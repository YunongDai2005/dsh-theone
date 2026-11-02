截至 2026-11-02，本机评测集已生成，共 **238 条用户消息**：Claude/Codex 交错组 226 条，DSH 主聊天参考组 12 条。已完成 open/cards 假模型回放及现有评分器验证。**这些结果只证明管线可运行，不能代表真实模型的准确率、延迟、缓存收益或费用。** 本轮没有调用模型 API，也没有读取凭据文件或配置服务密钥。

正式本地产物位于 `eval/data/private-real/benchmark-20261102/`，只保存在本机，由 `.gitignore` 的 `eval/data/private-*/` 排除。没有 git add、commit、push 或对外发布；代码交由作者审查后提交。

本次新增文件为 `eval/generate-private-real.py`、`eval/lib/private_real.py`、`eval/lib/private_real_redact.py`、`eval/run-private-real.mjs`、两份 `private-real` 测试及本报告；已有文件只给 `.gitignore` 追加一行。未改动原有 `src/`、`dist/`、`eval/` 文件，未处理用户其他未跟踪目录。

数据来源和筛选结果如下。候选量是清洗后、交错选择前的数量；快照生成时间为 2026-11-02 07:21:44 UTC。本机日志会继续增长，再次生成时统计可能变化。

| 来源 | 只读格式与识别方法 | 输入规模 | 清洗后候选 | 正式评测选入 |
|---|---|---:|---:|---:|
| Claude Code | `~/.claude/projects/*/*.jsonl`；`type=user`，读取 `message.content` 的文本块，用 `sessionId`/`uuid` 去重 | 33 文件，6,293 个 user 记录 | 32 会话，664 条 | 181 条：dev 147、test 34 |
| Codex | `~/.codex/sessions/**/*.jsonl`；以 `response_item` 的 user message 为主，忽略对应 `event_msg` 镜像 | 103 文件，1,321 个 user 记录 | 34 会话，404 条 | 45 条：dev 16、test 29 |
| DSH | `~/.dsh/sessions/**/*.zstd` 是压缩的 JSONL；数据库 `~/.dsh/theone/contexts.db` 关联 `routing_events`、`route_details` | 10 会话文件，129 个 user/message 事件 | 2 个 gateway，12 条真实用户输入 | 12 条：dev 11、test 1；全部未确认 |

Claude 排除了 5,419 个工具来源、元消息、sidechain 或压缩标记记录，129 个来源字段明确标为任务通知/系统的记录，30 个摘要或系统文本，41 个纯粘贴，9 个没有可用文本或时间的记录，1 个清除注入后为空的记录。另跳过 1 行损坏 JSON，不输出原始异常文本。只读取顶层文本块，不读取 thinking、工具参数或工具结果作为用户语料。

Codex 排除了 54 个 subagent/guardian 会话中的 764 条 user 记录，以及 15 个执行器或任务简报会话中的 77 条记录；还排除了 61 个纯注入、11 个摘要/系统文本、3 个纯粘贴和 1 条重复用户记录。28 个 event 用户镜像没有再次计入，218 个重复助手事件被去重。`source=exec`、`originator=codex_exec`、subagent 元数据，以及首批有效输入中的任务文件/派发特征，都会使整段 Codex 会话被排除。

DSH 使用 Python 3.14 的 `compression.zstd` 在内存解压，未导出原始日志。数据库用 `mode=ro&immutable=1` 和 `query_only` 打开；本机 WAL 为零。脚本遇到非空 WAL 会拒绝读取，避免静默漏掉最近纠正，也不修改源库。只接受 gateway 内 `source.kind=user` 且能关联路由的输入；排除了其中 32 个注入或转发事件和另外 8 个非 gateway 会话，避免把工作会话的转发副本当成新用户消息。

数据库中有 12 条路由，`corrected_to` 非空的记录为 **0**。生成器已实现“用户纠正优先于原落点”，并用人工数据验证了该分支；这不等于本机已有纠正金标。当前 DSH 全部使用原落点，标为 `gold.confidence=unconfirmed`、`ambiguous=true`，独立保存在 `gateway.jsonl`。现有评分器因此给出严格准确率 `null`，没有混入交错组的准确率。

所有文本都先在内存脱敏，之后才截取摘要或写文件；输出写入层还有第二次递归脱敏。占位符保留类别和长度量级，不保存原始值。提供商密钥覆盖 `oc_sk_`、`sk-`、`sk-ant-`、GitHub 与 Slack 指定前缀、AWS 访问键；同时覆盖 Bearer、JWT、PEM 私钥、长十六进制/base64 串、密码/token/api_key 等赋值、URL 用户密码、邮箱、国内及常见国际电话号码。Windows（包括双反斜杠写法）及 Unix 用户主目录归一化为 `~`。

以下命中数来自所有通过来源筛选的候选文本及可见助手文本的脱敏阶段，早于最终取样。它们是替换次数，不是唯一密钥数；工具/系统消息体未为统计而额外扫描。

| 类别 | 命中次数 |
|---|---:|
| 提供商/AWS 密钥 | 1 |
| Bearer | 1 |
| JWT | 0 |
| 长十六进制串 | 1,375 |
| 长 base64 或类似令牌串 | 6,663 |
| 凭据赋值 | 338 |
| 邮箱 | 237 |
| 电话号码 | 0 |
| 用户主目录 | 2,885 |
| PEM 私钥 | 0 |
| URL 用户密码 | 0 |

长串规则比较保守，哈希、较长标识符或路径也可能被遮盖，可能削弱路由线索。零命中不表示相应类别不存在于整台机器。测试中的密钥均由人工片段拼接生成；未从真实记录复制测试样例。

粘贴标签、围栏代码和附件内容不进入文本，最多保留 `[PASTE]`、是否有附件及脱敏后的块长度。纯粘贴或仅有图片的输入被排除。普通文本中没有边界标记的粘贴内容无法完整识别，仍属于剩余风险。助手可见文本最长保留 200 个字符，不使用隐藏推理，也不保留完整助手回答。

交错组采用以下构造规则：每个源会话作为一个近似话题；从时间区间有共同交集的 2–5 个会话构造消息流，按真实时间排序，只取共同活动区间内的用户输入。每个话题的最初用户请求作为历史预热，不计入评测；卡片标题/摘要只由这条过去请求截取，不导入最终会话标题或未来总结。最终得到 10 条流，其中 8 条含 2 个话题、2 条含 3 个话题；场景均为真实窗口并行工作的时间交错。

66 个清洗后源会话共有 1,068 条消息，其中 5 个单条会话不能参与交错。剩余 61 个会话的 1,063 条消息里，2 个跨切分边界的会话（24 条）被排除；37 个会话没有找到满足共同区间且双方都有可评测输入的组合。最终使用 22 个源会话，保留 226 条。未选入的另外 813 条属于无法组成可用重叠流、预热或共同区间外的消息。没有为了填满 2,000 条预算制造对话或强行交错不重叠的窗口。

