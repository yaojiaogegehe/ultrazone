# Ultrazone Rewind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit.

**Goal:** Add `/rewind` to branch the conversation and safely restore files captured before built-in edits, without overwriting later user changes.

**Architecture:** Core `edit/write` capture local file states inside the existing mutation queue. Content-addressed snapshots and transaction journals live under the Ultrazone agent directory; interactive code reuses the Diff renderer for previews.

**Tech Stack:** TypeScript, Node.js filesystem/crypto, Vitest, existing file mutation queue and session tree.

**Spec:** `docs/superpowers/specs/2026-10-31-ultrazone-native-workflows-design.md`

**Depends on:** All startup, prompts, plan, diff, context, loop, and btw plans must be implemented and their tests must pass before Task 1 starts.

## Global Constraints

- No subagents, `git reset --hard`, or whole-workspace replacement.
- Only local built-in `edit/write` changes are guaranteed; Shell, custom tools, remote backends, symlinks, and hard links are reported as uncovered.
- Never overwrite external changes or claim a partial restore is complete.
- MAX automates approvals, not conflict handling or missing snapshots.
- Run `npm run check` after code changes; do not commit.

---

### Task 1: Capture before/after states inside the file mutation queue

**Files:**
- Modify: `packages/coding-agent/src/config.ts`
- Modify: `packages/coding-agent/src/core/tools/edit.ts`
- Modify: `packages/coding-agent/src/core/tools/write.ts`
- Modify: `packages/coding-agent/src/core/tools/index.ts`
- Modify: `packages/coding-agent/src/core/sdk.ts`
- Modify: `packages/coding-agent/src/core/session-manager.ts`
- Create: `packages/coding-agent/test/checkpoint-harness.ts`
- Create: `packages/coding-agent/test/file-checkpoint-capture.test.ts`

**Interfaces:**
- Produces: `FileCheckpointEntry`, `CheckpointRecorder`, `getCheckpointsDir()`, and the test-only `createCheckpointHarness()`.

```ts
export interface CapturedState {
	exists: boolean;
	hash?: string;
	size?: number;
	mode?: number;
}
export interface FileCheckpointEntry extends SessionEntryBase {
	type: "file_checkpoint";
	path: string;
	toolCallId: string;
	before: CapturedState;
	after: CapturedState;
	skipped?: "too_large" | "remote_backend" | "symlink" | "hard_link" | "retention_limit";
}
export interface CheckpointRecorder {
	captureBefore(absolutePath: string): Promise<CapturedState>;
	captureAfter(absolutePath: string, before: CapturedState): Promise<void>;
}
```

The test helper has this exact shape and is shared by later tasks:

```ts
export interface CheckpointHarness {
	session: AgentSession;
	sessionManager: SessionManager;
	file(relativePath: string): string;
	editFile(relativePath: string, content: string): Promise<string>;
	failRestore(relativePath: string, error: Error): void;
}
```

- [ ] **Step 1: Write failing capture tests**

Build `test/checkpoint-harness.ts` on `createHarness()`, the real edit/write tools, and the production recorder. `file()` joins the temporary cwd and relative path; `editFile()` executes the real write tool and returns the new `file_checkpoint` entry ID. `failRestore()` arms a one-shot error in the injected restore filesystem adapter for Transaction Task 3; it does not change production global state.

Use it in the capture test:

```ts
const harness = await createCheckpointHarness();
writeFileSync(harness.file("a.txt"), "old\n");
const entryId = await harness.editFile("a.txt", "new\n");
const entry = harness.sessionManager.getEntry(entryId);
expect(entry).toMatchObject({
	type: "file_checkpoint",
	path: harness.file("a.txt"),
	before: { exists: true },
	after: { exists: true },
});
expect(entry?.type).toBe("file_checkpoint");
if (entry?.type === "file_checkpoint") expect(entry.before.hash).not.toBe(entry.after.hash);
```

Add tests for a newly created file, binary content, CRLF preservation, failed edit producing no checkpoint, two writes to one file serialized by the queue, a 10 MiB + 1 byte file marked `skipped: "too_large"`, custom remote operations marked `skipped: "remote_backend"`, and symlink/hard-link exclusions.

- [ ] **Step 2: Verify capture tests fail**

