# Ultrazone 工作进度

保存日期：2026-10-31

## 当前状态

用户决定下周再继续。本次保存后不开始实现，不设置定时任务，不提交 commit。

目前已经完成：

- 了解 Pi 项目结构、启动方式和终端界面。
- 调研 `D:/project/claude-code` 中可借鉴的功能与提示词。
- 确认全部功能设计和三档执行模式。
- 编写并自审设计文档。
- 将实施工作拆成 8 份计划，并检查计划之间的顺序、接口和测试步骤。

目前尚未完成：

- 没有修改任何功能代码。
- 没有安装缺失依赖或完成真实启动验证。
- 没有运行功能测试，因为功能尚未实现。
- 没有提交 Git。

最后一次检查时，工作区只有新增的 `docs/` 内容。本次又新增了 `update/README.md`。这些文件是后续工作的依据，不要删除。

## 下次从这里开始

1. 阅读总设计：`docs/superpowers/specs/2026-10-31-ultrazone-native-workflows-design.md`。
2. 从第一份计划开始：`docs/superpowers/plans/2026-10-31-ultrazone-startup-and-execution-modes.md`。
3. 按计划先安装依赖：在仓库根目录运行 `npm install --ignore-scripts`。
4. 从 Ultrazone 命令、参数解析和对应失败测试开始，逐项实施。
5. 每个阶段展示真实测试结果，用户确认后再进入下一阶段。

执行方式已经确定：在当前会话逐任务执行，使用 `superpowers:executing-plans`，**不展开 subagent**。

## 已确认的用户要求

### 沟通方式

- 默认用户不是技术人员，优先使用日常中文。
- 不得不使用专业词时，先用一句简短的话解释。
- 不让用户选择内部实现方式，只询问会影响费用、数据、权限、操作结果或使用习惯的事情。
- 给选择时，把推荐项放在前面，说明实际好处、代价和风险。
- 不重复询问已经确认的内容，避免因术语难懂造成反复确认和 Token 浪费。

### 工作方式

- 不随意展开 subagent；本轮明确要求不使用 subagent。
- 所有功能按 Ultrazone 的架构重新实现，不照搬 Claude Code 的代码或大段提示词。
- 采用已确认的原生核心与交互主文件路线，不改成独立插件体系。
- Kimi、Moonshot、DeepSeek 等模型共用同一套提示词，不维护厂商专属文案。
- 真实模型 API 验收必须另行获得用户明确授权，默认测试只使用 faux provider。
- 不执行 commit，除非用户以后明确要求。

## 启动方式与权限

品牌要求：

- 正式启动命令是 `ultrazone`，不保留 `pi` 启动别名。
- 配置目录使用 `.ultrazone`。
- 启动页采用深黑背景、绿色数据流和黑洞吸积盘视觉，Windows Terminal 默认使用 ANSI 字符画。

三档模式：

- `ultrazone`：只读操作自动；修改文件、执行命令和重要选择需要用户确认。
- `ultrazone --dangerously-skip-permissions`：普通工具和命令自动执行，但方案批准、文件恢复和项目信任仍由用户确认。
- `ultrazone --max`：工具、方案和重要流程全部自动决定并继续，启动页持续显示 MAX 警告。

两个自动标志同时传入时直接报错。模式只对当前进程有效，不写入设置，恢复旧会话也不会自动继承 MAX。

完全授权仍不能绕过非法参数、操作系统拒绝、文件外部修改冲突、符号链接保护和快照缺失等安全条件。

## 实施顺序

1. **启动与执行模式**  
   `docs/superpowers/plans/2026-10-31-ultrazone-startup-and-execution-modes.md`

2. **内置提示词：代码审查、安全审查、功能开发、提示词检查**  
   `docs/superpowers/plans/2026-10-31-ultrazone-built-in-prompts.md`

3. **计划模式：先给方案，确认后修改**  
   `docs/superpowers/plans/2026-10-31-ultrazone-plan-mode.md`

4. **文件改动查看 `/diff`**  
   `docs/superpowers/plans/2026-10-31-ultrazone-diff-view.md`

5. **对话空间查看 `/context`**  
   `docs/superpowers/plans/2026-10-31-ultrazone-context-view.md`

6. **当前会话定时任务 `/loop`**  
   `docs/superpowers/plans/2026-10-31-ultrazone-loop.md`

7. **只读临时提问 `/btw`**  
   `docs/superpowers/plans/2026-10-31-ultrazone-btw.md`

8. **对话和文件恢复 `/rewind`**  
   `docs/superpowers/plans/2026-10-31-ultrazone-rewind.md`

第 8 项必须等前 7 项全部实现并验收后才能开始，不能提前并入其他阶段。

## 重要行为边界

- `/review`、`/security-review`、`/prompt-audit` 的只读限制由程序执行，不只是提示词要求，MAX 也不能借此写文件。
- `/feature` 在方案批准前只读；默认和 AUTO 等用户确认，MAX 自动批准并记录。
- `/loop` 只在当前会话和进程运行，忙碌时跳过、不补跑、不重叠，重启后不自动执行。
- `/btw` 使用独立只读上下文，不启动 subagent、不中断主任务，也不自动污染主模型上下文。
- `/diff` 的“会话变更”指与会话开始时相比，不谎称只包含 Agent 修改。
- `/context` 区分模型实际报告的用量和本地估算，不为不同模型伪造精确 Token 数。
- `/rewind` 第一版只保证本地核心 `edit/write` 捕获的修改；Shell、未知自定义工具、远程文件、符号链接和硬链接不保证完整恢复。
- 文件恢复遇到用户后续修改时不能强行覆盖；部分恢复必须明确显示，不能宣称完整成功。

## 验证规则

- 代码变更后从仓库根目录运行完整输出的 `npm run check`，修复所有 errors、warnings 和 infos。
- 修改或新增的测试必须在对应包内单独运行并通过。
- 测试套件使用 `test/suite/harness.ts` 和 faux provider，不自动调用真实付费模型。
- 未经用户明确要求，不运行 `npm run build` 或 `npm test`。
- 依赖安装只使用 `npm install --ignore-scripts`；锁文件只通过项目规定的方式生成。
- 每阶段结束检查 `git status`，删除测试产生的无用临时文件，不执行 commit。

## 本次暂停点

设计和计划已经保存完毕，实施尚未开始。下周直接从第一份启动与执行模式计划继续即可。