时间边界为 **2026-10-26 12:36:30.136 UTC**（北京时间 20:36:30.136）。交错组 dev 有 6 条流、163 条消息；test 有 4 条流、63 条消息，源会话互不交叉。DSH 的长 gateway 按同一边界切成 3 个片段，合起来保持原始消息顺序，12 条消息不重复、不丢失；同一历史 gateway 可以出现在两个片段中，所以 DSH 不宣称会话独立性。

每条输入都有 `events_before`。交错组前台来源取严格早于该输入的最近一条可见助手文本，与当前输入的金标无关；226 条均有此状态。只有真实回复时间落在当前输入和下一条全局输入之间时，才填 `reply`，避免回放器提前看见尚未发生的回复。没有生成 `input.reply_to`、`pending_response`、`steering_of` 等用户引用。

多窗口记录没有真实的统一前台焦点日志，因此上述前台状态是按时间合并后的模拟观察，不是历史 UI 焦点的直接测量。DSH 助手源记录也没有可靠的话题 ID，当前根据此前同 gateway 的原始路由推断来源；2 条输入缺少可归属的此前回复，保留空 `events_before`，没有编造状态。DSH 卡片使用中性话题描述，历史卡片内容及创建时刻无法完整恢复，因此 DSH 也不是原运行环境的精确重演。

标签分布如下；`short` 使用裸续接词表或极短长度规则，`switch` 表示相邻输入来自不同话题，语言是逐条文本的粗略中/英分类（混合文字归中文）。

| 标签 | 交错组（226 条） | DSH 参考组（12 条） |
|---|---:|---:|
| short | 36（15.93%） | 6（50.00%） |
| switch | 41（18.14%） | 3（25.00%） |
| has_paste | 12（5.31%） | 0 |
| lang:zh | 211（93.36%） | 11（91.67%） |
| lang:en | 15（6.64%） | 1（8.33%） |
| short 且前台来源与会话金标不同 | 5 | 3 |

交错组的短输入仍然照常计分，没有因为缺乏语义线索而排除。对候选会话内的 1,002 对相邻输入，启发式检查发现 1 对有明显转题措辞（约 0.10%），147 对较长输入词面重叠很低（约 14.67%）。后一数值是需要人工复核的疑似规模，不是实际换题率；没有逐条人工确认或语义模型标注。因此“单窗口近似一个话题”的噪声仍未解决。

兼容性直接使用当前 `routing-v1` 校验器和 `eval/score.py`，无需修改已有回放或评分文件。新增 `eval/run-private-real.mjs` 调用已有 `routeSession`、`createClient` 和同一个假模型，只把缓存与 `os.tmpdir()` 指向所选预测文件旁的 `.cache`、`.tmp` 目录。它拒绝公开目录、路径链接逃逸、覆盖已有预测，以及没有显式执行模式的调用。`--dry-run` 禁止网络 fetch，假模型在进程内运行；`--live` 留给作者自行执行。

假模型检查使用正式目录下的 `dry-open-cards-dev.jsonl`、`dry-open-cards-test.jsonl` 和 `dry-open-cards-gateway.jsonl`，对应三个 `.score.json`。下表中的准确率仅用于确认标签分组及评分逻辑确实被执行。

| 假模型检查 | 消息数 | 严格准确率 | short 数量 / 准确率 |
|---|---:|---:|---:|
| 交错 dev | 163 | 26.38% | 25 / 36.00% |
| 交错 test | 63 | 39.68% | 11 / 36.36% |
| DSH 全部片段 | 12 | null（0 条已确认） | 6 条未确认；严格 short 准确率不提供 |

所有预测键完整，没有 `ERROR` 或缺失路由回执。评分文件里的假 token、按价目表换算的金额和进程内假模型耗时均不应当作为真实成本或性能使用；本轮实际模型 API 调用数为 0。

测试结果：新增 Python 测试 24/24，新增 Node 测试 4/4；另运行现有 routing-v1 Node 测试 18/18、现有 Python 评分测试 16/16。合计 62 项通过。测试覆盖脱敏先于截断/写盘、注入和工具排除、来源过滤、镜像去重、时间交错、无未来回复泄漏、跨集隔离、纠正金标优先、未确认排除严格评分、输出目录限制及拒绝覆盖。

环境差异由本轮自行处理：使用 `py`；评分与 Python 测试使用 `-X utf8 -B`，避免 Windows GBK 打印 `B³` 失败及生成字节码；Node 测试使用 `--test-isolation=none`。Python 3.14 的 `TemporaryDirectory` 在该沙箱中产生不可访问的目录，人工测试改用私有目录内继承工作区权限的普通目录。没有修改系统权限或启动辅助子代理。

复核代码和重新生成可使用以下命令。生成器拒绝覆盖已存在的输出目录，重新执行时替换最后的目录名。

```powershell
py -X utf8 -B -m unittest discover -s eval/test -p test_private_real.py -v
node --test --test-isolation=none eval/test/private-real.test.mjs eval/test/routing-v1.test.mjs
py -X utf8 -B -m unittest discover -s eval/test -p test_score_routing_v1.py -v
py -X utf8 -B eval/generate-private-real.py --out eval/data/private-real/author-fresh-corpus
```

下面是真实模型评测命令，**本轮未执行**。仅供作者在已有模型环境中审查后运行；不在命令或仓库里填写密钥。每次换一个输出文件名，缓存和临时文件会保留在同一私有目录。首先跑 dev，调参后再独立跑 test。

```powershell
node eval/run-private-real.mjs --data eval/data/private-real/benchmark-20261102/interleaved.jsonl --mode open --cards --split dev --live --out eval/data/private-real/benchmark-20261102/author-live-dev-01.jsonl
py -X utf8 -B eval/score.py eval/data/private-real/benchmark-20261102/interleaved.jsonl eval/data/private-real/benchmark-20261102/author-live-dev-01.jsonl --split dev

node eval/run-private-real.mjs --data eval/data/private-real/benchmark-20261102/interleaved.jsonl --mode open --cards --split test --live --out eval/data/private-real/benchmark-20261102/author-live-test-01.jsonl
py -X utf8 -B eval/score.py eval/data/private-real/benchmark-20261102/interleaved.jsonl eval/data/private-real/benchmark-20261102/author-live-test-01.jsonl --split test

node eval/run-private-real.mjs --data eval/data/private-real/benchmark-20261102/gateway.jsonl --mode open --cards --split all --live --out eval/data/private-real/benchmark-20261102/author-live-gateway-01.jsonl
py -X utf8 -B eval/score.py eval/data/private-real/benchmark-20261102/gateway.jsonl eval/data/private-real/benchmark-20261102/author-live-gateway-01.jsonl --split all
```

