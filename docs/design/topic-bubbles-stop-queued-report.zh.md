# 停止话题误丢弃排队消息：定位、修复与回归

日期：2026-11-08。范围：TheOne 服务端；不改细胞团或其他客户端源码。

## 结论与证据边界

这是 **TheOne 对 DSH 取消 API 的使用错误**。DSH 执行了其原有、明确的“取消当前活动并清空 inbox”语义；TheOne 把这个操作用于“停止一个话题的工作项”，因此扩大了停止范围。不是路由模型把 B 判成应该停止，也不是 bubbles 投影自行丢了消息。

用户提供的复现环境是隔离 DSH `0.2.1-rc.5`、OpenCode Go、TheOne `llm` 路由。本轮没有重新运行这套真实模型或浏览器场景。自动化测试使用本工作树的真实 DSH agent loop、会话持久化、路由服务和 HTTP handler，仅模型为可控的 FixtureModel；其中分别覆盖 `rules` 和 `llm`。当前依赖包 `@deepseek-ai/dsh-agent`、`dsh-agent-loop` 的版本均为 `0.2.1-rc.2`，不能把本轮结果表述为 rc.5 / OpenCode Go 的实机复测通过。

`node_modules` 是现有 Junction，目标为 `D:\doc\GitHub\dsh-theone\node_modules`；工具栈出现该目录是依赖来源，命令和修改仍在 `dsh-theone-bubbles` 工作树内。没有修改共享依赖。

## 确切调用链

1. 细胞团运行项的“停止”从 `src/client-foam-host.ts` 选取运行中的 `workItemId`，发送 `POST /api/theone/topics`，请求体为 `{ action: 'stop', workItemId }`。客户端没有主动遍历并撤回 B。
2. `src/index.ts::stopWork()` 找到 A 的 `WorkerRun`，先 `run.cancel()`，然后旧代码对前台运行调用 **不带选项的** `gateway.cancel({ kind: 'parent' })`。路由阶段尚未创建 Worker 的停止分支也有同样的问题。
3. DSH `ReactLoopAgent.cancel()` 在 `!options.keepInbox` 时调用 `inbox.clear()`；`ReactLoopInbox.clear()` 依次清空 `next-step` 和 `next-turn`。位置：已安装的 `node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js` 的 `cancel`、`clear`、`mutate`。
4. 清队列会持久化 `agent/inbox/spliced`（删除项，`outcome: 'canceled'`），并发出 `agent/inbox/discarded`。B 尚未成为当前步骤的 `user/message`，只是 inbox 中的待处理消息；删除 inbox 后，原生主聊天不再有这条待处理消息可以显示或领取。
5. TheOne 监听该丢弃事件，调用 `bubbleActivity.discard()`：无 `executionId` 的 B 变为 `phase: 'stopped'`、`delivery.phase: 'discarded'`；同时取消它的 `sorting`，并调用 `dropBackground()`。因此 B 不会再路由。若 B 已在后台完成但仍排队等待展示，旧代码还会丢掉它的后台运行/路由记录。

`run.cancel()` 本身只取消对应 Worker，不会清空主聊天的其他输入。`BubbleActivity.discard()` 是对真实 inbox 删除的观察，不是此次删除的起点。`turn/end` 的观察逻辑也不是 B 消失的原因。

界面中的 **cancelQueued 是独立的用户动作，但现有 HTTP 协议仍复用 `action: 'stop'`**：选中的工作项若还在 inbox，服务器返回 `effect: 'withdrawn'`；选中执行项则返回 `effect: 'stopped'`。本轮没有更改该兼容协议。

## 修复与取舍

在 `src/index.ts` 增加 `stopGatewayTurn()`，前台 Worker 停止和路由阶段停止共同使用：

