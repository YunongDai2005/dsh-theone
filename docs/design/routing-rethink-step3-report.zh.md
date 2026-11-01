# 路由重想第三步：误路由学习的来源与撤回

2026-11-01 · `routing-depth` · 起点 `0a628b7` · 工作区交付

结论：新增按消息、话题和修订号记账的学习日志。纠正会同步失效错误来源并重建长期状态；异步卡片、提取结果和重启后的旧检查点不能重新提交已失效的学习。Worker 恢复也会排除错误轮次，原始日志和已经发生的外部操作保留。正常完成仍在本轮提交可撤回的学习，不以沉默或超时作确认。

这次验证的是产品代码的离线行为，没有调用真实模型 API、查找或读取 Key，也没有得到新的真实准确率、延迟或费用结果。`src/` 和后端 `dist/` 已同步。任务说明明确要求不要尝试 commit，因此改动留在工作区；没有写 `.git`、提交、推送或发布。用户原有未跟踪目录没有用于本次工作。

## 1. 实现与来源模型

`src/learning-journal.ts` 与 `ContextStore` 共用 SQLite 事务，新增：

- `learning_routes`：`message_id + context_id + revision + stage`。同一个输入改变归属后，旧修订号永久失效；回到原话题也不会让旧异步结果复活。
- `learning_turns`：主聊天消息与 Worker 实际收到的复制消息 ID、会话、起止 seq、父来源的对应关系。跨话题简报、读取工具及事实查询传入的来源会继续传播。
- `learning_bases / learning_events`：每个投影的基线、语义操作、来源集合及有效/等待/失效状态。撤回时恢复基线，再按原顺序应用仍有效的操作；不直接减去已经过截断、饱和或衰减的权重。
- `learning_fact_versions / learning_fact_aliases`：事实版本的证据来源、预期确认状态、别名的独立贡献。撤回追加新版本，不倒拨版本号。

投影重算只执行存储层操作，绝不重新调用 Worker、编辑工具、终端或外部 API。用户后来手工改标题、摘要、分组和关联的操作保留为独立贡献。

## 2. 派生状态盘点

默认主库是 `theone/contexts.db`；表格中的主库指配置中的 `databasePath`。原有来源字段与这次新增的来源机制分列，避免把已有 seq 当成完整的路由来源。

