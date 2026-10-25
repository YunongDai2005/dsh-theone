# 两个话题像是同一件事时，问一次要不要合并

## 目标

路由有时会把同一件事开成两个话题（比如「论文第三章」和「毕设」）。现在只能等用户自己在话题工作区发现并合并。改成：一个**路由新开的话题**第一次写好话题卡片后，如果它和某个已有话题高度相似，就在主聊天用 DSH 的 `userQuestions` 问一次要不要合并，用户点一下就合并好。合并本来就能撤销（`unmergeTopic`），点错了也不怕。

这是唯一新增的提问，所以门槛要高、只问一次、问过就记住。

前置：本任务在 `docs/design/route-options.zh.md` 完成之后做，复用那里的 `askChoice`（在主聊天问单选题的私有方法）。

## 范围

允许改动：`src/index.ts`、`src/store.ts`、`src/routing-policy.ts`（相似度判断可以放这里，写成纯函数方便测试）、`dist/`（和源码一起提交）、新增测试 `tests/merge-suggestions.test.ts`，以及必须跟着调整的旧测试（逐条说明）。

不做：

- 不自动合并任何东西，只问。
- 不为相似度判断调用模型。
- 不改话题工作区、设置页界面（`client.ts` / `client-locales.ts`）。
- 不改版本号、不写 release notes、不发版、不改 README。
- 不做 dot 服务、头像相关的东西。

## 设计

### 1. 什么时候检查

- 只对**路由新建**的话题（`CREATE` 决定产生的话题；不含历史整理导入的话题、用户手动建的话题）。
- 在这个话题**第一次** `applyCard` 成功之后检查一次（`src/index.ts` 约 2804 行写卡片的地方）。以后卡片重写不再检查。
- 这个新话题已经被合并、删除、或被用户手动移动过工作区时不检查。

### 2. 怎么算「高度相似」（纯函数，不调模型）

拿新话题和每个其他话题比，候选话题要满足：还存在、能参与路由（不在 `store.unreachable()` 里）、和新话题之间没有记录过「已问过」。

两个话题算相似，需要**同时**满足：

1. **同一个工作地点**：两者的项目文件夹相同（`store.origin(id)?.cwd` 规范化后相等），或者两者都不属于任何项目。
2. **内容重合**，至少满足一条：
   - 共同的名字 / 实体 ≥ 2 个：比较双方的标题、`topic_names` 里的叫法、卡片 `aliases`、描述里的 `entities`；统一小写、去掉首尾标点后精确相等才算；长度小于 2 个字（英文小于 3 个字母）的不算。
   - 标题足够像：`similarity(textFeatures(标题A), textFeatures(标题B)) ≥ 0.6`（`src/routing-policy.ts` 现有函数）。

多个候选都满足时，选共同名字最多的；一样多选最近活动的。**一个新话题最多只问一次**，只问最像的那一个。

阈值写成具名常量，测试里用正反例把它钉住（明显是同一件事的要命中；只共享一个泛泛词、或不同项目文件夹的不能命中）。

### 3. 记住问过的

新表（`CREATE TABLE IF NOT EXISTS`，写法和现有表一致）：`merge_prompts(a TEXT, b TEXT, answer TEXT, at INTEGER, PRIMARY KEY (a, b))`，`a < b` 规范化存。`answer` 取 `merged` / `declined` / `dismissed`。

- 一对话题只要问过（不管怎么回答，包括取消），就不再问。
- 合并后撤销合并，也不会因此重新问这一对。
- 话题被删除时清掉它相关的行（和其他按话题清理的表一样处理；合并 / 撤销合并时这些行照原样保留即可，不需要搬）。

### 4. 怎么问

- 用 `askChoice` 在这个话题所在的主聊天问（话题最后一次路由时的 gateway）。
- 主聊天正在回答时，**等这一轮结束**再问；不要阻塞用户发下一条消息。如果用户在问题出来前已经发了新消息，就等那一轮也结束再问；30 分钟内都没有空闲就放弃，记为 `dismissed`。
- 先在测试里确认：主聊天空闲时（不在任何一轮里）调用 `userQuestions.ask({ agent: gateway })` 能正常产生问题事件、能被回答。**如果做不到，停下来在汇报里说明，不要自己发明别的界面或替代方案。**

### 5. 选项和结果

