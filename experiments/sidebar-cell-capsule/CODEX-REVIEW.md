# 话题细胞团与路由：Codex 代码评审

评审日期：2026-11-05。对照草案：`experiments/sidebar-cell-capsule/ROUTING-MAP.md`。代码基线：`fe436d005be92541ceb82495eacf83d7230c2488`，包版本 `0.4.5`。以下行号均指本次实际读取的工作区文件；宿主证据来自本地安装的 DSH `0.2.1-rc.2`，不是对所有受支持版本的保证。

这套视觉表达可以继续，但不能直接按草案的五值 `status` 接线。至少要分开：消息归属、Worker 执行、主聊天展示、当前挂载和话题是否办完。尤其要纠正三点：常规 `CLARIFY` 会自动落定，不会等用户选择；后台已经回答完的记录可能仍标为 `running`；打开另一个话题产生的隐式学习不等于把上一条消息迁移过去。

本次仅作设计评审，只写本文件；未改产品代码、未提交、未切分支。任务写的 `test/` 在此仓库实际是 `tests/`，已按后者评审。未访问 `.dsh/`、`.workbuddy/`、`promo*/`、`outreach/`。原型的满意度按草案提供的信息理解，本次没有重新做浏览器视觉验收；`foam.html` 的 `mount` 等函数是本地演示逻辑，不是已接通的产品能力。

## 1. 草案表格逐行核实

“有”指已有对应事实和可定位信号，不代表已经有细胞团接口；“部分”指存在基础事实，但字段、时机或交互含义不完整。