- 使用 `gateway.cancel({ kind: 'parent' }, { keepInbox: true })`。A 仍真正中止；其他尚未领取的消息继续留在 DSH 持久化 inbox 中。
- 等待这次中止到达 `agent/status: idle`，并捕获该边界上的旧 `finishRun` 收尾 Promise。不能使用 `gateway.whenIdle()` 等待全部工作：它会追踪新启动的回合，可能让“停止 A”一直等到 B 回答结束。
- 让现有 `turn/end` 逻辑完成 A 的 `finishRun`，删除旧的“等待 A 后再按 gateway ID 调用 finishRun”操作，避免异步收尾误操作已接替 A 的新运行。
- **仅设置 keepInbox 不够**：DSH 中止后的 driver 不会因为 inbox 已非空就自动醒来。如果停止期间有新输入，DSH 自己会安排后继 driver，TheOne 不重复唤醒；否则，在旧 driver 退休后，从当前仍存活的 inbox 中取队尾消息，保留原消息对象、ID、列表和顺序，移出后用公开 `send(..., true)` 重新投入，以唤醒正常执行流程。
- 重投使用现有 `moving` 保护，避免 TheOne 把这次移动解释为 cancelQueued，进而停止 B 的路由、后台 Worker 或删除它的运行记录。不恢复停止前的旧快照，因此停止收尾期间被用户显式撤回的消息不会复活。
- 后台停止仍只处理所选后台运行；显式撤回仍只移除所选排队工作项。

选择保留原生 gateway 回合中止，是为了沿用 DSH 对部分流、工具调用、审批/问答取消及中断记录的收尾语义，而不是把停止的 Worker 伪装成自然完成。原生 `send` 是公开的唤醒入口，当前接口没有独立的“仅唤醒现有 inbox”方法。

**重投的边界**：唤醒时队尾消息仍会产生原生“移出（canceled splice）/重新插入”两条持久化事件；两步在同一同步段完成，TheOne 不把它标成 stopped，最终沿原 ID 只执行一次。没有改 DSH 的事件协议，也未在浏览器验证这两条事件是否造成瞬时重绘。原生主聊天的全局停止按钮仍使用 DSH 自己的语义；本修复只收窄 TheOne 工作项停止的作用范围。

### 续跑后发现的关联问题：A 被拼进 B

修好队列后，测试进一步发现：若 A 在输出任何 assistant 文本前中止，旧 `stepInput()` 从历史倒查到上一条 assistant 消息来收集用户输入，会把已停止 A 的输入和 B 合成一个请求，交给 B 的话题。回归实际观察到 `Qwen first\n\nthesis second`，而不是只有 `thesis second`。

现在 `stepInput()` 只拼接 **当前 DSH `step/start` 之后真正接收的 `user/message` ID** 对应的请求内容。历史中的已停止 A 不会重放到 B；同一步内合法的多条插话仍然可以合并。没有改消息正文或重新生成消息身份。

## 回归测试

文件：`tests/bubble-stop.test.ts`。原有 7 个测试保留，新增 6 个场景，共 13 个：

| 场景 | 验证结果/契约 |
| --- | --- |
| A 运行，B/C 在 host queue，`rules` | 停止前 B 为 `contextId: null`、`executionId: null`、`phase: queued`；停止后 B 路由到另一话题并执行，C 随后执行 |
| A 运行，B/C 等待，`llm` | 覆盖先前台路由、运行期间分类暂缓、停止后再路由；不能只保留一个永远不动的 queued 状态 |
| A 还在 LLM 分类，B/C 排队 | 没有 Worker 的停止分支同样保留并继续处理队列 |
| B 已在后台完成，尚待主聊天展示 | 停止 A 后展示同一个 B execution 的答案，保留路由记录，不重新执行 B |
| A 中止收尾期间显式撤回 B，并新发 D | B 不复活；原有 C 和新来的 D 按顺序完成；旧停止操作不能误停新运行 |
| A 分类时收到两条 next-step 插话 | 停止 A 后两条消息作为同一步输入执行一次，不拆散、不重复 |

前三个测试还验证：停止响应不依赖 B 回答完成、工作项最终 `succeeded/shown`、路由和 topic run 为 `completed`、主聊天收到答案、消息 ID 各出现一次、答案没有夹带已停止 A 的请求。原有测试继续覆盖已提交内容和状态保留、重复停止、撤回后不执行、后台停止与准备阶段停止。

