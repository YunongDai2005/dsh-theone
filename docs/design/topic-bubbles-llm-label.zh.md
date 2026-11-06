# 新话题短名顺带由路由调用生成（给 Codex）

在工作区 `D:\doc\GitHub\dsh-theone-b-label`（分支 `bubbles-label`）里做，不要动别的目录。

## 背景

细胞上显示话题的短名 `BubbleTopic.label`。现在它由 `src/bubble-projection.ts` 按规则从实体/关键词里挑 2–6 字，挑不到时客户端退回标题截到第一个标点，常常不自然。路由在判定新话题时，LLM 分类调用本来就会起标题。

## 要求

1. 新话题创建时，让已有的分类调用顺带返回一个短名（中文 2–4 个字、英文 1–2 个词，能独立表意，不带标点，不是标题的机械截断）；不新增任何模型调用，不增加主路径延迟。规则（rules）模式和调用失败时保持现有规则做法。
2. 短名持久化到话题（存储层），投影优先用它，再退回现有规则；用户改名或合并后要有合理行为（改名时清掉旧短名并按规则重算，或让下一次相关调用更新——说明你的选择）。
3. 对已有话题不做批量回填调用（尊重 30 次/分钟上限）；可选：在已有的、本来就会对该话题发生的调用里顺带补上。
4. 测试：fixture 模型返回短名时投影用它；返回不合法（太长、带标点、空）时退回规则；rules 模式不变；不增加调用次数（断言调用计数）。
5. 如果修改了提示词，检查 `eval/` 里的路由评测有没有受影响的固定样例，必要时更新，并说明。

## 规则

- 不要修改 `src/client-foam.ts`、`src/client-foam-host.ts`、`src/client.ts`、`src/client-locales.ts`。
- 直接在 shell 里运行命令；不要用子代理或 node_repl；npm 用 `npm.cmd`；默认测试隔离遇到 spawn EPERM 时用 `--test-isolation=none` 并在报告里说明。
- 不要进入 `.dsh/`、`.workbuddy/`、`promo*/`、`outreach/`；不要读取或提交 `eval/data/private-*`。
- 不要提交（你的沙箱写不了 git 锁文件），Claude 会核对后提交。`npm.cmd run typecheck`、测试、`npm.cmd run build` 要通过。
- 报告写到 `docs/design/topic-bubbles-llm-label-report.zh.md`：改了哪些文件、提示词改动、测试结果。
