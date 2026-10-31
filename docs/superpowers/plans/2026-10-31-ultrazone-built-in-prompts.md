# Ultrazone Built-in Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit.

**Goal:** Ship original `/review`, `/security-review`, `/feature`, and `/prompt-audit` commands with enforced read-only and approval behavior.

**Architecture:** Bundled Markdown uses the existing prompt resource loader. New execution metadata travels with the expanded prompt so core tool rules, not model wording alone, protect the initial run.

**Tech Stack:** TypeScript, Markdown, Vitest, existing faux provider harness.

**Spec:** `docs/superpowers/specs/2026-10-31-ultrazone-native-workflows-design.md`

**Depends on:** `docs/superpowers/plans/2026-10-31-ultrazone-startup-and-execution-modes.md`

## Global Constraints

- No subagents and no provider-specific prompt variants.
- Prompt instructions are short English; answers follow the user's language.
- Do not request hidden reasoning or fixed JSON output.
- Read-only commands cannot write even in MAX.
- `/feature` starts read-only and changes to normal tools only after approval.
- Run `npm run check` after code changes; do not run real provider tests or commit.

---

### Task 1: Prompt execution metadata and bundled resource loading

**Files:**
- Modify: `packages/coding-agent/src/core/prompt-templates.ts`
- Modify: `packages/coding-agent/src/core/resource-loader.ts`
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Modify: `packages/coding-agent/src/core/tools/bash.ts`
- Modify: `packages/coding-agent/src/config.ts`
- Modify: `packages/coding-agent/package.json`
- Modify: `packages/coding-agent/test/prompt-templates.test.ts`
- Create: `packages/coding-agent/test/prompt-execution.test.ts`

**Interfaces:**
- Produces: `PromptExecution = "default" | "read-only" | "approval-required"`.
- Produces: `ExpandedPrompt = { text: string; execution: PromptExecution }`.
- Produces: `expandPromptTemplateDetailed(text, templates): ExpandedPrompt`.
- Preserves: existing `expandPromptTemplate(...): string` as a wrapper returning `.text`.
- Consumes: `isReadOnlyToolCall(name, input, annotations): boolean` from the startup plan; do not implement a second classifier.

- [ ] **Step 1: Write failing metadata and execution tests**

Add to `test/prompt-templates.test.ts`:

```ts
import { expandPromptTemplateDetailed } from "../src/core/prompt-templates.ts";

test("reads execution metadata without changing default templates", () => {
	const dir = mkdtempSync(join(tmpdir(), "ultrazone-prompt-"));
	try {
		writeFileSync(join(dir, "normal.md"), "Review this");
		writeFileSync(join(dir, "guarded.md"), "---\nexecution: read-only\n---\nReview this");
		const { prompts } = loadPromptTemplates({
			cwd: dir,
			agentDir: join(dir, "agent"),
			promptPaths: [dir],
			includeDefaults: false,
		});
		expect(expandPromptTemplateDetailed("/normal", prompts)).toEqual({ text: "Review this", execution: "default" });
		expect(expandPromptTemplateDetailed("/guarded", prompts)).toEqual({ text: "Review this", execution: "read-only" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
```

The existing test file already imports `mkdtempSync`, `rmSync`, `writeFileSync`, `tmpdir`, `join`, and `loadPromptTemplates`; add only the detailed-expansion import.

Create `test/prompt-execution.test.ts` with faux-provider responses that attempt `write` and `bash` during `/review`, and assert:

```ts
expect(getToolResult(harness, "write").isError).toBe(true);
expect(getToolResult(harness, "write").content[0]).toMatchObject({
	type: "text",
	text: expect.stringContaining("read-only"),
});
const successfulWrites = harness.sessionManager.getBranch().filter((entry) =>
	entry.type === "message" &&
	entry.message.role === "toolResult" &&
	entry.message.toolName === "write" &&
	!entry.message.isError,
);
expect(successfulWrites).toEqual([]);
```

Add cases proving `read`, `grep`, `git diff --stat`, and `git status --short` are allowed, while `git status --short && touch x`, redirection, substitution, and unknown MCP tools are rejected.

- [ ] **Step 2: Verify the tests fail**

Run from `packages/coding-agent`:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/prompt-templates.test.ts test/prompt-execution.test.ts
```

Expected: FAIL because detailed expansion and execution enforcement do not exist.

- [ ] **Step 3: Implement metadata, loading, and the shared read-only classifier**

Add frontmatter parsing for exactly `execution: read-only`, `execution: approval-required`, and `execution: default`; unknown values produce a resource diagnostic and fall back to `default`.

Use this public shape:

```ts
export type PromptExecution = "default" | "read-only" | "approval-required";
export interface ExpandedPrompt {
	text: string;
	execution: PromptExecution;
}

