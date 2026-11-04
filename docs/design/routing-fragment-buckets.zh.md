# 路由碎片分桶：主要是含糊归属和失败回退

日期：2026-11-04。分析代码基线：0b54494。

**这批数据不支持优先投入“多路找回”。** 主分析的 161 个非主话题碎片中，117 个出生消息被金标标为 ambiguous，22 个来自模型失败后的回退。明确归入 B 的只有 14 个。

“碎片”不一定是一张新卡。主分析仅 11/161 个出生点执行 CREATE，其中 2 个还是正常首次新建。其余 150/161 个执行 KEEP 或 SWAP，落入另一个已有话题。不能把约 1.35 个话题直接理解成重复建卡率。

本次只分析指定的已有真实模型预测。对话是合成数据。没有调用模型 API，没有查找或读取 Key，没有改 src/ 或 score.py。结论仅适用于这些记录。

## 1. 数据与口径

主分析使用 cache-5e36590a72d5 的 none-open/none-closed；复现使用 cache-26e14a000b7e 的同名文件；compact 使用第一目录的 compact-open/compact-closed。均为 eval/data/interleave-v0/predictions/ 下的 JSONL。

六份文件各有 2,466 条，键完整且不重复。每份 dev 有 40 段对话、1,971 条消息、162 件事；test 有 10 段对话、495 条消息、41 件事。各运行使用同一批对话，不能当成新增独立样本。

脚本直接调用 score.read_jsonl、score.score_session、score.evaluate。open 复用匈牙利匹配。任务说明把对应关系统称为匈牙利匹配，但原评分器的 v0 closed 直接使用预置 ID；这里沿用原行为，没有额外重匹配。

每件事最终匹配到的话题叫“主话题”。第一次进入其他预测话题时，记一个碎片出生点。按“gold 事情、预测话题”这一对计数，再次进入同一对不重复计数。同一预测话题可以是多件事的碎片。

有两个不能混用的数字：

- **碎片 N**：非主话题落点数。分桶比例以 N 为分母。
- **额外落点 E**：每件事实际用过的话题数减 1，再相加。它直接对应 topics_per_thread。
- 如果某件事从未用到主话题，或没有获得一对一匹配，N 会比 E 多 1。记这些事情数为 M，便有 **N = E + M**。不擅自给未匹配的事情另选主标签。

主话题可能后来才出生。第一条合法 CREATE 也可能被回看成非主话题。单列 D“正常首次新建”，不把未来话题当成当时漏掉的候选。后来进入主话题才增加额外落点的数量，另存为 chronological_extra_births_on_main。因此，N 不是当时多建卡片的数量。

A/B 的已有话题只包括当时已存在的主话题，以及此前接过这件事的预测话题。候选检查包括初始 candidateIds 和已尝试的翻页；有逐次调用记录时，只采用已发送的翻页。

分桶优先级：正常首次新建单列；含糊金标归 C；失败回退、自动消解 CLARIFY、插问话题复用归 D；其余按既有话题、候选和判断路径分 A/B。无既有话题或缺轨迹单列 D。每个出生点只占一个桶，重叠机制保存在 evidence。

**本批 C 的唯一判据是原始 turn.ambiguous=true。** 没有凭感觉扩大 C。C 表示金标已声明含糊，不证明每一句都绝对无法优化。由于缺少完整历史卡片快照，也不擅自把未标含糊的 B 改成 C。脚本另兼容原评分器的其他 schema 含糊标记，本批 v0 不涉及它。

gold.thread=null 的插问不进入事情分母，也不自身产生碎片。它新建的话题后来接入有 gold 的消息，才可能产生 D“插问话题复用”。CLARIFY、ERROR 不作为话题计数。含糊消息仍参与匹配和话题数，与原评分器一致。

## 2. 三次运行的分桶

### 主分析