若要对照第七步的前台规则，可用新输出名再跑 `--state-ablation drop-bindings`，分别查看 `.score.json` 中的 `by_tag.short`。此消融会删除前台观察，仍不改变原会话近似金标。直接使用原 `eval/run-router.mjs --data ... --mode open --cards --dry-run` 也能读取该格式，但其 CLI 固定写 `eval/.cache` 并使用系统临时目录，所以本任务采用新增的私有入口执行和提供作者命令。

最终交付检查覆盖本次拟提交的 8 个文件（包含 `.gitignore`）。与 7,265 条清洗后的候选输入/助手片段比较，按去空白后的连续 48 字符检测，没有重合；更短通用用语不靠该检查判定。敏感模式命中的都是代码排序参数、长测试函数名、人工假凭据/联系方式和已知仓库路径，逐项复核后没有发现真实密钥。正式数据正文复扫没有残留敏感模式；预测/缓存中的 22 次电话模式命中来自新生成的 UUID，字段为 inputId、messageId、replyTo，并非电话。两个旧快照也已复扫，未发现残留敏感模式。报告和测试没有引用真实聊天原文。

`git check-ignore` 确认正式语料、统计和评分文件均由 `.gitignore` 第 31 行排除；`git ls-files` 的已跟踪及可见未跟踪私有文件结果均为空。`.gitignore` 的差异为新增 1 行。开始时记录的 49,254 个原有文件中，所有原有代码、测试、数据正文以及 src/dist 均未改变；另有 619 个已有 LLM 缓存及 12 个已有评测日志在工作期间变化，没有文件缺失。这些路径属于同时进行的原评测，本任务回放只写新的私有目录，因此不把这 631 个变化算作本次改动，也不对它们回滚。检查证据保存在私有目录的 `protected-verification.json`、`export-audit.json`。

自动审批策略拒绝了删除本轮 `corpus-v1`、`corpus-v2` 旧快照及 3 个空人工测试目录的清理命令，只给出 `blocked by policy`，没有更具体原因。本轮未再次尝试删除或请求确认。这些中间产物仍在被忽略的 `eval/data/private-real/` 内；正式评测只使用 `benchmark-20261102/`，不要合并旧快照重复计数。

剩余限制是：脱敏不等于匿名化，未标记的粘贴、项目名称和非主目录路径仍可能揭示个人信息；私有语料不适合公开。当前缺少用户确认的 DSH 纠正数据，交错金标和前台观察均带有建模假设；时间样本、来源比例和 short 样本量有限，不能外推用户总体表现。尚未运行真实模型，也未验证作者的 API 配置和真实延迟；没有声称获得产品性能提升。

## 第二版（2026-11-02）

最终数据目录为 `eval/data/private-real/benchmark-20261102-v2-ready/`，版本标记为 `private-real-2`。本节更新第一版的卡片、预热、评分和前台观察约定。保留原始第一版目录及作者的真实模型预测；未调用任何模型 API，未读取模型凭据文件或使用 API Key，未 commit，交由作者审查后提交。

作者发现的准确率问题已经用现有预测只读复算。原评分器将 `catalog` 中的 ID 视为必须沿用的真实已有话题，因此这些金标不能参与开放匹配；产品创建的新 ID 即使分组合理，也无法映射到预置金标。下面的“一对一”将预置和新 ID 同等处理，每条流只拟合一次匹配，short/switch 继续使用这次匹配，不对子集重新拟合。

| 第一版作者预测 | 原严格准确率 | 一对一正确数 / 总数 | short 正确数 / 总数 | switch 正确数 / 总数 |
|---|---:|---:|---:|---:|
| dev，none | 24.54% | 113 / 163（69.33%） | 17 / 25 | 13 / 26 |
| dev，drop-bindings | 40.49% | 113 / 163（69.33%） | 17 / 25 | 13 / 26 |
| test，none | 49.21% | 44 / 63（69.84%） | 7 / 11 | 6 / 15 |
| test，drop-bindings | 26.98% | 42 / 63（66.67%） | 6 / 11 | 6 / 15 |

保留或去掉状态后，一对一准确率差为 dev 0 个百分点、test 3.17 个百分点，不能据此证明前台规则的收益。旧版 22 张卡片中有 8 张的标题或摘要仍含可清除的注入；226 条评分输入中有 14 条需要继续清除注入，12 条按新版清洗规则会被整体排除。第一版用源会话编号生成话题标题，并用单条首句构造卡片，附件引用或极短首句不能充分描述任务。旧前台观察来自跨窗口时间合并，不能证明用户当时看到了哪条回复。

过滤现在覆盖 `external_codex_apps_*`、`codex_internal_context*`、`command-*`、`local-command-*`、`ide_*` 及既有宿主标签；支持嵌套同名标签、带属性的标签、属性中的大于号和已知宿主的未闭合块。未知的成对 XML 风格前缀也被移除。清除后再检查系统摘要，避免包装层被移除后露出的摘要进入语料。附件引用不读取文件正文，混合输入只保留脱敏文件名；纯附件引用整条排除，文件名可作为历史卡片线索。

以下为最终生成时、通过来源筛选后用户记录的计数；“清除块”与“整条排除”口径不同，同一消息含多种类别时类别计数可能重叠。仅列类别和数量，不展示真实内容。

| 类别 | 清除块数 | 清除后为空的记录数 |
|---|---:|---:|
| external_codex_apps 前缀 | 56 | 56 |
| codex_internal_context 前缀 | 8 | 8 |
| 其他开头成对 XML 块 | 37 | 24 |
| command 前缀 | 3 | 1 |
| local-command 前缀 | 0 | 0 |
| ide 前缀 | 0 | 0 |
| 既有宿主标签，含环境和用户指令包装 | 78 | 65 |

共 180 条记录清除了 182 个块，154 条因清除后为空而排除。附件引用命中 7 条，其中纯附件 1 条。Claude 无时间戳的标题条目排除 2,302 条；这不是 2,302 个不同会话。卡片信息不足而不能交错的会话为 1 个。

数据审计还发现跨 Claude 会话复制的历史：源、消息 ID、时间戳及脱敏文本同时相同的 9 条记录现在只保留一次。选择较早开始、较早结束的历史作为保留方，排序相同时按匿名会话 ID 稳定选择。普通重复续接语不会仅因文本相同而被去重。中间数据曾将其中 8 条同时计入两个窗口，产生虚假交错；最终数据已排除这个问题。

卡片使用共同评测区间开始前最多前 5 条有效用户消息，每条先脱敏再截到 240 字符。摘要上限 1,800 字符，标题上限 80 字符；增加脱敏后的项目目录末级名称、此前附件文件名及可证明时间的原生标题或摘要。有效信息至少需要 4 种英文词或汉字及 18 个有效字符；项目名、文件名和短续接语本身不能使空任务通过门槛。若首句过短，可用稍后的有效请求完成预热，再开始评测。

