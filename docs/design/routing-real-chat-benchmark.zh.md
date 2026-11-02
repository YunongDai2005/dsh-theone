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