# 话题细胞团：后端第二期（给 Codex 的任务说明）

第一期（你做的 `e023bdf`…`0cf31ec`）已经通过验证：625 项测试全部通过，在真实 DSH 里事件流顺序正确，客户端已经接上（`src/client-foam-host.ts`）。下面四项是客户端现在还缺的后端能力。

## 工作位置与规则（同第一期）

- 仓库 `D:\doc\GitHub\dsh-theone-bubbles`，分支 `topic-bubbles`。不切分支，不 push，不合并。
- **不要改**：`src/client.ts`、`src/client-foam.ts`、`src/client-foam-host.ts`、`src/client-locales.ts`、`experiments/`。`dist/` 由构建生成，提交时只包括你改动的后端文件对应的产物。
- 不碰 `.dsh/`、`.workbuddy/`、`promo*/`、`outreach/`。
- 细胞团只观察，不触发模型调用；GET 请求不写数据库。
- 每一项单独提交，英文一句话的提交信息，不加 Co-Authored-By；只 `git add` 你改过的文件。
- 收尾跑 `npm run typecheck`、`npm test`、`npm run build`，三者都要通过。PowerShell 里用 `npm.cmd`。直接用 shell，不用子代理，不用 node_repl。

## 1. 合并排队（按你评审的 4.4 节实现）

- `POST /api/theone/topics {action:'merge', id, into, whenIdle:true, requestId}`：能立刻合并就返回 200；需要等待就返回 **202**，并带上 operationId 和操作状态。不传 `whenIdle` 时，保持现在的行为（成功 200，忙碌时 409）。
- `{action:'cancelMerge', operationId}` 可以取消，重复取消是幂等的。
- 有过期时间。同一 requestId 但参数不同，返回 409。反向合并、交叉合并、循环合并直接拒绝。
- 执行前重新校验，和 `startRun` 共用维护租约，避免检查和执行之间的竞态（TOCTOU）。
- 默认：重启后取消尚未执行的排队项，并保留回执。
- 快照的 `merges` 里列出 queued 和 executing 状态的操作。事件：`merge.changed`；成功时**必须**发出 `topic.merged`，客户端靠它播放融合动画。
- 客户端约定：200 表示已经合并，202 表示排上队了，其他状态码表示失败。

## 2. 话题短名 `BubbleTopic.label`

很多话题标题很长（比如“想去日本旅游，帮我看看行程”），细胞里放不下。请给每个话题一个短名：

- 来源：话题已有的 `entities` 和 `keywords`，优先选在标题里出现过的词；长度是 2–6 个汉字，或者不超过 14 个拉丁字符。没有合适的就给 `null`，客户端会自己兜底。
- 必须是确定性的：同样的话题数据，给出同样的短名。不调用模型，不写数据库。
- 用测试覆盖：中文、英文、混合、没有关键词这几种情况。

## 3. 打开话题用的会话 `BubbleTopic.openSessionId`

客户端“打开话题”现在要额外读一次 `/catalog`。请在快照里直接给出：优先给最近的来源会话，否则给 Worker 会话。归档的会话照样给出（客户端会先把它从归档里取出来再打开）。

## 4. 按工作项停止或撤回

- `POST /api/theone/topics {action:'stop', workItemId}`：
  - 如果正在执行，停止这次执行（用 `WorkerRun.cancel` 等现有原语），已经产生的结果不删；
  - 如果还在排队、没开始，就撤回这条输入。
- 返回体要说明实际做了哪一种。不允许的情况返回明确的错误码（比如已经交付完、或者不存在）。
- 工作项上的 `stop: Capability` 要如实反映这个接口能不能用。
- 发出对应的 `work.changed` 和 `delivery.changed` 事件。

## 汇报（中文）

每一项的提交 hash，接口示例（请求和响应），错误码表，没做完或没验证的部分照实写。