| # | 草案中的路由事实 | 结论 | 准确位置、实际行为和纠正意见 |
|---|---|---|---|
| 1 | `EXISTING contextId`，消息进入已有话题并开始回答 | **部分** | `validateRoutingDecision()`：`src/llm-router.ts:247-254`，模型的 `EXISTING` 被转换为 `MOUNT/KEEP/SWAP`；内部 `Action` 在 `src/types.ts:33-56`。`ContextStore.plan()`：`src/store.ts:755-777`；`TheOne.startRun()`：`src/index.ts:3142-3202`；`TheOne.answer()`：`src/index.ts:2615-2666`。应在最终归属提交后播放投递，在实际启动后表现运行；分类成功不保证 Worker 已启动。`relay()` 不是普通消息的通用路由入口。 |
| 2 | `EXISTING` 带 `relatedIds`，关联话题亮一下 | **部分** | 校验、去重、排除主目标、最多 3 个：`validateRoutingDecision()`，`src/llm-router.ts:242-245`；真正组装资料：`TheOne.briefingFor()`，`src/index.ts:2074-2119`，`buildBriefing()`，`src/linkage.ts:116-171`。`CREATE` 也能带关联。还会追加自动关联、`alternateIds`、事实和检索线索，且受共享开关、private、手动拆开、最多 4 个话题及文本预算影响。原始 `relatedIds` 只能叫“拟参考”，不能等同“实际已使用”；`briefing.shown` 也不涵盖仅传约束、事实等所有资料，更不是模型确实使用的证明。若要亮“已提供参考”，需在资料真正交给 Worker 后单独记录有效来源。 |
| 3 | `CREATE` 新话题，分裂出新细胞 | **有** | `ContextStore.topicFor()`：`src/store.ts:781-796`，生成话题 ID、Worker 会话 ID，并可能分配目录和话题工作区；调用点 `plan()`：`755-773`。模型说 CREATE 但标题唯一匹配已有话题时，会转换为已有话题：`validateRoutingDecision()`，`src/llm-router.ts:261-269`。分裂应由实际创建成功驱动，不能只看模型原始输出。后台启动失败可能删除刚创建的话题：`startBackground()`，`src/index.ts:2954-2964`，要有失败/撤回收尾。 |
| 4 | `CREATE + aside:true`，答完自动缩回 `+N` | **部分** | aside 校验：`src/llm-router.ts:234-236,265-270`；主路由保留原挂载：构造器的 `agent/pre-step` 回调，`src/index.ts:923-925`；后台分支：`otherMatter()`，`2930-2931`；展示已有后台结果时不挂载临时话题：`872`。无原话题时正常挂载，见 `tests/routing-aside.test.ts:56-65`。**没有**答完自动删除、标 done 或折叠的后端生命周期；算术快捷分支也可临时离题，但不依赖 `aside:true`（`src/index.ts:889-904,2915-2918`）。折叠是新增显示策略，建议答案交付后才折叠，保留相同话题 ID，失败/待用户回答时保持可见。 |
| 5 | `CLARIFY candidateIds`，候选间悬停等用户答 | **部分；常规等待态没有** | `validateRoutingDecision()` 把 `candidateIds` 存进 `Decision.relatedIds`：`src/llm-router.ts:272-280`。`settleUnclear()`：`src/routing-policy.ts:28-41`，除 `ROUTER_MODEL_MISSING`、`correction-unclear` 外，选当前候选/第一候选/当前话题/新话题；调用在 `src/index.ts:915-920`。其他候选成为 `alternateIds`，不是待选择对象。残留 CLARIFY 由 `answer()` 输出文本：`2642-2649`；用户主动纠错另有 `correctionChoice()`：`3285` 起。不能把模型初稿的 CLARIFY 动画做成阻塞选择。常规不确定路由可显示轻量标记和纠正入口；缺模型是配置阻断，不是多个候选等待。 |
| 6 | `applyCorrection` 或刚发完就打开另一话题，囊泡迁移 | **部分** | `TheOne.applyCorrection()`：`src/index.ts:3642-3672`；显式目录纠正：`/routes` 回调，`1148-1165`；口头纠正：`857-858,892-895,941`，重放原输入由 `answer()` 的 `2651-2655` 处理。目录纠正改归属/学习并挂载目标，**不自动重新回答**。`context/mount`：`1266-1284`，窗口是 **10 分钟**，调用 `applyCorrection(...,0.75,false)`；`record=false` 不写 `correctedTo`、不记 moved、也不惩罚原话题，只强化新话题。必须区分显式迁移、隐式提示、口头纠正重做和 `handToTopic()` 真正交接，不能都播放“旧消息被搬走”。纠正不撤销已发生的外部改动，见 `noteMisroute()`：`3058-3080`。 |
| 7 | 前台/后台正在回答，使用 active/background/starting/latestTopicRuns | **部分** | 运行容器定义：`src/index.ts:362-384`；`busy`：`3136-3137`；`WorkerRun.done/outcome/failure`：`src/run.ts:32-36,110-117`。`active` 是全局占用，`runs` 是当前主聊天跟随的运行，`background` 也保留已经完成但未展示的运行，`starting` 可正在等项目锁。`latestTopicRuns()`：`src/store.ts:1522-1525` 仅持久化最近一次记录；`topicStates()`：`src/index.ts:3729-3741` 返回的是业务状态，`active` 也可能闲着。应读每个运行的实时状态并分开 starting/running/waiting/completed，不能用 map 存在或业务 active 直接点亮。 |
| 8 | `requeue`/后台上限，虚线细胞等空位 | **部分** | `requeue()`：`src/index.ts:3116-3121`，把插话移到 `gateway.inbox.nextTurn` 尾部。`startBackground()`：`2940-2953`，普通插话启动路径限制 `background.size + starting.size < 2`，并阻止同话题重复运行；没有草案暗示的通用 MAX 常量。`relay()`：`2972-2999` 不走这个准入检查，不能将“总共最多 3 个”宣传成所有工作的硬上限。后台满/目标忙时直接返回，可能既无 route 也无新话题，已做的分类也不会留下独立排队记录；没有空位出现就扫描重启所有等待消息的调度器。应补消息级排队意图、原因与可空 contextId；无归属时画主细胞旁的待分配标记，不能虚构新话题。完成但未展示的 background 仍占槽位。 |
| 9 | 答好了，等主聊天展示；由 relay 决定展示顺序 | **部分** | 事实在 `background` 条目加 `WorkerRun.done === true && !failure && outcome.kind === 'completed'`；`WorkerRun.follow()`：`src/run.ts:110-117`。接管发生于 `agent/pre-step`：`src/index.ts:838-872`，以及 `answer()`：`2622-2639`。`relay()` 只为自主续跑/延迟问题回复创建主聊天输入并放入 background，不调度普通展示顺序。`WorkerRun.unshown`：`src/run.ts:132-137` 仅说明某个步骤尚未开始展示，不能证明整轮答完。当前没有稳定的 answered API；第 3 节给出可靠做法。 |
| 10 | 主聊天当前挂载话题 `store.current(gatewayKey)` | **有** | `ContextStore.current()`：`src/store.ts:304-307`；`mount()`：`548-551`；`plan()` 默认更新挂载：`764-766`。这是按 **gatewayKey** 保存的挂载，不是浏览器当前打开的会话、最后完成的后台话题，也不必等于正在展示的临时话题。用独立 `current`/`currentId` 标记，不能与 running/answered 互斥；重新打开原有话题只突出原细胞，不再制造“新话题”。 |
| 11 | 最近用得多 `contextUsage` | **有** | `ContextStore.contextUsage()`：`src/store.ts:309-322`。只计 `completed` 且非 CLARIFY 的路由；按 `corrected_to` 修正归属。`recentCalls` 是最近 **30 天**，`lastUsedAt` 是这些成功路由的**创建时间**，不是 Worker 完成时间或鼠标点击时间。用作有上限的体积/位置先验；新消息刚到或后台刚算完时它未必变化。若需即时活跃，另给 `lastActivityAt`，不要改写原指标含义；拖动中冻结排序。 |
| 12 | manual/workspace/project/entities/learned 形成吸附；−1 互推 | **部分** | `relatedTopics()`：`src/linkage.ts:26-60`，有分数和原因；`auto` 阈值 0.6、手动正关联 +100、同话题工作区 +0.6、相同 origin cwd +0.4；workspace 模式另有规则。`ContextStore.links()`：`src/store.ts:615-625`，学习权重 14 天半衰；`setManualLink()`：`644-652`。manual −1 被直接过滤，不是负分返回；需要另取手动拆开的边。现有 `linkageSnapshot()`：`src/index.ts:2047-2052` **丢掉 score**。给布局用的强度必须归一化/钳制，不能把 100 当弹簧系数。列表按读取方向取 top-N，不保证对称；private 检查针对资料来源，不能假定是双方完全隔离。见第 4 节。 |
| 13 | 合并 / 撤销合并 | **有；排队没有公开接口** | `editTopics()`：`src/index.ts:1329-1345`；服务端 `mergeTopics()`：`1352-1365`；存储 `mergeTopics()/mergeTopicsValue()`：`src/store.ts:1100-1165`，`unmergeTopic()`：`1193` 起。合并保留目标，来源历史成为目标可检索资料，源话题退出目录；撤销按 journal 恢复来源，并非切分全部后续对话。合并/撤销受**全局 busy**限制，不只是被拖的两颗。已有 `suggestMerge()` 的一次等待重试：`src/index.ts:3622-3628`，但没有可取消、可查询的 `whenIdle` 操作；现在传此字段也仍会按原逻辑返回 `GATEWAY_BUSY`。应等实际提交成功再融合；排队只画膜颈。 |
| 14 | declare done；下一条落到它自动重新打开 | **部分** | `editTopics` 的 status：`src/index.ts:1309-1314`；`ContextStore.declareTopic()`：`src/store.ts:1529-1536`；业务派生 `topicStatus()`：`src/topic-memory.ts:137-142`。后者按最新运行开始时间晚于声明时间判断重新活跃，并非收到路由/挂载就删除声明；原始声明行仍可能保留。接口目前**没有正在运行不能 done 的校验**。运行、等待用户、旧 interrupted 状态的优先级也高于 done。需区分 `declaredDoneAt` 和 `effectiveDone`；新增服务端能力判断/忙态守卫后才可实现“甩不走弹回”。重新打开保留 ID，不是 CREATE。 |
| 15 | 删除/归档/excluded 全部隐藏 | **部分** | `hiddenReasons()`：`src/store.ts:1638-1640`；`unreachable()`：`1647-1648` 仅含 orphaned/excluded。`HistoryCatalog.reconcile()`：`src/history-catalog.ts:282-299` 按已知来源综合计算，**不是任意一个来源归档或删除就隐藏整话题**。归档仍可被路由找到、可挂载：`routingContexts()`，`src/index.ts:3753-3774`；`context/mount`，`1272-1273`。orphaned/excluded 应不可投递，归档适合收起并在再次使用时显露。删除话题 `deleteTopic()`（`src/store.ts:1257` 起）与失去全部会话的 orphaned 不同。另有 excluded 过滤不一致，见第 2 节，不能把“已隐藏”误报为所有执行入口都已封闭。 |

补充交互核对：

- **拖到主卡片**：可复用 `context/mount`，但任何全局 busy 都可能返回 409，并非拖动目标空闲就能成功；客户端现有 `continueTopic()` 会挂载后 `navigation.open()`（`src/client.ts:1455-1463`）。挂载只选择后续上下文，不会自行生成答案。
- **拖到 DSH 会话行**：`editTopics('attach')`（`src/index.ts:1322-1327`）调用 `ContextStore.attachSession()`（`src/store.ts:1091-1092`），将整个会话标成可检索的历史范围，既不换 Worker，也不转移会话所有权。`attachableSessions()`（`src/index.ts:1385-1393`）只列最近 100 条，排除所有主聊天和话题 Worker；DOM 行存在不等于可 attach。现在的 `data-row-key` 用于 CSS 隐藏（`src/client.ts:1775-1778`），不是稳定拖放协议。需服务端重新校验；若要支持任意较旧会话，先扩展直接按 ID 验证的接口。
- **右键停止**：`editTopics()` 没有 stop 分支。`WorkerRun.cancel()`（`src/run.ts:140`）和 `dropBackground()`（`src/index.ts:3125-3132`）是内部原语；需要按消息/执行 ID 定位的控制接口，区分停止运行、撤回待展示消息与取消合并。删除 topic 会保留 DSH 会话（`src/index.ts:1332-1337`），不能把它标成“删除聊天”。

