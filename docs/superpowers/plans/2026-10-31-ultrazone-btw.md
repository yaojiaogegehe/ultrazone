# Ultrazone Btw Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit.

**Goal:** Add `/btw` for a read-only side question that leaves the main task and its model context untouched.

**Architecture:** A separate short-lived session receives the last complete context snapshot and only read-only tools. Its records live in dedicated session entries excluded from the main model projection.

**Tech Stack:** TypeScript, Vitest, existing AgentSession, in-memory SessionManager, faux provider.

**Spec:** `docs/superpowers/specs/2026-10-31-ultrazone-native-workflows-design.md`

**Depends on:** Startup/execution modes and built-in prompts plans.

## Global Constraints

- No task delegation and no writes, including in MAX.
- Main execution is not aborted or steered.
- Side content enters the main context only through an explicit user action.
- One active side request per session.
- Run `npm run check` after code changes; do not commit.

---

### Task 1: Persist side exchanges outside the main model context

**Files:**
- Modify: `packages/coding-agent/src/core/session-manager.ts`
- Create: `packages/coding-agent/test/btw-state.test.ts`

**Interfaces:**
- Produces: `BtwEntry`, `appendBtw()`, and `listBtw()`.

```ts
export interface BtwEntry extends SessionEntryBase {
	type: "btw";
	question: string;
	answer: string;
	status: "running" | "done" | "error";
	contextLeafId: string | null;
	replyToId?: string;
}
```

- [ ] **Step 1: Write failing projection and history tests**

```ts
test("stores side history without adding it to main model messages", () => {
	const manager = SessionManager.inMemory("/work");
	manager.appendMessage({ role: "user", content: "main task", timestamp: 1 });
	manager.appendBtw({ question: "why?", answer: "because", status: "done", contextLeafId: manager.getLeafId() });
	expect(manager.listBtw()).toHaveLength(1);
	expect(manager.buildSessionContext().messages.map((message) => message.role)).toEqual(["user"]);
	expect(manager.buildSessionContext().messages[0]).toMatchObject({ content: "main task" });
});
```

Add multiple entries, resume serialization, and branch filtering by `contextLeafId` without deleting side history.

- [ ] **Step 2: Verify state tests fail**

Run from `packages/coding-agent`:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/btw-state.test.ts
```

Expected: FAIL because `appendBtw` is absent.

- [ ] **Step 3: Implement dedicated append-only entries**

Add `BtwEntry` to `SessionEntry`. `appendBtw()` records a new exchange; later status and answer updates append another entry linked to the original question rather than mutating it. `listBtw()` folds linked entries into the latest state for display. Exclude `btw` from model projection, compaction input, and main-session user/assistant counts while retaining it in export and resume.

- [ ] **Step 4: Verify state and session regressions**

Run the Step 2 test plus existing session projection tests and `npm run check`; expected PASS and clean check.

---

### Task 2: Run a single read-only side session

**Files:**
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Modify: `packages/coding-agent/src/core/sdk.ts`
- Modify: `packages/coding-agent/src/core/resource-loader.ts`
- Create: `packages/coding-agent/test/btw-session.test.ts`

**Interfaces:**
- Produces: `AgentSession.askBtw(question): Promise<string>`, `cancelBtw()`, `bringBtwIntoMain(id)`, and `listBtw(): BtwEntry[]` delegated to the session manager.
- Produces: `AgentSessionConfig.readOnly?: boolean`, always enforced by the shared tool classifier.

- [ ] **Step 1: Write failing side-session tests**

Use two independently controlled faux providers or response queues. Hold the main response open, then call:

```ts
const sideId = await session.askBtw("Why is this check here?");
expect(session.isStreaming).toBe(true);
expect(session.listBtw()[0]?.question).toBe("Why is this check here?");
expect(mainContextTexts()).not.toContain("Why is this check here?");
expect(sideContextTexts()).toContain("last completed main message");
```

Add a side `write` attempt that fails, a second concurrent `askBtw` rejection, cancellation, and explicit `bringBtwIntoMain(sideId)` that adds one user-visible exchange only after the user chooses it.

- [ ] **Step 2: Verify side-session tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/btw-session.test.ts
```

Expected: FAIL because side sessions do not exist.

- [ ] **Step 3: Implement the isolated factory and lifecycle**

In `sdk.ts`, provide a factory that creates a fresh Agent/session with:

- An in-memory `SessionManager` containing only the last complete main projection.
- The current model and shared `ModelRuntime`.
- A new resource loader with extensions and MCP disabled, so side work cannot trigger main-session extension side effects.
- An appended system instruction identifying this as a read-only side question and giving the current main-task status.
- `readOnly: true` and the shared tool classifier, including safe Shell rules.

Do not reuse the main `Agent` instance. The side session gets its own abort controller, usage accounting, and disposal. Store the main leaf ID and show that filesystem reads observe live files, not a frozen filesystem snapshot.

`askBtw` rejects empty questions and concurrent requests. Completion appends the answer as `done`; errors append `error`. `bringBtwIntoMain(id)` requires an explicit call and submits the selected question/answer as the next main user input. Cancellation and session replacement dispose only the side request.

- [ ] **Step 4: Verify isolation and regressions**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/btw-session.test.ts test/btw-state.test.ts test/suite/agent-session-queue.test.ts
npm run check
```

Expected: PASS and clean check.

---

### Task 3: Add `/btw` overlay and history

**Files:**
- Modify: `packages/coding-agent/src/core/slash-commands.ts`
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Create: `packages/coding-agent/test/interactive-btw.test.ts`

**Interfaces:**
- Consumes: side-session methods and entries.

- [ ] **Step 1: Write failing overlay tests**

```ts
await submit("/btw Why did the main task choose this file?");
expect(sideOverlayText()).toContain("Why did the main task choose this file?");
expect(mainTranscriptText()).not.toContain("Why did the main task choose this file?");
await finishSideAnswer("It owns validation.");
expect(sideOverlayText()).toContain("It owns validation.");
await submit("/btw");
expect(sideOverlayText()).toContain("It owns validation.");
```

Add busy-side rejection, live-file-change warning, close/reopen, cancellation, and explicit bring-into-main behavior.

- [ ] **Step 2: Verify overlay tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-btw.test.ts
```

Expected: FAIL because `/btw` is unknown.

- [ ] **Step 3: Implement the overlay**

Register `/btw [question]`. With a question, open a focused answer overlay while leaving the main run active. Without a question, reopen the latest side exchange and allow history navigation. Display running, done, error, snapshot time, and live-file warning in plain language.

Offer `Bring into main conversation` only as a separate explicit action. MAX does not perform that action automatically because it changes the main model context rather than merely approving a tool.

- [ ] **Step 4: Verify UI and update docs**

Run the Step 2 test plus side state/session tests and `npm run check`. Update `packages/coding-agent/docs/usage.md`, `slash-commands.md`, `sessions.md`, and `security.md` with the read-only and context-isolation guarantees. Expected: PASS, clean check, no commit.