| 状态/入口 | 存储位置 | 修改前可用来源 | 本次处理 |
|---|---|---|---|
| 新建话题标题、初始关键词 | 主库 `contexts`，`plan/topicFor` | `routing_events.message_id` 可定位创建决策，但描述没有贡献来源 | 初始描述也记账；纠正后恢复中性话题壳，后续手工标题保留 |
| 卡片摘要、实体、别名、已定事项、未决事项 | `contexts`、`topic_names/topic_settled/topic_open` | 话题 ID、时间，无消息级来源 | `applyCard` 按来源整体重建；异步返回前再次检查来源修订 |
| 进度、目标、下一步、约束 | `context_state_updates`、`contexts`、`topic_flags` | 进度有 session/through_seq；约束无消息来源 | Worker 写入绑定当前输入及用过的历史来源，撤回后重放独立写入；隐私设置不参与重算 |
| 压缩摘要与跨话题 digest | `context_summary_updates/compaction_digests` | session/summary_seq/end_seq 或 through_seq | 记录覆盖的路由来源；包含被排除轮次的压缩摘要不重新导入 |
| 关键词及纠正学习 | `learned_terms`、`contexts.keywords`、`correction_terms` | 纠正项已有 message_id；聚合权重和关键词没有 | `learnTerms/addKeywords` 记账；撤销纠正通过修订失效重算，旧格式仅保留原有兼容路径 |
| 学习到的关联、人工关联 | `topic_links`，`learnFromRoute/readableTopic/factDelivery` | 只有话题对、权重、时间 | 提案不增加关联；完成后提交。查询、引用和合并继承来源；重算保留人工选择与独立贡献 |
| 自动分组、工作目录关联 | `topic_group_members/topic_groups/context_origins` | 创建决策、历史 session/cwd | 自动分组成员记账；手动分组可重放。已建立的 Worker cwd 是实际运行位置，不假装搬家或撤销文件操作；创建决策与会话保留审计 |
| 简报已读水位 | `briefing_seen` | reader/source/seen_at | 同时绑定接收输入和发送资料来源，避免一次错误接收永久吞掉之后应发送的进展 |
| 事实值、证据、确认状态和别名 | `facts/fact_versions` | 证据 session/seq/quote，但无归属修订；别名原来聚合 | 记录直接/接受证据和路由来源；错误版本失效，恢复最新有效值或追加撤回；旧别名不会被后续有效值携带。完全来自误路由的已撤回事实标签不再写进 Worker 描述 |
| 事实引用与依赖、last_used | `fact_deliveries/fact_dependencies/facts.last_used_at` | delivery 可有 input_id；lookup 原来没有 | lookup 补输入 ID；delivery 保留审计，依赖和使用时间按有效接收重新计算；读过失效值的其他话题可看到版本变化 |
| 路由使用先验、活跃度、休眠顺序 | `routing_events/route_details` 的查询投影 | message_id 已有 | `contextUsage` 使用 corrected_to；不再把纠正前落点算热度；时间线沿用纠正归属，lastActive 排除 moved/失效轮次 |
| 目录提取描述、历史索引、精确范围 | `history_index/history_turns/context_source_ranges` | session/seq/fingerprint，无路由修订 | 提取前过滤排除区间；跨模型等待校验来源和排除集；纠正清理旧范围并使相关索引重新扫描，目录描述与分组按来源提交 |
| Worker 会话和恢复提示 | DSH 原始事件日志、`topic_runs/misrouted_turns` | 原消息 ID，复制输入未完整关联 | 精确绑定复制输入；搜索、学习、恢复均过滤；用 DSH 原生 surface replace 排除模型上下文中的旧轮次及压缩派生。日志不删除 |
| 主聊天近期上下文、Gateway checkpoint | DSH 主聊天日志、压缩 checkpoint | 路由消息 ID/检查点摘录 | 已纠正或因错误父来源失效的片段不再次作为近期对话与检查点摘录输入 |
| 后台卡片/事实工作与恢复检查点 | `contexts.db.work.db` 的工作记录 | context/session/throughSeq、候选结果 | payload 和去重键带来源代次；执行前及提交前检查。旧候选失效后排队重算；无有效证据则完成为 skipped |
| 合并与撤销合并、分支复制 | `topic_merges`、复制描述/别名/来源范围 | 结构撤销日志，未保留学习因果链 | 元数据和关联复制携带来源；分支复制 turn 绑定。撤销合并也重建投影，不能从旧快照复活已撤回内容 |
| 工具调用与外部改动 | DSH 原始工具事件、`change_links`、新增 `misroute_effects` | 工具 callId/seq；误路由原有范围 | 保留并展示已调用的可能产生改动的操作；明确记录未自动撤销。handback 后被拒绝的调用不算外部执行 |
| 运行/去重/通知标记 | `topic_runs/plugin_flags/dismissed_notices` | message ID 或用途键 | 保留执行和通知审计；学习去重有 message/context 键；撤回不重复执行消息 |
| 焦点 shadow、待回应观察 | 单独的 `contexts.db.shadow.db` | message/session/order/replyTo | 保留观察审计；它不参与实际路由请求或长期学习输入，没有把 shadow 推断升级成确认依据 |
| 配置、授权、私有话题、显式完成状态、用户隐藏/删除决定 | settings/consent/exclusion/status 等 | 用户操作 | 不当成路由学习撤销；模型绑定、账户设置、用户原始文件不修改 |

边界：升级前已经存在且没有消息来源的旧描述/关键词/别名，只能作为 legacy 基线保留，不能凭空恢复其来源。这次没有对用户真实数据库做迁移回放或清库，严格撤回保证针对这次版本记账的贡献及已有明确排除范围。历史无来源污染的完全修复仍需要另行重建。

## 3. 写入策略及理由

