# 路由重想第四步：保留复核，暂不扩大快路

2026-11-01；分支 `routing-depth`，源码起点 `d10a846`。本轮仅分析任务指定的四份真实基线预测，未调用模型 API、未读取凭据、未读取正在生成的 step3 预测。

## 结论

**不修改 `src/` 或 `dist/` 的实际路由。** 新触发规则 `loss-evidence-v1` 只写入实验目录的离线影子结果；既有单执行者、`checkTargets` 和第三步学习写入策略均保持原样。

- **复核有可见的增量价值。** 在排除歧义与一次性插问的严格计分消息上，open dev/test 分别改对 **11 / 1** 条，closed dev/test 改对 **39 / 7** 条，四组均未观察到“正确改成错误”。这不代表所有消息均无伤害：包含歧义标注时有改错，部分一次性插问也被复核送入已有话题。
- **替代触发规则未过门槛。** dev/open 可省 62 次复核，但丢掉 2 次纠错，污染差 95% 区间上界 **+0.312 pp**，高于预设 **+0.2 pp**。冻结后 test 的严格分数没有变化，不能覆盖 dev 的失败；test/closed 被跳过的 4 条全是歧义消息，严格分数根本没有检验它们。
- **快路为零不是死代码。** 语料中没有任何一句命中现有裸续接表达式；顺序回放又没有回复绑定、宿主待答响应或同轮 steering 元数据。真实绑定快路的可比子集是 **0**，质量不降尚未证实。
- **翻页为零由小目录解释。** 四组每一步都把当时整个目录交给模型，目录最多 9 个话题，没有被截断的剩余页。本轮没有发现由候选筛选丢掉已有正确话题造成的错误，也不能由此证明大目录召回良好。

分析程序、冻结口径和逐条影子记录见 [实验说明](../../experiments/routing-rethink-step4/README.md)、[协议](../../experiments/routing-rethink-step4/protocol.md)、[dev 结果](../../experiments/routing-rethink-step4/dev-results.json)、[test 结果](../../experiments/routing-rethink-step4/test-results.json)。

## 1. 数据和反事实口径

只使用 `eval/data/interleave-v0/predictions/product-v1-{open,closed}-{dev,test}-cards-deepseek-v4.1-flash.jsonl`，模型为作者已运行的 DeepSeek V4.1 Flash / OpenCode Go。程序使用四个精确文件名，没有扫描 predictions 目录，也没有把预测副本纳入交付。

每个 mode 的 dev 为 40 段 / 1,971 条，test 为 10 段 / 495 条。严格准确率分母为 **1,631 / 420**；歧义消息 **273 / 62**、一次性插问 **88 / 20**，两者有交集。四份预测共 4,932 行，消息键完整唯一；产品协议、模式、候选与目录、终判与预测、逐调用数量及 token 加总均通过断言。输入文件哈希保存在结果 JSON。

使用 `trace.initial` 构造不复核的当前一步：`CLARIFY` 先按产品 `settleUnclear` 选择当前候选、首候选或当前话题，空目录则新建。`CREATE` 视为创建新话题，不能误当作空预测；若终判仍 CREATE，则用实际分配的 ID 计分。未触发复核的错误回退不记成复核收益。Python 收尾规则用手算测试和源码/dist 的 5 个收尾夹具核对。

**这是基线自身真实预测历史上的单步配对反事实，不是关闭复核后重新生成的完整对话。** 两条分支共享基线的目录、卡片和历史；替代路线后续会怎样更新卡片、候选、缓存、引用和执行，本轮没有模型结果。open 的已有 ID 固定使用基线全段 Hungarian 映射，仅供评分，不给规则使用，也不为替代策略重新拟合映射。初判 CREATE 被终判改为已有话题的反事实按新任务/重复拆分判准处理；本轮四组没有“假设新建的是尚未出现任务”的不可识别实例。

污染沿用评分器的 `wrong_existing / merged_new`；加权伤害为错入已有话题 3、重复新建/澄清/错误 1、正确 0，按每百条严格计分消息报告。它是基准代理，不等于实际写文件或跨话题简报造成的损害。

所有区间均为 **10,000 次、种子 20261101、以整段对话为单位的配对 bootstrap 双侧 95% 百分位区间**。每次抽中一段，带入该段全部计数再计算比率；不把消息当独立样本。四组分开，未混池。零事件的经验区间 `[0,0]` 只描述这批样本，不能保证未知人群零风险；少量子组的有效重采样数保存在 JSON。

