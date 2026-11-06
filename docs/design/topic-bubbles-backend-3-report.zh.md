# 话题细胞团后端第 3 阶段报告

日期：2026-11-06。对应 `topic-bubbles-backend-3.zh.md`。

后端已把自动合并建议改为持久化的侧栏状态，接受操作复用 `TopicMergeQueue` 和维护锁；新增终态回执快照，并补齐 `/routes` 的不可达目标守卫。本文不代表客户端已完成对接、真实模型或桌面交互已经验收。四个并行编辑的客户端源文件未修改。

## 1. 建议记录与迁移

`contexts.db` 新增 `merge_suggestions` 表。每个规范化 pair 只有一条建议，记录独立于旧 `merge_prompts`，不会在预留时写入 `dismissed` 或 `declined`。没有新增分类模型调用、Worker 或聊天回合。

`BubbleMergeSuggestion` 位于 `src/bubble-types.ts`：

| 字段 | 含义 |
| --- | --- |
| `suggestionId` | 持久化 UUID，也是响应接口的幂等对象 |
| `scope.gatewayKey / gatewayId` | 配置范围与建议所属主聊天；创建时使用该新话题最后路由到的 gateway |
| `pair` | 排序后的两个话题 ID；去重仍沿用同一存储内跨 gateway 不重复询问该 pair 的策略 |
| `directions` | 两个 `{sourceId,targetId}` 方向；source 并入 target，保留 target；首项是新话题并入候选旧话题 |
| `evidence.sharedNames / titleSimilarity` | 创建时共享名称数与标题相似度；保留现有候选门槛和排序 |
| `createdAt / updatedAt / expiresAt` | Unix 毫秒时间；pending 有效期 30 分钟 |
| `state` | `pending / accepted / declined / dismissed / expired` |
| `operationId / sourceId / targetId / requestId` | 接受后绑定的唯一合并操作与方向 |
| `reason` | 生命周期失效原因，如 `SUGGESTION_INVALID / SUGGESTION_EXPIRED / GATEWAY_CLOSED` |

旧 `merge_prompts` 原样保留，不伪造其 suggestionId、时间或用户意图。旧 `dismissed` 仍抑制再次建议，**不转换为明确拒绝**；旧 `declined`、`merged` 同样保持原有抑制行为。

同意只是 `accepted`，只有实际结构合并成功后才在旧 pair 记录写 `merged`。`decline` 与建议状态在同一存储事务内写入，不写负关联、不标 done、不写路由学习。`later` 不修改服务端状态，建议仍为 pending，客户端只收起此次展开；因此之后仍可以接受或拒绝同一建议。

有效性检查包含：话题仍存在、未被排除／失去全部可读来源、gateway 范围及最后归属仍有效、pair 未被处理、当前共享名称／标题仍达到原相似度门槛，以及创建时的结构指纹仍匹配。指纹覆盖 Worker 身份、名称、分组、目录和手动移动／合并标记，以 SHA-256 保存；它不是对外的通用 `topicRevision`。执行前和 Worker 释放后再次检查。执行等待期间发现失效会记住该结果，即使用户随后改回原值也不会复活旧意图。

会话明确关闭、删除／移组／改名或不可达会清理 pending 建议；超时由定时器和写接口处理。GET 快照不执行过期写入。插件停止／正常重启保留仍有效的 pending；已经接受但未完成的合并沿用队列既有重启策略，取消并保留回执，不自动重做。

## 2. 响应接口

`POST /api/theone/topics`：

```json
{
  "action": "mergeSuggestion",
  "suggestionId": "<snapshot.mergeSuggestions 中的 ID>",
  "response": "accept",
  "sourceId": "topic-to-remove",
  "targetId": "topic-to-keep",
  "requestId": "<本次明确意图的唯一 ID>"
}
```

`response` 必须是字符串 `accept / decline / later`。`sourceId / targetId` 可省略，默认选第一方向；重试已接受的建议则默认沿用已经接受的方向。建议客户端总是提交用户明确选择的完整方向。`requestId` 可省略，服务端使用 `suggestion:<suggestionId>`；传入时必须是非空、最长 128 字符的字符串。