| 模式 / 数据 | 碎片 N | A 没找到 | B 判断错 | C 金标含糊 | D 其他 |
|---|---:|---:|---:|---:|---:|
| open / dev | 65 | 0/65（0.0%） | 9/65（13.8%） | 46/65（70.8%） | 10/65（15.4%） |
| open / test | 12 | 0/12（0.0%） | 0/12（0.0%） | 11/12（91.7%） | 1/12（8.3%） |
| closed / dev | 71 | 0/71（0.0%） | 5/71（7.0%） | 52/71（73.2%） | 14/71（19.7%） |
| closed / test | 13 | 0/13（0.0%） | 0/13（0.0%） | 8/13（61.5%） | 5/13（38.5%） |

四组合计仅作描述：C 为 117/161（72.7%），B 为 14/161（8.7%），D 为 30/161（18.6%），A 为 0/161。open 与 closed 是相同对话的不同回放，不能把它们当成双倍独立样本。

### 同代码复现

| 模式 / 数据 | 碎片 N | A 没找到 | B 判断错 | C 金标含糊 | D 其他 |
|---|---:|---:|---:|---:|---:|
| open / dev | 65 | 0/65（0.0%） | 5/65（7.7%） | 44/65（67.7%） | 16/65（24.6%） |
| open / test | 12 | 0/12（0.0%） | 0/12（0.0%） | 10/12（83.3%） | 2/12（16.7%） |
| closed / dev | 77 | 0/77（0.0%） | 9/77（11.7%） | 45/77（58.4%） | 23/77（29.9%） |
| closed / test | 13 | 0/13（0.0%） | 0/13（0.0%） | 8/13（61.5%） | 5/13（38.5%） |

方向一致：C 最大，A 为 0。但比例不稳定。open/dev 的 C 从 46/65（70.8%）变为 44/65（67.7%）；closed/dev 从 52/71（73.2%）变为 45/77（58.4%），差约 14.8 个百分点。

失败回退出生点从 22/161 增到 39/167。open/dev 从 6 个增到 13 个，closed/dev 从 11 个增到 19 个。这不能解释成身份卡片或候选检索变化。

test 每模式只有 10 段对话。open 的 C 是 11/12 对 10/12；closed 是 8/13 对 8/13。能说主因方向相同，不能说比例收敛。

### compact 对照

| 模式 / 数据 | 碎片 N | A 没找到 | B 判断错 | C 金标含糊 | D 其他 |
|---|---:|---:|---:|---:|---:|
| open / dev | 58 | 0/58（0.0%） | 7/58（12.1%） | 43/58（74.1%） | 8/58（13.8%） |
| open / test | 14 | 0/14（0.0%） | 0/14（0.0%） | 12/14（85.7%） | 2/14（14.3%） |
| closed / dev | 71 | 0/71（0.0%） | 4/71（5.6%） | 53/71（74.6%） | 14/71（19.7%） |
| closed / test | 16 | 0/16（0.0%） | 1/16（6.2%） | 9/16（56.2%） | 6/16（37.5%） |

compact 没有改变主因。合计 C 为 117/159，B 为 12/159，D 为 30/159，A 为 0/159。open/dev 的碎片从 65 降到 58，open/test 却从 12 增到 14；closed/dev 仍为 71，closed/test 从 13 增到 16。不能据此声称 compact 稳定减少碎片。

### A 为 0 是否被 C/D 的优先级掩盖

没有。主分析当时有旧话题可回归的出生点，**159/159 都在初始候选里**。四组分别为 64/64、11/11、71/71、13/13。另外两个是正常首次新建。

复现为 162/162，compact 为 154/154，也都能看到至少一个旧落点。六份文件均不缺 candidateIds，翻页次数为 0，每步候选最多 8～9 个。这只是小目录的观察，不能外推到上百个话题的检索。

## 3. B 和 D 的子类

以下是出生点计数，C 的计数见上表。