## 2. 遗漏的事实，是否值得呈现

| 事实及证据 | 界面建议 |
|---|---|
| **正在分类/启动**：`sorting`、`reservedGateway`（`src/index.ts:363,378,859-860,2862-2876`）；从 `worker()`、`readyToRun()` 到项目锁、briefing 存在等待（`3146-3171`）。 | **值得**。主细胞轻微待处理状态；目标明确后显示启动中。不能在路由模型刚返回时假装已经开始回答。 |
| **等待项目锁**：`ProjectQueue.acquire()`（`src/project-queue.ts:18-44`），调用 `src/index.ts:3154-3155`；`projectKey()`（`src/project-queue.ts:5-15`）归一到仓库根。 | **值得**。与后台容量满区别，用“同项目上一项尚未结束”作悬浮信息。相同仓库的不同目录可能互相等待，不能靠不同细胞就承诺并行。当前队列没有可直接查询的等待列表，需补观测。 |
| **真实问题/审批等待**：`whileAsking()`（`src/index.ts:3689-3711`），`topicStatus()` 优先等待（`src/topic-memory.ts:138`）。 | **必须**。停止 running 呼吸，给可到达原问题/审批的入口；多个等待可并存。细胞点击不能替用户提交答案或批准工具，不能把它混成路由 CLARIFY。 |
| **失败、取消、重启中断、迁移**：`WorkerRun.follow()/stream()`（`src/run.ts:110-117,175-205`）；`finishRun()`（`src/index.ts:4007-4039`）；启动 `interruptTopicRuns()`（`425`）；恢复 `realign()`（`3026-3050`）。 | **必须**。有静态标记和详情；失败不能使用“答好了”的颜色；重启后先恢复/核验，不能自动重跑或用旧 running 冒充实时运行。 |
| **后台算完与主聊天已显示是两个时刻**：`answer()` 接管（`src/index.ts:2622-2639`）；`WorkerRun.stream()`（`src/run.ts:164-211`）。 | **必须**。answered = 成功且尚未交付主聊天。囊泡回主细胞发生在开始交付时，不在后台算完时；“已显示”只指提交到主聊天记录，不代表用户已读。 |
| **steering 批量/同一运行的补充**：`stepInput()`（`src/index.ts:186-194`），pre-step 批量处理（`808-846`），`forwardToWorker()`（`1728-1736`）。 | **值得**。一次轻量补充脉冲和数量即可。传 `messageIds[]`、批次与执行 ID；不是每条输入都对应一个新 Worker 或一条独立 route 行。不要凭 `recentRoutes()` 补出虚假的一对一关系。 |
| **绑定优先、临时返回、当前挂载与前台注意对象不同**：`resolveBinding` 使用于 `src/index.ts:882-911`；`recordBindingEvent()`（`1739-1762`）；`tests/routing-bindings.test.ts:325-417,514`。 | **值得但克制**。当前描边表示挂载；前台正在展示对象另有高亮；aside 可显示返回对象。回复引用/审批归属是路由依据，放详情，不增加常驻技术标签。 |
| **shadow 是观察记录，不是第二路执行**：`RoutingShadow.record()/advance()/snapshot()`（`src/routing-shadow.ts:91-144`）；可关闭及容错（`src/index.ts:411-413,1764-1766`）。 | **不单独画 shadow 细胞或双路动画**。可作诊断来源；`displayOrder` 是已经观察到的会话事件顺序，不能预测未来收件箱顺序，`background` 是累积观察记录，不能代替实时运行队列。实际绑定/注意状态用 `RoutingBindings`。 |
| **路由不确定但已落定、二次复核、降级**：`settleUnclear()`（`src/routing-policy.ts:34-41`）；`classify()`（`src/index.ts:2750-2809`）；receipt trace。 | **值得显示结果，不值得持续动画全部内部阶段**。低强度不确定标记、纠正入口、详情中的错误/复核原因即可。初选后来被改掉，不应先送到错误细胞再撤回，除非它实际执行过。 |
| **Worker handback**：`handBack()/handToTopic()`（`src/index.ts:3225-3281`）；失败会还原 route（`3262-3270`）。 | **值得**。它是实际交接，应有明确来源/目标/成功事件；同 messageId 的新执行必须分配新 executionId。回滚不留永久转移动画，外部副作用仍须能查看。 |
| **话题工作区与文件项目不同**：`groupForNew()`（`src/store.ts:804-813`）、`topicStates()/projectOf()`（`src/index.ts:3718-3740`）、`projectFolders()`（`2847-2854`）。 | **值得**。聚团依据 `groupId`；项目做小标签/悬浮说明与排队原因。不要把目录分组解释成实际文件夹权限。路由临时 `p1/p2` 来自列表索引，不能充当长期稳定 projectId。 |
| **private/linkScope/manual −1**：`relatedTopics()/mayShare()`（`src/linkage.ts:26-76`），`briefingFor()`（`src/index.ts:2090-2104`）。 | **值得**。小锁表达“此话题资料不向其他话题共享”，不是账号访问控制，也不是对外加密。现有代码允许 private 目标读取其他非 private 来源，且手动/请求参考的过滤各有路径；若设计想要双方完全隔离，需要单独修改语义，不能由布局暗示已具备。 |
| **资料确实送入、历史内容失效/纠错撤回**：`briefingFor()`（`src/index.ts:2105-2119`）、`learnFromRoute()`（`3995-4000`）、`learningJournal` 和 `excludeWorkerSurface()`（`3388-3409`）。 | **前者可轻闪，后者详情可见**。路由 proposal 不学习关联，成功完成后才提交，之后还可撤回。亮一次只证明提供了资料，不能声称模型用了它或执行正确；布局权重也不是正确率。 |
| **学习/卡片/事实后台任务**：`queueMemory()/runMemory()`（`src/index.ts:3450-3509`），纠正词学习链（`3667-3672`）。 | **默认不占主运行态**。确有持续较久的任务可在详情显示“正在更新话题资料”；未做 per-topic 观测前不要制造学习进度百分比。也不要把通用 PersistentWork 任务都算成两槽后台路由。 |
| **历史索引/同意/排除**：`/catalog`、`/catalog/consent`（`src/index.ts:1113-1132`），`HistoryCatalog.reconcile()`（`src/history-catalog.ts:282-300`）。 | **值得一个全局状态**。标明目录仍在整理/不可用，不给每个话题都套 loading；读取细胞快照本身不得触发索引、模型调用或代用户授权历史读取。 |
| **自主续跑、goal round、延迟问题回复**：inbox 插入钩子（`src/index.ts:556-561`），goal 分支（`809-810,877-900`），`relay()`（`2972-2999`）。 | **值得区分来源**。自主工作不能被画成新用户指令；普通后台 relay 不抢前台挂载，宿主验证的延迟问题回复例外。不给三种来源都套相同“主细胞发出用户消息”动画。 |
| **长时间未使用/用户办完/归档三种收起原因**：`activityLabel()/topicStatus()`（`src/topic-memory.ts:120-142`）与 hiddenReasons。 | **值得**，但主要用于展开列表、排序和收起原因。收起不等于删除或不可路由；`+N` 应能解释是哪类话题，且保留键盘可达入口。 |

