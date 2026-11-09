# Bubble projection performance repair

Baseline: `50d124c` on `topic-bubbles`. This follows the routing-test timeout recorded in [the bubble boundary validation](bubble-header-overlap-validation.md).

## Cause and change

Every `sourceRanges(topicId)` call previously loaded and decoded all topic descriptors to find one worker session ID. A bubble projection reads sources for every topic. Catalog health reads also constructed full catalog snapshots, repeating those source reads. Frequent synchronous publication amplified this into roughly quadratic descriptor decoding and long event-loop stalls.

- Look up the worker session ID by the indexed topic ID, preserving bounded-history, worker and legacy-unscoped source classification.
- Add `HistoryCatalog.statusSnapshot()` for current status without topic/group/source enumeration. Bubble health, consent responses and feedback use it; full snapshots share the same status normalization.
- Preserve the original routing test's **30,000ms timeout** and all routing assertions. Add a generous work budget of fewer than 100,000 decoded descriptors for its three-message scenario, so the original approximately two-million-decoding regression also fails on faster machines.

There is no cross-request cache or publication debounce. Status is read fresh, and the original publication/event behavior is retained.

## Measured comparison

The original named routing test was run sequentially on the baseline and repair checkout, using the same forwarding-only read counters. Both use real DSH session/storage/gateway components and the existing local fixture model, with 70 additional topics and three messages. The observer does not replace query results or model behavior.

| Metric | Baseline | Repair |
| --- | ---: | ---: |
| Named test duration | 8,597.95ms | 2,193.81ms |
| Full context-list reads | 27,238 | 491 |
| Topic descriptors decoded | 2,002,718 | 35,683 |
| Source-range reads | 26,565 | 13,319 |
| Bubble publications | 94 | 94 |
| Synchronous time inside publication | 8,100.31ms | 1,704.36ms |

This run reduced test duration by about 74.5% and descriptor decoding by about 98.2%. These are local measurements, not a promise about remote model latency or all library sizes.

## Verification

- Red phase: all three targeted regressions failed on the baseline behavior: health assembled a catalog snapshot; a source lookup decoded unrelated topics; three gateway messages decoded 1,992,030 descriptors.
- Source regressions (`store`, `bubble-api`, `bubble-projection`, `routing-policy`): **35/35 passed**. The originally slow test took 2.20s with its existing 30s limit.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Default full `npm test`: **764/764 passed**, zero failed/cancelled/skipped, 119.51s. The originally slow routing test passed in **4.26s** during this run, with the unchanged 30s timeout and the new decoding budget.
- Regression checks against built modules (`store`, `bubble-api`, `bubble-projection`, `routing-policy`): **35/35 passed**; the originally slow case took 2.11s.

Ignored local logs and read-counter JSON are in the repair checkout's `.theone/` directory and `.theone-*.log` files. The production patch changes only store lookup and catalog status reads; no timeout or default test concurrency was increased.

## 2026-11-09：发布批次与历史网关扩展性

本节基线为 `8fc6efb`，继续修复前一节之后仍然存在的重复发布开销。只修改后端气泡聚合、投影和接线，以及新增测试、基准脚本和本节；没有修改客户端或真实数据库。

### 实现与协议取舍

- `src/bubble-projection.ts` 的 `readBubbleProjection()` 在一次 flush 内读取共享事实：目录、隐藏原因、私有标记、使用量、执行记录、完成声明、时间线、分组、建议、来源、连接和项目来源；同时计算标签、打开的会话、休眠统计和候选布局边。`unavailable` 从同一次隐藏原因读取派生，路由记录按最新运行读取一次。`projectBubbles()` 仅做 scope 过滤、可见性和可见边选择。
- `src/index.ts` 的 `prepareBubblePublication()` 每批只计算一次活动快照、停止/完成能力、catalog 状态、merge 状态、topicIds 和不可用 ID。公开的同步 `bubbleView()` 先 flush，再读取最新事实；共享数据不跨批缓存。
- `src/bubble-aggregator.ts` 的 `publish()` 在服务开启 `defer` 后排入 microtask；`read()`、poll 注册/唤醒/超时检查和同步观察边界会先 flush。全部 scope 准备成功之后才提交、通知 waiter。事件入队时复制，按调用顺序和 scope 保留；同批事件共享 version，seq 逐事件递增。version 计的是已提交批次，不是通知函数被调用的次数。环形缓冲仍为 512，reset 原因和 schemaVersion 不变。关闭会丢弃待发布批次；投影失败保留队列，下次发布或读取可重试。
- **同步例外有意保留**：直接构造的旧式 aggregator 默认同步；服务的创建/删除、挂载、编辑、私有性、分组、合并、隐藏/恢复、完成声明、运行记录、学习回放及建议可见性边界同步发布。存在归档或完成声明时，activity 也同步观察，因为仅活动变化就可能使话题恢复、移除或重新打开。普通连接、目录状态、会话元数据和不影响这些话题事件的 activity 通知合并。同步边界的 topic 事件插在此前已排队的事件之后，避免颠倒顺序。因此不能把“50 次连接改动合为一批”推广为“任意 50 次编辑都合为一批”。
- 只投影 `null`、最新网关、最近读过的 head 和有 waiter 的 scope。其他已知网关首次读取时建 head，不返回 `UNKNOWN_GATEWAY`。**5 分钟**没有读取且没有 waiter 的非最新 head 在下一次发布/读取时回收：这个窗口远大于 25 秒长轮询，允许短暂断线，同时限制遗留窗口持续占用。重建使用新的不透明 epoch（仍为 UUID 加 scope 后缀），旧同 scope 游标得到 `epoch_changed`；活跃 scope 之间切换得到 `scope_changed`，其他活跃 head 不受影响。旧事件不补播，新 head 从完整快照开始续读。

