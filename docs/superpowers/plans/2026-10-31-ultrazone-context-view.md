# Ultrazone Context View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit.

**Goal:** Add `/context` to explain current context usage and the largest contributors without making model-specific token claims.

**Architecture:** `AgentSession` reads the existing session projection and system-prompt sections, using existing token estimation. `InteractiveMode` only formats the local report; no model request is made.

**Tech Stack:** TypeScript, Vitest, existing compaction estimation and session projection.

**Spec:** `docs/superpowers/specs/2026-10-31-ultrazone-native-workflows-design.md`

**Depends on:** Startup/execution modes plan.

## Global Constraints

- No subagents and no real model call for `/context`.
- Provider-reported totals and estimated category values are labeled separately.
- Inactive prompts and resources are excluded.
- Run `npm run check` after code changes; do not commit.

---

### Task 1: Build a provider-neutral context report

**Files:**
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Modify: `packages/coding-agent/src/core/compaction/compaction.ts`
- Create: `packages/coding-agent/test/context-inspection.test.ts`

**Interfaces:**
- Produces: `ContextGroup`, `ContextInspection`, and `AgentSession.inspectContext()`.

```ts
export interface ContextGroup {
	id: string;
	label: string;
	category: "system" | "project" | "skill" | "tools" | "user" | "assistant" | "tool-result" | "image";
	sourcePath?: string;
	estimatedTokens: number;
}
export interface ContextInspection {
	provider: string;
	modelId: string;
	contextWindow: number;
	reserveTokens: number;
	currentTokens: number;
	countBasis: "reported-plus-estimated" | "estimated-only";
	groups: ContextGroup[];
	suggestions: string[];
}
```

- [ ] **Step 1: Write failing breakdown tests**

Using `createHarness()`, append a system message with named sections, a user message, and a large tool result. Assert:

```ts
const report = harness.session.inspectContext();
expect(report.groups.find((group) => group.id === "system:project_context")?.estimatedTokens).toBeGreaterThan(0);
expect(report.groups.find((group) => group.id === "tool-result:read")?.estimatedTokens).toBeGreaterThan(0);
expect(report.groups.some((group) => group.label.includes("unused.md"))).toBe(false);
expect(report.countBasis).toBe("estimated-only");
expect(report.currentTokens).toBe(report.groups.reduce((sum, group) => sum + group.estimatedTokens, 0));
```

Add a second case with assistant usage and assert `countBasis === "reported-plus-estimated"`, without requiring estimated categories to equal the provider total. Add a near-limit case that suggests compaction and a small-context case that emits no generic warning.

- [ ] **Step 2: Verify the report tests fail**

Run from `packages/coding-agent`:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/context-inspection.test.ts
```

Expected: FAIL because `inspectContext` is absent.

- [ ] **Step 3: Implement projection-based grouping**

Use `sessionManager.buildSessionProjection()` and `estimateProjectedContextTokens()` for current usage. Reuse `estimateTokens()` for category estimates; do not introduce another character formula.

Read the current `SystemMessage.sections` so groups use actual section names such as `system:project_context` and `system:skills`. Group tool results by `toolName`, count image blocks separately, and never iterate the resource directory to add inactive prompts. Preserve source paths only where the current message already contains them.

Generate suggestions from measured thresholds: approaching the compaction reserve, one tool result dominating the trailing estimate, repeated large reads, or an unusually large active skill section. Return no suggestion when none applies.

- [ ] **Step 4: Verify report and compaction regressions**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/context-inspection.test.ts test/suite/agent-session-compaction.test.ts
npm run check
```

Expected: PASS and clean check.

---

### Task 2: Display `/context` without changing the session

**Files:**
- Modify: `packages/coding-agent/src/core/slash-commands.ts`
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Create: `packages/coding-agent/test/interactive-context.test.ts`

**Interfaces:**
- Consumes: `AgentSession.inspectContext()`.

- [ ] **Step 1: Write failing display tests**

```ts
const requestCountBefore = fauxRequestCount();
await submit("/context");
expect(fauxRequestCount()).toBe(requestCountBefore);
expect(overlayText()).toContain("Estimated");
expect(overlayText()).toContain("Context window");
expect(overlayText()).toContain("tool-result:read");
expect(userMessagesAfterCommand()).toHaveLength(0);
```

Add reported-plus-estimated labeling, large-number formatting, sorted largest groups, empty-session text, and close-key behavior.

- [ ] **Step 2: Verify display tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-context.test.ts
```

Expected: FAIL because `/context` is unknown.

- [ ] **Step 3: Implement the local report overlay**

Register `/context`. Show model and window first, current usage and basis second, then the largest groups. Use `Estimated` or `Reported + estimated` visibly; never label character-derived categories as exact. Show concrete suggestions only when returned by `inspectContext()`.

Do not call `prompt()`, `sendUserMessage()`, compaction, or resource mutation from this command. Closing the overlay returns focus to the editor.

- [ ] **Step 4: Verify zero model calls and update docs**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-context.test.ts test/context-inspection.test.ts
npm run check
```

Update `packages/coding-agent/docs/usage.md`, `slash-commands.md`, `sessions.md`, and `compaction.md` to distinguish actual provider usage from category estimates. Expected: PASS, clean check, no commit.