Claude 本机记录中的 `custom-title/customTitle` 没有时间戳，全部拒绝作为卡片来源；未发现可用于本轮的带时间会话摘要。Codex 的 `session_meta` 有项目路径，本机没有线程标题字段；实际线程名在 `.codex/session_index.jsonl`，包含 `thread_name` 和 `updated_at`。只在更新时间严格早于评测边界时使用，未使用文件修改时间代替内容时间。`turn_context.summary` 是推理配置，不当作会话摘要。索引共 141 条记录，关联到合格候选会话的带时间标题有 23 条；最终卡片实际使用其中 6 条。最终 20 张卡片使用 1/2/3/5 条历史请求的数量分别为 8/3/2/7，使用附件文件名线索 4 次。

评测区间从所有源会话均具备可用卡片的最早时间之后 1 毫秒开始，结束于最早结束的源会话。每张卡片的所有材料都严格早于该边界，边界内或之后的输入仍只用于评分。分组优先选择双窗口，避免第三个窗口缩短重叠区间或占用另一条可用流的配对对象；仍是确定性贪心选择，不声称全局最优。

交错组 `catalog` 为空，卡片放在独立的 `warmup` 数组。私有回放入口在同一产品运行实例中先送入预热，再处理评分消息，让产品自行创建话题；不把源会话标签作为路由指令。预热消息的 `gold.thread=null`，不会进入评分输入或匹配权重。普通预测文件只包含评分消息；预热回执另存为 `<预测文件>.warmup.jsonl`，便于审查预热调用及成本。原有 `eval/score.py`、产品回放器和 `src/`、`dist/` 均未修改。第二版必须使用 `eval/run-private-real.mjs` 回放，直接调用原入口会遗漏独立预热。

交错组标记 `observation_basis=unavailable_multi_window`，所有 `events_before`、`reply` 均为空，不提供 `current_id` 或用户绑定。回放入口会拒绝给这种数据重新加入前台事件或助手回复。产品仍会保留回放过程自身产生的状态，但这不是历史 UI 焦点证据，因此这套交错数据不用于验证第七步前台归属规则。DSH 参考组继续单独保留其推断观察和未确认标记。

最终候选包含 Claude 32 个会话、654 条去重用户消息，Codex 35 个会话、351 条消息；另有 DSH 2 个 gateway、12 条输入。交错候选中 55 个会话、989 条消息具有足够卡片和至少两条输入；1 个跨时间切分边界的会话（14 条）被排除，34 个未找到可用配对。最终采用 20 个互不重复的源会话，形成 10 条双窗口流、229 条评分消息，另有 20 条预热。989 条中的其余 760 条是预热、区间外、跨界或无法交错的输入。没有拼接无重叠的会话来填满预算。

时间切分边界为 **2026-10-26 14:57:54.650 UTC**（北京时间 22:57:54.650）。dev/test 源会话互不相交，且 dev 最晚评分时间早于 test 最早评分时间。旧版为 10 条流、226 条评分输入；新版在更严格过滤和历史去重后仍保留 10 条流、229 条。来源日志有新增，不能将两版规模之差解释为同一固定快照上的净过滤量。

| 最终集合 | 流 / 片段 | 评分或参考消息 | 独立预热 | short | switch |
|---|---:|---:|---:|---:|---:|
| 交错 dev | 6 | 135 | 12 | 23 | 10 |
| 交错 test | 4 | 94 | 8 | 31 | 12 |
| DSH 全部片段 | 3 | 12 | 0 | 6 | 3 |

合计 241 条评分或参考消息，外加 20 条预热；DSH 的 12 条均未确认，严格准确率仍为 null。交错组有 Claude 165 条、Codex 64 条，中文 218 条、英文 11 条；含粘贴或附件线索的输入为 10 条。新旧 short/switch 样本数不同，不能直接当作相同测试集比较。

项目分类只比较源会话记录的目录末级名称，不区分大小写，先计算匿名身份再脱敏显示名称，以免脱敏占位符把不同项目误合并。所有源会话在观察区间内只出现同一个目录名时标记 `project_scope=same_project`，存在多个已知名称则为 `cross_project`，缺少目录信息为 `unknown`。分类在 session 级存储，并添加对应 turn 标签，使原评分器和新诊断工具都能分别报告。报告仅给出统计，不列真实项目名。

| 分组 | dev 流 / 消息 | test 流 / 消息 | 合计流 / 消息 |
|---|---:|---:|---:|
| same_project | 2 / 7 | 0 / 0 | 2 / 7 |
| cross_project | 4 / 128 | 4 / 94 | 8 / 222 |
| unknown | 0 / 0 | 0 / 0 | 0 / 0 |

同项目的两个窗口被产品合为一个话题未必错误；本轮仍保留源会话近似金标供观察，没有用项目标签自动改金标。目录末级同名也不能证明是同一仓库，因此分类有局限。

新增只读工具 `eval/score-private-real.py` 复用现有匈牙利算法，忽略预置身份，仅以每条流全部可评分消息求一个一对一映射，然后输出总体、short、switch 和项目分组的正确数、分母及准确率。它拒绝重复、缺失、额外预测键，排除未确认或歧义输入，不修改数据、预测或旧评分文件，也不输出聊天内容或具体映射 ID。

最终假模型检查使用 `dry-v2-interleaved-dev-none.jsonl`、`dry-v2-interleaved-test-none.jsonl`、`dry-v2-gateway-all-none.jsonl`，配有原评分器生成的 `.score.json` 和只读诊断结果 `.diagnostic.json`。229 条交错预测、12 条 DSH 预测及 20 条独立预热回执均已核对，无 ERROR、错误字段或缺失回执；预测键完整，预热键与评分键不重叠。两种评分的总体正确数一致。

| 最终假模型检查 | 正确数 / 严格分母 | short | switch |
|---|---:|---:|---:|
| dev | 112 / 135（82.96%） | 23 / 23 | 4 / 10 |
| test | 63 / 94（67.02%） | 21 / 31 | 6 / 12 |
| DSH | 0 / 0（null） | 0 / 0 | 0 / 0 |

这些数值只验证回放和评分管线。假模型在全部 10 条交错流内都只给出一个预测话题，switch F1 为 0；高总体准确率来自多数类别占比，不能作为产品真实路由能力，更不能与第一版真实模型成绩比较。评分器显示的假 token、耗时和换算金额也不是实际成本或性能。预热成本未计入普通预测的每消息费用，真实评测总成本需同时审查独立预热回执。