| 组 / 模式 / 数据 | B 新建保留 | B 未救回 | D 失败回退 | D 插问复用 | D 正常首次新建 | D 尚无旧话题 |
|---|---:|---:|---:|---:|---:|---:|
| 主分析 / open / dev | 1 | 8 | 6 | 3 | 1 | 0 |
| 主分析 / open / test | 0 | 0 | 0 | 0 | 1 | 0 |
| 主分析 / closed / dev | 2 | 3 | 11 | 3 | 0 | 0 |
| 主分析 / closed / test | 0 | 0 | 5 | 0 | 0 | 0 |
| 复现 / open / dev | 0 | 5 | 13 | 2 | 1 | 0 |
| 复现 / open / test | 0 | 0 | 2 | 0 | 0 | 0 |
| 复现 / closed / dev | 4 | 5 | 19 | 4 | 0 | 0 |
| 复现 / closed / test | 0 | 0 | 5 | 0 | 0 | 0 |
| compact / open / dev | 2 | 5 | 3 | 2 | 2 | 1 |
| compact / open / test | 0 | 0 | 2 | 0 | 0 | 0 |
| compact / closed / dev | 2 | 2 | 12 | 2 | 0 | 0 |
| compact / closed / test | 1 | 0 | 5 | 1 | 0 | 0 |

B“初判正确、被复核改错”与 B“无失败的规则直接落点”均为 0。没有真实样例，使用手造测试覆盖。翻页未救回、后续变化但中间步骤不明、缺轨迹，也均为 0。

主分析 B“初判错未救回”的 11 个中，10 个未复核；另 1 个初判 CREATE，复核后落到错误旧话题。B“初判新建且保留”的 3 个都尝试复核，其中 2 个采纳结果、1 个未采纳。不把未采纳写成复核认可。

D 失败回退还可按原错误码拆开：

| 运行 | ROUTER_REQUEST_FAILED | ROUTER_INVALID_DECISION | ROUTER_COMPACT_ID_INVALID | 合计 |
|---|---:|---:|---:|---:|
| 主分析 | 12 | 10 | 0 | 22 |
| 复现 | 30 | 9 | 0 | 39 |
| compact | 9 | 9 | 4 | 22 |

这是碎片出生点上的失败，不是全部请求失败。错误码不足以区分网络、服务端或重试原因。

C 中另有重叠机制：主分析有 3 个失败回退、7 个自动消解 CLARIFY；复现为 4 个和 7 个，compact 为 6 个和 8 个。D 的 CLARIFY 回退为 0，是因为这些消息已归 C，不代表没有这条路径。

## 4. B 的自动特征与局限

预测没有保存整张卡片、版本或应用成功时间，无法测完整卡片的词重叠或真实年龄。

标题可以恢复：closed 来自预置目录，open 来自此前 CREATE。回放关闭后台目录重建，卡片应用更新摘要等字段，不改标题。脚本只用当时已知标题。实现依据见 [product-replay.mjs](../../eval/lib/product-replay.mjs) 和 [store.ts](../../src/store.ts)。

- 标题重叠：英文和数字按词切分、转小写、去掉脚本列明的少量虚词；中文取相邻两个汉字。交集除以并集，小于 0.1 记低重叠。它不能证明进入新阶段，中英混用也会降低它。
- 距上次出现：同一 gold 上次出现与本条之间的消息数。连续为 0，首次为缺失。
- 距卡片请求：主话题最近一次 card_usage 到本条的轮数差。它不等于距卡片成功更新的时间。真实 card_age_turns 一律为 null。话题年龄另按出现以来的轮数记录；closed 从目录注入起算，不是真实年龄。
- 同领域候选：候选对应另一 gold，且金标 domain 相同。映射复用评分器。未映射候选无法判断领域；这个离线标签也不证明模型看到了相似卡片。

| 组 / 模式 / 数据 | B 数 | 标题低重叠 | 同领域候选 | 中间隔几条，中位数（可测数） | 距卡片请求几轮，中位数（可测数） |
|---|---:|---:|---:|---:|---:|
| 主分析 / open / dev | 9 | 9/9（100.0%） | 3/9（33.3%） | 0（9） | 7（9） |
| 主分析 / closed / dev | 5 | 5/5（100.0%） | 2/5（40.0%） | 1.5（4） | 7.5（4） |
| 复现 / open / dev | 5 | 4/4（100.0%） | 1/5（20.0%） | 0（5） | 8.5（4） |
| 复现 / closed / dev | 9 | 9/9（100.0%） | 0/9（0.0%） | 0（4） | 15（4） |
| compact / open / dev | 7 | 7/7（100.0%） | 3/7（42.9%） | 0（7） | 10（7） |
| compact / closed / dev | 4 | 3/4（75.0%） | 1/4（25.0%） | 1（2） | 14.5（2） |
| compact / closed / test | 1 | 1/1（100.0%） | 1/1（100.0%） | 不可测（0） | 不可测（0） |