测试用 Qwen / thesis 两个固定话题控制路由，验证的是和用户 Python / 日语场景相同的执行及排队生命周期，不声称 FixtureModel 验证了真实模型的语义判断。

### 失败先行记录

- 修复前新增的最初 5 个测试全部失败：三个排队用例都实际读到 B 为 `stopped`；后台已完成答案变成 `discarded`；停止收尾期间的显式撤回已返回 409，因为 B 早被连带撤回。
- 只修队列后，分类阶段和后台展示用例通过；另外三个用例实际收到夹带 A 的 Worker 输入/答案，暴露 `stepInput` 问题。
- 修复当前步骤输入范围后，停止测试 13/13 通过。又将最终新增的全部 6 个用例加载到未修改的 HEAD 入口，6/6 均按预期失败，确认新增 next-step 用例也能捕获旧 bug。该入口文件的 Git blob 哈希与 HEAD 完全一致：`e6b520d8a7c84e65721fd174609bbe675973a703`；没有改回工作区源码。最终验证结果见下节。

日志保留在已忽略的 `.theone/`：`stop-queued-red.log`、`stop-queued-batch-red.log`、`stop-queued-green.log`、`stop-queued-final-baseline.log`。诊断输出已从源码和测试中移除。

## 验证命令与结果

| 检查 | 结果 |
| --- | --- |
| 源码停止测试 | 13/13 通过；原有 7 项加新增 6 项 |
| 编译产物停止测试 | 13/13 通过；将测试 harness 的 TheOne 入口解析到本轮生成的 JS，其余生产模块也来自同一次编译 |
| `npm.cmd run typecheck` | 通过，覆盖服务端/测试和客户端类型检查 |
| 服务端 TypeScript 编译 | 通过；输出到 `.theone/stop-queued-dist`，仅同步验证后的 `index.js`、`index.d.ts` 到跟踪的 `dist/` |
| 全量源测试 | 731 项：727 通过、4 失败、0 cancelled、0 skipped；失败均为子进程 `EPERM`，全量未全绿 |

全量失败明细（进程退出码 1，未隐藏或跳过失败）：

| 文件 | 实际失败 |
| --- | --- |
| `tests/client-topic-folder.test.ts` | esbuild 启动编译子进程：`spawn EPERM` |
| `tests/client-update.test.ts` | esbuild 启动编译子进程：`spawn EPERM` |
| `tests/pack-plugin.test.ts` | 打包流程调用 `execFile`：`spawn EPERM` |
| `tests/route-stats.test.ts` | 启动统计脚本：`spawnSync ... node.exe EPERM` |

这些检查仍需在允许相应子进程的环境复跑，不能据本轮宣称完整整包检查通过。最终全量没有超时或取消；旧报告关注的 `native gateway never asks back...` 路由用例本轮用原有 30 秒限时通过（15.99 秒）。为排查这一关注项曾另外运行未修改 HEAD 的单例对照，该次超过 30 秒，记录于 `.theone/stop-queued-policy-baseline.log`；不把两次时间差当成本修复的性能收益。全量还打印了原有归档测试桩缺少 `unarchiveSession` 的诊断，该用例断言通过，未为此改动归档代码或测试桩。

实际验证命令：

```powershell
node --import ./.theone/backend-4-loader.mjs --test --test-isolation=none tests/bubble-stop.test.ts
node --import ./.theone/backend-4-loader.mjs --test --test-isolation=none tests/*.test.ts
npm.cmd run typecheck
node node_modules/typescript/bin/tsc -p tsconfig.json --outDir .theone/stop-queued-dist
node --import ./.theone/stop-queued-dist-loader.mjs --test --test-isolation=none tests/bubble-stop.test.ts
```

构建输出与同步后的两个 dist 文件逐一核对 SHA-256，完全一致。未重打完整客户端 bundle，也未把工作区改动安装到正在运行的 DSH 实例。验证日志：`.theone/stop-queued-full.log`、`stop-queued-typecheck.log`、`stop-queued-build.log`、`stop-queued-dist-test.log`。