最终验证为 private-real Python 38 项、只读评分 Python 5 项、private-real Node 6 项，加既有 routing-v1 Node 18 项和 Python 评分 16 项，共 **83 项**。新增测试均为人工样例，覆盖新注入类别、嵌套包装、附件文件名、时间不明/未来标题、短首句预热、信息不足、项目身份、复制历史去重、双窗口优先分组、预热建立产品话题及不进入评分、一对一子集匹配和预测键完整性。

复核命令如下。生成时必须指定尚不存在的私有输出目录。

```powershell
py -X utf8 -B -m unittest discover -s eval/test -p 'test_private_real*.py' -v
node --test --test-isolation=none eval/test/private-real.test.mjs eval/test/routing-v1.test.mjs
py -X utf8 -B -m unittest discover -s eval/test -p test_score_routing_v1.py -v
py -X utf8 -B eval/generate-private-real.py --out eval/data/private-real/author-v2-fresh-corpus
```

以下真实模型命令**未执行**，供作者在现有模型配置中审查后自行运行。不在命令中填写密钥；先跑 dev，再独立跑 test。输出名与第一版和本轮假模型输出均不同。

```powershell
$bench = 'eval/data/private-real/benchmark-20261102-v2-ready'

node eval/run-private-real.mjs --data "$bench/interleaved.jsonl" --mode open --cards --split dev --live --out "$bench/author-live2-interleaved-dev-none.jsonl"
py -X utf8 -B eval/score.py "$bench/interleaved.jsonl" "$bench/author-live2-interleaved-dev-none.jsonl" --split dev
py -X utf8 -B eval/score-private-real.py "$bench/interleaved.jsonl" "$bench/author-live2-interleaved-dev-none.jsonl" --split dev

node eval/run-private-real.mjs --data "$bench/interleaved.jsonl" --mode open --cards --split test --live --out "$bench/author-live2-interleaved-test-none.jsonl"
py -X utf8 -B eval/score.py "$bench/interleaved.jsonl" "$bench/author-live2-interleaved-test-none.jsonl" --split test
py -X utf8 -B eval/score-private-real.py "$bench/interleaved.jsonl" "$bench/author-live2-interleaved-test-none.jsonl" --split test

node eval/run-private-real.mjs --data "$bench/gateway.jsonl" --mode open --cards --split all --live --out "$bench/author-live2-gateway-all-none.jsonl"
py -X utf8 -B eval/score.py "$bench/gateway.jsonl" "$bench/author-live2-gateway-all-none.jsonl" --split all
py -X utf8 -B eval/score-private-real.py "$bench/gateway.jsonl" "$bench/author-live2-gateway-all-none.jsonl" --split all
```

如作者需要延续第一版状态消融的对照，下面仍提供独立输出名。但第二版交错输入没有模拟前台绑定，`drop-bindings` 不能被解释为第七步前台规则的因果实验，真实模型随机性也可能造成差异。

```powershell
foreach ($split in @('dev', 'test')) {
  node eval/run-private-real.mjs --data "$bench/interleaved.jsonl" --mode open --cards --split $split --state-ablation drop-bindings --live --out "$bench/author-live2-interleaved-$split-drop-bindings.jsonl"
  py -X utf8 -B eval/score.py "$bench/interleaved.jsonl" "$bench/author-live2-interleaved-$split-drop-bindings.jsonl" --split $split
  py -X utf8 -B eval/score-private-real.py "$bench/interleaved.jsonl" "$bench/author-live2-interleaved-$split-drop-bindings.jsonl" --split $split
}
```

只读复算第一版可使用下列命令，不会覆盖第一版 `.score.json`。

```powershell
$old = 'eval/data/private-real/benchmark-20261102'
foreach ($split in @('dev', 'test')) {
  foreach ($ablation in @('none', 'drop-bindings')) {
    py -X utf8 -B eval/score-private-real.py "$old/interleaved.jsonl" "$old/live1-interleaved-$split-$ablation.jsonl" --split $split
  }
}
```

只采用 `benchmark-20261102-v2-ready/` 作为第二版正式输入。`v2-check-01/`、`benchmark-20261102-v2/` 和 `benchmark-20261102-v2-final/` 是本轮检查期间留下的中间快照，不用于正式评测，也不要合并重复计数。所有这些目录均在既有忽略规则下，未覆盖第一版。最终审计记录在正式目录的 `verification.json`：229 条评分输入无重复观察，249 条预热及评分文本复扫没有残留敏感模式，时间和源会话隔离检查通过。对开始时记录的 1,313 个受保护文件逐一哈希复核，改变数为 0，其中第一版目录有 941 个文件。

交付前还将 8 份待审文件与 7,128 条 Claude/Codex 候选用户文本及可见助手片段做去空白后的连续 48 字符重合检查（报告只检查第二版新增部分）。报告和全部人工样例均无聊天原文重合；17 个命中窗口经逐项复核仅为既有 routing-v1 字段结构和 Node 标准导入语句，不是用户对话内容。检查结果在 `export-audit.json`、`export-review.json`；短于该长度的普通用语不由此检查证明。全程使用 shell、`py -X utf8 -B` 和 Node 非隔离测试；中文写入使用 UTF-8，没有使用子代理或 node_repl。

剩余限制：源会话仍只是近似话题，938 对相邻输入中有 160 对低词面重叠，不能把它当成实际换题率；共同时间区间仅证明会话生命周期重叠，不证明窗口持续活跃。短输入缺少前台观察时仍可能本来就不可判定。原生标题数量少，信息门槛和贪心配对都会带来选择偏差；同项目子集只有 7 条且全部在 dev，不能据此概括同项目并行效果。DSH 尚无确认纠正金标。脱敏不等于匿名化，路径、项目线索和无边界粘贴仍可能含个人信息，私有语料不宜公开。本轮只验证离线数据与工具，真实模型能力、真实成本及延迟均留待作者评测。

### 第二版真实模型结果（作者补测）

DeepSeek V4.1 Flash（OpenCode Go，`reasoning_effort: none`，open/cards），2026-11-02，数据 `benchmark-20261102-v2-ready`。两个评分器（`eval/score.py` 开放模式、`eval/score-private-real.py` 一对一映射）给出的总体正确数一致。

| 组 | 总体 | short | switch | harm/100 | $/千条 |
|---|---|---|---|---:|---:|
| dev（6 流） | 119/135 = 88.1% | 22/23 | 5/10 | 24.4 | 0.26 |
| test（4 流） | 67/94 = 71.3% | 23/31 | 7/12 | 89.4 | 0.21 |
| DSH 参考（12 条，均未确认） | 不计分 | – | – | – | 0.36 |

第一版同一模型在一对一口径下约 69%（dev 69.3%、test 69.8%），主要被注入文本和空卡片拖累；第二版 dev 明显上升，test 基本持平。

逐条看错误（只在本机看，不在此处引用原文），可以分成三类：