需登记的代码边界：`routingContexts()`（`src/index.ts:3757`）仅过滤 orphaned；`HistoryCatalog.candidates()`（`src/history-catalog.ts:308-312`）才过滤 `unreachable()`。但 `classify()` 的 attention 补候选（`2730-2734`）、失败时全量目录路径、余页复核（`2772-2777`），以及无 catalog/快捷路由使用的仍可能是前者。因此“excluded 绝不会被选中”还不是统一守卫。这是静态路径发现，未在本次调用真实模型复现；实现快照时可以过滤展示，但不能因此声称路由问题已修复。验收需覆盖这些入口，并在执行前统一重验不可达对象。

另一个边界是“聊天里只有与 LLM 的对话”尚未完全兑现：`agent/pre-step` 即使 routeNotice=hidden 仍可能输出 alternate 提示（`src/index.ts:953-960`）；挂载说明、纠错副作用说明（`3058-3080`）、合并建议结果（`3631-3633`）、重启恢复说明（`3026-3050`）仍进主聊天。需要逐种迁移到侧栏详情并保留可见入口；LLM 正式回答、工具结果、原生审批/问题不应被一刀切隐藏。

## 3. “答好了，等展示”及展示顺序

### 3.1 可以可靠观察到什么

正常后台流程如下，执行与交付是两条独立状态线：

1. `sortMidReply()` 判为其他事项，将输入移至 next-turn；`startBackground()` 做 `plan/claim`，占 `starting` 槽位（`src/index.ts:2862-2876,2940-2953`）。
2. `startRun()` 等 Worker 准备、项目锁、briefing，然后 `run.start()`（`3142-3197`）。注册进入 background 的时刻还可能没完成 briefing，不应一律称 running。
3. `WorkerRun.follow()` 等 `worker.whenIdle()`，设置 `done=true`；`outcome` 来自 Worker 的 `turn/end`（`src/run.ts:72-74,110-117`）。成功判定必须同时检查 done、failure、outcome，不能只读 done。
4. background 条目仍在，main input 仍等待或已被宿主 claim。此时若成功且未选入展示，就是 **ready to display**。对应持久化 route/topic-run 可能仍为 running，因为 `finishRun()` 要等主聊天结束才收尾（`src/index.ts:4013-4017`）。
5. 主聊天选到该消息，`answer()` 取走 background，把同一个 run 放进 runs，开始 `stream()`（`2622-2639`）。未结束的后台也可在这里转为实时流，不能只允许 answered 转入。
6. WorkerRun 的 shown 在每次 `stream()` 入口递增（`src/run.ts:165`），它表示开始跟随某一步，**不表示整轮成功交付**。只有主聊天对应步骤/轮次实际提交并完成收尾，才能记录 delivered；取消、retry、失败另走分支。

建议增加只读的运行观测值：执行 ID、关联输入批次、阶段、Worker 结束原因、是否仍等待展示、是否已选中展示、已开始/已提交展示的步骤数量、最终主聊天提交位置。由 WorkerRun 的 start/follow/stream/失败/取消边界通知聚合器；不要把私有 `steps`、chunks 或答案正文直接暴露给快照。

### 3.2 顺序的权威来源

本地宿主 `ReactLoopInbox.claim()`（`node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:97-110`）先取全部 next-step，若进入 next-turn 再取 next-turn 的第一条。`preStep()` 在 TheOne pre-step 处理之前就 claim（同文件 `902-925`）。TheOne 还会将其他话题插话重新 append 到队尾（`src/index.ts:3116-3121`），或者将多条输入合并处理并丢弃原有后台分算（`835-844`）。

因此不能按完成时间、background Map 顺序、route.created_at、话题 ID 或 shadow.displayOrder 排未来答案。应暴露：

- 当前主聊天正在交付的执行；
- 按宿主实际顺序读取的 `nextTurn`，以及独立 `nextStep`；
- 已 claim、尚在 pre-step/分类中的批次，避免从 inbox 消失到 runs 出现之间“凭空丢消息”；
- 每个等待项映射到哪个已有执行，或仍未分类；普通队列位置只承诺“当前顺序”，不承诺等待时长和永远不变的名次。

`agent/inbox/spliced/claimed` 可作变更触发；原生 splice 还可能为重排发 discarded/inserted。必须保留 TheOne 的 `moving` 语义，将内部 requeue 合成一个逻辑变更，不能画成取消再新建。多条 steering 是同一个执行的输入集合，不能按每个 messageId 重播完整投递动画。

### 3.3 重启后的边界

运行对象在内存，重启会丢失。现有 `turnOf()/realign()`（`src/index.ts:3011-3050`）读取 topic session，已成功且有回复则只展示既有回复，否则给出中断说明，不自动重做。新接口应先标 `recovering/unknown`，在单独恢复路径验证后才变成 ready/interrupted。不要为了每次 GET 快照去加载所有历史会话，更不能把 UI 重连变成执行触发器。

## 4. 接口设计草案

### 4.1 快照与事件

建议沿用 `/api/theone/bubbles`，但它是状态投影，不是新的执行入口：

`GET /api/theone/bubbles?gatewayId=...&epoch=...&since=<version>&after=<seq>&waitMs=25000`

- scope 由服务端固定 gatewayKey，并验证 gatewayId 属于它；首次未指定可解析当前主聊天，响应返回实际 scope。gatewayKey 的 current 是共享的，不能伪造按浏览器隔离的挂载语义。切换 gatewayId、profile 或插件实例必须丢弃旧游标。
- 无游标、epoch 不符、事件已淘汰、scope 变更或游标超前：立即给完整 snapshot 和 `reset:true`。reset 不播放积压的老动画，直接接纳新 head。
- 正常更新：同一响应给**一致切面的完整快照 + 该切面之前的增量事件**。初版完整快照更易恢复，后面再考虑 patch；不要先读 snapshot 再异步读 events 拼接。
- 无变化且 waitMs=0：立即 `200 {kind:'unchanged',cursor}`；有等待则等版本/事件变化或超时。超时也返回 unchanged。统一 `Cache-Control:no-store`；不借 HTTP 304 表达业务游标。
- `topics` 包含可展示/可折叠话题；orphaned/excluded 的正文及关联不下发。已归档但正在运行、待交付或当前挂载的如何显露见第 5 节待决项。至少不能静默吞掉正在进行的任务；无法展示的目标以无标题的“目标不可用”工作项表达。
- 待归属项在 `workItems` 中允许 contextId=null。topic 只聚合自己的 workItemIds；一个话题可以同时当前挂载、正在回答、另有排队消息，不能压成一个枚举。
- 事件覆盖选择落定、实际新建、启动/等待/完成、交付开始/结束、显式纠正/撤销/handback、挂载、done/reopen、归档/恢复/删除、合并排队及结果。隐式 mount 学习用独立 hint 事件，不冒充 route.moved。
- 不把 `recentRoutes(30)` 当事件流：它按可变行列举，没单调 seq，纠正/完成修改旧行，截断也会漏动画。首次后台启动 receipt 有时只在 background 内存，后到 pre-step 才持久化（`src/index.ts:1718-1721,938-940`），也不能仅轮询 `/routes`。