没有 B 的 test 组不计算特征。主分析 B 的 14/14 都低重叠，但正确主话题路由里，open/dev 也有 1,246/1,433（87.0%）低重叠，closed/dev 有 1,368/1,600（85.5%）。低重叠不是充分的错误解释。

正确对照取主话题当时已存在、金标不含糊、匹配正确的消息。它与 B 出生点的采样粒度不同，没有做匹配实验，只用于避免把普遍的短句现象当成错误特征。

主分析 B 中只有 3/9 个 open/dev、2/5 个 closed/dev 有同领域候选。间隔中位数为 0 条和 1.5 条，不能笼统归因于隔太久。距卡片请求中位数为 7 轮和 7.5 轮，正确对照均为 5 轮；样本小且缺卡片应用记录，不能判定卡片过期。

## 5. 后续 KEEP：传播规模

出生消息不算跟随。后续仍是同一 gold、同一碎片，动作 KEEP，且此前当前话题也相同，才计跟随。SWAP 返回已有碎片不再计出生；之后 KEEP 仍可计入。

| 组 / 模式 / 数据 | 碎片内全部消息 | 后续 KEEP | 其中正常首话题跟随 | 扣除后 KEEP | 其他后续消息 |
|---|---:|---:|---:|---:|---:|---:|
| 主分析 / open / dev | 109 | 33 | 17 | 16 | 11 |
| 主分析 / open / test | 19 | 4 | 0 | 4 | 3 |
| 主分析 / closed / dev | 99 | 20 | 0 | 20 | 8 |
| 主分析 / closed / test | 43 | 24 | 0 | 24 | 6 |
| 复现 / open / dev | 107 | 32 | 15 | 17 | 10 |
| 复现 / open / test | 20 | 7 | 0 | 7 | 1 |
| 复现 / closed / dev | 127 | 28 | 0 | 28 | 22 |
| 复现 / closed / test | 17 | 3 | 0 | 3 | 1 |
| compact / open / dev | 104 | 32 | 15 | 17 | 14 |
| compact / open / test | 22 | 5 | 0 | 5 | 3 |
| compact / closed / dev | 117 | 33 | 0 | 33 | 13 |
| compact / closed / test | 17 | 1 | 0 | 1 | 0 |

主分析 open/dev 的 33 条 KEEP 中，17 条来自 en-0014 最初合法建立的找房话题。只是最终匹配没有给这件事分到主标签，不能把它们都说成错误传播。复现和 compact 的 open/dev 各有 15 条同类情况，表中单独扣出。

主分析 closed/test 的 24 条 KEEP 中，**22 条集中在 en-0030**。第 0 条就因 ROUTER_INVALID_DECISION 回退新建做饭话题，后来持续跟随。复现 closed/test 的 KEEP 只有 3 条。一个出生点能放大代价，10 段对话的传播规模也很不稳定。

KEEP 是记录到的跟随路径，不证明这些消息一定能被某项优化挽救。它不是新的出生原因。

## 6. 代表样例

i 与 JSONL 相同，从 0 开始。“主”“短”分别指主分析、compact。主标题是当时存在的目录标题；CREATE 的落点标题是本次新建标题。没有把 gold 标题冒充 open 的实际卡片标题。

### B：初判 CREATE，最后仍 CREATE

| 位置 | 消息原文 | 当时主标题 → 最后落点 | 判据 |
|---|---|---|---|
| 主/open/dev，en-0024，i=25 | Back on the SQLite thing, the approval flow needs to handle trades people actually make | ShiftSwap 下一版本开发 → SQLite 审批流支持实际交易 | 候选已有主话题。复核被采纳，仍新建。标题重叠 0，中间隔 4 条。 |
| 主/closed/dev，en-0006，i=12 | thinking about learning Python finally, signed up for Python for Everybody on Coursera | Python for data work → Starting Python for Everybody on Coursera | 复核仍判为另一课程。也可能涉及合成目录与消息的边界差异。 |
| 主/closed/dev，en-0006，i=14 | my tutor session moved to Thursday at 6, does that still work | Spanish for trip → 改期后的导师课时间确认 | attempted=true，但 accepted=false。不能写成复核认可。 |