## 2. 复核到底改对多少

“未改”比较收尾后的落点，忽略理由、标题等字段变化。下表的改对、改错和严格未改只覆盖严格计分子集；全部未改包含歧义和一次性插问。

| 组 | 实际尝试 / 全部消息 | 严格复核条数 | 改对 | 改错 | 严格未改落点 | 全部未改落点 |
| --- | --- | --- | --- | --- | --- | --- |
| open · dev | 275 / 1971 | 184 | 11 | 0 | 173 | 247 |
| open · test | 59 / 495 | 44 | 1 | 0 | 43 | 51 |
| closed · dev | 138 / 1971 | 54 | 39 | 0 | 15 | 85 |
| closed · test | 28 / 495 | 13 | 7 | 0 | 6 | 15 |

复核对**全部严格计分消息**的增量如下；正的准确率差代表复核更好，负的污染/伤害差代表复核更好。不能把复核子集的准确率变化直接当作全量提升。

| 组 | 不复核 → 基线终判准确率 | 准确率差 pp [95% CI] | 污染差 pp [95% CI] | 伤害/100 差 [95% CI] |
| --- | --- | --- | --- | --- |
| open · dev | 97.057% → 97.731% | +0.674 [+0.313, +1.075] | -0.123 [-0.312, +0.000] | -0.920 [-1.549, -0.380] |
| open · test | 98.571% → 98.810% | +0.238 [+0.000, +0.773] | +0.000 [+0.000, +0.000] | -0.238 [-0.773, +0.000] |
| closed · dev | 92.949% → 95.340% | +2.391 [+1.856, +2.919] | +0.000 [+0.000, +0.000] | -2.391 [-2.919, -1.856] |
| closed · test | 96.905% → 98.571% | +1.667 [+0.685, +2.799] | +0.000 [+0.000, +0.000] | -1.667 [-2.799, -0.685] |

按实际触发原因拆分（证据冲突优先于 CREATE/CLARIFY，三类互斥）：

| 组 | 触发原因 | 尝试 / 严格条数 | 改对 / 改错 | 严格未改 | 全部未改 |
| --- | --- | --- | --- | --- | --- |
| open · dev | create | 220 / 166 | 9 / 0 | 157 | 206 |
| open · dev | clarify | 22 / 4 | 2 / 0 | 2 | 12 |
| open · dev | evidence-conflict | 33 / 14 | 0 / 0 | 14 | 29 |
| open · test | create | 47 / 39 | 0 / 0 | 39 | 44 |
| open · test | clarify | 3 / 0 | 0 / 0 | 0 | 1 |
| open · test | evidence-conflict | 9 / 5 | 1 / 0 | 4 | 6 |
| closed · dev | create | 83 / 36 | 36 / 0 | 0 | 42 |
| closed · dev | clarify | 19 / 2 | 0 / 0 | 2 | 13 |
| closed · dev | evidence-conflict | 36 / 16 | 3 / 0 | 13 | 30 |
| closed · test | create | 11 / 4 | 4 / 0 | 0 | 5 |
| closed · test | clarify | 4 / 0 | 0 / 0 | 0 | 2 |
| closed · test | evidence-conflict | 13 / 9 | 3 / 0 | 6 | 8 |

closed/dev 的 CREATE 复核在严格子集上修复 36 条，是其主要收益来源；open/dev 的 CLARIFY 复核也修复 2 条，说明“没有新增独有线索”并不意味着再次比较没有价值。源码收尾本身还使 closed/dev 的 1 条初始 CLARIFY 正确落点；若直接把裸 CLARIFY 算错，会把这条误记为复核修复。

严格子集四组均为零改错，不能推广到被排除的消息。下面把有 gold 的歧义消息也计入；这只是标签敏感性分析，不升级为更可靠的准确率。一次性插问送入话题的数量则沿用评分器定义，列出复核子集的前后变化。

| 组 | 含歧义：改对 / 改错 | 复核子集：一次性插问送入话题（前 → 后） |
| --- | --- | --- |
| open · dev | 21 / 2 | 1 → 3 |
| open · test | 5 / 0 | 0 → 2 |
| closed · dev | 43 / 0 | 1 → 5 |
| closed · test | 8 / 1 | 0 → 2 |

## 3. 调用、token、时间和费用