Run from `packages/coding-agent`:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/file-checkpoint-capture.test.ts
```

Expected: FAIL because checkpoint recording is absent.

- [ ] **Step 3: Implement content-addressed snapshots**

Store objects under `getAgentDir()/checkpoints/<sessionId>/objects/<sha256>` and journals under the sibling `transactions/` directory. Create directories with owner-only permissions where supported. Write object temp files and rename them atomically; never send object content to the model.

Set the first version limits to 10 MiB per file and 256 MiB retained objects per session. Capture `lstat`, content hash, size, and mode where available. Skip symlinks, files with multiple hard links, unsupported custom operations, and oversized files with an explicit reason.

Call `captureBefore` after entering `withFileMutationQueue` and before reading/writing. Call `captureAfter` after a successful mutation and before releasing the queue. Failed mutations append no successful checkpoint. Wire one recorder through `ToolsOptions` in `sdk.ts`, closing over the mutable `SessionManager` and current tool-call ID; read-only session context is not used for appends.

`FileCheckpointEntry` remains outside model context but is exported with the session. Complete `test/checkpoint-harness.ts` only after the production interfaces exist; later tasks reuse it rather than inventing new setup helpers.

- [ ] **Step 4: Verify capture and tool regressions**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/file-checkpoint-capture.test.ts test/edit-tool-legacy-input.test.ts test/edit-tool-no-full-redraw.test.ts test/suite/agent-session-tool-orchestration.test.ts
npm run check
```

Expected: PASS and clean check.

---

### Task 2: Build checkpoint lists and a non-destructive restore plan

**Files:**
- Modify: `packages/coding-agent/src/core/session-manager.ts`
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Create: `packages/coding-agent/test/rewind-plan.test.ts`

**Interfaces:**
- Produces: `CheckpointSummary`, `RewindPlan`, `listCheckpoints()`, and `planRewind()`.

```ts
export interface CheckpointSummary {
	targetEntryId: string;
	userText: string;
	fileCount: number;
	uncoveredCount: number;
}
export interface RewindFileAction {
	path: string;
	action: "restore" | "delete-new-file" | "unchanged" | "conflict" | "uncovered";
	reason?: string;
}
export interface RewindPlan {
	targetEntryId: string;
	includeFiles: boolean;
	actions: RewindFileAction[];
	partial: boolean;
}
```

- [ ] **Step 1: Write failing preflight tests**

```ts
test("refuses to overwrite a file changed after the agent", async () => {
	const harness = await createCheckpointHarness();
	const targetEntryId = await harness.editFile("a.txt", "agent\n");
	writeFileSync(harness.file("a.txt"), "user\n");
	const plan = await harness.session.planRewind(targetEntryId, true);
	expect(plan.actions).toContainEqual({
		path: harness.file("a.txt"),
		action: "conflict",
		reason: "changed_after_agent",
	});
	expect(plan.partial).toBe(true);
});
```

Add unchanged files, deletion of an agent-created file only when its current hash still matches, missing snapshot, a checkpoint-level warning after Shell execution that is not assigned to an unverified file, multiple checkpoints on one path, and branch-specific summaries.

- [ ] **Step 2: Verify preflight tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/rewind-plan.test.ts
```

Expected: FAIL because `planRewind` is absent.

- [ ] **Step 3: Implement summaries and read-only preflight**

Fold checkpoint entries by user turn and path, retaining the earliest before-state and latest after-state. Compare current file hashes without modifying anything. Classify every action and mark the plan partial when any conflict, uncovered path, or missing object exists.

`planRewind(targetEntryId, false)` performs no filesystem reads beyond session metadata and contains no file actions. `planRewind` never calls `branch()` or writes an object; it only describes what a later confirmed restore may do.

- [ ] **Step 4: Verify preflight and history regressions**

Run the Step 2 tests plus capture tests and session projection tests. Run `npm run check`; expected PASS and clean check.

---

### Task 3: Apply restore as a recoverable transaction

**Files:**
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Modify: `packages/coding-agent/src/core/session-manager.ts`
- Create: `packages/coding-agent/test/rewind-transaction.test.ts`

**Interfaces:**
- Produces: `applyRewind(plan, options): Promise<RewindResult>` and `recoverInterruptedRewinds()`.

```ts
export interface RewindResult {
	status: "done" | "partial" | "failed";
	restoredPaths: string[];
	skipped: RewindFileAction[];
	decidedBy: "user" | "max";
}
```

- [ ] **Step 1: Write failing transaction tests**

Inject a filesystem failure for the second of two restores and assert:

```ts
const harness = await createCheckpointHarness();
const targetEntryId = await harness.editFile("a.txt", "a1\n");
await harness.editFile("b.txt", "b1\n");
const plan = await harness.session.planRewind(targetEntryId, true);
const firstFile = harness.file("a.txt");
const secondFile = harness.file("b.txt");
const firstBeforeAttempt = readFileSync(firstFile, "utf8");
const secondBeforeAttempt = readFileSync(secondFile, "utf8");
const originalLeafId = harness.sessionManager.getLeafId();
harness.failRestore("b.txt", new Error("injected restore failure"));