### 4.2 版本、事件序列和原子性

`schemaVersion` 是协议版本；`epoch` 是每次插件启动生成的新标识；`version` 是当前 scope 的视图修订；`seq` 是该 epoch 内的事件递增号。不要拿当前时间戳、SQLite rowid 或 `MAX(created_at)` 替代这些概念。

建议一个聚合器串行发布：完成一次真实状态变更后，重新计算相关投影，生成若干事件，统一 `version += 1`；每个事件各 `seq += 1`。同一批事件可共享 version。所有事件和快照须来自提交后的状态，事务回滚不发布；运行内存状态的更新也要在同一发布边界内完成。中间事件即使最终快照回到原状，也保留顺序。

捕获范围必须包括 store 变更、inbox、WorkerRun、asking、项目等待、纠正学习导致的可见关联变化、catalog reconcile、配置/private/linkScope、merge/unmerge。不能只在 HTTP 写接口里加版本：工具调用、后台索引、后台完成也会改状态。建议 ContextStore 提供事务成功后通知，聚合器只标 dirty/发布；GET 只读。不要调用会 `markSeen` 的 `buildBriefing()` 来生成展示边。

每个 scope 一个有界事件环，例如保留最近 512 条；同一次响应不分页切断事件范围，超出保留窗口直接 reset。快照携带 `eventFloor`，响应游标的 seq 是读取到的水位，**不是返回数组最后一项**：隐私过滤/合并事件可能使数组有间隙。客户端按 scope+epoch+seq 去重，只接受同 epoch 较新的 version，忽略晚到旧响应。初次加载/断档/后台标签页恢复以快照为准；不承诺动画恰好一次，也不把动画播放成功当业务确认。

挂起实现用“检查 → 注册 waiter → 再检查”的无缝序列，避免判断未变后、监听装好前漏掉变更。唤醒时一次性复制快照与事件；同 tick 多个修改可以合批，但事件先后不丢。每次请求的 serverTime、动画帧、文本 token 不递增 version。lastUsedAt 的年龄在客户端算；recentCalls 的 30 天边界、休眠阈值、链接衰减需要低频/到期重算，量化后的可见投影变化才发布，避免空闲长轮询变成高频推送。

### 4.3 长轮询可行性及回退

**结论：本地安装版本允许挂起请求。** 证据超过“看见 async”这一层：

1. 本项目 `registerCatalogChannel()` 的局部类型是 `(request:Request)=>Promise<Response>`（`src/index.ts:993-1000`）。已有处理器会 await 异步编辑；但项目目前没有细胞长轮询实现。
2. 宿主正式类型 `ConnectionFetchRoute`（`node_modules/@deepseek-ai/dsh-client-connection/lib/types/rpc.d.ts:117-140`）明确支持 Promise<Response>，query 保留；`requestBody:'buffered'` 只描述请求体读取，不要求响应立即结束。
3. `HostConnectionService.createSharedFetchHandler()` 直接返回 `route.fetch(request)`（本地 `lib/index.js:820-838`），并对 exact route 检查 owner。HTTP `bridge()` 等待它（同文件 `40-88`），连接关闭会 abort Request.signal（`41-44,75-79`）。这条代码路径没有自身的 25 秒 handler 超时。
4. 本次通过 shell 运行了**不落盘的内存探针**，直接使用本地 HostConnectionService：挂起一个注册处理器时另一路由能返回；释放 Promise 后原 query 仍在；Request.abort 能到达处理器；注销路由后新请求 404，但已经挂起的请求不会自动结束。全部断言通过。

最后一点决定清理设计：必须组合 request.signal 与插件 lifetime signal，超时/变更/中断/卸载均撤销 timer、listener 和 waiter；在数据库关闭前先释放所有挂起请求。只调用注册 disposer 不够。局部类型把 disposer 写成同步函数，正式类型是 `()=>Promise<void>`，实现时应采用正式类型并正确等待清理。

这次没有启动真实 Web/桌面连接、没有进行 25 秒代理链路实验，也未验证旧 `0.2.0-rc.2`。因此实现顺序是先 `waitMs=0`，再启用有界长轮询；实际宿主/代理不能稳定挂起时，客户端降级到相同 API 的短轮询：可见且活跃约 1–2 秒、空闲 5–10 秒，失焦暂停/明显放慢，失败指数退避加抖动，前台恢复立即刷新。一次只保留一个在途请求；POST 成功后可取消旧等待并刷新；反复早断或不支持该端点时显示兼容状态，不能无限快速重连。现有目录已有 5 秒轮询与 abort/reading 守卫（`src/client.ts:1427-1453`），可借其模式。

不必为了细胞动画先引入 WebSocket/SSE；如果以后改推送，仍复用 snapshot/epoch/seq/reset 协议，不另造一套状态语义。

### 4.4 合并排队

保留旧 POST 兼容性：`whenIdle` 不传仍按现在的即时成功/409 处理；新请求带 `whenIdle:true` 和 `requestId`。可排队时返回 HTTP 202，给 operationId、queued=true、操作状态和新游标；立即执行成功返回 200。不能只给 `{queued:true}`，否则无法取消、重试去重或解释失败。

建议语义：

1. 入队先验证双方存在且不同、可访问、请求方向明确；记录 source/target 的结构修订。涉及同一话题的其他 pending merge 初版直接返回冲突，不悄悄接受 A→B→C、相反方向或循环。同 requestId+同内容返回同操作；同 requestId+不同内容返回 409。
2. 初版遵守现有全局 busy 边界，外加宿主 inbox、closing/sorting、目标 Worker 实时状态和项目启动占用检查。`mergeGatewayIdle()/waitForMergeIdle()`（`src/index.ts:3543-3563`）可复用部分判定，但不能直接将那个提示框的 Promise 当队列。用户已排队输入优先；建议从运行/展示收尾触发 drain，辅以有界兜底定时器，防止失去唤醒；超时明确 expired，不永远画膜颈。
3. 执行前重新验证双方还存在、未隐藏、未被移组/attach/合并、结构修订匹配，并重新检查工作状态。队列接受后到执行前是 TOCTOU 窗口。私有/工作区/项目策略变化时应取消或失败，不默默改变原意图。
4. 合并与 `startRun` 的准入需要共用维护租约：先占租约再 await Worker dispose，再重验并同步提交 store merge。现有 `mergeTopics()` 在 dispose 前后都看 busy，但其间仍可有新请求；仅把调用包在 setTimeout 不够。租约只覆盖执行临界区，排队期间不冻结用户聊天。
5. 用 `{action:'cancelMerge',operationId}` 取消尚未执行的项，返回其最终状态；重复取消幂等。已经 executing/succeeded 返回明确状态/409，不能声称撤回正在执行的数据库事务。已成功合并的反操作仍是 unmerge。
6. 建议持久化被接受的操作及终态，便于请求重试和崩溃后查询；合并提交与 succeeded 标记必须在同一事务边界完成，防止重复合并。**初版默认重启取消尚未执行的排队项，并保留 cancelled/restarted 回执**；是否让排队跨重启继续见待决项。已提交结果重启后仍可查询，不能再执行一次。结构 revision 与高频视图 version 分开，避免每次呼吸/运行状态更新都使操作失效。