费用统一用仓库原比较单价：每百万 token 未缓存输入 **$0.30**、缓存命中 **$0.006**、输出 **$1.20**。公式为 `(input-cache_hit)*0.30 + cache_hit*0.006 + output*1.20`，再除以百万。**这不是 OpenCode Go 实收账单，也没有核验当前报价。** 总费用和总 token 包含卡片及辅助调用；复核调用占比以路由调用为分母。缓存命中 token 已包含在输入 token 内，不能再加一遍。

open/test 的最终 `recheck` tier 是 **57/495=11.52%**，但 `trace.recheck.attempted` 是 **59/495=11.92%**，其中 2 次未采纳。下面使用全部 59 次物理复核调用，包含失败尝试的已记录消耗。四组记录了 17/4/18/2 条带错误的路由；这些记录没有被静默丢弃。

| 组 | 复核 / 路由 / 含卡片总调用 | 复核输入 / 其中缓存 / 输出 token | 复核总 token | 复核调用耗时合计 s | 复核费用 $ / 含卡片总费用 $ |
| --- | --- | --- | --- | --- | --- |
| open · dev | 275 / 2246 / 2714 | 676,504 / 428,800 / 83,108 | 759,612 | 1122.99 | 0.176614 / 0.829069 |
| open · test | 59 / 554 / 662 | 142,981 / 82,688 / 17,395 | 160,376 | 275.48 | 0.039458 / 0.200535 |
| closed · dev | 138 / 2109 / 2571 | 353,658 / 221,440 / 47,363 | 401,021 | 686.32 | 0.097830 / 0.647597 |
| closed · test | 28 / 523 / 632 | 71,029 / 41,728 / 9,379 | 80,408 | 136.23 | 0.020295 / 0.157619 |

| 组 | 路由调用占比 % [95% CI] | 含卡片 token 占比 % [95% CI] | 路由调用耗时占比 % [95% CI] | 复核 $/千条 [95% CI] |
| --- | --- | --- | --- | --- |
| open · dev | 12.24 [11.27, 13.26] | 12.08 [10.99, 13.22] | 22.15 [19.63, 25.10] | 0.08961 [0.07667, 0.10474] |
| open · test | 10.65 [8.98, 12.35] | 10.33 [8.35, 12.59] | 21.22 [15.63, 27.93] | 0.07971 [0.05559, 0.11113] |
| closed · dev | 6.54 [5.52, 7.56] | 7.05 [5.92, 8.15] | 15.30 [12.40, 18.37] | 0.04963 [0.04046, 0.05928] |
| closed · test | 5.35 [3.66, 7.18] | 5.72 [3.85, 7.82] | 12.94 [8.20, 18.07] | 0.04100 [0.02749, 0.05623] |

各原因的复核开销（只统计 recheck 层，完整区间见结果 JSON）：

| 组 | 原因 | 物理调用 | 输入+输出 token | 耗时 s | 比较口径费用 $ |
| --- | --- | --- | --- | --- | --- |
| open · dev | create | 220 | 574,316 | 817.41 | 0.122639 |
| open · dev | clarify | 22 | 77,894 | 149.95 | 0.025199 |
| open · dev | evidence-conflict | 33 | 107,402 | 155.63 | 0.028775 |
| open · test | create | 47 | 119,558 | 182.35 | 0.027457 |
| open · test | clarify | 3 | 11,982 | 42.32 | 0.005277 |
| open · test | evidence-conflict | 9 | 28,836 | 50.81 | 0.006724 |
| closed · dev | create | 83 | 233,086 | 385.99 | 0.055335 |
| closed · dev | clarify | 19 | 62,618 | 154.68 | 0.018784 |
| closed · dev | evidence-conflict | 36 | 105,317 | 145.66 | 0.023711 |
| closed · test | create | 11 | 31,067 | 49.86 | 0.008204 |
| closed · test | clarify | 4 | 13,016 | 35.29 | 0.003749 |
| closed · test | evidence-conflict | 13 | 36,325 | 51.07 | 0.008342 |

耗时来自逐次传输记录。复核在 quick 后串行执行，因此可以量出当前一步可省的调用耗时；并发会话的这些耗时之和不是整批运行的墙钟时间，也不是实际部署后的端到端 p90。排队、卡片变化和之后的请求成本没有被假装抵消。

## 4. 候选 Recall@K 及“答案不在候选里”

