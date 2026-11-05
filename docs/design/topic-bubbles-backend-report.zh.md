# 话题细胞团后端第一期交付报告

日期：2026-11-05。分支：topic-bubbles。范围以任务说明为准：完成第 1–4 项，以及第 5 项的 status done 忙碌保护；合并排队不在本期。

## 逐步交付与提交

| 步骤 | 实现 | 提交 |
|---|---|---|
| 1 | 纯类型协议；只读投影；分离生命周期、挂载、执行与交付；可见性、能力和有界布局边 | e023bdf |
| 2 | 每个 WorkerRun 独立 executionId；messageIds/batchId；分类、队列、项目锁、执行、选中、提交、取消观测 | 925d62f |
| 3 | GET /api/theone/bubbles；同步聚合快照与事件；epoch/version/seq/reset；提交后的 store 与 catalog 变更发布 | 4273244 |
| 4 | 25 秒有界长轮询；注册前后检查；断连、超时和插件生命周期清理；真实 HTTP 验证 | 22216f2 |
| 5 | TOPIC_BUSY 守卫；能力与写接口一致；重启待恢复/待交付保护；最终回归、后端构建产物和本报告 | 本报告所在提交，最终 hash 见交付消息 |

第 5 步同时修正集成测试发现的观测问题：steering 合并后短暂重复、撤回附加消息误丢弃整轮、handback 继承旧终态、失败 handback 的准备对象未收尾、恢复路径残留 routing、合并来源离开快照后事件被过滤。每项先复现失败，再验证修复。没有新增路由或模型请求来生成这些状态。

## 客户端协议

协议类型位于 [src/bubble-types.ts](../../src/bubble-types.ts)，只有类型，可用 import type 引入。

| 字段 | 使用方式 |
|---|---|
| topics[].current | 当前挂载，独立于是否正在执行；aside 不因此夺取当前挂载 |
| lifecycle / declaredDoneAt / effectiveDone | 业务生命周期、历史 done 声明和当前是否有效；不能拿 lifecycle=active 当作正在执行 |
| workItems[].id / executionId | 逻辑处理项与实际 WorkerRun 的身份；handback 同一 messageId 可有多次执行；恢复历史不能证实时 executionId=null |
| messageIds / primaryMessageId / batchId | 真实合批与 steering 归属；批次不是话题身份；历史不可恢复的 batchId=null |
| phase / queueReason | 执行阶段与排队原因；容量、同话题、项目锁分别报告；尚未创建的目标保持 contextId=null |
| delivery.phase | waiting、selected、showing、shown、discarded、unknown，独立于执行阶段；succeeded + waiting 才是成功待交付 |
| shownSteps / committedSteps / commit | 已开始跟随步数、主聊天已提交步数及宿主事件定位；shown 要等整轮交付收尾，不能由一次流式片段推断 |
| gateway.nextTurn / nextStep / claimed | 两个宿主队列及取走但仍在分类的批次；位置只是当前队列顺序 |
| capabilities | 展示操作入口，提交时仍由服务端重新验证；mount/mergeNow/delete 保留现有全局 busy 边界，done 按目标话题判断 |
| edges | 布局关系，不证明已提供参考，也不改变共享权限；每端 top 4 取并集，总数最多 256，强度按 0.05 量化，保留 kept_apart |
| private | 反映现有单向共享语义，不表示双向隔离，也不对 owner 隐藏 |
| health | 目录按实际状态发布；路由模型健康没有足够证据时给 unknown，规则路由给 rules |

归档但当前挂载、运行或待交付的话题继续可见，包括另一主会话拥有待交付工作的情况。excluded/orphaned 不出现在话题或关联端点中；相关工作保留可观测身份，目标置 null 并标记 targetUnavailable。事件按同一已发布切面过滤。正常删除、合并可保留曾经可见的来源 ID，供客户端收尾；不会为被排除的话题保留这种动画标识。

aside 交付后不会自动声明 done 或删除。10 分钟内手动打开别的话题沿用弱学习，只产生 route.hint。显式纠错、口头纠错、handback、undo 用 route.moved 区分原因；reexecute 明确是否重新执行。topic.merged/topic.unmerged 只报告已提交结果；恢复可见性使用原话题 ID 和 restored，不伪装成新建。

### 请求、游标与长轮询

首次请求 GET /api/theone/bubbles?waitMs=0。可传 gatewayId；省略时选择当前 gatewayKey 下最近主会话。之后固定该 scope，并带回完整游标：

GET /api/theone/bubbles?gatewayId=...&gatewayKey=...&epoch=...&since=<cursor.version>&after=<cursor.seq>&waitMs=25000

