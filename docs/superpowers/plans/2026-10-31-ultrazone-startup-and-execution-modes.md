# Ultrazone Startup and Execution Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit.

**Goal:** Launch the product as `ultrazone`, show its own startup screen, and enforce default, AUTO, and MAX behavior.

**Architecture:** The CLI parses the mode once and passes it through the existing runtime into `AgentSession`. Core execution code makes approval decisions; interactive code only displays requests and startup information.

**Tech Stack:** TypeScript, Node.js 22.19+, Vitest, existing Pi TUI.

**Spec:** `docs/superpowers/specs/2026-10-31-ultrazone-native-workflows-design.md`

## Global Constraints

- All work stays in the current session; no subagents.
- Do not copy Claude Code code or prompt text.
- User-facing choices use plain Chinese with a recommended option and concrete consequences.
- `default` and AUTO require critical workflow confirmation; MAX automates approvals but not safety checks.
- Modes are process-local and never written to settings.
- Run `npm run check` from the repository root after code changes; do not run `npm run build` or `npm test`.
- Do not commit.

---

### Task 1: Ultrazone command and mode parsing

**Files:**
- Modify: `packages/coding-agent/package.json`
- Modify: `packages/coding-agent/src/cli/args.ts`
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Rename: `pi-test.sh`, `pi-test.ps1`, and `pi-test.bat` to `ultrazone-test.sh`, `ultrazone-test.ps1`, and `ultrazone-test.bat`
- Rename: `scripts/auto-pi.sh` to `scripts/auto-ultrazone.sh`
- Modify: `scripts/local-release.mjs`
- Modify: `flake.nix`
- Modify: `nix/package.nix`
- Modify: `package-lock.json` and `packages/coding-agent/install-lock/package-lock.json` through the approved generators
- Test: `packages/coding-agent/test/args.test.ts`
- Create: `packages/coding-agent/test/ultrazone-brand.test.ts`

**Interfaces:**
- Produces: `ExecutionMode = "default" | "auto" | "max"`.
- Produces: `Args.executionMode: ExecutionMode`, defaulting to `"default"`.

- [ ] **Step 1: Write failing brand and flag tests**

Append to `test/args.test.ts` and create `test/ultrazone-brand.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseArgs } from "../src/cli/args.ts";

describe("ultrazone launch contract", () => {
	test("exposes only the ultrazone executable and config", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(pkg.bin).toEqual({ ultrazone: "dist/bundle/cli.js" });
		expect(pkg.piConfig).toMatchObject({ name: "ultrazone", configDir: ".ultrazone" });
	});

	test.each([
		[[], "default"],
		[["--dangerously-skip-permissions"], "auto"],
		[["--max"], "max"],
	])("parses %j as %s", (args, mode) => {
		expect(parseArgs(args).executionMode).toBe(mode);
	});

	test("rejects conflicting automation flags", () => {
		expect(parseArgs(["--max", "--dangerously-skip-permissions"]).diagnostics).toContainEqual({
			type: "error",
			message: "Cannot use --max with --dangerously-skip-permissions",
		});
	});
});
```

- [ ] **Step 2: Install local dependencies and verify the tests fail**

From the repository root, install without lifecycle scripts:

```bash
npm install --ignore-scripts
```