产品候选上限 K=16，但这批实际 K 最大为 open/dev 9、open/test 7、closed/dev 9、closed/test 6。`candidateIds` 采用目录顺序，不提供检索排名，所以报告**实际候选集合 Recall@cap16**，不伪造 Recall@1/4/8。

主表采用与基线严格准确率对应的固定 canonical ID，只在已有正确 ID 存在于当时目录时计算召回。单元格为“命中/可召回分母（比例）”；空分母写 —，不是 100%。短句为不超过 16 个 Unicode 字符；同域表示 gold 工作有同 domain 的其他工作；长期返回代理是距该工作上次出现至少 10 条中间消息，并没有跨日时间证据。分组有重叠，不相加。

| 分组 | open · dev | open · test | closed · dev | closed · test |
| --- | --- | --- | --- | --- |
| 全部 | 1467/1467（100.0%） | 379/379（100.0%） | 1631/1631（100.0%） | 420/420（100.0%） |
| 短句 ≤16 字符 | 357/357（100.0%） | 81/81（100.0%） | 359/359（100.0%） | 81/81（100.0%） |
| implicit 风格（仅计分分组） | 498/498（100.0%） | 115/115（100.0%） | 499/499（100.0%） | 115/115（100.0%） |
| 同域工作 | 283/283（100.0%） | 49/49（100.0%） | 321/321（100.0%） | 57/57（100.0%） |
| 同域切换 | 25/25（100.0%） | 8/8（100.0%） | 36/36（100.0%） | 10/10（100.0%） |
| 返回间隔 ≥10 条 | 60/60（100.0%） | 14/14（100.0%） | 60/60（100.0%） | 14/14（100.0%） |
| 目录 0 | — | — | — | — |
| 目录 1–4 | 995/995（100.0%） | 289/289（100.0%） | 745/745（100.0%） | 201/201（100.0%） |
| 目录 5–8 | 450/450（100.0%） | 90/90（100.0%） | 872/872（100.0%） | 219/219（100.0%） |
| 目录 9–16 | 22/22（100.0%） | — | 14/14（100.0%） | — |
| 目录 >16 | — | — | — | — |

所有非空组的经验 bootstrap 区间都是 [100%,100%]，只是本批小目录全量入选的直接结果，不能外推到 >16 话题或更大的历史目录。为防止分母选择掩盖历史问题，下面同时列出被排除的情形与只用此前历史多数归属（prefix owner）的诊断：

| 组 | 严格条数 | open 首次任务 | canonical ID 尚不在目录 | prefix 多数归属尚不存在 | prefix 存在时的集合召回 |
| --- | --- | --- | --- | --- | --- |
| open · dev | 1631 | 162 | 2 | 15 | 1454/1454 |
| open · test | 420 | 40 | 1 | 2 | 378/378 |
| closed · dev | 1631 | 0 | 0 | 0 | 1631/1631 |
| closed · test | 420 | 0 | 0 | 0 | 420/420 |

**候选截断漏掉已有正确话题：四组均为 0 条。** 因为每条的 candidates 集合恰好等于当时 catalog。canonical ID 不在目录的逐条记录如下（i 为零基索引）：

| 组 | 消息键 | 当时目录数 | prefix 仍有该工作拥有者 | 最终严格计分 |
| --- | --- | --- | --- | --- |
| open · dev | en-0014:2 | 1 | 是 | 错误 |
| open · dev | en-0014:3 | 1 | 是 | 错误 |
| open · test | en-0020:27 | 3 | 是 | 正确 |

open/dev 的两条都在 en-0014：全段映射最后把正确工作配给了一个后来才创建的 ID，而当时唯一话题在历史前缀上仍主要属于该工作。因此这两条是全段标签/历史混合造成的计分错误，不能归因于候选检索把已有正确项丢了。open/test 的 en-0020:27 通过 CREATE 得到最终 canonical ID，最终计分正确，同样不是漏候选导致的错误。

prefix 口径另有 dev 15 条、test 2 条尚无多数属于目标工作的已有话题，反映已发生的历史归属或合并；“没有干净多数拥有者”不等于语义正确答案绝对不存在。本轮只报告这个诊断，不把它当作检索因果损失。首次任务本就可能应新建，也不能混入已有话题召回的失败分母。

## 5. 快路与翻页为什么为零

源码路径在 [routing-policy.ts](../../src/routing-policy.ts) 的 `continuesCurrent`、[index.ts](../../src/index.ts) 的 `fastKeep` / `classify`，候选上限在 [history-catalog.ts](../../src/history-catalog.ts)。