- kind=update 始终包含完整 snapshot 和该切面之前的增量 events；先替换快照，再消费可用事件。
- kind=unchanged 只返回 scope、cursor、serverTime；保留现有快照。
- epoch 为不透明字符串，包含实例代次与 scope 标识；只在相同 scope/epoch 内比较 version/seq。每个发布批次提升 version，事件各有 seq；同批事件可以共享 version。
- 必须保存响应的 cursor.seq，不能取最后一个可见事件的 seq。事件可能被过滤，快照也可以在没有事件时变化。
- 每个 scope 保留最近 512 个事件。eventFloor 是最后被淘汰的 seq，after 小于它就重置。
- reset=true 的原因包括 initial、epoch_changed、scope_changed、events_expired、cursor_ahead。重置时 events 为空；清掉旧动画和去重状态，不补演历史。网络响应也要按请求所属 scope 和游标丢弃迟到结果。
- waitMs 默认 0，范围 0–25000，超过上限会被截断。游标完整且没有变化时才等待。每个插件实例最多挂起 128 个请求；初次/重置/已有变化立即返回。
- 查询中的重复参数、空值、超过 256 字符的值，以及负数、小数、非数字、非安全整数返回 INVALID_CURSOR。所有响应带 Cache-Control: no-store。
- 客户端每个视图保持一个在途请求；卸载/切换主会话时 abort。网络错误、429、503 使用有上限的退避。旧 transport 若提前结束长请求，退回 waitMs=0 加定时短轮询，不能在 unchanged 后无延迟忙循环。这里交付后端与协议建议，未修改客户端实现回退。

| HTTP 状态 | error | 含义 |
|---|---|---|
| 400 | INVALID_CURSOR | 游标/查询格式不合法 |
| 404 | UNKNOWN_GATEWAY | 主会话不属于当前可读取 scope；插件路由尚未存在时也可能是宿主原生 404 |
| 429 | TOO_MANY_WAITERS | 已到挂起请求上限 |
| 499 | REQUEST_ABORTED | 请求信号已撤销；真实断连时客户端通常收不到响应体 |
| 503 | BUBBLES_CLOSED | 插件关闭；waiter 在数据库关闭之前释放 |
| 409 | TOPIC_BUSY | POST /api/theone/topics 的 status done 被拒绝；含执行、等待用户、启动、排队、待交付、未完成恢复 |

status done 的请求体仍是 {"action":"status","id":"...","done":true}；拒绝时不写声明。闲置话题继续成功，done=false 可以撤销声明；其他话题忙不单独阻止这个闲置话题。检查位于读取 HTTP body 之后、写入声明之前的同步段。

### 真实响应示例

完整文件：[topic-bubbles-response.example.json](topic-bubbles-response.example.json)。来源是 tests/bubble-api.test.ts 通过真实 HostConnectionService 调用 GET，创建一个测试话题后读取增量响应；直接记录返回 JSON。协议不含消息正文、摘要正文或工具参数，无需手工虚构或替换字段。以下只摘取其游标和事件部分；完整 topics/workItems/gateway/edges/health 在链接文件中：

```json
{
  "kind": "update",
  "reset": false,
  "snapshot": {
    "schemaVersion": 1,
    "scope": {
      "gatewayKey": "test-gateway",
      "gatewayId": "d5b1773b-5ccf-4920-a8c5-d12c92c19530"
    },
    "cursor": {
      "epoch": "1e8e5a81-0987-4c6b-a865-bccd77a81cf1:c0af2442d65e21e6",
      "version": 1,
      "seq": 1
    },
    "eventFloor": 0,
    "serverTime": 1793866902105
  },
  "events": [
    {
      "type": "topic.changed",
      "contextId": "0c87e21b-7b9b-45df-b241-0b3d5227cb78",
      "change": "created",
      "version": 1,
      "seq": 1,
      "at": 1793866902105,
      "gatewayId": "d5b1773b-5ccf-4920-a8c5-d12c92c19530"
    }
  ]
}
```

## 验证结果

最终源代码上执行：

| 命令 | 结果 |
|---|---|
| npm.cmd run typecheck | 通过，含服务端测试类型和客户端类型 |
| npm.cmd test | 625 项通过，失败/取消/跳过均为 0，46.61 秒 |
| npm.cmd run build | 通过；提交本期后端的 dist 输出 |
| git diff --check | 本次源代码和测试无空白错误 |