1. **金标本身可疑。** test 最大的一条流（54 条）里两个源会话做的是同一类工作，产品把它们合成了一个话题，贡献了 test 约四分之三的错误。目录末级名不同，所以被标成 cross_project，但实际是同一件事在两个窗口里推进。dev 最大的流也有类似的少量情况。
2. **没有前台状态时本来就判断不了的短句。** 例如“怎么样了”“跑完了吗”这类进度追问，在多窗口数据里没有“最后一条回复来自哪个话题”的状态。真实的单一主聊天里，第七步的前台/待答规则会用到这个状态，所以这部分是偏悲观的估计。
3. **真正的路由弱点：显式换题时偏向留在当前话题。** switch 子集只有约 50–58%。用户隐式提到另一件事（只说对象名、不说“回到……”）时，模型常常 KEEP。这是第七步规则覆盖不到的、需要语义判断的部分，样本还少（22 条），先记录，不据此调提示词。

另外仍有少量 Codex 附件头（以“# Files mentioned by the user”开头的块）留在评测消息里，下一版生成器应一并过滤。

### 重复跑一次：波动很大，总分不能当主指标

同一份 v2 数据、同一模型再跑一次（live3）：

| 组 | 第一次（live2） | 第二次（live3） |
|---|---|---|
| dev | 119/135 = 88.1% | 88/135 = 65.2% |
| test | 67/94 = 71.3% | 70/94 = 74.5% |

相邻两条“是否同一话题”的判断两次一致率 dev 120/129、test 87/90，路由行为本身相当稳定；总分剧烈波动来自评分结构：

- 每组被一两条长流主导（dev 一条流 73 条、test 一条流 54 条，各占一半以上）。
- dev 那条长流 70 条来自同一个源会话，只有 3 条属于另一个窗口，几乎不是“交错”。第一次产品把它全放进一个话题（得 67/73），第二次把这个长会话拆成了两三个子话题（得 36/73）。一个长会话里本来就做了好几件事，拆开未必是错，但“一个会话就是一个话题”的金标会把拆分全部记错。

所以这份真实聊天集目前更适合当**错误来源的定性样本**（看哪些真实说法会被分错），不适合当准确率主指标。要变成可用的指标，至少需要：按流加权或报告逐流中位数；只选两边消息数接近、真正来回切换的流；对长会话内部做子话题标注（或允许一个会话对应多个话题的评分口径）。


## 第三版（2026-11-02）

第三版正式数据保存在 `eval/data/private-real/benchmark-20261102-v3/`，版本为 `private-real-3`。本轮完成附件包装清理、真实往返窗口筛选、独立的混入/拆分/切换诊断、v2 两次已有预测的只读复算，以及 v3 假模型回放。**没有调用模型 API，没有读取或使用 Key，没有 add、commit、push 或对外发布；代码由作者审查后提交。** 第一版、第二版和作者的 live2/live3 文件均保留原状。

新口径确实减少了 dev 长会话内部拆分造成的分数波动，但不能据此宣布这份语料已经成为稳定的主指标：严格筛选后只有 **2 条流、44 条评分消息**，dev/test 各一条流。工具和数据约束已落实，统计规模仍不足；没有为扩大规模放宽门槛。

本轮修改 `eval/lib/private_real.py`、`eval/score-private-real.py`、两份既有 private-real Python 测试及本报告，新增 `eval/lib/private_real_blocks.py`、`eval/lib/private_real_metrics.py`、`eval/test/test_private_real_v3.py`。生成器和私有回放入口直接复用；`src/`、`dist/`、`eval/score.py` 及其他原有 eval 文件没有修改。

过滤新增了已知 Markdown 宿主结构：附件列表头、附件描述段、IDE 的活动文件/打开标签页区段和配套请求标记。文件描述和目录路径被移除，只保留先脱敏再截断的文件名；真正的用户请求和普通 Markdown 章节继续保留。没有请求标记时，仅消费可识别的文件列表，不吞掉后续普通段落。代码围栏内的示例不当作宿主块；附件名也不能使纯粘贴变成有效用户请求。既有 XML 宿主包装过滤继续生效。

下表来自正式快照在来源筛选后的用户记录，早于取样；清除块数和整条排除数分开统计，不包含助手文本的清理次数。快照时间为 **2026-11-02 09:25:07 UTC**。

| 新增过滤类别 | Claude | Codex | DSH |
|---|---:|---:|---:|
| 附件说明块 | 0 | 9 | 0 |
| 随附件块移除的请求标记 | 0 | 9 | 0 |
| IDE Markdown 上下文块 | 0 | 0 | 0 |
| 命中新规则的用户记录 | 0 | 9 | 0 |

9 条均保留了真实请求，不是排除 9 条消息。旧 v2 评分输入中残留附件头的有 3 条；复算旧预测时没有修改这些输入。v3 全部评分/预热/卡片文本已复扫，相关自动头残留为 0。候选总量仍为 Claude 32 个会话、654 条消息，Codex 35 个会话、351 条消息。文件名线索仍可能透露项目含义，脱敏不等于匿名化。

选流现在固定为双源会话的真实时间窗口。每个源在一条流中至少 **5 条评分消息且占比至少 20%**，相邻来源真正改变至少 **3 次**，每流最多 **40 条评分消息**；预热不占这些配额。拒绝跨来源的同时间戳输入造成的不可判定顺序。只从双方均有合格历史卡片、且会话生命周期共同覆盖的区间内取连续片段，不重新排列、补写或跳过片段内部消息。

枚举满足条件的连续窗口，按消息数、切换数、时间及匿名身份确定性排序，贪心选取。长会话可以在同一 split 内贡献多个片段，但按来源、原观察 ID 和时间全局去重，一条观察最多评分一次；重复历史预热仍不评分。余下预算容不下窗口时跳过，不截断成失衡短流。dev/test 时间边界按合格窗口的去重观察覆盖量选择，目标约 70/30；整段跨界源会话仍排除，保证源会话不跨集合。该算法不声称全局最优。

55 个卡片合格候选会话有 989 条消息，产生 45 个合格候选窗口；最终取 2 个互不重叠窗口，另外 43 个与已选观察重叠。使用 4 个独立源会话，44 条评分消息；其余 945 条未进入评分，含预热、区间外、不能组成合格交错以及跨界输入。跨时间边界排除了 1 个会话、22 条消息。边界为 **2026-10-29 05:26:18.228 UTC**，dev 最晚评分时间严格早于 test 最早评分时间。

| 集合 | 流/片段 | 评分或参考消息 | 每源评分数量 | 独立预热 | short | switch |
|---|---:|---:|---|---:|---:|---:|
| 交错 dev | 1 | 25 | 19 / 6 | 2 | 7 | 4 |
| 交错 test | 1 | 19 | 14 / 5 | 2 | 4 | 7 |
| DSH 参考 all | 3 | 12 | 不适用 | 0 | 6 | 3 |