const result = await harness.session.applyRewind(plan, { decidedBy: "user" });
expect(result.status).toBe("failed");
expect(readFileSync(firstFile, "utf8")).toBe(firstBeforeAttempt);
expect(readFileSync(secondFile, "utf8")).toBe(secondBeforeAttempt);
expect(harness.sessionManager.getLeafId()).toBe(originalLeafId);
```

Add explicit conflict exclusions producing `partial`, an agent-created file deletion, a crash journal recovered on the next call, and successful conversation branching only after all selected file operations finish.

- [ ] **Step 2: Verify transaction tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/rewind-transaction.test.ts
```

Expected: FAIL because transactional restore is absent.

- [ ] **Step 3: Implement pre-backup, journal, atomic restore, and rollback**

Recheck every selected hash immediately before writing to close the preflight/write race. Back up current states into a transaction object and write a journal containing target, selected actions, backups, and state. Use atomic rename for content restoration and only delete newly created files whose current hash still matches.

If any selected operation fails, restore every already-written path from the transaction backup, mark the journal failed, and leave the session leaf untouched. On success, mark the journal done and only then call `sessionManager.branch(targetEntryId)`. Preserve the original conversation branch.

Run `recoverInterruptedRewinds()` before accepting new edits at startup. A journal in `applying` state is rolled back to its pre-attempt states; a completed journal only needs pruning.

- [ ] **Step 4: Verify failure recovery and tool regressions**

Run the Step 2 tests, capture/preflight tests, and relevant session suite files. Run `npm run check`; expected PASS and clean check.

---

### Task 4: Add `/rewind` choices, retention, and documentation

**Files:**
- Modify: `packages/coding-agent/src/core/slash-commands.ts`
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Modify: `packages/coding-agent/src/modes/interactive/components/diff.ts`
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Create: `packages/coding-agent/test/interactive-rewind.test.ts`

**Interfaces:**
- Consumes: native approval callback, checkpoint summaries, restore plans, and transactions.

- [ ] **Step 1: Write failing mode and presentation tests**

```ts
await submit("/rewind");
expect(overlayText()).toContain("Conversation only");
expect(overlayText()).toContain("Conversation and captured files");
expect(overlayText()).toContain("user changed after agent");
await choose("Conversation and captured files");
expect(approvalSubjects()).toContain("rewind");
```

Add AUTO requiring the same confirmation, MAX choosing the latest safe checkpoint with conversation plus restorable files, partial-result wording, conversation-only restore, and pruning that retains objects referenced by another branch.

- [ ] **Step 2: Verify interaction tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-rewind.test.ts
```

Expected: FAIL because `/rewind` is unknown.

- [ ] **Step 3: Implement the native picker and mode behavior**

List checkpoints by user turn with message summary, file count, and uncovered count. Preview restore/delete/conflict/uncovered paths using the existing Diff renderer. Default and AUTO require explicit target, scope, and conflict-exclusion confirmation. MAX uses the specified target or latest safe checkpoint and includes conversation plus all safely restorable files; conflicts remain excluded and produce `partial`.

Record `decidedBy` and never persist MAX as the next launch mode. Prune unreferenced objects only after scanning every branch in the session. If referenced objects exceed 256 MiB, keep them and mark later captures `skipped: "retention_limit"` with a visible warning; never delete referenced content merely to satisfy the limit. Do not add a force-overwrite action.

- [ ] **Step 4: Verify end-to-end behavior and update docs**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-rewind.test.ts test/rewind-transaction.test.ts test/rewind-plan.test.ts test/file-checkpoint-capture.test.ts
npm run check
```

Update `packages/coding-agent/docs/usage.md`, `slash-commands.md`, `sessions.md`, `security.md`, and `configuration.md` with snapshot coverage, storage limits, partial restores, crash recovery, and mode behavior. Exercise the real terminal using faux providers and temporary repositories. Expected: PASS, clean check, no real provider calls, no commit.