膜颈只代表 queued/executing；成功事件到达后才融合；失败/取消拆颈并保留来源。操作等待的文字在悬浮/详情中，不进聊天，也不弹出二次确认。

### 4.5 TypeScript 类型草稿

下面是拟新增协议，**不是现有导出类型或已实现接口**。标识使用字符串、时间使用 epoch ms；ID 在服务端生成，客户端不能提交所有权或伪造执行身份。展示状态刻意与执行状态、业务 done 分开。mergeNow 与 queueMerge 分别控制即时合并和允许入队，避免全局 busy 把排队入口也禁用；waits 的引用只能导航到宿主实际存在的请求。

```ts
type TopicId = string;
type GatewayId = string;
type WorkItemId = string;
type ExecutionId = string;
type OperationId = string;
type MessageId = string;
type Ms = number;

interface BubbleScope {
  gatewayKey: string;
  gatewayId: GatewayId | null;
}
interface BubbleCursor {
  epoch: string;   // 每次插件启动更换；只在同 scope/epoch 内比较数字
  version: number; // 视图修订，非时间戳
  seq: number;     // 事件读取水位，可跨过被过滤的事件
}
type TopicLifecycle = 'active' | 'waiting' | 'dormant' | 'done';
type WorkPhase = 'routing' | 'queued' | 'starting' | 'running'
  | 'waiting_user' | 'recovering' | 'succeeded' | 'failed'
  | 'stopped' | 'interrupted' | 'superseded';
type DeliveryPhase = 'waiting' | 'selected' | 'showing'
  | 'shown' | 'discarded' | 'unknown';
type QueueReason = 'host_queue' | 'capacity' | 'topic_busy'
  | 'project_busy' | 'handoff';

interface Capability {
  allowed: boolean;
  reason?: 'gateway_busy' | 'topic_busy' | 'unavailable'
    | 'pending_delivery' | 'operation_conflict';
}
interface BubbleTopic {
  id: TopicId;
  title: string;
  topicRevision: number; // 结构变更修订，供操作前置条件使用
  current: boolean;
  lifecycle: TopicLifecycle;
  declaredDoneAt: Ms | null;
  effectiveDone: boolean;
  archived: boolean;
  private: boolean;      // 共享规则；不表示对 owner 隐藏
  groupId: string | null;
  project: { id: string; name: string } | null; // 新增稳定 ID，非路由 p1
  usage: { completedCalls: number; recentCalls: number; lastUsedAt: Ms | null };
  lastActivityAt: Ms | null;
  workItemIds: WorkItemId[];
  capabilities: {
    mount: Capability;
    declareDone: Capability;
    mergeNow: Capability;
    queueMerge: Capability; // 忙时仍可入队；成对冲突在 POST 时重验
    delete: Capability;
  };
}
interface BubbleWorkItem {
  id: WorkItemId;       // 一个逻辑处理项；不以 topicId 代替
  gatewayId: GatewayId;
  primaryMessageId: MessageId;
  messageIds: MessageId[]; // 包括合批/steering；必须非空
  source: 'user' | 'steering' | 'goal' | 'relay';
  contextId: TopicId | null;
  executionId: ExecutionId | null; // 每个 WorkerRun 新 ID；重试 attempt 可另记
  lane: 'foreground' | 'background' | null;
  phase: WorkPhase;
  queueReason?: QueueReason;
  waits?: { kind: 'question' | 'approval'; referenceId: string;
    ownerSessionId: string; callId?: string }[]; // 只链接宿主已有请求
  delivery: {
    phase: DeliveryPhase;
    shownSteps: number;      // 已开始跟随，不能当整轮完成
    committedSteps: number;  // 已提交至主聊天
    commit?: { sessionId: GatewayId; eventSeq: number };
  };
  temporary?: { kind: 'model_aside' | 'arithmetic'; returnContextId: TopicId | null };
  outcome?: 'completed' | 'failed' | 'stopped' | 'interrupted' | 'moved';
  updatedAt: Ms;
  stop: Capability;
}
interface InboxItem {
  messageId: MessageId;
  workItemId: WorkItemId | null;
  contextId: TopicId | null;
  position: number; // 当前 inbox 中的位置，不是永久展示排名
}
interface BubbleGateway {
  id: GatewayId;
  currentId: TopicId | null;
  showingExecutionId: ExecutionId | null;
  nextTurn: InboxItem[];
  nextStep: InboxItem[];
  claimed: { batchId: string; messageIds: MessageId[] }[];
}
interface BubbleEdge {
  a: TopicId;
  b: TopicId; // pair 规范排序；参考提供方向另记在事件里
  relation: 'related' | 'kept_apart';
  strength: number; // 0..1，展示强度，不是权限/概率/原始 score
  manual: -1 | 0 | 1;
  reasons: ('manual' | 'workspace' | 'project' | 'entities' | 'learned')[];
}
interface MergeOperation {
  id: OperationId;
  requestId: string;
  sourceId: TopicId;
  targetId: TopicId;
  sourceRevision: number;
  targetRevision: number;
  state: 'queued' | 'executing' | 'succeeded' | 'cancelled' | 'failed' | 'expired';
  createdAt: Ms;
  expiresAt: Ms;
  updatedAt: Ms;
  reason?: 'gateway_busy' | 'topic_changed' | 'topic_missing'
    | 'restarted' | 'user_cancelled' | 'internal_error';
}
interface BubbleSnapshot {
  schemaVersion: 1;
  scope: BubbleScope;
  cursor: BubbleCursor;
  eventFloor: number;
  serverTime: Ms;
  topics: BubbleTopic[];
  workItems: BubbleWorkItem[];
  gateway: BubbleGateway | null;
  edges: BubbleEdge[];
  merges: MergeOperation[];
  health: {
    catalog: 'ready' | 'indexing' | 'unavailable' | 'consent_required';
    router: 'ready' | 'rules' | 'unavailable';
  };
}
interface EventMeta {
  seq: number;
  version: number;
  at: Ms;
  gatewayId: GatewayId | null;
}
type BubbleEvent = EventMeta & (
  | { type: 'route.assigned'; workItemId: WorkItemId; messageIds: MessageId[];
      contextId: TopicId; action: 'KEEP' | 'MOUNT' | 'SWAP' | 'CREATE';
      created: boolean; relatedProposedIds: TopicId[]; alternateIds: TopicId[];
      temporary?: BubbleWorkItem['temporary'] }
  | { type: 'route.blocked'; workItemId: WorkItemId;
      reason: 'model_missing' | 'correction_unclear'; candidateIds: TopicId[] }
  | { type: 'reference.provided'; executionId: ExecutionId; contextId: TopicId;
      sources: { topicId: TopicId; kind: 'briefing' | 'fact' | 'recall' }[] }
  | { type: 'work.changed'; workItemId: WorkItemId; executionId: ExecutionId | null;
      phase: WorkPhase; queueReason?: QueueReason }
  | { type: 'delivery.changed'; workItemId: WorkItemId; executionId: ExecutionId | null;
      phase: DeliveryPhase }
  | { type: 'route.moved'; messageId: MessageId; fromId: TopicId; toId: TopicId;
      cause: 'explicit' | 'spoken_correction' | 'handback' | 'undo';
      reexecute: boolean }
  | { type: 'route.hint'; messageId: MessageId; suggestedId: TopicId }
  | { type: 'topic.changed'; contextId: TopicId;
      change: 'created' | 'mounted' | 'declared_done' | 'reopened'
        | 'archived' | 'restored' | 'removed' | 'edited' }
  | { type: 'merge.changed'; operation: MergeOperation }
  | { type: 'topic.unmerged'; sourceId: TopicId; targetId: TopicId }
);
type BubbleReadResponse =
  | { kind: 'update'; reset: boolean;
      resetReason?: 'initial' | 'epoch_changed' | 'scope_changed' | 'events_expired' | 'cursor_ahead';
      snapshot: BubbleSnapshot; events: BubbleEvent[] }
  | { kind: 'unchanged'; scope: BubbleScope; cursor: BubbleCursor; serverTime: Ms };

type MergeCommand =
  | { action: 'merge'; id: TopicId; into: TopicId; whenIdle: true;
      requestId: string; sourceRevision: number; targetRevision: number }
  | { action: 'cancelMerge'; operationId: OperationId };
interface MergeAck {
  queued: boolean;
  operation: MergeOperation;
  cursor: BubbleCursor;
}
```