新测试位于 bubble-projection、bubble-observation、bubble-api、bubble-events、bubble-poll、bubble-http、bubble-done，另外增强了 approval、handback、topic-status 的既有断言。并发交错用 Promise.withResolvers() 栅栏；定时器生命周期测试用模拟时钟，真实 HTTP 测试实际等待 25 秒，没有用 sleep 猜测交错。

覆盖 A 前台阻塞/B 后台提前完成或仍运行时接管、B 只执行一次并原样展示、容量/同话题/同项目锁、未知 CREATE、删除队列、内部 requeue、claimed 窗口、steering 撤回、原生问题与审批、handback 多执行与回退、恢复不重跑、done 运行中/待交付/启动中/闲置/读取 body 的竞态，以及跨 scope、过期事件环、过滤水位、回滚不发布、store 非 HTTP 写入、隐藏/恢复/合并事件。

GET 的数据库 total_changes() 和 fixture 模型请求计数保持不变。完整套件还覆盖既有 relay、合批、取消、重试、镜像和工具只执行一次的行为。发布来自 store 成功事务边界、运行/队列边界和 catalog 状态，而非只在 HTTP 写接口递增；GET 不扫描/修复历史、不写库、不触发 Worker。时间衰减按 60 秒低频重投影，不按 token 或动画帧发布。

真实网络验证使用本机已安装的 @deepseek-ai/dsh-client-connection 0.2.1-rc.2 的 Connection.apply HTTP 桥接和独立临时 fixture 服务：一次 waitMs=25000 实测 25014 ms，期间另一请求正常响应；真实 socket.destroy 后宿主 Request.signal 取消挂起请求，waiter 数归零。只使用该临时 fixture 自己生成的凭据，没有登录用户账户或改账户设置。另有专门测试证明仅注销路由不会自动释放已有请求，插件关闭的生命周期信号必须负责清理。

## 保留在聊天中的回执清单

本期没有迁移或隐藏这些消息：

| 现有路径 | 保留内容 |
|---|---|
| theone-route / routeNotice | 路由去向、切换和 alternate 提示 |
| announceMount / mountNotice | 打开、继续某个话题的说明 |
| mergeTopics / suggestMerge 收尾 | 合并结果说明及现有建议流程 |
| noteMisroute / excludedRoute | 纠错结果、错误话题可能已产生副作用、隔离旧输入的说明 |
| realign / relay 恢复 | 重启中断或已完成内容的恢复说明，以及后台续跑通知 |
| 分支与持久任务 notice | 分支、任务进度和结果通知 |

正式答案、工具卡、宿主原生问题和审批仍由原有路径交付。不能仅靠把 source 渲染为空白来替代下一期迁移。

## 范围、兼容性与未验证项

- 本期没有合并排队或停止执行接口：merges=[]，queueMerge/stop 为 unsupported。即时合并的现有行为保留。
- 稳定项目 ID、结构 topicRevision 尚未实现，字段给 null。waits 的可导航原生引用和 reference.provided 的实际参考来源事件未实现，未用猜测数据占位；只报告已知 waiting_user 阶段。不能把 relatedProposedIds 或布局边当成已提供参考。
- 历史的执行身份、批次和交付确认无法证明时使用 null/unknown；事件环不跨插件重启持久化，重启靠 epoch reset。
- 未做真实桌面 transport、受支持旧宿主 0.2.0-rc.2、外部反向代理的 25 秒兼容验收。当前 HTTP 桥接成功不能替代这些验收。客户端实际退避、回退、多窗口迟到响应与视觉交互由前端任务验证，本报告不宣称已经验收。
- 没有真实模型计费/token 或延迟实验，也没有部署/发布。fixture 的请求/执行次数断言和只读检查证明相应受测路径没有额外调用，不等同于真实模型成本测量。
- 评审指出的既有 excluded 路由入口差异仍需独立修复与覆盖（catalog 关闭/失败、attention 补入、余页复核、fastKeep、执行前等）。本任务硬性要求不改变路由选择，所以本期只对新投影和事件做一致过滤，不能把 UI/API 隐藏当成所有执行入口已加固。
- 小的类型差异已自行适配：正式宿主 route disposer 是异步类型，而仓库原来的局部声明是同步；改用官方返回类型。同时保留仓库已有 PUT settings 与旧路由可选 requestBody 的兼容声明，不改变原接口行为。
- 没有修改 src/client.ts、src/client-foam.ts、src/client-locales.ts 或 experiments/。工作期间有并行前端提交，构建也产生前端 dist 差异；这些和 experiments/ 下的其他工作未纳入本次提交。没有切分支、安装依赖、push 或合并。所有本期提交使用仓库配置的作者，无 Co-Authored-By。