### B：初判错，后面没有救回

| 位置 | 消息原文 | 当时主标题 → 实际落点 | 判据 |
|---|---|---|---|
| 主/open/dev，en-0006，i=26 | Back to Python, I need to get serious about automating those monthly sales reports. | Learn Python via Coursera's Python for Everybody → Organize Q2 2025 bookstore sales tax return | 初判切到税务，Python 只作关联。未复核。 |
| 主/closed/dev，zh-0037，i=21 | P-2023-1012交上去之后，我回头去弄那个销售报告 | 分析Q3销售数据 → 处理交通事故理赔 | 抓住理赔编号，忽略回到销售报告的动作。未复核。 |
| 主/open/dev，zh-0041，i=21 | 学校数我重新数了一遍，是48所 | 为十一月应用统计年会投摘要（300词） → 《地理分析》返修意见逐条修改 | 初判新建，复核后改到错误旧话题。不是新建保留。 |

### C：原始金标已标含糊

| 位置 | 消息原文 | 当时主标题 → 实际落点 | 可复查判据 |
|---|---|---|---|
| 主/open/dev，zh-0001，i=31 | 要不要把python课里做的那个练习也放进去 | 准备投递云图数据数据分析岗 → Python课进度：第8章跳到第12章是否合适 | ambiguous=true。涉及课程与求职材料。 |
| 主/open/dev，zh-0003，i=40 | 那按你这么说，我每周跑25公里这点量够撑住这六天吗 | 国庆云南六天行程规划（10月1-6日） → 半马训练：十二月跑进两小时（当前配速6分半） | ambiguous=true。涉及行程和训练。 |
| 主/open/dev，en-0002，i=34 | ok back to that thing I was working on before | Paper revision due August 30 → Fridge shopping: $1800 budget, 36-inch alcove | ambiguous=true；初判 CLARIFY，最后 unclear-settled。 |

自动消解 CLARIFY 的另一例是主/closed/dev 的 en-0014 i=4：“also what about that other thing I mentioned”。主标题“Apartment Move”，落点“Lease Review”。同样标含糊。它与上表最后一条说明该机制确实出现，但未另占 D。

### D：失败回退

| 位置 | 消息原文 | 当时主标题 → 实际落点 | 判据 |
|---|---|---|---|
| 主/open/dev，en-0008，i=12 | Back to the salon app, staging URL changed to https://app.salonbook.example.com | Salon booking app launch prep (staging review) → Quarterly tax filing (Oct 15 deadline) | ROUTER_REQUEST_FAILED，回退 KEEP。 |
| 主/open/dev，zh-0033，i=50 | 奶茶店秋季菜单那三款，试卖日期提前到9月8日行不行 | 准备南街奶茶店秋季菜单 → 为西巷花店做小程序下单 | ROUTER_REQUEST_FAILED，回退 KEEP。候选并未漏掉主话题。 |
| 主/closed/dev，zh-0003，i=13 | 想理一下家里的账，房贷月供6800 | 家庭年度预算整理 → 国庆云南六日游 | ROUTER_INVALID_DECISION，回退 KEEP。 |

无效决策的另一例是主/closed/test 的 en-0030 i=0：“I want to start prepping five healthy dinners for the workweek, recipes should serve 4 people”。“Weeknight Meal Prep”已在目录，仍回退 CREATE。新标题是“I want to start prepping five healthy dinners for the workweek, recipes should s”。它带来前述 22 条后续 KEEP。

### D：插问话题被后续任务复用

| 位置 | 消息原文 | 当时主标题 → 实际落点 | 判据 |
|---|---|---|---|
| 主/open/dev，en-0024，i=16 | ok what about the second one | Senior QA Engineer job search strategy → Convert 12 km to miles | 换算话题由此前 gold=null 的插问新建。 |
| 主/open/dev，en-0034，i=4 | makes sense, keep going | Summer block party (Aug 12): budget and permits → 3 quarts to cups conversion | 仍跟着容量换算。 |
| 主/open/dev，zh-0049，i=19 | 那你直接给我个例子吧 | 制定基于慕课网《SQL从入门到实战》的SQL学习计划 → 文二路菜市场周六上午人少的时间段 | 仍跟着菜市场插问。 |