映射说明：`readyToDisplay` 从成功的 workItem 与 `delivery.phase==='waiting'` 派生；`current` 从挂载派生，不是 phase。`declaredDoneAt` 保留历史声明，`effectiveDone` 与 lifecycle 一致。`relatedProposedIds` 不触发“已提供参考”高亮，后者看 reference.provided；candidateIds 只用于确实阻塞的纠错。所有时间/ID/数字在边界校验，数量有上限，日志不带正文；序号使用安全整数，达到上限轮换 epoch。

边生成用一次 store 快照预取 contexts/groups/links/private/origins/hidden，避免每个细胞请求并重复全表扫描。manual −1 单独保留；强度量化；可见端点都在 snapshot 中；top-N 取并集或互选的规则固定，并设总边数上限。将方向性参考列表折成无向布局边不改变共享策略；不要因 layout 显示靠近就绕过 private/linkScope。原始分数和详细原因按需进入详情。

## 5. 实现顺序、测试清单、风险与待决事项

### 5.1 建议的实现顺序

这些是下一轮实现清单，本轮没有修改或运行产品测试套件。测试框架参考 `tests/harness.ts:21-24,37-92`：`node:test`、`node:assert/strict`、FixtureModel；集成测试用真实 DSH session/loop，模型由 fixture 控制。并发交错优先用 `Promise.withResolvers()` 栅栏，参考 `tests/mid-reply.test.ts:29-69`，不用长 sleep 猜时序。

| 步骤 | 交付内容 | 必须覆盖的测试；现有写法参考 |
|---|---|---|
| 1. 定义状态语义与只读投影 | 分离 topic 生命周期、挂载、work 执行、delivery；先从现有对象投影，未知明确为 unknown/null；统一可见性/能力判断。 | current+running、current+aside 展示、同 topic 同时有运行和队列、后台 done 但 DB running、声明时间早/晚于运行、失败/中断/待审批、没有 usage 的新话题。参考 `tests/topic-status.test.ts:11,47`、`tests/routing-aside.test.ts:56`、`tests/catalog-consent.test.ts:125`。增加 excluded 在 catalog 关闭/失败/attention 补入/余页复核/fastKeep/执行前的回归；GET 投影不产生 store 写入或模型请求。 |
| 2. 补运行与消息队列观测 | 给每个 WorkerRun 分配 executionId，记录 messageIds/batchId；在分类、项目等待、Worker 实际启动、完成、被主聊天选中、提交和取消处通知。 | A 前台阻塞、B 后台先完成：B=ready 且 A 仍 current；随后 B 只执行一次、原样展示。B 未完成就被接管时转 showing/running。第三个后台因容量满、同话题忙、同项目锁、未知 CREATE 尚未建细胞、relay 绕开普通限额、队列删除取消、内部 requeue 不误取消、claimed 窗口不丢记录。参考 `tests/mid-reply.test.ts:72,120,154`、`tests/project-queue.test.ts:5`、`tests/steering.test.ts:11`、`tests/relay.test.ts:22`。 |
| 3. 做快照+事件及立即返回 API | 先 waitMs=0；所有可见变更走聚合器；ring/epoch/version/seq/reset；不依赖 `/routes` 的列表差异猜事件。 | 首次/无变化/正常增量/环溢出/重启/非法游标/跨 scope；同批多事件、回滚无事件、事件与快照一致；合批/handback 同消息多执行、旧响应晚到、过滤事件仍正确推进水位；后台 completed 和 catalog 变更即使没有 HTTP 写请求也递增版本。HTTP fixture 参考 `tests/manage.test.ts:15-24`、`tests/history-catalog.test.ts:15`；客户端竞态参考 `tests/client-session-visibility.test.ts:8-44`。 |
| 4. 做有界长轮询与回退 | waiter 生命周期、丢唤醒保护、单请求/上限、客户端 abort 和退避。 | 相同游标挂起、变更即时唤醒、多客户端收到同切面、timeout unchanged；注册前后竞态、连接关闭、页面卸载、插件卸载、数据库关闭前清空 waiter；注销路由不会自动取消 pending 的专门回归。至少一次真实 HTTP 25 秒与断连验证，再分别验证桌面和受支持旧宿主；不支持时切短轮询且无忙循环。复用第 3 步的 HostConnectionService 模式。本次内存探针只覆盖处理器层，不替代这些验收。 |
| 5. 增加合并操作队列及服务端守卫 | whenIdle/requestId/op 状态、取消、过期、结构版本、全局维护租约、原子结果；status done 的运行中守卫；明确 mount 仍有全局限制。 | 即时成功、忙时 202、用户消息优先、所有后台交付后才合并、排队取消和重复取消、重复提交/相同 key 不同参数、反向/交叉/循环拒绝、目标删除/移组/private 变化、dispose 期间新输入、关闭/重启、事务失败恢复，merge 后 unmerge 保留合并后新增内容。参考 `tests/manage.test.ts:101`、`tests/merge-undo.test.ts:8,56`、`tests/merge-suggestions.test.ts:202,376,395,417`；新增 run/asking/starting 时 done 失败、闲时成功。 |
| 6. 接细胞视图和交互 | 先能稳定显示 current/running/waiting/queued/ready，再接投递/引用/融合动画；复用 mount/attach，补真正按执行停止的接口。 | 按实际事件仅播放一次；初次/重连不重演；10 个以上话题、长标题、移动中不跳位、`+N` 可查；队列失败弹回保留原状态；旧 UI 快照与新服务端能力冲突按新结果恢复。拖会话按 server eligible 校验，不只信 DOM；主会话/Worker/旧会话/消失行/虚拟滚动覆盖。参考 `tests/continue-topic.test.ts:20`、`tests/client-navigation.test.ts:24-99`、`tests/client-topic-folder.test.ts:58,65`；真实 DSH 检验行命中、窄侧栏、主题、键盘、触屏、prefers-reduced-motion、失焦恢复和多窗口。 |
| 7. 迁移路由状态说明，做整链回归 | 将路由回执/后台进度/纠错结果放侧栏详情；保持正式答案、工具卡和原生问题审批可达；不只把旧 source 渲染成空白。 | alternate 提示、mount、merge 结果、纠错副作用、重启恢复都能在侧栏找回；不再重复进入聊天，也不损坏回复归属。Worker 工具只执行一次，重试无重复文本，取消仍停 Worker。参考 `tests/mirror.test.ts:20,53,106`、`tests/streaming.test.ts:10,55,90,118,155`、`tests/lifecycle.test.ts:57,77,124`、`tests/routing-bindings.test.ts:239,266,325,514`、`tests/learning-provenance.test.ts:168,229,327`。随后运行 `npm run typecheck`、`npm test`、`npm run build`；真实安装视觉验收单列，不拿静态/fixture 通过替代。 |