1. 裸续接快路需要已有有效 current、不是纠正，并满足同轮 steering、纯附件或 `continuesCurrent(text)`。dev 1,971 条、test 495 条对源码和 dist 的表达式命中均为 **0**；其中长度 ≤16 的消息有 477/110 条，implicit 有 616/141 条，但都不等于裸“继续/好的/go on”。例如“场地呢”“那接下来要准备啥”包含对象或新的询问，现有表达式不会匹配它们。
2. `product-v1` 对每条执行 `followup` 后等待 `whenIdle`，输入只有 text，没有同轮消息交叠、纯附件或 goal 轮次。语料也没有 reply、replyTo、宿主待答 requestId、steering、时间戳等字段。不能拿 style=implicit 或上一条 gold 当作可信绑定。
3. 正例探针“继续”“go on”“thanks”“详细一点”全部匹配。既有真实产品/回放测试的 fast 场景、开关 shadow 的对齐测试均通过，证明路径可达，不是被 product-v1 禁用了。
4. 翻页仅在 CREATE 后存在未入选目录项时发生。这里目录均小于 16、候选包含全目录，因此 remaining 为空。既有 55 话题 review / review-invalid 夹具通过，覆盖真实三页复查，不能把本数据零触发判作死代码。

实验实现了 [bindings.mjs](../../experiments/routing-rethink-step4/bindings.mjs) 的保守影子建议：可信显式回复必须解析到同会话的有效前台/用户消息；宿主响应必须指明某个仍待答的 host-request；steering 必须携带匹配的活动轮次。多个拥有者冲突、后台通知、question-form 推测、失效话题和跨会话身份均弃权。它使用第二步 shadow 的消息/待答结构，但未接入实际路由。

| 切分 | 可用于明确绑定的真实消息 | 快路与模型同子集样本 | 质量差区间 | 结论 |
| --- | --- | --- | --- | --- |
| dev | 0 | 0 | 不可估计 | 未证实 |
| test | 0 | 0 | 不可估计 | 未证实 |

6 项绑定夹具只证明规则边界，不证明真实准确率，也没有生成假的配对模型成绩。报告没有扩大裸短句规则来强行制造覆盖率。

## 6. 预期损失触发规则：冻结后仍只保留影子

新规则 `loss-evidence-v1` 是一个**代价代理假说，不是已校准的错误概率模型**：已有话题错入代价 3，重复新建代价 1；可区分的冲突证据和已有替代目标作为复核是否可能降低损失的信号。dev 先观察到 CREATE 有大量修复，所以保留非空目录的拆分风险；提出省去空目录复核和缺少区分证据的 CLARIFY 复核。运行时仅用候选、初判动作、已记录的冲突 ID/terms：

```text
候选为空：跳过
冲突 ID 在候选中，terms 非空，且与初判 ID 不同：复核
初判 CREATE 且目录非空：复核
其余：跳过
```

离线只在基线已经尝试复核的记录上应用这个删除规则；不假装知道原来没复核的消息再问模型会得到什么。没有使用 gold、ambiguous、style、终判、测试标签或理由文本作为触发特征。

该假说在 dev 已失败：22 条 open CLARIFY 中只有 4 条进入严格计分，其中 2 条确实被复核改对。保留这个失败方案并冻结做一次 test 诊断，是为了检验这条机制假说；没有把它描述为已选出的最优策略，也没有因 test 表现修改规则或阈值。

冻结时间 `2026-11-01T13:40:12.685957+00:00`，见 [freeze.json](../../experiments/routing-rethink-step4/freeze.json)。冻结包含分析程序、绑定建议、协议和相关源码共 11 个文件的 SHA-256，以及 dev 输入与结果哈希。test 入口先写不可覆盖的 [启动记录](../../experiments/routing-rethink-step4/test-evaluation-started.json)，随后只运行了一次；冻结后的规则与分析代码没有变更。

| 组 | 跳过复核 / 保留复核 | 准确率差 pp [95% CI] | 污染差 pp [95% CI] | 伤害/100 差 [95% CI] | 数值门槛 |
| --- | --- | --- | --- | --- | --- |
| open · dev | 62 / 213 | -0.123 [-0.312, +0.000] | +0.123 [+0.000, +0.312] | +0.368 [+0.000, +0.935] | 未过 |
| open · test | 13 / 46 | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | 仅样本数值通过 |
| closed · dev | 19 / 119 | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | 仅样本数值通过 |
| closed · test | 4 / 24 | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | 仅样本数值通过 |