| 风险 | 写入时间 | 确认含义 |
|---|---|---|
| 路由提案和执行预留 | 立即写路由审计和 `proposed` 来源 | 只代表选择了执行候选，不代表用户确认 |
| 话题内进度、经过验证的直接事实、初始化描述 | 按原工具/生命周期立即写入可撤回投影 | 保持正常任务和首轮学习速度；全部携带来源 |
| 关联权重 | 当前输入成功完成时，从 pending 物化一次 | 阶段是 `inferred`，完成不等于确认；失败或纠正不提交旧关联 |
| 卡片、可选后台事实提取 | 保持首轮和原有 `cardDue` 节奏，后台执行 | 不等待下一句，也不增加正常路由的模型调用；结果写入前验证来源 |
| 跨话题分享的事实 | 沿用用户原话/明确接受的证据检查；有候选歧义或 unclear/fallback 的归属保持 proposed | `checkTargets` 的明确继续/允许或纠正提供归属正证据后，符合条件的事实立即释放；沉默、时间和执行成功都不替代它 |
| 纠正/handback/自动挪动 | 确定新落点后，同步失效旧修订并重建，再安排必要后台学习 | 新落点是纠正证据；旧提取返回、旧检查点和旧别名不会获得新的合法性 |

`confirmed` 在日志中表示归属已有纠正/对象选择证据，不等于事实值已确认；事实仍有自己的证据验证。跨话题资料和工具读取会传递父来源，防止错误结论经过另一个话题洗成“独立学习”。

来源粒度有意偏保守：如果一份摘要或一轮推导使用了多条输入，其中一条被排除，整份派生结果会撤回，使用有效历史重建。无法逐句证明独立性的部分不被冒充为干净证据；不会为了补回它自动重跑原任务。

正常结束只扫描等待物化的贡献；完整历史重算放在纠正路径。此次没有以离线单测时长宣称产品延迟不变，实际长历史性能仍待真实环境验证。

## 4. 单执行者与外部副作用

handback 先完成目标 Worker 的准备，目标实际执行等待原 Worker idle。交出输入后，原 Worker 的后续工具调用被拒绝。启动准备失败则恢复原路由。原有 `checkTargets` 及一次性对象确认继续生效；没有为了本次任务关闭产品的执行前检查。

受控工具夹具验证了：错误项目实际写入 0 次、重复输入新增执行 0 次、双 Worker 同时执行 0 次；目标项目恰好写入 1 次。另一个生命周期测试验证了已经调用过的 edit 会记录在纠正提示和 `misroute_effects` 中，文件操作不会被声称已回滚。这些是夹具结果，不是对所有真实工具和所有并发情况的保证。

## 5. 验证记录

最终统计见同目录外的 [validation.json](../../experiments/routing-rethink-step3/validation.json)。完整原始 TAP 日志在本机 `%TEMP%/routing-rethink-step3-validation/`。

- 后端 `tsc -p tsconfig.json`、测试类型检查、客户端 `--noEmit` 通过，生成的 `dist/learning-journal.*` 和修改的后端 dist 已同步。
- 最终核心回归组合 45/45 通过，其中新增 `tests/learning-provenance.test.ts` 17 项。既有生命周期与长期离开后恢复测试补充了新的来源契约。
- Node 评测测试 30/30、Python 评分测试 22/22 通过。
- 前端两组测试因内部 esbuild spawn 受限，采用 shell 直接构建相同 bundle，再在临时副本中替换构建入口；断言不变，7/7 通过。没有修改原前端测试以跳过断言。
- 全量原生替代测试：**480 项结果，476 通过，4 项因 spawn/spawnSync EPERM 未完成，退出码 1**。其中两项是 `client-topic-folder.test.ts` / `client-update.test.ts` 的文件加载失败（其 7 项断言已另行通过），另两项是 release archive 打包和 route-stats CLI 子进程测试；没有把它们写成测试全绿。
- `--dry-run`：dev/test 各选两个会话、每会话前六条；open/closed 均启用 cards，四组各 12 条，共 48 条。全部生成唯一完整消息键且评分成功。假模型输出的准确率、token 估算、美元数都不是产品收益或实际账单。
- `git diff --check` 通过。没有运行标准 npm 构建/测试的子进程入口，也没有尝试 commit。

新增测试逐项如下（标题与源码一致）：

