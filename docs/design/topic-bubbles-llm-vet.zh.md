# 合并建议：规则粗筛 + LLM 把关（给 Codex）

在工作区 `D:\doc\GitHub\dsh-theone-b-vet`（分支 `bubbles-vet`）里做，不要动别的目录。

## 背景

合并建议现在由 `mergeSimilarity`（`src/routing-policy.ts`：同一文件夹，且共享名称 ≥2 或标题相似度 ≥0.6）产生，并已改为持久化的侧栏建议（见 `docs/design/topic-bubbles-backend-3-report.zh.md`，`merge_suggestions` 表、`BubbleMergeSuggestion`）。问题：名字不像但是一件事的（「日本旅游」与「京都住哪」）抓不到；名字像但不是一件事的会误报。

## 要求

1. 两段式：规则粗筛放宽一点产生候选（例如加入摘要/实体的相似度，候选数量设上限）；对候选在 **TheOne 空闲时**用一次小的 LLM 调用把关：输入两个话题的标题、摘要、实体，输出 是否同一件事、置信度、建议保留哪个（方向）和一句内部理由（不显示给用户）。只有把关通过的才写成 pending 建议；方向写进 `directions` 的第一项。
2. 成本与限流：不在消息主路径上调用；批量、去重、缓存（同一 pair 在两个话题都没有实质变化前不重复把关）；遵守全局 30 次/分钟上限和现有的路由限流机制；rules 模式或无模型时退回现有规则（保持现在的行为）。
3. 把关结果「不是一回事」记为内部判定，不等于用户 decline，不写负关联，不影响路由学习；话题有实质变化后可以重新把关。
4. 测试：fixture 模型说「是」才产生建议；说「否」不产生且不重复调用；名字不像但 fixture 说「是」时能产生；rules 模式行为不变；调用只在空闲时发生、受限流。
5. 说明你如何判断「实质变化」与缓存失效。

## 规则

- 不要修改 `src/client-foam.ts`、`src/client-foam-host.ts`、`src/client.ts`、`src/client-locales.ts`。
- 直接在 shell 里运行命令；不要用子代理或 node_repl；npm 用 `npm.cmd`；默认测试隔离遇到 spawn EPERM 时用 `--test-isolation=none` 并在报告里说明。
- 不要进入 `.dsh/`、`.workbuddy/`、`promo*/`、`outreach/`；不要读取或提交 `eval/data/private-*`。
- 不要提交（你的沙箱写不了 git 锁文件），Claude 会核对后提交。`npm.cmd run typecheck`、测试、`npm.cmd run build` 要通过。
- 报告写到 `docs/design/topic-bubbles-llm-vet-report.zh.md`：改了哪些文件、提示词、成本控制、测试结果。