这里差值方向为**新规则减原基线**。预设准确率下界 ≥−0.5 pp、污染上界 ≤+0.2 pp；另保守检查伤害/100 上界 ≤+0.2。dev/open 的污染和伤害均未过。test/closed 的被跳过子集严格分母是 0，test/open 被跳过的严格样本仅为 10 条首轮空目录消息，所以三行 `[0,0]` 不能被解释成已证明普遍不降质。要声称减少污染，区间上界必须小于零，本方案也不满足。

包括歧义 gold 后，新规则准确率差依次为 −0.319、−0.421、−0.159、−0.211 pp；这些标签不够可靠，却足以提醒不能把被严格计分排除的损失当作不存在。

节约是固定历史下删除这些已观测调用的估算，仍按同一价格计费、保持原卡片成本：

| 组 | 少调用 | 少输入+输出 token | 少 $/千条 [95% CI] | 含卡片总费用降幅 % [95% CI] | 可避免串行 ms/消息 [95% CI] |
| --- | --- | --- | --- | --- | --- |
| open · dev | 62 | 149,704 | 0.01856 [0.01285, 0.02540] | 4.41 [3.09, 5.94] | 133.4 [99.1, 175.0] |
| open · test | 13 | 29,904 | 0.01901 [0.00758, 0.03833] | 4.69 [1.94, 8.89] | 158.1 [62.9, 323.2] |
| closed · dev | 19 | 62,618 | 0.00953 [0.00460, 0.01574] | 2.90 [1.42, 4.68] | 78.5 [35.1, 131.8] |
| closed · test | 4 | 13,016 | 0.00757 [0.00000, 0.01706] | 2.38 [0.00, 5.27] | 71.3 [0.0, 156.6] |

这些估算约为 2.4%–4.7% 总费用下降，没有达到研究后续阶段提出的至少 10% 总费用下降目标；端到端 p90 也没有新实测。无论从 dev 的污染门槛、缺少真实绑定样本，还是反事实历史和费用验证看，都不应据此修改实际路由。所有建议仅保存为结果 JSON 中的 `shadow_records`，没有给用户正在使用的数据库写入新策略或迁移。

## 7. 验证和环境限制

完整测试名称与结果见 [validation.json](../../experiments/routing-rethink-step4/validation.json)。没有为绕过失败而修改既有测试或源码。