| # | 测试标题 | 主要断言 |
|---:|---|---|
| 1 | correcting a completed route removes its usage prior from the wrong topic | 纠正后的 prior 只计入新落点 |
| 2 | correction retracts already learned cards, facts, state and links and survives restart | 首轮及时学习；撤回卡片、别名、约束、状态、事实、关联和 prior；重启仍干净 |
| 3 | handback starts the replacement only after the first worker is idle | 错项目写入/重复执行/双 Worker 为零；拒绝的工具不伪记为副作用 |
| 4 | rebuilding projections keeps independent later learning and explicit edits | 保留独立学习、用户摘要；饱和关联按操作重算 |
| 5 | a card already in flight cannot commit after correction | 异步旧卡片不能回写 |
| 6 | a checkpoint from an excluded turn is not restored after restart | 旧候选检查点不能复活污染；无有效证据不调用模型 |
| 7 | facts from an uncertain owner stay proposed until positive target evidence | 成功完成不冒充确认；明确对象确认立即释放 |
| 8 | merge and unmerge cannot preserve invalid route-derived metadata | 合并与拆分都不能复活错误元数据 |
| 9 | invalid fact versions restore the last valid value and notify dependent topics | 还原有效值/别名且版本递增，保留消费者旧版本水位 |
| 10 | a resumed worker never receives the excluded turn as reusable conversation | 重启后真实 DSH 模型请求不含错误轮次 |
| 11 | a catalog refresh cannot re-extract excluded turns or keep their keywords | 真实目录重索引输入和关键词不复用错误内容 |
| 12 | a branch retains source provenance when its copied descriptor is later revoked | 分支复制不能丢失来源 |
| 13 | a route proposal cannot train relatedness; completion commits it once without another message | 提案不增加关联，当前完成提交一次，仍为 inferred |
| 14 | a corrected CREATE retracts its inferred title, keywords and workspace membership | 创建时的推断也可撤回，用户后来改名/分组保留 |
| 15 | a valid later fact value does not preserve aliases inherited from a wrong route | 保留有效新值，去掉继承的错误别名 |
| 16 | a link-only contribution is revoked through merge and unmerge | 没有卡片来源时也不能漏掉合并关联 |
| 17 | a later topic cannot retain memory copied from an excluded route through its briefing | 跨话题传播后的派生状态一起撤回 |

测试使用真实 ContextStore、DSH 会话和工具循环、产品纠正 API、HistoryCatalog 和后台工作恢复；模型仅用 `FixtureModel`/仓库假模型。

## 6. 现有基线、预期影响及作者执行命令

在本地找到的预测文件名含 `-cards-`：`product-v1-{mode}-{split}-cards-deepseek-v4.1-flash.jsonl`。任务中的通配表达是简写，已按同一模型与 product-v1 口径继续，没有因此要求用户确认。只读取并重新评分旧预测，没有重跑模型。

| 组 | 本地准确率 | recheck 比例 | 伤害/百条 | 任务给出的 $/千条 | 统一评分单价下的旧预测 $/千条 |
|---|---:|---:|---:|---:|---:|
| open · dev（1,971 条） | 97.73% | 13.95% | 7.1122 | 0.21 | 0.420634 |
| open · test（495 条） | 98.81% | 11.52% | 3.8095 | 0.20 | 0.405121 |
| closed · dev（1,971 条） | 95.34% | 7.00% | 3.4948 | 0.16 | 0.328563 |
| closed · test（495 条） | 98.57% | 5.66% | 0.7143 | 0.16 | 0.318423 |

这里“复核”对应旧预测的 `recheck` 层，不能拿 `review` 字段的 0% 替代。统一评分采用每百万 token `input=0.30, cache_hit=0.006, output=1.20`，是固定比较口径，不是对当前供应商实收价格的核验。费用差异发生在同一份旧预测的计价口径，不是本次改动的回归；任务中费用所用单价无法从预测记录还原。基线文件哈希和重算结果见 [baseline-summary.json](../../experiments/routing-rethink-step3/baseline-summary.json)。

预期会影响后续路由请求：关联从提案移到当前成功完成，歧义归属事实不立即跨话题分享，错误输入的卡片/别名/先验会消失；跨话题污染撤回可能减小下一次上下文。正常卡片频率没有增加，纠正后可能增加干净资料的后台重建调用。这些都需要用同一模型、相同 corpus/seed、相同 cards 开关分别配对验证，不能用假模型分数替代。