Then run from `packages/coding-agent`:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/args.test.ts test/ultrazone-brand.test.ts
```

Expected: FAIL because `bin`, `piConfig`, and `executionMode` do not exist.

- [ ] **Step 3: Implement the command and parsing contract**

Set the package fields exactly:

```json
"piConfig": { "name": "ultrazone", "configDir": ".ultrazone" },
"bin": { "ultrazone": "dist/bundle/cli.js" }
```

Add the exported type near `AgentSessionConfig` and initialize it in `parseArgs`:

```ts
export type ExecutionMode = "default" | "auto" | "max";
```

```ts
const result: Args = {
	executionMode: "default",
	messages: [],
	fileArgs: [],
	unknownFlags: new Map(),
	diagnostics: [],
};
```

Add explicit parse branches before unknown flags. If both flags occur, append exactly one conflict diagnostic. Do not allow either flag into `unknownFlags`.

Rename the development launchers and update every reference:

```bash
mv pi-test.sh ultrazone-test.sh
mv pi-test.ps1 ultrazone-test.ps1
mv pi-test.bat ultrazone-test.bat
mv scripts/auto-pi.sh scripts/auto-ultrazone.sh
```

Change the binary output from `dist/pi` to `dist/ultrazone`, local-release wrappers from `pi.ps1` to `ultrazone.ps1`, and Nix wrappers/checks from `bin/pi` to `bin/ultrazone`. Rename the Nix package/app aliases to `ultrazone` while retaining `default`. Update script comments and README commands in the same task so no instruction tells the user to launch with `pi`.

- [ ] **Step 4: Verify parsing and regenerate package metadata**

Run the Step 2 command; expected PASS.

From the repository root:

```bash
npm install --package-lock-only --ignore-scripts
node scripts/generate-coding-agent-install-lock.mjs
```

Run `npm run check`; expected no errors, warnings, or infos.

---

### Task 2: Core approval decisions and runtime propagation

**Files:**
- Modify: `packages/coding-agent/src/core/agent-session.ts`
- Modify: `packages/coding-agent/src/core/sdk.ts`
- Modify: `packages/coding-agent/src/core/agent-session-services.ts`
- Modify: `packages/coding-agent/src/main.ts`
- Modify: `packages/coding-agent/src/core/project-trust.ts`
- Modify: `packages/coding-agent/src/core/tools/bash.ts`
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Modify: `packages/coding-agent/test/suite/harness.ts`
- Create: `packages/coding-agent/test/execution-mode.test.ts`

**Interfaces:**
- Consumes: `Args.executionMode` from Task 1.
- Produces: `ApprovalRequest`, `ApprovalDecision`, `decideApproval()`, `isReadOnlyToolCall()`, and `AgentSessionConfig.executionMode`.
- Produces: public readonly `AgentSession.executionMode` for startup labels and every later feature.
- Adds to the test harness: `HarnessOptions.executionMode` and `HarnessOptions.approvalHandler`.

```ts
export type ApprovalSubject = "tool" | "plan" | "rewind" | "trust";
export interface ApprovalRequest {
	subject: ApprovalSubject;
	summary: string;
	readOnly?: boolean;
}
export type ApprovalDecision = "allow" | "ask" | "deny" | "auto";
```

- [ ] **Step 1: Write the failing decision-matrix tests**

```ts
import { describe, expect, test } from "vitest";
import { decideApproval } from "../src/core/agent-session.ts";

const write: ApprovalRequest = { subject: "tool", summary: "Edit src/a.ts", readOnly: false };
const plan: ApprovalRequest = { subject: "plan", summary: "Start this plan" };

describe("execution mode approvals", () => {
	test("default asks before writes and critical workflows", () => {
		expect(decideApproval("default", write, true)).toBe("ask");
		expect(decideApproval("default", plan, true)).toBe("ask");
	});

	test("auto skips tool approval only", () => {
		expect(decideApproval("auto", write, true)).toBe("allow");
		expect(decideApproval("auto", plan, true)).toBe("ask");
	});

	test("max automates decisions without removing validation", () => {
		expect(decideApproval("max", write, true)).toBe("auto");
		expect(decideApproval("max", plan, true)).toBe("auto");
	});

	test("noninteractive default and AUTO cannot invent a human answer", () => {
		expect(decideApproval("default", write, false)).toBe("deny");
		expect(decideApproval("auto", plan, false)).toBe("deny");
	});
});
```

Import `ApprovalRequest` alongside `decideApproval` in the test.

- [ ] **Step 2: Verify the matrix fails**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/execution-mode.test.ts
```

Expected: FAIL because `decideApproval` is not exported.

- [ ] **Step 3: Implement decisions and pass the mode through existing creation options**

Implement the pure decision function in `agent-session.ts`:

```ts
export function decideApproval(
	mode: ExecutionMode,
	request: ApprovalRequest,
	canAsk: boolean,
): ApprovalDecision {
	if (mode === "max") return "auto";
	if (request.subject === "tool" && request.readOnly === true) return "allow";
	if (mode === "auto" && request.subject === "tool") return "allow";
	return canAsk ? "ask" : "deny";
}
```

Add `executionMode?: ExecutionMode` to `AgentSessionConfig` and `CreateAgentSessionOptions`, default it to `"default"`, expose it as public readonly `AgentSession.executionMode`, and pass `parsed.executionMode` through `buildSessionOptions`, `createAgentSessionFromServices`, and runtime replacement. Route project trust through the same subject; MAX trusts only for the current process and does not persist that choice.

Create `isReadOnlyToolCall(name, input, annotations)` here as the single shared classifier. Allow built-in `read/grep/find/ls`, verified `readOnlyHint`, and strict single-command read-only Shell. The Shell parser in `bash.ts` rejects pipes, redirection, substitutions, separators, newlines, and environment assignments before checking commands such as limited `git status/diff/log/show`, `rg`, and `fd`. Later prompt, plan, and Btw tasks consume this function instead of duplicating it.

Add an interactive approval callback returning `Promise<boolean>`. In default and AUTO, `ask` must present the request summary and actual consequence in plain Chinese. In noninteractive modes, `deny` stops the action with the recorded reason. Do not change the pure function to bypass parameter, path, or safety validation.