| 检查 | 本轮结果 |
| --- | --- |
| 后端、测试、客户端 TypeScript 类型检查 | 三项退出码均为 0；后端使用 --noEmit |
| 新增 test_analysis.py | 14/14 通过 |
| 新增 bindings.test.mjs | 6/6 通过 |
| Node eval/test/*.test.mjs | 单进程 30/30 通过 |
| Python eval/test | 22/22 通过 |
| 全量 tests/*.test.ts 原生单进程入口 | 480 项结果：476 通过，4 项因 EPERM 未完成；退出码 1 |
| 实际路由/回放 parity | 包含在全量通过项中，10 个场景 × shadow 开关 = 20 项 |
| 已有 routing-shadow / learning-provenance | 包含在全量通过项中，分别 9 / 17 项 |
| 源码/dist 纯函数探针 | dev/test 共 2,466 条续接表达式一致；每切分 5 个收尾及 4 个正续接夹具 |
| 冻结与结果核验 verify.py | 11 个冻结文件、四组统计及本报告相对链接核验；不重跑 test 预测 |
| Git diff --check | 通过；最终差异范围核对为新增实验目录与本报告 |
| 标准 npm build / npm test / commit | 按任务说明交作者；本轮未尝试这些入口或写 .git |

未完成的四项具体是 `client-topic-folder.test.ts`、`client-update.test.ts` 在加载时启动 esbuild 失败，以及 `pack-plugin.test.ts` 的 release archive 用例、`route-stats.test.ts` 的 CLI 用例启动子进程失败。前两项是文件加载占位，不能当成只漏了两个前端断言，更不能称全量通过。完整日志保存在本机 `%TEMP%/routing-rethink-step4-validation-20261101/`。

新增分析测试名称：

- `test_unclear_settlement_prefers_current_only_if_offered`
- `test_unclear_ignores_unknown_ids_and_handles_empty_catalog`
- `test_create_is_not_mistaken_for_an_existing_assigned_id`
- `test_candidate_miss_separates_catalog_absence_from_selection`
- `test_loss_does_not_update_counterfactual_history`
- `test_oneoff_into_an_empty_but_existing_topic_remains_isolated`
- `test_trigger_uses_pre_review_evidence_and_skips_empty_catalog`
- `test_trigger_does_not_accept_stale_or_empty_evidence`
- `test_bootstrap_resamples_whole_unequal_conversations`
- `test_empty_statistic_is_unknown_not_zero`
- `test_usage_cost_does_not_bill_cache_twice`
- `test_input_join_rejects_missing_duplicate_and_unknown_keys`
- `test_only_authorized_baseline_paths_can_be_resolved`
- `test_group_analysis_keeps_baseline_history_and_scores_settlement`

新增绑定测试名称：

- `an explicit trusted reply binds to its resolved source despite background focus`
- `two pending questions require the exact host request identity`
- `same-round steering requires a trusted active round binding`
- `conflicting explicit owners abstain instead of silently taking precedence`
- `untrusted references, question-form guesses, and background notices cannot bind`
- `stale topics and cross-session message identities cannot bind`

现有实际路径测试使用仓库假模型/FixtureModel；评测 HTTP 协议测试使用本地假服务。没有调用外部模型 API。本轮未改回放流程，已有实际路径夹具足以验证其可达性，没有另跑真实模型或把假模型分数写成收益。

## 8. 作者执行命令与提交

先核验本轮冻结记录和新增脚本；这不会再次评分 test，也不会访问模型：

```powershell
py -X utf8 -B experiments/routing-rethink-step4/verify.py
py -X utf8 -B -m unittest discover -s experiments/routing-rethink-step4 -p test_analysis.py
node --test --test-isolation=none experiments/routing-rethink-step4/bindings.test.mjs
```

在允许子进程的作者环境运行标准检查：

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
node --test eval/test/*.test.mjs
py -X utf8 -B -m unittest discover -s eval/test
```

由于本轮没有修改产品，不需要为 step4 额外发起真实模型前后重跑；作者正在进行的 step3 配对实验保持独立。本轮不能代替其验收。未来若新策略确实通过离线门槛，真实回放仍需新输出文件名、同模型/cards/价格/版本配对，并计卡片和端到端 p90。

任务文件明确写了“不要 commit”，且沙箱 `.git` 只读，因此本轮**没有提交、没有暂存**，按这一更具体的收尾要求执行。作者检查后只选择本轮路径提交：

```powershell
git add -- docs/design/routing-rethink-step4-report.zh.md experiments/routing-rethink-step4
git diff --cached --check
git diff --cached --stat
git commit -m "Analyze recheck value and freeze routing step 4 shadow policy"
```

完整分析的开发顺序是 `analyze.py dev` → `analyze.py freeze` → `analyze.py test`，规则已经冻结，test 结果已有保护锁。日常核验运行 `verify.py`，不要删除锁后重新调参测试。独立复核应另存审计副本、使用相同冻结规则，并明确它不是一份新留出集。

## 9. 没有做到、不能声称的事

- 没有不同策略各自历史下的真实闭环配对回放，也没有当前 step3 之后的预测分析。因此初判/终判增量是单步条件效应，不能声称长期准确率、历史污染、费用或速度按同样幅度变化。
- 没有大于 16 话题的真实模型样本、真实助手问答/时间戳/前台可见事件；大目录召回、长期返回和明确绑定快路的质量均未证实。夹具不是替代数据。
- test 只有 10 段，部分关键子组为零；已有早期研究和报告看过该语料或 test 总分，本轮没有把它称为完全未见的新基准。
- 真实模型记录由合成语料产生，gold 与歧义标记不是新的人审自然对话。固定映射和前缀多数归属是评分工具，不是真实用户确认。
- 只有已触发复核的调用结果；无法评价“给未复核的错误 KEEP/SWAP 增加复核”的收益，也不能假定缺乏独有证据时模型没有其他可比较信息。
- `alternateIds`、跨话题简报、后续卡片变化及工具副作用未被落点评分完整覆盖。真实损害仍需任务继续成功、错误写入与纠正恢复等证据。
- 未核验供应商实际账单、未完成标准子进程测试入口、未提交或部署。`src/` 未改，因此没有需要同步的新 dist 产物。