接受操作重新校验建议与话题，再通过队列检查全局忙态、冲突和维护锁。空闲时立即完成，返回 **200**；需要等待或另一个窗口正在执行，返回 **202**。响应结构如下：

```json
{
  "operationId": "<持久化操作 ID>",
  "requestId": "<第一个接受请求的 ID>",
  "suggestionId": "<建议 ID>",
  "sourceId": "topic-to-remove",
  "targetId": "topic-to-keep",
  "whenIdle": true,
  "state": "queued",
  "createdAt": 1800000000000,
  "updatedAt": 1800000000000,
  "expiresAt": 1800000300000,
  "suggestion": { "state": "accepted", "...": "其余 BubbleMergeSuggestion 字段" }
}
```

`suggestion.state=accepted` **不代表合并成功**，应以操作 `state=succeeded` 为准。同一建议的多窗口请求及网络重试返回相同 operationId；后来的不同 requestId 不会创建第二个操作。反向接受同一建议返回冲突。`decline / later` 成功返回 200 与 `{suggestion}`；重复 decline 返回原记录。

取消仍用 `{action:'cancelMerge', operationId}`；撤销成功合并仍用 `{action:'unmerge', id:sourceId}`。取消后的旧 suggestionId 仍绑定旧回执，不会重新排队。如果用户明确发起新的合并意图，应调用普通 merge 接口并生成新的 requestId：

```ts
// 网络重试复用此对象；再次明确发起操作时重新生成 requestId。
const command = {
  action: 'merge', id: sourceId, into: targetId,
  whenIdle: true, requestId: crypto.randomUUID(),
}
```

普通 merge 的 requestId 语义无需放宽：同 ID 重放原终态，不同 ID 可以在取消、过期或撤销后开始新的操作。本轮增加了回归验证，并禁止普通 merge 请求复用另一条建议操作的 requestId。

### 错误码

| HTTP | 错误码 | 客户端处理 |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | 修正字段类型、响应值或 requestId |
| 404 | `UNKNOWN_SUGGESTION` | 建议不存在或不属于当前 gatewayKey，刷新快照 |
| 409 | `SUGGESTION_CONFLICT` | 方向不属于该 pair，或与已接受方向冲突 |
| 409 | `SUGGESTION_FINISHED` | 已接受／拒绝后又提交不同响应，不覆盖先到的决定 |
| 409 | `SUGGESTION_EXPIRED` | pending 已超时，清理本地入口 |
| 409 | `SUGGESTION_INVALID` | 会话关闭、结构或可达性变化，刷新快照 |
| 409 | `MERGE_CONFLICT / REQUEST_ID_CONFLICT` | 其他合并占用话题，或 requestId 已用于另一命令；保留候选并显示原因 |
| 409 | `MERGE_UNAVAILABLE` | 队列已关闭或回执不可用 |
| 409，含操作回执 | `MERGE_CANCELLED / MERGE_RESTARTED / MERGE_EXPIRED / TOPIC_CHANGED / UNKNOWN_CONTEXT / TOPIC_HIDDEN / MERGE_FAILED` 等 | 操作已取消、过期或失败；不要播放合并成功动画 |

合并立即成功返回 200，尚在排队／执行返回 202，已有失败终态返回 409 与完整操作回执。取消 executing 仍返回 `MERGE_EXECUTING`，已经结束则为 `MERGE_FINISHED`。

## 3. bubbles 快照、能力和事件

`GET /api/theone/bubbles` 继续使用 schemaVersion 1、epoch/version/seq、long poll 与事件缺口重置协议，增加两个字段。当前服务器总会返回数组；类型为可选以兼容旧 schemaVersion 1 生产者。

| 字段 | 内容 |
| --- | --- |
| `mergeSuggestions` | 当前 gateway 的 pending 建议，含 pair、两个方向和依据；只包含可展示话题 |
| `merges` | 仍是 queued / executing 的操作，保持已有客户端语义 |
| `mergeReceipts` | succeeded / cancelled / expired / failed 的持久化终态回执；包含 operationId、requestId、suggestionId（若有）、方向、时间与 error；不暴露当前被排除或 orphaned 的话题引用 |