作者在自己的可运行环境执行标准检查（以下不是本轮已执行的标准入口）：

```powershell
npm run build
npm run typecheck
npm test
node --test eval/test/*.test.mjs
py -X utf8 -B -m unittest discover -s eval/test
```

真实回放由作者运行，使用原先已配置的 OpenCode Go 环境，不需要在报告或命令里填写 Key。输出采用 step3 新文件名，不覆盖基线。四组和基线一起用相同单价评分：

```powershell
$model = 'deepseek-v4.1-flash'
$env:EVAL_PRICES = '0.30,0.006,1.20'
foreach ($mode in @('open', 'closed')) {
  foreach ($split in @('dev', 'test')) {
    $before = "eval/data/interleave-v0/predictions/product-v1-$mode-$split-cards-deepseek-v4.1-flash.jsonl"
    $after = "eval/data/interleave-v0/predictions/product-v1-step3-$mode-$split-cards-deepseek-v4.1-flash.jsonl"
    node eval/run-router.mjs --replay product-v1 --mode $mode --policy theone --cards --split $split --model $model --out $after
    if ($LASTEXITCODE -ne 0) { throw "Replay failed: $mode $split" }
    py -X utf8 -B eval/score.py eval/data/interleave-v0/sessions.jsonl $before $after --split $split
    if ($LASTEXITCODE -ne 0) { throw "Score failed: $mode $split" }
  }
}
```

评分入口验证消息键集合；使用 `(session_id, i)` 配对看新错、修复及伤害变化，分别保留 open/closed、dev/test。保留新源码提交号和结果，检查 accuracy、recheck/review、harm、调用数、卡片和总费用、p50/p90；不能把缓存命中或离线时长当作真实提速。若账户中实际模型 ID 有前缀，应沿用作者先前同一个配置的完整 ID。不要用 `--limit` 的输出与全量 corpus 配对评分。

提交前选择本次文件，避免纳入用户原有未跟踪内容：

```powershell
git add -- src/learning-journal.ts src/store.ts src/index.ts src/run.ts src/fact-flow.ts src/history-catalog.ts src/gateway-compaction.ts
git add -- dist/learning-journal.js dist/learning-journal.d.ts dist/store.js dist/store.d.ts dist/index.js dist/index.d.ts dist/run.js dist/run.d.ts dist/fact-flow.js dist/history-catalog.js dist/gateway-compaction.js dist/gateway-compaction.d.ts
git add -- tests/learning-provenance.test.ts tests/lifecycle.test.ts tests/topic-memory.test.ts
git add -- docs/design/routing-rethink-step3-report.zh.md experiments/routing-rethink-step3/validation.json experiments/routing-rethink-step3/baseline-summary.json
git diff --cached --check
git diff --cached --stat
git commit -m "fix: retract route-derived learning after corrections"
```

## 7. 未覆盖的边界与风险

1. 无法精确追溯升级前未记来源的聚合数据；没有对用户真实历史执行来源重建。这个限制不应被“所有历史已清洗”掩盖。
2. 来源是输入/批次级，不是逐字因果图。一个已污染来源可能使整轮后续推导或整份卡片撤回，因此会保守地少保留一些无法证明独立的学习；原始日志可审计，正常未纠正路线的首轮学习仍按原节奏进行。
3. 日志目前未做长期裁剪；正常写入增加本地 SQLite 成本，纠正需要扫描/重建受影响投影。尚无真实大库的时间、磁盘和长期压力数据。
4. DSH 原始日志、已经复制到外部文件、第三方插件私有记忆和已经执行的工具不在回滚范围。`misroute_effects` 根据工具事件记录可能产生改动的调用，不是文件系统差分证明；有调用不等于每个外部动作都成功。
5. 实际 Worker cwd 不会因纠正自动搬迁。错误 CREATE 的语义描述和自动分组撤回，但话题壳和原会话保留供审计。
6. `checkTargets` 的既有策略仍可能在宿主未提供确认服务时按旧规则继续；本轮保持其兼容行为，没有宣称解决所有对象识别错误。
7. 当前环境不能完成标准 npm 子进程链路和打包/CLI 子进程测试，需作者执行上面的标准检查；尚未做桌面部署或真实模型配对验收。