交错消息含 Claude 38 条、Codex 6 条；中文 43 条、英文 1 条；两流都为 `cross_project`。DSH 全部未确认，独立保留，既不参加新选流约束，也不进入严格指标分母。交错数据继续不提供模拟前台观察、回复或用户绑定，不用于证明前台归属规则的收益。

只读工具沿用 `eval/score-private-real.py`，扩展诊断字段并保留旧接口；仅向标准输出写不含正文和具体话题 ID 的汇总 JSON，不改输入、预测或旧评分文件。指标定义如下。

- **跨会话混入率**（`cross_session_mixing`）：在每条流的全部可评分消息上，按预测话题统计来源组成；只有某来源严格超过该话题消息数的一半，才确定其归属。落入“归属另一来源”的消息数除以全部可评分消息数。一个来源对应多个纯净话题不会增加混入。它是回顾性组成指标，不是逐条在线归属判定。
- 平票或没有过半来源的消息计入 `unresolved`，ERROR/CLARIFY 计入 `invalid`，都不冒充正确路由；分母仍保留这些消息。另给 `minority_impurity`，即每个有效预测话题的消息数减去最大来源数后求和，便于发现平票混合。混入率为 0 必须结合这三个计数看，不能把未定归属或无效路由当成干净话题。
- **会话内拆分**（`fragmentation`）：每个“源会话在一条流中的实例”触及多少个有效预测话题，报告平均数、中位数、最大值、拆成多个话题的实例数和完整数量直方图；无效路由不算话题。另给该来源实际占多数的话题数直方图，区分拆分与落入别人话题。它独立呈现，不并入错误率。源会话若贡献多条流，会作为多个实例统计，不冒充独立用户样本。
- **切换正确率**（`switch_routing`）：只检查带 `switch` 标签的可评分消息。必须离开紧邻前一条消息的预测话题，且进入仅用当前消息之前的评分历史确定、由目标来源占严格多数的话题；若此前没有这样的目标话题，才允许创建历史中未出现的新话题。当前及未来输入不能反过来证明这次选择正确。有已有归属话题却重新建一个纯净话题，混入可为 0，但这次切回仍不正确。
- 切换还分为 `first` 与 `returning`。前一条被排除或无有效落点时，记 `unassessable`，仍留在 switch 分母且不计正确，不能跨过它连接到更早输入。预热没有可验证的来源归属，因此不借它认定历史话题；这里的“首次/返回”以评分序列为准，不能检验首次评分输入是否找回预热话题。
- **一对一匈牙利准确率**继续对每流全部可评分消息只拟合一次，再复用给 short/switch 和项目子集；保留按消息加权总分，新增 `stream_accuracy.mean`（每流等权平均）、`median`（逐流中位数）和 `per_stream`。混入率和切换正确率也附带逐流均值/中位数。没有严格可评分输入的流不参与均值，分母为 0 的指标返回 null。

所有指标均排除歧义、未确认、无金标输入及受消融影响且要求用户引用的输入。每条预测键的完整性和重复检查保持不变。旧 `switch` 字段仍是一对一映射下的子集准确率，**不能与新 `switch_routing` 混用**。

使用作者的同一份 v2 输入和已有 live2/live3 预测进行只读复算，未重新调用模型。下表百分数保留两位，变化为百分点。

| v2 集合/轮次 | 一对一按消息总分 | 一对一按流平均 | 一对一逐流中位数 | 跨会话混入 | 新切换正确率 |
|---|---:|---:|---:|---:|---:|
| dev live2 | 119/135 = 88.15% | 84.44% | 85.89% | 9/135 = 6.67% | 2/10 = 20.00% |
| dev live3 | 88/135 = 65.19% | 77.36% | 76.67% | 9/135 = 6.67% | 2/10 = 20.00% |
| test live2 | 67/94 = 71.28% | 79.74% | 78.00% | 23/94 = 24.47% | 5/12 = 41.67% |
| test live3 | 70/94 = 74.47% | 85.24% | 89.00% | 24/94 = 25.53% | 4/12 = 33.33% |

**dev 的混入率变化为 0，旧总分变化为 22.96；test 的混入率变化为 1.06，旧总分变化为 3.19。** dev 的一对一按流均值变化缩小到 7.08，但 test 的按流均值变化为 5.50、中位数变化为 11.00，并非所有汇总方式都会更稳。新切换指标在 test 相差一条，也会变动 8.33 个百分点；没有声称它必然比旧总分稳定。这两轮证据支持将跨会话污染与会话内拆分分开看，不能证明总体方差或模型改进。

| v2 集合/轮次 | 每源话题数均值 | 中位数 / 最大值 | 触及话题数分布（话题数:来源实例数） | 返回正确数 |
|---|---:|---:|---|---:|
| dev live2 | 1.250 | 1 / 3 | 1:10，2:1，3:1 | 0/4 |
| dev live3 | 1.417 | 1 / 5 | 1:10，2:1，5:1 | 0/4 |
| test live2 | 1.500 | 1 / 3 | 1:5，2:2，3:1 | 3/8 |
| test live3 | 1.375 | 1 / 2 | 1:5，2:3 | 2/8 |

四份复算结果的 `unresolved`、`invalid`、`unassessable` 都为 0。dev 按流平均混入率两次都是 9.74%，test 为 12.26% → 14.76%。首次来源切换正确数 dev 两次都是 2/6，test 两次都是 2/4。完整计数及逐流结果保存在 v3 目录的 `v2-live2-dev.v3-diagnostic.json`、`v2-live3-dev.v3-diagnostic.json` 及对应 test 文件；这些是旧预测的新分析，没有覆盖旧目录。

v3 假模型回放使用 `dry-v3-interleaved-dev-none.jsonl`、`dry-v3-interleaved-test-none.jsonl`、`dry-v3-gateway-all-none.jsonl`。共 56 条评分/参考预测和 4 条独立预热回执；键完整且不重复，预热键与评分键分离，无 ERROR、错误字段或缺失路由回执。两条交错流均被假模型合成单一话题，因此新指标准确暴露了混入和切换失败。

| 假模型集合 | 一对一正确数 | 混入数 / 分母 | 每源话题数均值 | 新切换正确数 |
|---|---:|---:|---:|---:|
| dev | 19/25 = 76.00% | 6/25 = 24.00% | 1 | 0/4 |
| test | 14/19 = 73.68% | 5/19 = 26.32% | 1 | 0/7 |
| DSH | 0/0，null | 0/0，null | null | 0/0，null |

每个交错 split 只有一流，因此该组的一对一均值、中位数等于总分。原 `eval/score.py` 的总体正确数与新工具一致；旧评分输出保存在对应 `.score.json`，新诊断在 `.diagnostic.json`。上述数字仅证明离线管线及指标工作；假 token、耗时和换算金额均不代表真实费用或性能。本轮模型 API 调用数为 0。