快照包含终态回执，因此错过事件或重启后仍可恢复成功、取消、过期和失败原因。删除的话题 ID 可以出现在相应失败回执里，供已有操作匹配；成功合并已移除的 sourceId 也保留。当前没有新增历史回执清理或分页策略。

每个话题已有 `capabilities.mount / declareDone / mergeNow / queueMerge / delete`，每项 `{allowed, reason?}`，本轮保留并验证其行为。全局忙时 mergeNow 为 `gateway_busy`；已有活动合并占用该话题时 queueMerge 为 `topic_busy`；终态回执不会继续占用话题能力。

停止必须针对具体工作项：`workItems[].stop={allowed,reason?}`，并用 `workItemId` 提交 `{action:'stop',workItemId}`。话题通过 `workItemIds` 关联工作项，不能只选第一个工作项或将它们合成一个不明确的 stop。能力 reason 的现有枚举是 `gateway_busy / topic_busy / unavailable / pending_delivery / unsupported / already_delivered / already_stopped / not_running`。

新增事件：

- `mergeSuggestion.appeared`：`{suggestion}`，只发送到建议所属 gateway；当前不可见或已经结束的建议不会从旧缓冲事件中重新出现。
- `mergeSuggestion.ended`：`{suggestionId,state,operationId?,reason?}`。接受后也结束 pending 展示，但执行进度继续由队列事件负责。
- 继续消费 `merge.changed` 的完整操作回执，以及 `topic.merged / topic.unmerged`。所有事件仍带 `seq/version/at/gatewayId`。

客户端收到 `reset=true` 时用快照重建状态，不依赖补播旧动画；正常更新也以快照为准。可以这样调用：

```ts
const suggestion = snapshot.mergeSuggestions?.find(s => s.suggestionId === selectedId)
if (!suggestion) return refresh()
const direction = suggestion.directions[selectedDirection]
const response = await fetch('/api/theone/topics', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'mergeSuggestion', suggestionId: suggestion.suggestionId,
    response: 'accept', ...direction, requestId: intentId }),
})
const result = await response.json()
// 仅 response.ok 表示命令被接受；202 显示排队与取消入口。
// 保存 result.operationId；成功动画仅依赖 succeeded。
// 非 2xx 保留错误原因，回滚本地预览，并刷新权威快照。

// 稍后：服务端 pending 不变，本地只折叠该建议详情。
await post({ action: 'mergeSuggestion', suggestionId: selectedId, response: 'later' })
// 明确拒绝：只拒绝合并该 pair。
await post({ action: 'mergeSuggestion', suggestionId: selectedId, response: 'decline' })
```

## 4. `/api/theone/routes`

显式纠错在调用 `applyCorrection`、写学习与 mount 之前检查 `store.unreachable()`；`excluded / orphaned` 返回 **409 `TOPIC_HIDDEN`**，与 mount 相同。仅 archived 的话题仍可恢复使用。undo 也在等待已有学习完成后重验原目标与忙态；不可达时不撤回学习、不清除 correctedTo、不挂载。undo 原话题已不存在返回 400 `UNKNOWN_CONTEXT`；其他原有错误码不变。

## 5. 验证与交付

