# Ultrazone Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit.

**Goal:** Add `/loop` for bounded, session-local recurring prompts without overlapping runs or surprise execution after restart.

**Architecture:** `AgentSession` owns timers and submits work to the same main session. Interactive code registers commands and displays state; all timers are disposed on session replacement or shutdown.

**Tech Stack:** TypeScript, Node.js timers, Vitest fake timers, faux provider.

**Spec:** `docs/superpowers/specs/2026-10-31-ultrazone-native-workflows-design.md`

**Depends on:** Startup/execution modes and plan mode plans.

## Global Constraints

- No subagents, overlapping runs, catch-up bursts, or automatic restart.
- Loop cannot create another Loop or bypass plan/read-only mode.
- Mode is inherited from the current process and never elevated.
- Run `npm run check` after code changes; do not commit.

---

### Task 1: Implement the session-local scheduler

**Files:**
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Modify: `packages/coding-agent/src/core/extensions/types.ts`
- Create: `packages/coding-agent/test/loop-scheduler.test.ts`

**Interfaces:**
- Produces: `LoopTaskView` and the following session methods:

```ts
export interface LoopTaskView {
	id: string;
	intervalMs: number;
	prompt: string;
	status: "active" | "paused" | "stopped";
	nextRunAt: number;
	consecutiveFailures: number;
	lastSkipReason?: string;
}

startLoop(intervalMs: number, prompt: string): LoopTaskView;
pauseLoop(id: string): boolean;
resumeLoop(id: string): boolean;
stopLoop(id: string): boolean;
listLoops(): LoopTaskView[];
```

- [ ] **Step 1: Write failing fake-timer tests**

```ts
import { fauxAssistantMessage, type AssistantMessage } from "@earendil-works/pi-ai/compat";

test("skips a busy run without queuing catch-up work", async () => {
	vi.useFakeTimers();
	try {
		const harness = await createHarness();
		let releaseFirst!: () => void;
		harness.faux.setResponses([
			() => new Promise<AssistantMessage>((resolve) => {
				releaseFirst = () => resolve(fauxAssistantMessage("first"));
			}),
			fauxAssistantMessage("second"),
		]);
		harness.session.startLoop(60_000, "check deploy");
		await vi.advanceTimersByTimeAsync(60_000);
		expect(harness.session.isStreaming).toBe(true);
		expect(getUserTexts(harness)).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(getUserTexts(harness)).toHaveLength(1);
		expect(harness.session.listLoops()[0]?.lastSkipReason).toBe("busy");
		releaseFirst();
		await vi.waitFor(() => expect(harness.session.isStreaming).toBe(false));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(getUserTexts(harness)).toHaveLength(2);
	} finally {
		vi.useRealTimers();
	}
});
```

Add minimum interval rejection, `/loop` prompt rejection, pause/resume, plan-mode pause, three-failure auto-pause, and disposal tests.

- [ ] **Step 2: Verify scheduler tests fail**

Run from `packages/coding-agent`:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/loop-scheduler.test.ts
```

Expected: FAIL because the loop methods are absent.

- [ ] **Step 3: Implement one timer per task with no backlog**

Require `intervalMs >= 60_000`, a non-empty prompt, and a prompt that does not begin with `/loop`. Generate short unique IDs from `randomUUID().slice(0, 8)`.

On each firing:

- If the session is streaming, compacting, or in plan mode, record the skip and schedule the next interval without submitting work.
- Otherwise submit the prompt once with input source `loop` and a `[loop:<id>]` display marker.
- Observe settlement to reset or increment consecutive failures; pause after three.
- Do not create overlapping timers or an immediate retry.

Add `loop` to the existing `InputSource` union used by extension input events. Clear every timer in `dispose()`, session replacement, and shutdown. Do not persist active timers or resume them from session files.

- [ ] **Step 4: Verify scheduler and lifecycle regressions**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/loop-scheduler.test.ts test/suite/agent-session-queue.test.ts test/suite/agent-session-runtime.test.ts
npm run check
```

Expected: PASS and clean check.

---

### Task 2: Add Loop commands and visible status

**Files:**
- Modify: `packages/coding-agent/src/core/slash-commands.ts`
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Create: `packages/coding-agent/test/interactive-loop.test.ts`

**Interfaces:**
- Consumes: Loop methods and `ExecutionMode`.

- [ ] **Step 1: Write failing command tests**

```ts
await submit("/loop 5m check the deploy");
expect(session.listLoops()).toHaveLength(1);
expect(session.listLoops()[0]).toMatchObject({ intervalMs: 300_000, prompt: "check the deploy", status: "active" });
const id = session.listLoops()[0]!.id;
await submit(`/loop pause ${id}`);
expect(session.listLoops()[0]?.status).toBe("paused");
await submit(`/loop stop ${id}`);
expect(session.listLoops()).toHaveLength(0);
```

Add list output with next run and skip reason, invalid interval text, plan-mode status, shutdown cleanup, and inherited MAX behavior. Assert the user sees actual consequences: `Runs only in this session; busy runs are skipped.`

- [ ] **Step 2: Verify command tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-loop.test.ts
```

Expected: FAIL because `/loop` is unknown.

- [ ] **Step 3: Implement command parsing and plain-language status**

Support the exact command forms from the spec. Parse `s`, `m`, and `h` into milliseconds, rejecting values below 60 seconds and prompts that start another Loop.

`/loop list` shows ID, interval, state, next run, failures, and last skip reason. Prompt submissions from the scheduler display `[loop:id]` and usage through existing transcript components. Do not add an extra confirmation after the user explicitly creates a Loop; critical workflows inside it still use the current execution mode.

- [ ] **Step 4: Verify commands and update docs**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-loop.test.ts test/loop-scheduler.test.ts
npm run check
```

Update `packages/coding-agent/docs/usage.md`, `slash-commands.md`, `sessions.md`, and `security.md` with scheduling limits, cost visibility, non-persistence, and mode behavior. Expected: PASS, clean check, no commit.