| 选项 | 结果 |
|---|---|
| 合并到「旧话题」（放第一个，是推荐项） | 把新话题并进旧话题：走现有合并的同一条路（`/api/theone/topics` 里 `merge` 那段：忙的时候不合并、停掉被合并话题的 Worker、`store.mergeTopics`），抽成一个内部方法共用，不要复制。记 `merged` |
| 合并到「新话题」 | 方向反过来。记 `merged` |
| 不是一回事 | 记 `declined`，以后不再问这一对 |
| 取消、超时、没答案、服务不可用 | 记 `dismissed`，不再问 |

合并时主聊天正忙（`this.busy`）：等空闲后再合并一次；还是不行就放弃，在主聊天说一句没合并成（文案见下）。

合并成功后在主聊天显示一句话（不调模型，直接写一条助手文本，参考现有不调模型直接回复的写法，例如欢迎语 `welcomeGateway` 或 `CLARIFY` 的输出方式；选不调模型、不打断正在进行的回合的方式）。

## 文案（语言跟这个主聊天最近一条用户消息走，用 `writtenInEnglish` 判断）

- header：`可能重复` / `Possible duplicate`
- question：`「{新}」和「{旧}」好像是同一件事，要合并吗？` / `"{新}" and "{旧}" look like the same thing. Merge them?`
- detail：`合并后可以在话题卡片上撤销。` / `You can undo a merge from the topic card.`
- 选项：
  - `合并到「{旧}」`，说明 `保留「{旧}」，把「{新}」并进去` / `Merge into "{旧}"`，说明 `Keep "{旧}" and fold "{新}" into it`
  - `合并到「{新}」`，说明 `保留「{新}」，把「{旧}」并进去` / `Merge into "{新}"`，说明 `Keep "{新}" and fold "{旧}" into it`
  - `不是一回事`，说明 `以后不再问这两个` / `Not the same`，说明 `Don't ask about these two again`
- 合并成功：`已合并到「{目标}」，在它的卡片上可以撤销合并。` / `Merged into "{目标}". You can undo it from its card.`
- 没合并成：`「{新}」和「{旧}」这次没合并成，可以在话题工作区手动合并。` / `Couldn't merge "{新}" and "{旧}" this time; you can merge them in Topic workspaces.`

选项 label 重名或过长的处理和 `askChoice` 一致。

## 验收

1. 新建 `tests/merge-suggestions.test.ts`，至少覆盖：
   - 相似度纯函数的正反例（同项目同名词 ≥2 命中；标题相似命中；不同项目文件夹不命中；只共享一个词不命中；短词不算）；
   - 路由新建的话题第一次写卡片后弹出问题；导入的话题、手动建的话题、第二次写卡片都不弹；
   - 三个选项各自的结果，合并方向正确，`merged` / `declined` 被记住，之后同一对不再问；
   - 取消 / 服务不可用记 `dismissed` 且不再问；
   - 主聊天正在回答时不打断，结束后才问；
   - 合并后撤销合并，不会重新问；
   - 合并时主聊天忙的处理；
   - 删除话题清理 `merge_prompts`；
   - 英文文案。
2. `npm.cmd run build`、`npm.cmd run typecheck`、`npm.cmd test` 全部通过（不能少于开始时的测试数）。`dist/` 一起提交。

## 工作方式

- 直接用 shell 执行命令，不要使用子代理和 node_repl。PowerShell 里用 `npm.cmd`；需要 Python 用 `py`；读中文文件用 `-Encoding UTF8`。
- 在分支 `theone/merge-suggestions` 上提交（从 `theone/route-options` 的最新提交开出来），可以分几次提交。作者用 `YunongDai2005 <yuriddaaii@gmail.com>`，**提交信息里不要加 Co-Authored-By 或任何 AI 署名行**。不要 push，不要改写历史。
- 仓库里未跟踪的用户文件夹（`.dsh/`、`.workbuddy/`、`outreach/`、`promo/`、`promo-4k/`、`promo-demo/`、`promo-fish/`、`promo-horus/`）不要碰；`git add` 只加你改过的文件。

## 汇报要回答

- 改了哪些文件，各做了什么。
- 测试总数和结果；改了哪些旧测试、为什么。
- 主聊天空闲时 `userQuestions.ask` 能不能弹出，怎么验证的。
- 相似度阈值最后是多少，正反例各举一个。
- 合并逻辑抽出来的共用方法长什么样。
- 有没有偏离本文设计的地方，为什么。
- 还有什么没做完或拿不准的。