- [ ] **Step 4: Verify the matrix and existing session tests**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/execution-mode.test.ts test/suite/agent-session-runtime.test.ts test/trust-manager.test.ts test/trust-selector.test.ts
```

Expected: PASS, including trust behavior in all three modes.

From the root, run `npm run check`; expected clean.

---

### Task 3: Ultrazone startup art and persistent mode labels

**Files:**
- Create: `packages/coding-agent/src/modes/interactive/components/ultrazone-logo.ts`
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Modify: `packages/coding-agent/src/modes/interactive/components/footer.ts`
- Modify: `packages/coding-agent/src/core/system-prompt.ts`
- Modify: `packages/coding-agent/package.json`
- Test: `packages/coding-agent/test/interactive-mode-startup-input.test.ts`
- Create: `packages/coding-agent/test/ultrazone-startup.test.ts`

**Interfaces:**
- Consumes: `AgentSession.executionMode`.
- Produces: `ultrazoneLogoLines(colorMode): string[]` and `executionModeLabel(mode): "GUIDED" | "AUTO" | "MAX"`.

- [ ] **Step 1: Write failing visual-contract tests**

```ts
import { describe, expect, test } from "vitest";
import { executionModeLabel, ultrazoneLogoLines } from "../src/modes/interactive/components/ultrazone-logo.ts";

describe("ultrazone startup", () => {
	test("renders a centered black-hole silhouette without old branding", () => {
		const lines = ultrazoneLogoLines("truecolor");
		const plain = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("ULTRAZONE");
		expect(plain).not.toMatch(/\bPi\b|piLogo/);
		expect(new Set(lines.map((line) => line.length)).size).toBeGreaterThan(0);
	});

	test("labels every execution mode", () => {
		expect(executionModeLabel("default")).toBe("GUIDED");
		expect(executionModeLabel("auto")).toBe("AUTO");
		expect(executionModeLabel("max")).toBe("MAX");
	});
});
```

Also add terminal-rendering assertions to the existing startup test using its current test harness; do not replace its input tests.

- [ ] **Step 2: Verify the visual tests fail**

Run:

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/ultrazone-startup.test.ts test/interactive-mode-startup-input.test.ts
```

Expected: FAIL because the new component does not exist.

- [ ] **Step 3: Implement the native startup screen**

Use the existing half-block foreground/background technique from `pi-logo.ts`. Build fixed rows with a blank central disk, tilted bright rings, sparse stars, and green/cyan colors; include a plain-text `ULTRAZONE` fallback. Do not load a PNG on Windows Terminal.

The component exports:

```ts
import type { TerminalColorMode } from "@earendil-works/pi-tui";
import type { ExecutionMode } from "../../../core/agent-session.ts";

export function executionModeLabel(mode: ExecutionMode): "GUIDED" | "AUTO" | "MAX" {
	if (mode === "default") return "GUIDED";
	return mode === "auto" ? "AUTO" : "MAX";
}

export function ultrazoneLogoLines(_colorMode: TerminalColorMode): string[] {
	return [
		"       ·  .        ·       ",
		"    ╭───────╮  ·          ",
		"  ╭─╯███████╰─╮     ·     ",
		" ╭╯  ███████  ╰─╮         ",
		" ╰╮  ███████  ╭─╯   ·     ",
		"  ╰─╮███████╰─╯           ",
		"    ╰───────╯      ULTRAZONE",
	];
}
```

Replace `_colorMode` with real ANSI coloring in the implementation, preserving row widths after stripping escape codes. Connect the logo, version, model, cwd, mode, shortcuts, and resource status in `interactive-mode.ts`. Add AUTO/MAX to the footer and MAX to the terminal title. Rename the user-facing system-prompt product references to Ultrazone. Keep `pi-ai` and other internal package identifiers unchanged.

- [ ] **Step 4: Verify startup behavior and checks**

Run the Step 2 tests; expected PASS. Exercise the real terminal against a faux provider for all three flags and verify that AUTO/MAX stay visible and no `pi` command is advertised.

From the root, run `npm run check`; expected clean.

---

### Task 4: Update startup documentation without changing the approved behavior

**Files:**
- Modify: `README.md`
- Modify: `packages/coding-agent/docs/usage.md`
- Modify: `packages/coding-agent/docs/cli.md`
- Modify: `packages/coding-agent/docs/security.md`
- Modify: `packages/coding-agent/docs/configuration.md`

- [ ] **Step 1: Replace user-facing launch instructions**

Document exactly these commands and consequences:

```text
ultrazone
ultrazone --dangerously-skip-permissions
ultrazone --max
```

Explain in plain language that AUTO still asks for plans, rewind, and trust; MAX automates those decisions only for that process. State that conflicting flags fail and that MAX is not saved.

- [ ] **Step 2: Verify documentation and workspace state**

Run:

```bash
git diff --check
npm run check
git status --short
```

Expected: no whitespace errors, clean checks, and only intentional source, test, generated lock, design, and plan files. Remove temporary terminal logs created during verification. Do not commit.
