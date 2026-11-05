# 话题细胞团 × 路由：映射草案（Claude 起草，待 Codex 对照代码审）

## 产品目标

左侧栏里原来的「话题工作区」一行，换成 TheOne 主卡片下面挂着的一团细胞（原型：`experiments/sidebar-cell-capsule/foam.html`）。

- 每个话题是一颗圆细胞：线条膜加一个实心核，和 One 的 logo 是同一种画法。
- 细胞之间像肥皂泡筏一样挤在一起，接触面被挤平，但每颗细胞的膜保持独立。
- 聊天窗口里只有和 LLM 的对话：路由的结果、后台进度、回执，全部在细胞团里表现，不进聊天窗口。

## 路由 → 细胞：逐条映射

| 路由里的事实 | 代码位置（我的理解，请核实） | 细胞团里的表现 |
|---|---|---|
| 一条消息被路由到已有话题 `EXISTING contextId` | `llm-router.ts` 的决策；`startRun` / `relay` | 主细胞分泌出一个小囊泡，飘进那颗细胞；细胞被点亮、长大，开始回答 |
| `EXISTING` 同时带 `relatedIds` | 同上 | 主囊泡进目标细胞，被一起用到的话题只轻微亮一下，没有囊泡 |
| `CREATE` 新话题 | 同上 | 从主细胞里分裂出一颗新细胞，靠膜颈相连，长大后拉断 |
| `CREATE` 且 `aside: true`（一次性小问题） | 同上 | 分裂出一颗小细胞，答完就慢慢缩小，折进 +N，不长期占位 |
| `CLARIFY candidateIds` | 同上 | 囊泡停在几个候选细胞之间，候选细胞微微亮着等用户回答；用户答了，囊泡进被选中的那颗 |
| 用户纠正了路由（`applyCorrection`，或刚发完消息就打开了另一个话题） | `index.ts` 的 applyCorrection、context/mount | 囊泡从错的细胞里出来，转进对的细胞 |
| 话题正在回答（前台或后台） | `this.active`、`this.background`、`this.starting`、`latestTopicRuns` | 暖光，核在漂移，膜轻轻呼吸 |
| 排队（`requeue`，超过后台上限） | `requeue` / `MAX` 背景数 | 小一号的虚线细胞，有空位时长大、变实 |
| 答好了，等主聊天展示 | `relay` 的展示顺序 | 白底暖线；轮到时答案以囊泡飘回主细胞 |
| 主聊天当前挂着的话题 | `store.current(gatewayKey)` | 主色描边，和 logo 一样 |
| 最近用得多的话题 | `store.contextUsage`（lastUsedAt、recentCalls） | 更大、更靠上（靠近主卡片） |
| 话题之间的关联 | `linkage.ts` 的 `relatedTopics`：manual / workspace / project / entities / learned | 关联越强，两颗细胞之间的吸附越强：同一个话题工作区的话题自然聚成小团。手动拆开（manual −1）的两颗互相轻推 |
| 合并 / 撤销合并 | `editTopics` 的 merge、unmerge | 两颗细胞融合；撤销时一颗分裂成两颗 |
| 用户说这件事办完了（`declareTopic done`）；下一条消息落到它时自动重新打开 | `store.declareTopic` | 用户把细胞甩出侧栏 = 声明办完了，它折进 +N；之后再有消息路由到它，它从主细胞重新分裂出来 |
| 隐藏（会话被删除或归档、excluded） | `hiddenReasons` / `unreachable` | 不显示 |

## 交互（原型里已经做好，用户很满意）

- **拖到主卡片：** 主聊天接着聊这个话题（context/mount）。
- **拖到另一颗细胞：** 合并。如果其中一个话题正在回答，就先用膜颈把两颗绑住，等空闲了再合（后端现在会直接回 `GATEWAY_BUSY`，需要支持排队）。
- **拖到 DSH 会话行**（`data-row-key="session:<id>"`）：把那个会话 attach 到这个话题。
- **甩出侧栏：** `status done`。正在回答的细胞甩不走，会弹回来。
- **右键菜单：** 打开话题、停止、删除等。

## 后端需要什么（初步）

1. **一份细胞团快照**，`GET /api/theone/bubbles?since=<version>`，用长轮询：版本号没变就挂起，最多约 25 秒。快照里每个可见话题带：id、标题、lastUsedAt、recentCalls、状态（idle / running / queued / answered / current）、declaredDone、所在的话题工作区 id，以及和其他可见话题之间的关联边（对端 id 和权重，可以只取前几条）。
2. **最近的路由事件**（自增 seq）：messageId、action、contextId、relatedIds、candidateIds、aside、created，以及纠正事件（从哪个话题转到哪个话题）。客户端按 seq 播放囊泡动画，播过的不再播。
3. **合并排队：** `POST /api/theone/topics {action:'merge', id, into, whenIdle:true}` 在忙的时候返回 `{queued:true}`，空闲时自动执行，也可以取消；排队中的合并要出现在快照里。
4. **甩走、拖到主卡片、拖到会话：** 复用已有的 `status`、`context/mount`、`attach`。

## 请 Codex 回答的问题

1. 上表每一行：代码里真的有这个信号吗？准确的位置在哪？哪些行我理解错了？
2. 有没有遗漏的、值得在细胞团里表现的路由事实？比如 shadow 路由、steering 批量、话题的 project、private、学习中的状态，等等。
3. 最难拿到的是“答好了，等主聊天展示”这个状态和展示顺序。它在哪里？怎么可靠地暴露出来？
4. 快照加事件的接口，你会怎么设计？版本号怎么递增？长轮询在 DSH 的 fetch 注册方式下可行吗？
5. 你建议的实现顺序，以及每一步需要的测试。