### 验证

- 红阶段在原实现上新增的 8 项测试有 **6 项按预期失败**：30 个活跃网关的一次发布读取 `contexts()` **63 次**；50 次连接写入投影 **1,550 次**；事件没有同批提交，waiter 只拿到第一条事件，冷网关被提前投影，close 前已执行待合并投影。另两项是原有同步语义的兼容保护。
- 随后的红/绿测试还抓到并修复了工作事件与同步编辑的顺序、waiter 重查误回收刚建立的冷 head、归档话题在同回合内恢复/移除/再恢复的事件丢失，以及 flush 的 listener 关闭服务时应返回 `BUBBLES_CLOSED` 的边界。
- **95/95 通过**：原有 70 项 bubble 测试、新增 16 项发布回归、3 项 store 测试、6 项 routing-policy 测试。原测试断言及路由测试的 **30 秒 timeout** 未修改；最后一次组合运行耗时 38.89 秒，原路由案例 0.69 秒。
- **144/144 投影对照一致**：脚本将原版和新版投影器用于同一内存库，覆盖 null/历史/当前 scope、三种 linkScope、隐藏/归档、分组/项目来源、私有性、手工/学习连接、持久化/实时运行、完成声明、合并建议、busy 状态与来源选择。
- `npm.cmd run typecheck` 通过；`git diff --check` 通过。使用 tsc 输出到忽略的 `.theone/publish-scaling/current`，再单进程执行测试，没有改写现有 `dist/`。完整 `npm.cmd test` 和 `npm.cmd run build` 按任务说明留给 Claude 执行，不能把本节验证当作这两项已经通过。

### 基准结果

Windows / Node **v24.21.0**，本机顺序运行，使用相同的 forwarding-only 计数器。耗时为单次观测，受机器负载影响；读取次数更适合用作扩展性证据。以下使用最终源码的复测数据。计时包含同步 publish 和实际执行的 microtask/read flush，并扣除嵌套计时的重复累计，不能只计入队函数返回前的耗时。

合成场景为 **300 个话题 × 30 个已知网关 × 同一回合 50 次真实 `setManualLink()` 写入**，修改 50 对连接。建库、预热、登记网关和可选的 30 次预先读取不计入测量。

| 指标 | 8fc6efb：仅最新网关需要更新 | 修复后：仅最新网关需要更新 | 8fc6efb：30 个网关均活跃 | 修复后：30 个网关均活跃 |
| --- | ---: | ---: | ---: | ---: |
| 发布/flush 累计耗时 | 65,249.73ms | **56.88ms** | 69,837.80ms | **74.13ms** |
| 50 次写入及 flush 总耗时 | 65,270.15ms | 64.22ms | 69,856.75ms | 82.06ms |
| publish 调用数 | 50 | 50 | 50 | 50 |
| 实际投影批次 | 50 | **1** | 50 | **1** |
| scope 投影数 | 1,550 | **2** | 1,550 | **31** |
| 发布内共享读取总数 | 25,000 | **12** | 25,000 | **12** |
| 发布内 contexts 读取 | 3,150 | **1** | 3,150 | **1** |
| 发布内 descriptor 解码 | 945,000 | **300** | 945,000 | **300** |
| 发布内 sourceRanges 读取 | 465,000 | **300** | 465,000 | **300** |

