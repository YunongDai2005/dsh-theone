# 话题细胞团后端第 3 阶段（给 Codex）

依据你写的 `experiments/sidebar-cell-capsule/ERGONOMICS-REVIEW.md` §8、§10.4、§10.6 和计划 `docs/design/topic-bubbles-ergonomics-plan.zh.md`。客户端（`src/client-foam.ts`、`src/client-foam-host.ts`、`src/client.ts`、`src/client-locales.ts`）由 Claude 同时在改，**不要动这些文件**；其余后端文件和测试归你。

## 规则

- 直接在 shell 里运行命令；不要用子代理或 node_repl；npm 用 `npm.cmd`。
- 不要进入 `.dsh/`、`.workbuddy/`、`promo*/`、`outreach/`；不要提交 `eval/data/private-*`。
- 只 `git add` 你改的文件再提交（Claude 也在同一工作区提交）；提交者 YunongDai2005，不加 Co-Authored-By。不要 push。
- 完成后 `npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build` 都要通过；dist 中你改动的后端文件一并提交。

## 任务

### 1. 合并建议迁出主聊天（评审 §8，按你的「后端需要做什么」1–5 实现）

- 建议记录：suggestionId、gateway 范围、规范化 pair、两个方向、依据（共享名称数、标题相似度）、创建/过期时间、状态 pending / accepted / declined / dismissed / expired。把「为防并发预留」和「用户已处理」分开；旧的 dismissed 记录迁移时不当作用户明确拒绝，本轮也不默认重问。
- 响应接口（建议 `POST /api/theone/topics {action:'mergeSuggestion', suggestionId, response:'accept'|'decline'|'later', sourceId?, targetId?, requestId?}`，名字你定，写进报告）：按 suggestionId 幂等；accept 重验可达性、建议有效性和全局忙态，进现有 `TopicMergeQueue`，返回 operationId（能立刻执行就 200）；decline 写 pair 拒绝记录，不写负关联、不标 done、不训练路由；later 只收起，不改变是否再问。
- bubbles 快照里暴露 pending 建议（含两个话题 id、方向依据），以及事件（建议出现 / 结束），支持重启恢复与事件缺口；类型写进 `src/bubble-types.ts`。
- 移除 `suggestMerge` 路径里的主聊天选择卡（askChoice）和 followup notice。会话关闭、超时、话题删除/移组时清理建议。
- 测试：双窗口 accept 幂等；decline 后不再建议该 pair 且不产生负关联；later 不等于 decline；重启后 pending 仍在；话题删除后旧建议不能执行；主聊天里不再出现这两类消息。

### 2. 客户端需要的回执与能力（评审 §10.4）

- 确认 bubbles 快照的每个话题带 capabilities（done / merge / stop 等是否允许及原因），合并队列项带 operationId、状态和终态（成功、取消、过期、失败原因）；缺什么补什么，并在报告里列出字段。
- 合并 requestId：服务端对同一 requestId 的旧终态回执不要阻止一次新的明确意图（客户端会改为每次意图生成新 id）；如果需要服务端改动，说明。

### 3. `/api/theone/routes` 可达性校验（评审 §10.6）

纠错目标的可达性守卫与 mount 一致（不可达话题返回明确错误码），加测试。

## 报告

写到 `docs/design/topic-bubbles-backend-3-report.zh.md`：接口、字段、错误码、事件，以及客户端该怎么调用的示例。