export function expandPromptTemplateDetailed(text: string, templates: PromptTemplate[]): ExpandedPrompt {
	const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
	const template = match ? templates.find((item) => item.name === match[1]) : undefined;
	if (!match || !template) return { text, execution: "default" };
	return {
		text: substituteArgs(template.content, parseCommandArgs(match[2] ?? "")),
		execution: template.execution ?? "default",
	};
}
```

The command-name match is exact, so `/reviewed` cannot match `/review`.

Reuse `isReadOnlyToolCall` and the Shell parser from the startup plan. Do not add another command allowlist; this task only applies the shared result to prompt execution.

Add `getBundledPromptsDir()` beside `getThemesDir()` in `config.ts`, resolve source/dist/Bun layouts through existing package helpers, prepend that directory to prompt paths with `SourceInfo.source === "builtin"`, and copy `src/prompts/*.md` in `copy-assets` and `copy-binary-assets`. Existing user/project override order and `--no-prompt-templates` behavior remain unchanged.

- [ ] **Step 4: Verify metadata and execution tests**

Run the Step 2 command; expected PASS. Run `npm run check` from the root; expected clean.

---

### Task 2: Add the four original prompt resources

**Files:**
- Create: `packages/coding-agent/src/prompts/review.md`
- Create: `packages/coding-agent/src/prompts/security-review.md`
- Create: `packages/coding-agent/src/prompts/feature.md`
- Create: `packages/coding-agent/src/prompts/prompt-audit.md`
- Create: `packages/coding-agent/test/ultrazone-prompts.test.ts`

**Interfaces:**
- Consumes: `execution` metadata from Task 1.

- [ ] **Step 1: Write failing content-contract tests**

```ts
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const names = ["review", "security-review", "feature", "prompt-audit"] as const;

describe("bundled prompts", () => {
	test.each(names)("%s is provider-neutral and forbids subagents", (name) => {
		const text = readFileSync(new URL(`../src/prompts/${name}.md`, import.meta.url), "utf8");
		expect(text).not.toMatch(/Claude|Kimi|DeepSeek|hidden chain.of.thought/i);
		expect(text).toContain("Do not use, spawn, or delegate to subagents.");
	});

	test.each(["review", "security-review", "prompt-audit"])("%s is read-only", (name) => {
		const text = readFileSync(new URL(`../src/prompts/${name}.md`, import.meta.url), "utf8");
		expect(text).toContain("execution: read-only");
	});

	test("feature requires approval before edits", () => {
		const text = readFileSync(new URL("../src/prompts/feature.md", import.meta.url), "utf8");
		expect(text).toContain("execution: approval-required");
	});
});
```

- [ ] **Step 2: Verify the resource tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/ultrazone-prompts.test.ts
```

Expected: FAIL because the four files are absent.

- [ ] **Step 3: Create the prompt files**

`review.md`:

```markdown
---
description: Review current changes for correctness
argument-hint: "[scope]"
execution: read-only
---
Review the current changes. If arguments are supplied, use them as the scope: $ARGUMENTS

1. Inspect the actual diff and relevant surrounding code.
2. Report only findings supported by code evidence. Do not report style-only preferences or guesses.
3. For each finding, give severity, `path:line`, the condition that triggers it, and a specific fix.
4. List tests that were not run and remaining risks.
5. If there is no diff or no reliable finding, say so plainly.

Do not edit files. Do not use, spawn, or delegate to subagents. Answer in the user's language.
```

`security-review.md`:

```markdown
---
description: Review current changes for security risks
argument-hint: "[scope]"
execution: read-only
---
Perform a security review of the current changes. Optional scope: $ARGUMENTS

Check injection, path traversal, authorization, SSRF, XSS, unsafe deserialization, exposed secrets, and dangerous file operations. For each finding, state the exploit preconditions, affected path, and code evidence. Mark unproven concerns as needing verification instead of calling them vulnerabilities. Never repeat a secret value; report only its location and type.

Do not edit files. Do not use, spawn, or delegate to subagents. Answer in the user's language.
```

`feature.md`:

```markdown
---
description: Design and implement a feature after approval
argument-hint: "<request>"
execution: approval-required
---
Work on this request: $ARGUMENTS

First inspect the relevant code and project instructions. Present a short proposal with the problem, a concrete example or flow, and the smallest useful solution. Stop before any file change or state-changing command and request approval.

After approval, implement the approved scope, run the tests that cover it, inspect the final diff, and report verified results and unresolved issues. Do not refactor unrelated code. Do not use, spawn, or delegate to subagents. Answer in the user's language.
```

`prompt-audit.md`:

```markdown
---
description: Audit project instructions and prompts
argument-hint: "[paths]"
execution: read-only
---
Audit AGENTS.md files, skills, and prompt templates. Optional paths: $ARGUMENTS

Identify contradictions, duplication, ineffective rules, unnecessary absolutes, outdated model assumptions, unavailable tool assumptions, requests for hidden reasoning, brittle output requirements, and avoidable token cost. For each issue, give its location, a short reason, and a concrete simplification. Do not rewrite files automatically.

Do not edit files. Do not use, spawn, or delegate to subagents. Answer in the user's language.
```

- [ ] **Step 4: Verify prompt content and loading**

Run the Step 2 command and `test/prompt-templates.test.ts`; expected PASS. Confirm the four commands appear once with builtin source tags and no provider names.

---

### Task 3: Enforce the feature approval transition

**Files:**
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Modify: `packages/coding-agent/test/suite/harness.ts`
- Create: `packages/coding-agent/test/feature-prompt-approval.test.ts`

**Interfaces:**
- Consumes: `decideApproval()` and the interactive approval callback from the startup plan.
- Consumes: `PromptExecution = "approval-required"`.
- Adds to the test harness: `HarnessOptions.executionMode?: ExecutionMode` and `HarnessOptions.approvalHandler?: (request: ApprovalRequest) => Promise<boolean>`.

- [ ] **Step 1: Write failing approval-transition tests**

Using `test/suite/harness.ts`, pass the approval callback through the real session config and queue a blocked write, a plan, an approved write, and completion:

```ts
const approvals: ApprovalRequest[] = [];
const harness = await createHarness({
	executionMode: "default",
	approvalHandler: async (request) => {
		approvals.push(request);
		return true;
	},
});
harness.faux.setResponses([
	fauxAssistantMessage([fauxToolCall("write", { path: "before.txt", content: "blocked" })]),
	fauxAssistantMessage("1. Inspect validation\n2. Add the smallest guard"),
	fauxAssistantMessage([fauxToolCall("write", { path: "after.txt", content: "allowed" })]),
	fauxAssistantMessage("Implemented and verified"),
]);
await harness.session.prompt("/feature Add validation");

const writeResults = harness.sessionManager.getBranch().flatMap((entry) =>
	entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "write"
		? [entry.message]
		: [],
);
expect(writeResults[0]?.isError).toBe(true);
expect(writeResults.at(-1)?.isError).toBe(false);
expect(approvals.map((request) => request.subject)).toEqual(["plan"]);
```

Import `fauxAssistantMessage` and `fauxToolCall` from `@earendil-works/pi-ai/compat`, and `ApprovalRequest` from `../src/core/agent-session.ts`. Add MAX coverage where the approval is recorded as automatic, and a rejection case where no approved write occurs.

- [ ] **Step 2: Verify the transition tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/feature-prompt-approval.test.ts
```

Expected: FAIL because `approval-required` currently has no post-run transition.

- [ ] **Step 3: Implement one-run approval state**

Keep the existing `PromptExecution` for the active run. On `agent_before_settle`, if the run began from `/feature` and has not been approved:

- Call the native approval callback with subject `plan` and the proposal summary.
- On user approval, call `sessionManager.appendEntry("prompt_approval", { template: "feature", approvedBy: "user" })`.
- On MAX, use the automatic decision path and store `approvedBy: "max"`.
- Return the existing boundary continuation with `continue: true` and a custom message containing exactly `The proposal is approved. Continue with the implementation and verification.`; set the next run to `PromptExecution.default`. Do not recursively call `prompt()` from the boundary handler.
- On rejection, remain read-only and return no continuation.
- Do not repeatedly request approval during retries, compaction, or tool continuation within the same proposal.

Use the existing custom-entry API for approval records; do not store execution mode in global settings.

- [ ] **Step 4: Run behavior and regression checks**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/feature-prompt-approval.test.ts test/prompt-execution.test.ts test/suite/agent-session-boundaries.test.ts
npm run check
```

Expected: all tests PASS and the check is clean. Manually exercise `/feature` in default, AUTO, and MAX using the faux provider; no real model calls.