建议先交付步骤 1–4 的可观察数据和一个朴素状态列表，再接已确定的细胞表现。这样可以直接对照真实队列验证视觉语义，不需重新增加路由模型调用；并且不改变现有路由选择、执行次数和 token 消耗来“制造”动画。

### 5.2 主要风险与限制

- **状态误报风险最高**：busy 包括已完成待展示；`topicStatus.active` 不代表正在跑；原始 done 声明可能已经被后续运行覆盖；`unshown` 不是整轮完成。统一按本文件的多个维度派生。
- **展示与副作用风险**：pending 输出被取消/合批丢弃不等于 Worker 从未做事；纠正/合并/撤销合并也不自动撤销文件或外部系统改动。侧栏必须保留具体结果与失败入口，不能只有一段好看的移动动画。
- **可见性和共享风险**：private、excluded、归档、客户端 hideTopicSessions 是不同规则；不要用同一个隐藏开关。excluded 的执行入口不一致、请求参考对共享规则的特殊路径需要独立回归，UI 过滤不能充当安全守卫。
- **竞态与多入口风险**：状态可能来自 API、工具、目录扫描、主聊天、后台、自主续跑、用户直接打开 Worker；只监听前台接口会漏。多浏览器的动画游标各自保存，业务动作使用服务端幂等和结构 revision。
- **性能风险**：逐帧查询 SQLite、每个细胞各发请求、每个 token bump version、对每个节点重复扫描全部关联，都会放大开销。批量预取、事件通知、低频时间投影、单在途长轮询；渲染动画只消费客户端缓存。
- **兼容风险**：`data-row-key` 是实现细节；正式 disposer 是异步；当前 TheOne 使用了一处简化类型断言。本地宿主源码与内存探针不能覆盖旧宿主、桌面 transport、反向代理超时。
- **范围风险**：snapshot/events、合并队列、stop 能力、聊天状态迁移是几项独立工程；`foam.html` 的本地演示不证明这些已经接通。本次没有声称 UI 可用、全套测试通过或部署完成。

### 5.3 需要用户在实现前拍板的产品语义

本轮按要求不弹窗、不等待选择。以下不阻塞文档交付；尚未决定时可采用列出的建议作为实现提案，但不能把建议写成用户已批准的产品行为。

| 待决项 | 建议默认及原因 |
|---|---|
| 归档但被再次路由/当前挂载/还有待展示结果的细胞是否重新显露？ | 建议显露活动和待展示对象；归档只影响常驻位置。否则真实任务会在侧栏不可见。 |
| aside 何时折叠，首次话题和追问怎么办？ | 建议成功交付后折叠；无返回对象时按普通话题；追问重新展开同 ID；失败或待用户回答不折叠。不自动标 done 或删除。 |
| 甩走运行中以外的“待交付/排队”对象是否也算办完？ | 建议先阻止尚有执行或未交付结果的对象甩走；普通闲置对象才 done，随时可撤销。若允许甩走待交付对象，需要保留明确的队列入口，不能悄悄丢答案。 |
| 10 分钟内打开别的话题继续作为隐式路由学习吗？ | 建议先保留现有弱提示行为，但不画消息迁移；如果用户想让拖动真正纠正上一条，须单独定义带 messageId 的动作。挂载与纠错不能混用。 |
| 合并等待是否只看这两颗，以及是否跨重启继续？ | 建议初版沿用全局空闲，排队意图有可查询回执但重启取消未执行项。改成仅局部空闲或跨重启自动继续，需要额外执行隔离与恢复语义验收。 |
| private 要表达“资料不向外共享”还是双方完全隔离？ | 建议本轮先忠实展示现有单向资料保护语义。若改双向隔离，应先统一 briefing/事实/近期对话/手动参考的行为，再调整边和锁的文案。 |
| 侧栏取代聊天状态说明后，是否保留文字详情入口？ | 建议必须保留。合并失败、误路由已有副作用、重启恢复、缺模型都需要能读到原因；不弹窗不等于只用颜色和动画传达。 |
| 直接“停止”具体停止什么，是否同时撤回尚未展示的消息？ | 建议先明确区分停止当前执行与撤回队列输入，均有稳定 ID；默认停止不删除已有结果。删除 topic 的动作继续与删除 DSH 聊天区分。 |

### 5.4 本次验证记录

- 逐行读取草案并定位 15 行的源码；核对相关 store、WorkerRun、项目队列、学习/历史目录、客户端和现有测试。
- shell 内存验证使用本地真实 HostConnectionService：挂起/并发其他路由/query 保留、Request.signal、注销后的旧请求生命周期，共三组断言通过；没有创建测试文件、数据库、真实服务监听或模型请求。
- 未运行 `npm test`、build 或安装流程：现有集成 harness 会创建临时会话、SQLite 等文件（`tests/harness.ts:61-67`），不符合本轮只允许写本文件的范围；测试表是后续实现清单，不是本轮通过记录。
- 交付检查覆盖 5 个主章节、15 行结论、117 处文件/行号引用；类型草稿在内存中通过 TypeScript strict/noEmit 检查，没有生成文件。147 个源码、测试、原型及配置文件的哈希与检查前一致，HEAD 未变化；新增文件只有本评审。