默认进程隔离测试遇到 `spawn EPERM`，按要求改用 `--test-isolation=none`；tsx 的 esbuild 子进程仍被沙箱拒绝。复用仓库已有的 `.theone/backend-4-loader.mjs`，以已安装 TypeScript 的 `transpileModule` 在同一进程加载原测试；未更改断言、依赖或 package.json。Node 自带实验性 TS 转换也尝试过，但不能正确加载这套源码，未作为验证依据。

## 排队标记评估：后端字段已经足够

当前 `src/client-foam-host.ts` 把工作项按 `contextId` 放进话题分组，明确跳过 `contextId: null`。所以“消息尚未决定话题”的 host queue 工作项不会形成任何话题细胞，也不会体现在当前运行话题的单一状态中。不是后端缺少这条排队事实。

建议在主卡片旁增加独立的“待处理 N”标记，不把尚未路由的 B 归给 A，也不要预判它属于日语。无需后端字段扩展：

| 字段 | 用法 |
| --- | --- |
| `snapshot.scope.gatewayId` / `gateway.id` | 限定当前主聊天，避免统计别的 gateway |
| `gateway.nextTurn[]` | 当前真实排队消息；以 `messageId` 去重计数，`position` 给出顺序 |
| `nextTurn[].workItemId` | 关联到工作项的阶段和操作能力；不能要求 `contextId` 已有值 |
| `workItems[].source` | 人类消息标记通常只统计 `user`；`goal`、`relay` 分开处理 |
| `workItems[].phase === 'queued'` 与 `queueReason` | 区分 `host_queue`、`capacity`、`topic_busy`、`project_busy` 等等待原因 |
| `workItems[].contextId === null` | 表示尚未分配可见话题；若有 `targetUnavailable`，应另标目标不可用，不能当成尚未分类 |
| `workItems[].executionId`、`phase`、`delivery.phase` | 区分等待开始、已经后台运行、已完成等待展示，避免把三者都写成“还没开始” |
| `gateway.nextStep[]` | 待插话/下一步骤输入；建议与 nextTurn 的独立回合队列分开展示 |
| `gateway.claimed[]`、`workItems[].phase === 'routing'` | 消息从队列领取后进入路由；可切换为“正在分配”标记，不能用历史 queued 项补数 |
| `gateway.showingExecutionId`、`gateway.currentId` | 定位主卡片当前展示/挂载话题；排队标记本身仍属于 gateway |
| `workItems[].stop.allowed`、`id` | 明确选择某条消息执行 cancelQueued；不能复用当前运行项 ID |
| `snapshot.cursor`、轮询返回的新 snapshot | 用新快照重算标记，避免只听 running 事件而漏掉队列变化 |

如果只显示“还有一条在等”，优先以 live `gateway.nextTurn` 的用户消息为依据，再按工作项标明“待执行 / 后台执行中 / 待展示”；不能直接数全部历史 `phase: queued` 项。一个工作项也可能合并多个 `messageIds`，所以“消息数”和“执行项数”应明确区分。

对本次 B，已有字段 `nextTurn[].messageId/workItemId/position` 加 `phase: queued`、`queueReason: host_queue`、`contextId: null` 足以显示一个待路由标记。本轮只评估字段，不修改客户端。

## 交付边界

本轮交付文件：

- `src/index.ts`
- `tests/bubble-stop.test.ts`
- `dist/index.js`
- `dist/index.d.ts`
- `docs/design/topic-bubbles-stop-queued-report.zh.md`

未修改 `src/client-foam.ts`、`src/client-foam-host.ts`、`src/client.ts`、`src/client-locales.ts`。没有子代理、node_repl 或选择/确认弹窗；没有登录、修改账号设置、部署、发布或调用真实模型。没有运行 git add/commit/push；由 Claude 核对后提交。开始时已有的其他源码/测试改动及 `experiments/sidebar-cell-capsule/harness.js` 未由本轮改写。