这三条原始 ambiguous=false，不擅自挪到 C。它们提示插问后的自然返回需要单独研究。

### D：正常首次新建，以及尚无旧话题的首次混入

| 位置 | 消息原文 | 当时标题 / 落点 | 判据 |
|---|---|---|---|
| 主/open/dev，en-0014，i=0 | I'm looking for a new apartment, budget is around $1,500 a month | 目录为空；新建 Finding a new apartment (~$1,500/month) | 合法首次新建，最后没有获得该 gold 的主标签。 |
| 主/open/test，en-0020，i=25 | the new bathroom faucet drips, I think I need a Moen 1222 cartridge, does that sound right | 当时没有该任务主话题；新建 Dripping bathroom faucet and Moen 1222 cartridge | 后来的主话题不能当成当时已有候选。 |
| 短/open/dev，zh-0021，i=15 | 还有我爸妈的事，他们11月15日要从市区老房子搬到郊区江宁的电梯房，得帮忙张罗 | 该任务尚无旧话题；落入 南京搬往杭州的搬家日期调整 | 父母搬家第一次出现，混入自己的搬家。这是 no_prior_thread_topic 的唯一实测例子。 |

A、B 复核改错和 B 纯规则直接落点均没有实测样例。尚无旧话题只有 1 例，不凑数。上述边界另有手造单元测试。

## 7. 与原评分器核对

| 组 / 模式 / 数据 | 落点总数 / 事情数 | 额外落点 E | 未用主话题 M | 本脚本 | score.py |
|---|---:|---:|---:|---:|---:|
| 主分析 / open / dev | 226/162 | 64 | 1 | 1.395 | 1.395 |
| 主分析 / open / test | 53/41 | 12 | 0 | 1.293 | 1.293 |
| 主分析 / closed / dev | 232/162 | 70 | 1 | 1.432 | 1.432 |
| 主分析 / closed / test | 53/41 | 12 | 1 | 1.293 | 1.293 |
| 复现 / open / dev | 227/162 | 65 | 0 | 1.401 | 1.401 |
| 复现 / open / test | 53/41 | 12 | 0 | 1.293 | 1.293 |
| 复现 / closed / dev | 237/162 | 75 | 2 | 1.463 | 1.463 |
| 复现 / closed / test | 54/41 | 13 | 0 | 1.317 | 1.317 |
| compact / open / dev | 220/162 | 58 | 0 | 1.358 | 1.358 |
| compact / open / test | 54/41 | 13 | 1 | 1.317 | 1.317 |
| compact / closed / dev | 231/162 | 69 | 2 | 1.426 | 1.426 |
| compact / closed / test | 57/41 | 16 | 0 | 1.390 | 1.390 |

十二组完全一致。任务说明的“约 1.35”是概数，指定主分析文件复算为 1.395、1.293、1.432、1.293。没有改评分规则去凑概数。

原评分器的准确率通常排除 ambiguous，话题数却包含它们。准确率高、话题数偏高可以同时发生，不能混用分母。

## 8. 复现与验证

仅新增 [fragment-buckets.py](../../eval/fragment-buckets.py)、[test_fragment_buckets.py](../../eval/test/test_fragment_buckets.py) 和本报告。预测只读，不纳入提交。

~~~powershell
$predictions = @(
  'eval/data/interleave-v0/predictions/cache-5e36590a72d5/none-open.jsonl',
  'eval/data/interleave-v0/predictions/cache-5e36590a72d5/none-closed.jsonl',
  'eval/data/interleave-v0/predictions/cache-26e14a000b7e/none-open.jsonl',
  'eval/data/interleave-v0/predictions/cache-26e14a000b7e/none-closed.jsonl',
  'eval/data/interleave-v0/predictions/cache-5e36590a72d5/compact-open.jsonl',
  'eval/data/interleave-v0/predictions/cache-5e36590a72d5/compact-closed.jsonl'
)
py eval/fragment-buckets.py eval/data/interleave-v0/sessions.jsonl @predictions --split dev
py eval/fragment-buckets.py eval/data/interleave-v0/sessions.jsonl @predictions --split test --json
~~~