| 检查 | 实际结果 |
| --- | --- |
| 新增回归的先失败再修复 | 先确认建议字段缺失、不可达纠错仍返回 200；另复现并修复 undo 不可达、释放 Worker 时改回原值、非字符串 response 被误当接受、共享实体被后续卡片替换等边界 |
| 相关后端 14 个测试文件 | **100/100 通过**，0 失败／取消／跳过，约 51.2 秒；包含实际 HTTP 长轮询与断连检查 |
| 最后修改后的四个直接相关回归文件 | **46/46 通过**，0 失败／取消／跳过，约 16.1 秒；包括新增的当前相似度重验 |
| 全量测试运行 | **650 项，646 通过、4 失败，0 取消／跳过**，约 191.9 秒；4 项均为创建子进程时的 `EPERM`，详见下文。其后最后边界改动已经由上述 46 项复核 |
| 后端及非客户端测试类型检查 | **通过**：`npm.cmd exec --offline -- tsc -p .theone/backend-3-tsconfig.json` |
| 后端编译及 dist | **通过**：`npm.cmd exec --offline -- tsc -p .theone/backend-3-build-tsconfig.json`；最新后端产物已生成 |
| `npm.cmd run typecheck` | 未全通过：仅并行客户端的中间编辑错误；`src/client-foam-host.ts:276,283,284` 的回调参数／Promise 返回值，与 `src/client-foam.ts:569` 的合并参数不一致；未修改这些文件 |
| `npm.cmd run build` | 同样停在上述客户端类型错误；不能声称标准整包 build 已通过 |
| `npm.cmd test` | 默认进程隔离被 `spawn EPERM` 拦截，未执行正常断言 |

按要求尝试 `npm.cmd exec --offline -- tsx --test --test-isolation=none tests/merge-suggestions-api.test.ts`，但当前限制连 tsx 的 esbuild 编译子进程也拦截。因此使用临时、未提交的 `.theone/backend-3-loader.mjs`，通过 Node `registerHooks` 在进程内调用已安装 TypeScript 的 `transpileModule`，执行**同一批源测试**；没有修改 package.json、测试断言或依赖来绕过失败。实际完整运行命令：

```powershell
node --import ./.theone/backend-3-loader.mjs --test --test-isolation=none tests/*.test.ts
```

4 个环境失败分别为：`client-topic-folder.test.ts`、`client-update.test.ts` 启动 esbuild；`pack-plugin.test.ts` 启动打包进程；`route-stats.test.ts` 启动 Node 脚本。按任务约定由 Claude 在可启动子进程的环境重跑标准全量套件；当前并行客户端编辑也需要完成后再次执行完整 typecheck/build。

临时 loader、两个仅排除 `src/client*.ts`／客户端测试的 tsconfig 和运行日志都在已忽略的 `.theone/`，未纳入提交。日志分别为 `backend-3-full-test.log`、`backend-3-focused-test.log`、`backend-3-final-regressions.log`、`backend-3-npm-test.log`、`backend-3-tsx-no-isolation.log`、`backend-3-build.log`。后端源码、测试、此报告和对应后端 dist 构成本轮待提交范围；前端编译产物留给并行工作处理。

**提交未完成。** 已使用逐文件 `git add -- <本轮 21 个文件>`，没有使用目录或通配符暂存。Git 在写入 `D:/doc/GitHub/dsh-theone/.git/worktrees/dsh-theone-bubbles/index.lock` 时返回 `Permission denied`；该索引位于当前工作区可写范围外。因此本轮没有成功暂存、没有创建提交，也没有 push。当前 Git 配置的提交身份已核对为 YunongDai2005；后续提交应继续使用该身份且不添加 Co-Authored-By。

待提交的 21 个文件如下，可在具有 Git 索引写权限的执行环境逐项暂存：

```text
src/bubble-aggregator.ts
src/bubble-projection.ts
src/bubble-types.ts
src/index.ts
src/store.ts
src/topic-merge-queue.ts
tests/bubble-api.test.ts
tests/bubble-merge.test.ts
tests/merge-suggestions.test.ts
tests/merge-suggestions-api.test.ts
docs/design/topic-bubbles-backend-3-report.zh.md
dist/bubble-aggregator.js
dist/bubble-projection.d.ts
dist/bubble-projection.js
dist/bubble-types.d.ts
dist/index.d.ts
dist/index.js
dist/store.d.ts
dist/store.js
dist/topic-merge-queue.d.ts
dist/topic-merge-queue.js
```

本轮只使用 shell 命令执行验证；没有子代理或 node_repl。没有安装、发布、push、登录、修改账号设置或访问真实用户 DSH 数据。测试使用隔离临时目录、实际 DSH 会话／持久化／HTTP bridge 和 fixture 模型；不是实际模型效果或桌面视觉验收。
