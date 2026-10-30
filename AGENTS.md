# 开发规范

## 交流风格

- 回答应简明扼要。
- 在提交（commit）、问题（issue）、PR 评论或代码中，不要使用表情符号（emoji）。
- 避免冗余词汇或过于热情的客套话（例如，使用“Thanks @user”，而不是“Thanks so much @user!”）。
- 仅使用技术性语言，表达要直接。
- 使用简洁、清晰、简单的语言。若必须使用专业术语，请先进行定义。
- 在阐述复杂的设计或问题时，请遵循以下结构：问题描述 -> 具体示例或简要执行流程 -> 解决方案。说明为何该方案是必要的，并将其与非必要的复杂性区分开来。
- 优先提供具体行为描述和简短示例，避免使用抽象总结、晦涩术语或未经解释的变更列表。
- 当用户提出问题时，应先回答问题，再进行修改或执行实现命令。
- 在回应用户反馈或分析时，应先明确表达同意或不同意，然后再说明所做的修改。

## 代码质量

- 在进行大规模修改、编辑未完全审阅的文件，或受邀进行调查/审计时，请务必完整阅读相关文件。进行大范围变更时，切勿仅依赖搜索片段。
- 除非绝对必要，否则严禁使用 `any` 类型。
- 对于仅在单处调用的单行辅助函数，应将其内联（inline）处理。
- 查阅 `node_modules` 以确认外部 API 类型；切勿凭空猜测。
- **禁止使用内联导入**（如 `await import()`、`import("pkg").Type` 或动态类型导入等）。仅允许使用顶层导入（top-level imports）。
- 在 `packages/coding-agent` 中，通过 `src/config.ts` 提供的辅助函数来解析包资源（assets）。请勿直接使用 `__dirname`；这些辅助函数已妥善处理了源码检出（source checkouts）、npm 安装以及独立二进制文件等不同场景。
- 严禁为了修复因依赖项过时而导致的类型错误，而删除或降级代码；应通过升级相关依赖项来解决问题。
- 在由根配置（root config）管控的代码区域（即 `packages/*/src`、`packages/*/test` 及 `packages/coding-agent/examples`）中，仅允许使用“可擦除”的 TypeScript 语法（即 Node.js 的“仅移除类型”模式）。这意味着不得使用参数属性（parameter properties）、`enum`、`namespace`/`module`、`import =`、`export =` 或其他需要额外生成 JS 代码的语法结构。请使用显式字段并在构造函数中进行赋值。 - 在移除看似有意为之的功能或代码前，务必先进行确认。
- 除非用户明确要求，否则无需保留向后兼容性。
- 切勿硬编码按键检查（例如 `matchesKey(keyData, "ctrl+x")`）。应将默认值添加到 `DEFAULT_EDITOR_KEYBINDINGS` 或 `DEFAULT_APP_KEYBINDINGS` 中，以确保其可配置。
- 切勿直接修改 `packages/ai/src/models.generated.ts`；应修改 `packages/ai/scripts/generate-models.ts`，然后重新生成该文件。提交时包含生成的 `models.generated.ts` 的差异（diff）是可以接受的，即使重新生成过程中包含了与当前任务无关的上游模型元数据变更。`packages/ai/src/providers/data/` 目录下的生成模型数据已被加入 `.gitignore`：请勿将其添加到暂存区（stage），也不要在 Git 历史记录中查找这些文件。

## 命令

- 修改代码（非文档）后，请运行 `npm run check`（查看完整输出，无需截断）。在提交代码前，必须修复所有错误（errors）、警告（warnings）和提示（infos）。此命令不包含测试环节。
- 除非用户明确要求，否则请勿运行 `npm run build` 或 `npm test`。
- 切勿直接运行完整的 Vitest 测试套件：其中包含端到端（E2E）测试，若环境中存在端点（endpoint）或身份验证（auth）相关的环境变量，这些测试便会自动触发。对于非 E2E 测试，请在仓库根目录下运行 `./test.sh`。若需运行特定测试，请在对应的包（package）根目录下执行：
- Vitest: `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/specific.test.ts`
- `packages/tui` (`node:test`): `node --test test/specific.test.ts`
- 若创建或修改了测试文件，请务必运行该测试，并不断调整测试代码或实现逻辑，直至测试通过。
- 在 `packages/coding-agent/test/suite/` 目录下，请使用 `test/suite/harness.ts` 配合模拟提供商（faux provider）进行测试。严禁使用真实的提供商 API、密钥或付费令牌。 - 在编写用于修复 GitHub Issue 的回归测试时，请在测试代码旁添加注释，注明对应的 GitHub Issue 编号。
- 对于临时脚本，请将其写入临时文件（例如 `/tmp`），执行后根据需要进行修改，并在任务完成后将其删除。请勿将多行脚本直接嵌入到 `bash` 命令中。
- 除非用户明确要求，否则切勿执行提交（commit）操作。

## 依赖项与安装安全性

- 将 `npm` 依赖项及锁文件（lockfile）的变更视为已审查的代码。所有直接引用的依赖项（包括工作区内部的依赖项）必须锁定在特定版本。
- 在更新 `undici` 时，必须查阅目标版本的更新日志（changelog/release notes），评估其中变更是否会影响现有功能，确认无误后再执行更新。
- 本地安装或更新依赖时，请使用 `npm install --ignore-scripts`；在执行清理安装或 CI 环境安装时，请使用 `npm ci --ignore-scripts`。除非用户明确要求，否则不要运行任何生命周期脚本（lifecycle scripts）。
- 若依赖项元数据发生变更，请通过 `npm install --package-lock-only --ignore-scripts` 更新 `package-lock.json`。
- 若需重新生成 `packages/coding-agent/install-lock/`，请运行 `node scripts/generate-coding-agent-install-lock.mjs`（可通过 `--check` 参数或 `npm run check` 命令进行验证）。若新增的依赖项包含生命周期脚本，则必须经过审查，并在该脚本中将其显式加入允许列表（allowlist）；严禁在未明确说明的情况下擅自添加。
- 提交前检查（Pre-commit）会拦截锁文件的提交，除非设置了 `PI_ALLOW_LOCKFILE_CHANGE=1`。除非用户确实希望提交锁文件的变更，否则请勿绕过此限制。

## Git

可能同时运行多个 `pi` 会话。