# Ultrazone Plan Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit.

**Goal:** Add `/plan` so the agent can inspect and propose safely, and only an explicit approval or MAX can unlock execution.

**Architecture:** Plan state is append-only session data. `AgentSession` applies the shared read-only classifier before every direct or nested tool call, while `InteractiveMode` owns the confirmation screen.

**Tech Stack:** TypeScript, Vitest, existing session tree and faux provider.

**Spec:** `docs/superpowers/specs/2026-10-31-ultrazone-native-workflows-design.md`

**Depends on:** Startup/execution modes and built-in prompts plans.

## Global Constraints

- No Plan subagent and no model-driven self-approval.
- Unknown tools and uncertain shell commands fail closed.
- Plan content is branch-local; execution mode remains process-local.
- Run `npm run check` after code changes; do not commit.

---

### Task 1: Persist branch-local plan state

**Files:**
- Modify: `packages/coding-agent/src/core/session-manager.ts`
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Create: `packages/coding-agent/test/plan-state.test.ts`

**Interfaces:**
- Produces: `PlanStateEntry`, `appendPlanState()`, and `getPlanState()`.

```ts
export interface PlanStateEntry extends SessionEntryBase {
	type: "plan_state";
	goal: string;
	draft: string;
	status: "active" | "approved" | "cancelled";
	approvedBy?: "user" | "max";
}
```

- [ ] **Step 1: Write failing state and branch tests**

```ts
import { describe, expect, test } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";

describe("plan state", () => {
	test("uses the latest state on the current branch only", () => {
		const manager = SessionManager.inMemory("/work");
		manager.appendPlanState({ goal: "Fix login", draft: "Inspect auth", status: "active" });
		const active = manager.getPlanState();
		manager.appendPlanState({ goal: "Fix login", draft: "Inspect auth", status: "approved", approvedBy: "user" });
		expect(manager.getPlanState()).toMatchObject({ status: "approved", approvedBy: "user" });
		manager.branch(active!.id);
		expect(manager.getPlanState()).toMatchObject({ status: "active" });
	});

	test("does not inject plan metadata as an extra user message", () => {
		const manager = SessionManager.inMemory("/work");
		manager.appendPlanState({ goal: "Fix login", draft: "Inspect auth", status: "active" });
		expect(manager.buildSessionContext().messages).toEqual([]);
	});
});
```

- [ ] **Step 2: Verify the state tests fail**

Run from `packages/coding-agent`:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/plan-state.test.ts
```

Expected: FAIL because the plan methods do not exist.

- [ ] **Step 3: Implement append-only plan entries**

Add `PlanStateEntry` to `SessionEntry`, implement `appendPlanState(input: Omit<PlanStateEntry, keyof SessionEntryBase | "type">)`, and make `getPlanState()` scan the current branch backwards. Exclude `plan_state` from model projection, compaction cut points, and message counts while retaining it in export and resume data.

- [ ] **Step 4: Verify state and session regressions**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/plan-state.test.ts test/session-context-edit.test.ts test/sdk-session-manager.test.ts test/agent-session-branching.test.ts
npm run check
```

Expected: PASS and clean check.

---

### Task 2: Enforce read-only execution before approval

**Files:**
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Modify: `packages/coding-agent/src/core/tools/bash.ts`
- Create: `packages/coding-agent/test/plan-mode.test.ts`

**Interfaces:**
- Consumes: `isReadOnlyToolCall()` from the startup plan.
- Produces: `AgentSession.enterPlan(goal)`, `approvePlan(actor)`, `cancelPlan()`, and `AgentSession.planState`.

- [ ] **Step 1: Write failing tool-gate tests**

Use `createHarness()` and faux responses that request `read`, `write`, `bash`, an unannotated MCP tool, and a nested `write` through another tool. First verify the shared classifier directly, then verify the active plan gate through real tool results:

```ts
await harness.session.enterPlan("Fix login");
expect(harness.session.planState?.status).toBe("active");
expect(isReadOnlyToolCall("read", {}, undefined)).toBe(true);
expect(isReadOnlyToolCall("write", { path: "a.ts" }, undefined)).toBe(false);
expect(isReadOnlyToolCall("bash", { command: "git diff --stat" }, undefined)).toBe(true);
expect(isReadOnlyToolCall("bash", { command: "git diff && touch x" }, undefined)).toBe(false);

harness.faux.setResponses([fauxAssistantMessage([fauxToolCall("write", { path: "a.ts", content: "blocked" })])]);
await harness.session.prompt("attempt the write");
expect(getToolResult(harness, "write").isError).toBe(true);
```

Import `isReadOnlyToolCall` from the shared core location created by the startup plan and the faux response helpers from `@earendil-works/pi-ai/compat`. Add a nested custom tool that calls `executeTool("write", ...)` and assert its child result is also blocked; do not add a second production allowlist for tests.

- [ ] **Step 2: Verify the gate tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/plan-mode.test.ts
```

Expected: FAIL because plan mode is not connected to the tool gate.

- [ ] **Step 3: Connect plan state to every tool path**

`enterPlan(goal)` rejects while streaming or compacting, appends an active plan entry, and applies read-only execution. `approvePlan("user" | "max")` appends an approved entry and restores normal execution for later runs. `cancelPlan()` appends a cancelled entry and restores normal execution.

Apply this check before extension `tool_call` handlers and again through the nested execution path. Unknown MCP tools, `codemode`, shell composition, redirection, substitution, and environment assignments must reject with a plain-language reason. Retrying or compacting cannot clear the plan state.

- [ ] **Step 4: Verify direct, nested, and resume behavior**

Run the Step 2 test plus `test/prompt-execution.test.ts` and `test/suite/agent-session-tool-orchestration.test.ts`; expected PASS. Run `npm run check`; expected clean.

---

### Task 3: Add `/plan` interaction and automatic MAX approval

**Files:**
- Modify: `packages/coding-agent/src/core/slash-commands.ts`
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Create: `packages/coding-agent/test/interactive-plan.test.ts`

**Interfaces:**
- Consumes: native approval callback and `ExecutionMode`.
- Consumes: plan methods from Task 2.

- [ ] **Step 1: Write failing interaction tests**

Cover these exact flows using the existing interactive test harness:

```ts
await submit("/plan Fix the login redirect");
expect(lastUserPrompt()).toContain("Fix the login redirect");
expect(session.planState?.status).toBe("active");

await choose("Approve and implement");
expect(session.planState).toMatchObject({ status: "approved", approvedBy: "user" });
```

Add AUTO, which must show the same choice; MAX, which records `approvedBy: "max"`; busy `/plan`, which is rejected; and continue/cancel choices.

- [ ] **Step 2: Verify the interaction tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-plan.test.ts
```

Expected: FAIL because `/plan` is unknown.

- [ ] **Step 3: Implement the command and confirmation screen**

Register `/plan [goal]`. With a goal, enter plan mode and send a concise planning instruction. Without a goal, show the current draft or enter an empty planning session. On completion, show three choices in plain language:

1. `Approve and implement` (recommended).
2. `Continue planning`.
3. `Cancel plan`.

Explain that approval permits file edits and commands under the current execution mode. MAX chooses the first automatically and records it. Reject mode changes while the agent is busy.

- [ ] **Step 4: Verify all three modes and update docs**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-plan.test.ts test/plan-mode.test.ts test/plan-state.test.ts
npm run check
```

Update `packages/coding-agent/docs/usage.md`, `slash-commands.md`, `sessions.md`, and `security.md` with a short plain-language example and the exact read-only limits. Expected: PASS, clean check, no real provider calls, no commit.