验证覆盖 private-real Python **60 项**、既有 Python 评分 **16 项**、private-real/routing-v1 Node **24 项**，合计 **100 项通过**。人工样例验证附件脱敏、正文边界、纯附件/纯粘贴排除、代码示例保护、派发任务排除、每源数量与占比、真实切换、同时间戳拒绝、40 条上限、多片段不重复计分、预算不破坏门槛、时间/源会话隔离，以及混入、纯拆分、平票、无效预测、只用过去历史的切回和逐流统计。两个旧选流测试的样本扩大到满足新门槛，仍验证原来的配对与隔离行为。新增失败样例均先复现失败再修复。

正式语料的筛选约束、44 个评分观察唯一性、预热先于窗口、源会话/时间隔离和预测回执检查记录在 `verification.json`。以最终代码再次在内存生成并比较，`interleaved.jsonl`、`gateway.jsonl` 与正式文件完全一致，见 `generation-verification.json`；未额外落盘原始候选。语料及预测字符串复扫没有残留敏感模式，自动头残留为 0。工作开始时记录了 2,237 个原文件的哈希，复核未发现授权范围外变化；其中包括 src/dist、原评分器、第一版、第二版及已有真实预测。所有新语料、预测和审计记录只位于既有忽略规则下的 `eval/data/private-real/`。

交付文件另与 7,132 条脱敏候选用户/可见助手及元数据片段进行去空白后的连续 48 字符重合检查，报告仅检查第三版新增内容。6 个命中窗口均为既有 routing-v1 字段结构；报告和新增人工样例没有聊天原文重合。敏感模式命中经复核属于代码变量、长测试名、已知路径和人工假凭据/联系方式，未发现真实凭据。记录见 `export-audit.json`、`export-review.json`；此检查不证明短文本或语义上的匿名性。

复核命令如下；生成时仍必须使用尚不存在的目录。

```powershell
py -X utf8 -B -m unittest discover -s eval/test -p 'test_private_real*.py'
py -X utf8 -B -m unittest discover -s eval/test -p test_score_routing_v1.py
node --test --test-isolation=none eval/test/private-real.test.mjs eval/test/routing-v1.test.mjs
py -X utf8 -B eval/generate-private-real.py --out eval/data/private-real/author-v3-fresh-corpus

$old = 'eval/data/private-real/benchmark-20261102-v2-ready'
foreach ($split in @('dev', 'test')) {
  foreach ($run in @('live2', 'live3')) {
    py -X utf8 -B eval/score-private-real.py "$old/interleaved.jsonl" "$old/$run-interleaved-$split-none.jsonl" --split $split
  }
}
```

以下真实模型命令**本轮未执行**，留给作者在已有模型环境中审查后运行；输出名与所有旧预测、假模型预测都不同。不把密钥写进命令或仓库。按 dev、test 顺序执行；要观察重复波动时，将输出后缀 `01` 改成 `02` 再完整跑一轮，不能覆盖或拼接两轮预测。普通预测与 `.warmup.jsonl` 的真实调用成本应分别审查后合计。

```powershell
$bench = 'eval/data/private-real/benchmark-20261102-v3'
foreach ($split in @('dev', 'test')) {
  $prediction = "$bench/author-live-v3-interleaved-$split-01.jsonl"
  node eval/run-private-real.mjs --data "$bench/interleaved.jsonl" --mode open --cards --split $split --live --out $prediction
  if ($LASTEXITCODE -ne 0) { throw 'Replay failed; inspect the private output before continuing.' }
  py -X utf8 -B eval/score-private-real.py "$bench/interleaved.jsonl" $prediction --split $split
  py -X utf8 -B eval/score.py "$bench/interleaved.jsonl" $prediction --split $split
}

# Optional: unconfirmed DSH reference only; it does not enter strict accuracy.
node eval/run-private-real.mjs --data "$bench/gateway.jsonl" --mode open --cards --split all --live --out "$bench/author-live-v3-gateway-all-01.jsonl"
py -X utf8 -B eval/score-private-real.py "$bench/gateway.jsonl" "$bench/author-live-v3-gateway-all-01.jsonl" --split all
```

环境差异已自行处理：使用 `py -X utf8 -B` 和 Node 非隔离测试，中文按 UTF-8 读写；所有执行通过 shell，没有子代理、node_repl、交互选择或确认提示。没有改动账户设置、读取凭据文件或启动真实评测。

剩余限制：两流不足以估计逐流稳定性，尤其每个 split 仍只能由一流决定分数；40 条上限解决超长流权重失衡，但无法凭空增加独立样本。时间窗口仍仅证明生命周期重叠，没有更强的活动间隔约束；确定性贪心和近似 70/30 切分也会带来选择偏差。源会话是窗口身份近似金标，同一任务跨窗口时混入仍可能是合理合并；会话内部实际子话题未经人工标注。评分序列的返回检测不覆盖预热话题身份，短输入缺少前台观察的问题仍在。拆分虽独立展示，过度创建纯话题仍需结合返回正确率和拆分分布判断。只有两次旧预测，不能把本轮差值当作统计置信度。DSH 无确认金标；未知宿主包装、未标记粘贴和项目线索仍需审查。第三版真实模型表现、延迟与成本均未测试。

### 第三版真实模型结果（作者补测，两轮）

DeepSeek V4.1 Flash，同一份 v3 数据并行跑两轮（v3a、v3b）。

| 组 | 一对一 | 跨会话混入 | 切换正确（新口径） |
|---|---|---|---|
| dev v3a / v3b | 23/25、20/25 | 8.0%、16.0% | 1/4、0/4 |
| test v3a / v3b | 14/19、14/19 | 26.3%、26.3% | 0/7、0/7 |

逐条看（只在本机看，不引用原文）：两条流里的两个窗口都属于同一个大项目（一条是同一产品的两块工作，另一条是同一产品的路由评测和界面设计），产品几乎每条都 KEEP 在当前话题，理由写的都是“承接当前……话题”。被判错的切换句大多是很短的、回应另一个窗口刚给出的回复的话（同意、让它继续跑、交代自己要离开等）。多窗口数据里没有“用户刚看到哪个窗口的回复”这一状态，这类句子单看文字本来就无法判断；在真实的单一主聊天里，它们正是第七步前台/待答规则处理的情形。

结论：

- 这份多窗口语料能稳定测出“会不会把两件事混进一个话题”（test 两轮混入率完全相同），但**测不了切换**：切换句缺少前台状态，金标又按窗口而不是按事情划分。不应据此调路由提示词。
- 真实聊天里最有价值、也最缺的是 **DSH 主聊天里用户亲手纠正过的路由**（目前 0 条）。日常使用 TheOne 时随手把分错的消息改到正确话题，就会自然积累出带金标、带真实前台状态的样本；生成器已经支持“纠正优先”的金标。
