# Ultrazone Diff View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit.

**Goal:** Add `/diff` to show working-tree changes against session start, HEAD, or the default branch without misleading pre-existing changes as agent work.

**Architecture:** Existing Git utilities collect read-only repository data. `InteractiveMode` renders it in a dismissible overlay and owns refresh timers, with no background work after close.

**Tech Stack:** TypeScript, Node.js `child_process`, existing `diff` package, Vitest, temporary Git repositories.

**Spec:** `docs/superpowers/specs/2026-10-31-ultrazone-native-workflows-design.md`

**Depends on:** Startup/execution modes plan.

## Global Constraints

- No subagents and no copying Claude Code implementation.
- Git commands are read-only and use `--no-optional-locks`.
- “Session” means session-start HEAD, not “only agent edits”.
- Test files are never folded as noise.
- Run `npm run check` after code changes; do not commit.

---

### Task 1: Collect repository changes and persist the session-start HEAD

**Files:**
- Modify: `packages/coding-agent/src/utils/git.ts`
- Modify: `packages/coding-agent/src/core/session-manager.ts`
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Create: `packages/coding-agent/test/workspace-diff.test.ts`

**Interfaces:**
- Produces: `DiffBase`, `WorkspaceDiffFile`, `WorkspaceDiff`, `collectWorkspaceDiff()`.

```ts
export interface RepositoryStateEntry extends SessionEntryBase {
	type: "repository_state";
	sessionStartHead: string;
}
export type DiffBase =
	| { kind: "head" }
	| { kind: "session"; head: string }
	| { kind: "merge-base"; branch: string };
export interface WorkspaceDiffFile {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed";
	patch: string;
	generated: boolean;
}
export interface WorkspaceDiff {
	baseLabel: string;
	files: WorkspaceDiffFile[];
	additions: number;
	deletions: number;
}
```

- [ ] **Step 1: Write failing temporary-repository tests**

Create a test helper that initializes a repository with `git init`, local test author config, and an initial commit. Set `repo` to that temporary directory and `initialHead` to the exact output of `git rev-parse HEAD` before changing files. Test:

```ts
test("includes tracked and untracked changes without touching the index", async () => {
	writeFileSync(join(repo, "tracked.txt"), "new\n");
	writeFileSync(join(repo, "new.txt"), "first\n");
	const result = await collectWorkspaceDiff(repo, { kind: "head" });
	expect(result.files.map((file) => file.path).sort()).toEqual(["new.txt", "tracked.txt"]);
	expect(result.files.find((file) => file.path === "new.txt")?.patch).toContain("+first");
	expect(existsSync(join(repo, ".git", "index.lock"))).toBe(false);
});

test("labels the exact comparison base", async () => {
	const result = await collectWorkspaceDiff(repo, { kind: "session", head: initialHead });
	expect(result.baseLabel).toBe(`session ${initialHead.slice(0, 8)}`);
});
```

Add non-repository, unborn-HEAD, rename, lockfile/generated folding metadata, and ordinary test-file visibility cases.

- [ ] **Step 2: Verify the collector tests fail**

Run from `packages/coding-agent`:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/workspace-diff.test.ts
```

Expected: FAIL because `collectWorkspaceDiff` is absent.

- [ ] **Step 3: Implement read-only collection**

Use `execFile("git", ["--no-optional-locks", ...])`; never use a shell for repository paths. Collect status, numstat, and patches, bounding output and reporting truncation. Use `Diff.createTwoFilesPatch` for untracked text files and mark binary or oversized files with an explicit unavailable patch instead of reading unbounded data.

Resolve merge-base with `git merge-base HEAD <default-branch>`. Detect the default branch from `origin/HEAD`, then a uniquely available `main` or `master`; otherwise return a readable error. Do not infer it from the current branch name.

Add a session metadata entry recording the initial HEAD when a new session starts in a repository. Resume reads that entry; older sessions without it use current HEAD once and label the base as `approximate session start` rather than claiming exact history.

- [ ] **Step 4: Verify collector and session regressions**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/workspace-diff.test.ts test/session-context-edit.test.ts test/sdk-session-manager.test.ts test/agent-session-branching.test.ts
npm run check
```

Expected: PASS and clean check.

---

### Task 2: Render `/diff` and manage its lifecycle

**Files:**
- Modify: `packages/coding-agent/src/core/slash-commands.ts`
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Modify: `packages/coding-agent/src/modes/interactive/components/diff.ts`
- Create: `packages/coding-agent/test/interactive-diff.test.ts`

**Interfaces:**
- Consumes: `collectWorkspaceDiff()` and session-start HEAD.
- Produces: `DiffBase` switching inside the existing interactive overlay.

- [ ] **Step 1: Write failing overlay lifecycle tests**

Using the existing fake terminal and a temporary repository, assert:

```ts
await submit("/diff");
expect(overlayText()).toContain("tracked.txt");
expect(overlayText()).toContain("HEAD");

await editFileThroughSession("tracked.txt", "second\n");
await advanceRefreshDebounce();
expect(overlayText()).toContain("+second");

await closeOverlay();
const timerCount = activeGitTimerCount();
await advanceHeadPoll();
expect(activeGitTimerCount()).toBe(timerCount);
```

Add narrow-terminal stacking, base switching, non-repository text, slow-Git backoff, and no-duplicate-refresh cases. Implement `activeGitTimerCount()` as a test harness inspection helper, not production global state.

- [ ] **Step 2: Verify the overlay tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-diff.test.ts
```

Expected: FAIL because `/diff` is unknown.

- [ ] **Step 3: Implement the native overlay and refresh rules**

Register `/diff`. Reuse the existing diff syntax renderer and overlay focus handling. Show base label, file list, additions/deletions, patch, and explicit truncated/binary states. Collapse lockfiles and generated files by default; render test files normally.

Refresh after successful `edit/write` and after every completed Shell command, whether success, failure, or interruption. Debounce bursts to one collection. Poll HEAD only while open. If collection exceeds 150 ms, delay the next automatic refresh by the observed duration, capped at 30 seconds; consecutive timeouts back off to at most 60 seconds. Manual open and base switching bypass the delay but queue behind an active collection.

- [ ] **Step 4: Verify interaction, cleanup, and documentation**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-diff.test.ts test/workspace-diff.test.ts
npm run check
```

Update `packages/coding-agent/docs/usage.md`, `slash-commands.md`, and `keybindings.md` with `/diff`, base meanings, close keys, and refresh behavior. Expected: PASS, clean check, no timers after close, no commit.