“共享读取总数”是 contexts、hiddenReasons、privateIds、unreachable、contextUsage、latestTopicRuns、declaredTopics、routeTimeline、groups、mergeSuggestions、links、origins、current 的调用数之和，包含原实现中互相调用的读取；route、sources、sourceRanges 单列在 JSON 中。新版这 12 类实际读取各执行一次，unreachable 由 hiddenReasons 派生、调用数为零。写入路径仍有 **50 次** `syncMergeSuggestions()` 读取，不属于气泡发布；包括它们的共享读取总数是 **25,050 → 62**，没有把它们隐藏或计为已消除。

原路由测试仍运行原文件中的三条消息场景（额外 70 个话题，真实 DSH session/storage/gateway 和本地 fixture 模型），没有复制或削弱断言：

| 指标 | 8fc6efb | 修复后 |
| --- | ---: | ---: |
| 原命名测试耗时 | 2,539.33ms | **944.81ms** |
| 发布/flush 累计耗时 | 2,037.99ms | **512.21ms** |
| publish 调用数 / 投影批次 | 95 / 95 | 89 / 62 |
| scope 投影数 | 184 | 119 |
| 发布内共享读取 | 3,318 | 744 |
| 发布内 contexts 读取 | 463 | 62 |
| 发布内 descriptor 解码 | 33,626 | 4,417 |
| 全场景 descriptor 解码 | 36,048 | 6,766 |
| 发布内 sourceRanges 读取 | 13,392 | 4,417 |

原始 JSON 和日志保存在忽略目录 `.theone/publish-scaling/`：`baseline-burst-0.json`、`baseline-burst-30.json`、`current-burst-0.json`、`current-burst-30.json`、`baseline-routing.json`、`current-routing.json`，以及对应的 `*-routing.log`、`red.log`、`verification-final.log`。这是本地后端工作量/延迟验证，不是部署、真实模型费用或前端视觉验收。

### 复现命令

在仓库根目录的 PowerShell 中执行。基准脚本只创建临时测试库，不连接模型服务。当前测量的 baseline JS 是修改生产源码之前由 `8fc6efb` 编译的副本；以下命令可从 Git 重建基线，且不切换工作树、不修改 Git 索引。

```powershell
New-Item -ItemType Directory -Force .theone/publish-scaling/baseline-source | Out-Null
git archive --format=tar --output=.theone/publish-scaling/baseline-source.tar 8fc6efb src tests scripts fixtures package.json tsconfig.json tsconfig.tests.json
tar -xf .theone/publish-scaling/baseline-source.tar -C .theone/publish-scaling/baseline-source
node node_modules/typescript/bin/tsc -p .theone/publish-scaling/baseline-source/tsconfig.tests.json --noEmit false --declaration false --outDir .theone/publish-scaling/baseline
New-Item -ItemType Directory -Force .theone/publish-scaling/baseline/fixtures | Out-Null
Copy-Item .theone/publish-scaling/baseline-source/fixtures/* .theone/publish-scaling/baseline/fixtures -Recurse -Force

node node_modules/typescript/bin/tsc -p tsconfig.tests.json --noEmit false --declaration false --outDir .theone/publish-scaling/current
New-Item -ItemType Directory -Force .theone/publish-scaling/current/fixtures | Out-Null
Copy-Item fixtures/* .theone/publish-scaling/current/fixtures -Recurse -Force
node --test --test-isolation=none '.theone/publish-scaling/current/tests/bubble-*.test.js' .theone/publish-scaling/current/tests/store.test.js .theone/publish-scaling/current/tests/routing-policy.test.js
npm.cmd run typecheck
node scripts/benchmark-bubble-publish-scaling.mjs --compare .theone/publish-scaling/baseline .theone/publish-scaling/current

foreach ($variant in @('baseline','current')) {
  foreach ($active in @(0,30)) {
    node scripts/benchmark-bubble-publish-scaling.mjs ".theone/publish-scaling/$variant" ".theone/publish-scaling/$variant-burst-$active.json" $active
  }
  $env:BUBBLE_BENCH_ROOT = (Resolve-Path ".theone/publish-scaling/$variant").Path
  $env:BUBBLE_BENCH_OUTPUT = Join-Path $PWD ".theone/publish-scaling/$variant-routing.json"
  node --import ./scripts/benchmark-bubble-publish-scaling.mjs --test --test-isolation=none --test-name-pattern='native gateway never asks back' ".theone/publish-scaling/$variant/tests/routing-policy.test.js"
  Remove-Item Env:BUBBLE_BENCH_ROOT,Env:BUBBLE_BENCH_OUTPUT
}
```

完整项目检查仍待执行：`npm.cmd test`、`npm.cmd run build`。本任务说明明确要求由 Claude 审查后提交，本轮没有尝试写入只读 `.git`，也没有发布或部署。