也支持 --split all。表格给桶数、比例和后续 KEEP；JSON 给出生点、原文、当时标题、轨迹、时间特征、跟随索引、每会话计数和输入 SHA-256。脚本不创建评分旁文件，不改输入。

先写测试，再确认缺少脚本时失败，之后实现。新增测试覆盖 A、B 四个必需子类、C、D、跟随计数、正常首次新建、晚出现主标签、未匹配线程、closed 主话题未使用、翻页、缺轨迹、输入校验和多文件 CLI。合法首话题 KEEP 另有测试，避免当成错误传播。

- py -m unittest discover -s eval/test：123 项通过，新增 23 项。使用默认 Python 3.14。
- node --test eval/test/*.test.mjs：默认进程隔离被沙箱拦住，9 个文件均报 spawn EPERM，未执行到断言。
- node --test --test-isolation=none eval/test/*.test.mjs：同一套测试进程内运行，62 项通过，0 跳过。Node v24.21.0。
- 六文件分别执行 dev/test 表格和 all JSON，输入完整性与 12 组评分器核对通过。

TemporaryDirectory 生成的 Windows ACL 不允许本沙箱令牌进入，切换目录或 Python 版本也未解决。新测试沿用仓库 test_private_real.py 的普通工作区临时目录方式，并检查清理路径。未改系统权限或现有测试。Node 的替代命令也未改用例。

任务文件原写“不提交”，本轮用户直接要求“验证、提交”，因此尝试只暂存这三个文件。git add 在创建 .git/index.lock 时被 Permission denied 拒绝；当前环境的 .git 为只读。未暂存、未产生提交，也未推送或发布。没有请求弹窗确认或更改权限。

输入指纹用于复查同一批文件；完整路径见第 1 节。

| 文件 | SHA-256 |
|---|---|
| sessions.jsonl | be37451e752841c6eea81c5c71dca2c82b6198cbe258f440e559deabef4a25a6 |
| cache-5e36590a72d5/none-open.jsonl | e46eece3f3fbb9a5338445f02aa62610f9bced64b817947b761c2daa8d2ab0b4 |
| cache-5e36590a72d5/none-closed.jsonl | 68785aac827d43030ffa3109a24af2ae50eac8aa68bc5da6aa8fc85222c99508 |
| cache-26e14a000b7e/none-open.jsonl | cbc77da8bb5373cbf2e77347333e11772a65b86b011dde15f8195f9ccced259c |
| cache-26e14a000b7e/none-closed.jsonl | cbe235273033597972ee00ae6c793eda9139c0b77ae70bfccee9c030b4685152 |
| cache-5e36590a72d5/compact-open.jsonl | 78df86f86fc65a778c109616f71d999d2b7df21fbb48a8c0d4eca36023a65c39 |
| cache-5e36590a72d5/compact-closed.jsonl | 24dd35d4b85913b2e8e4575cbd2031999658de40640bbabd616ab6a263d3e757 |

## 9. 下一步结论

**“稳定身份”和“多路找回”都不是这批碎片的主要原因。** C 最大，单靠卡片或更多检索直接消除碎片的空间有限。含糊金标不等于绝对无解，但这些日志不足以证明扩大检索或重写身份能解决它。

先检查模型失败后的回退，以及插问后的自然返回。主分析有 22 个非含糊失败回退出生点，超过 B 的 14 个；一个失败还能带出 22 条 KEEP。先核查失败与回退路径，再设计如何保留归属的不确定性。这里仅给研究顺序，没有实施产品修改。

如果必须在两项中选一个小实验，先试稳定身份，关注同一任务换说法、同领域任务边界和插问后返回，不承诺总体收益。多路找回留给更大目录和确实漏候选的样本；当前 A=0，无法估算它的收益。

后续比较应同时看出生点、KEEP、任务混入和失败回退。不能只降话题数，却把不同事情硬并在一起。本轮没有运行新的模型实验。
