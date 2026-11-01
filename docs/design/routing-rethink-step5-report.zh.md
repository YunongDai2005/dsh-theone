# 路由重想第五步：可回放的事件数据与定向评测

2026-11-01 · `routing-depth` · 起点 `67b40fa`

结论：补充了独立标记的 routing-v1 格式、确定性中英定向集、自然措辞生成入口、真实产品事件回放和对应评分。提交候选数据为 **256 段会话、448 条用户消息、48 组成对案例**。纠正通过产品 HTTP API 执行；重启会关闭整个运行时，再使用同一数据库重建；卡片、关键词、事实的撤回都有可检查的前后快照。现有 8 份 v0 预测的文件哈希、完整评分对象和序列化评分哈希保持一致。

产品当前没有将“回复某条消息”“回答指定宿主问题/审批”传入分类器的绑定入口；已有 shadow API 只是观察记录。因此本轮保留这些输入并明确报告缺口，没有借 gold、修改 currentId 或直接指定路由来冒充绑定成功。同轮补充走真实 `gateway.steer`；其送达与是否跳过模型分类是两件事。

本轮不改 `src/` 的产品行为，不调用真实模型 API，不查找或读取凭据。假模型的准确率、token、耗时和美元显示只用于检查管线，不能作为真实产品收益。任务文件明确要求“不要 commit”，当前沙箱 `.git` 也只读；本轮不暂存、不提交、不推送或发布，作者提交命令见末尾。

## 1. 格式、兼容与字段理由

旧 `eval/generate.mjs` 已经将事实生命周期数据叫作 `interleave-v1`。为了保留旧格式，本轮保留 `version`，另加 **`routing_schema: "routing-v1"`** 作为事件回放和新评分的唯一开关。没有该字段的 v0 和旧事实 v1 沿用原路径。旧事实生成器在输出目录包含 routing-v1 数据时会在调用模型前拒绝覆盖；生成事实数据时须另选目录。

| 层级/字段 | 含义和设计理由 |
|---|---|
| `session_id / split / lang` | 沿用预测键与语言分组；预测键仍为 `(session_id, i)`，缺失、重复、未知键均报错 |
| `routing_schema` | 区分事件格式和已经存在的事实 v1，避免仅靠目录或 version 猜测 |
| `catalog` | 真正传入产品初始化的描述符；每项保留 id、title、summary、entities、keywords、lastState。预置目录在 open 模式也保留 |
| `current_id` | 可选初始挂载状态，是观测输入，不能从 gold 反推；只在首次启动挂载，重启不得重新覆盖数据库内的焦点 |
| `template_group / scenario / generation` | 记录模板家族、机制与模板/模型措辞来源，便于分母检查和避免把模板输出称作自然采集数据 |
| `pair` | 指定组 id、左右 side、只允许变化的 event id/字段以及评测 turn；校验器要求两侧的文本、其他事件、目录、时间、split 完全相同 |
| `turn.at` | ISO 时间戳，允许隔日输入。校验顺序并导出；没有修改产品时钟，不据此宣称验证了衰减或隔日活跃度 |
| `events_before` | 按数组顺序在用户输入前应用事件，可在下一条之前精确纠正、重启，不把事件本身伪装成需要分类的用户消息 |
| `foreground` | `id / topic_id / text`，用户看到的消息来源；与后台完成事件区分 |
| `pending` | `id / owner_id / kind(question 或 approval) / message_id`，有宿主请求身份和拥有者，不能靠问号推断 |
| `background` | `topic_id / text / visible:false`；作为后台观察记录，不推进前台焦点 |
| `correction` | `turn_i / target_topic_id / text`；代表用户明确给出的目标话题，调用产品纠正 API，不读取评测 gold 来决定目标 |
| `restart` | 真正销毁并重建插件/DSH 运行时，同一目录、同一数据库、持久化会话继续使用；重建后的主聊天实例是新的 |
| `input.reply_to / pending_response` | 引用已经出现的前台消息或请求 id，不把短句自动解释为“最近一个问题的回答” |
| `input.steering_of` | 引用紧邻的上一条普通输入，驱动在真实 Worker 回复过程中调用 steer；暂不接受多个补充、补充中的事件或补充接补充 |
| `reply` | 定向集提供的可见助手文本；不根据 gold 生成 Worker 内容 |
| `worker_actions` | 显式的确定性 Worker 工具脚本，仅允许 `theone_record / theone_update_state`。用真实工具写入事实/状态，以便撤回测试有实际污染可观察；不是模型自主执行能力验证 |
| `gold.explicit_binding` | 该输入是否理应由明确来源绑定；子集准确率与当前入口可用程度分别报告 |
| `gold.retract` | 应撤回的旧 turn、原话题、检查标记。动态误建话题用 `from_topic_id:"$routed"` 引用该 turn 的真实预测 id，不预填随机产品 id |
| `ambiguous / gold.refs` | 保留 v0 严格/宽松评分与合法跨话题引用；故意缺少项目线索的错误起点标为 ambiguous，避免当作无歧义分类正确率样本 |

`eval/lib/routing-v1.mjs` 校验目录、事件类型/身份、悬空引用、向未来纠正、时间顺序、gold、受限工具脚本和成对不变量。所有用户消息都有明确绑定标注和撤回列表（可为空）。

## 2. 定向集组成与划分

数据在 `eval/data/interleave-v1/sessions.jsonl`，manifest 记录计数和数据 SHA-256：

`aa5d702ae8ccfa157f9561683d9eb691c6ce7e8e1c822014ff8dd7c48b27dc5e`

默认 8 个变体，各生成中英版本；变体 0–5 为 dev，6–7 为 test。**成对两侧以及同一变体的中英文和各机制全部留在同一个 split**。dev 192 段/336 条；test 64 段/112 条。不是从真实用户日志收集，也不是独立自然样本：两个语言版本和同模板有相关性，留出集只有 2 个变体组。

| 机制 | 会话数 | 用户消息数 | dev/test 会话数 |
|---|---:|---:|---:|
| 同句短话，只改前台来源 | 32 | 32 | 24 / 8 |
| 同句短话，只改宿主问题拥有者 | 32 | 32 | 24 / 8 |
| 同句短话，只改审批拥有者 | 32 | 32 | 24 / 8 |
| 前台工作被后台完成事件插播 | 16 | 32 | 12 / 4 |
| 同轮 steering | 16 | 32 | 12 / 4 |
| 误投已有话题、纠正、重启后再继续 | 16 | 48 | 12 / 4 |
| 误建话题后纠正，观察初始关键词撤回 | 16 | 32 | 12 / 4 |
| 保存后隔日重启恢复 | 16 | 32 | 12 / 4 |
| 24 个同域相似话题，含具体返回和弱线索返回 | 16 | 48 | 12 / 4 |
| 跨项目同名 report.csv | 16 | 32 | 12 / 4 |
| 合法跨话题引用，主工作不切换 | 16 | 16 | 12 / 4 |
| 一次性算术插问后返回原工作 | 16 | 48 | 12 / 4 |
| 明确新任务 | 16 | 32 | 12 / 4 |
| 合计 | 256 | 448 | 192 / 64 |

明确绑定应有样本 112 条：前台/问题/审批 96 条，steering 16 条。48 组配对全部是相同用户文本、相同 currentId 和目录，只改声明的拥有者及该条 gold。问题/审批同时保留另一个待答请求，不能只按“存在待答”来猜归属。

数据生成不需要模型。`--templates --out 新目录` 可重复生成同样字节；CLI 拒绝覆盖已有 sessions.jsonl。自然措辞入口在独立的 `eval/generate-routing-v1.mjs`：把模板结构作为计划，仅接受模型返回 text/reply；成对短句锁定、每组只写一遍再用于两侧；事件、gold、split、工具脚本不接受模型修改。缺行、重复行、丢失事实证据/项目名/指定对象会报错，不把空值当作成功。模型措辞仍需人工语义审查。

## 3. 回放如何接到产品

`product-replay.mjs` 的 v0 分支仍使用原流程；routing-v1 使用单独事件驱动器，同样实例化实际 `dist/index.js`、DSH AgentLoop、SessionStore、JSONL 持久化和 SQLite 查询服务，只替换模型传输。

- **纠正**：通过真实 `HostConnectionService` 的浏览器 peer 调用 `POST /api/theone/routes`，传实际消息 id 和事件声明的目标；等待学习/Worker 收尾，再读取快照。没有直接调用 store 的搬移方法来绕过产品 API。
- **重启**：等待完成、flush 主聊天、dispose 整个 Context；随后创建新 Context/插件实例，复用 contexts.db、shadow.db、work.db、fts.db 和 sessions 目录。输出记录前后 instance 号及 reused_database，不是清空内存变量冒充重启。
- **大目录**：初始化时使用实际 catalog，调用实际候选检索、初判、复核、目录分页复查。测试验证 24 个条目进入产品、首批 16 个候选、剩余页确实调用且导出每页候选。
- **同轮输入**：在 Worker 模型开始回答的边界暂停，调用原生 `gateway.steer` 后继续。产品可以先分类再转发。若没有独立 RouterReceipt，输出 `receipt_missing:true`，预测来自实际 Worker 请求的会话与其工作话题对应关系；保留实际传输调用，无法从回执还原的层级标作 `unattributed`，不制造 receipt。
- **前台/后台/待答**：使用产品现有 `RoutingShadow.record/openPending` 记录观察，输出 `shadow-only`。这些入口不构造路由请求。回复对象和待答响应输出 `binding.unsupported`，不偷偷设置当前话题。关闭 shadow 时记录 unsupported。
- **状态消融**：`--state-ablation drop-bindings` 移除回复/待答的状态入口；同轮输入改作普通顺序输入。目录、文本、纠正、重启和后台观察保留。两类预测分别写新文件，不能混在同一评分文件中。

每行包含输入前/后状态：当前话题、卡片（摘要/实体/别名/已定/未决）、有效路由关键词、实际 facts、进度/约束、排除来源、仍活跃的学习来源和 shadow。排除审计本来就应保留，评分不把审计记录里的旧文本当作仍在产品记忆中。多条共享一轮的快照明确标记 after-shared-round。

`worker_actions` 只在其公开声明的案例中运行，确实通过 Worker 工具循环写入；没有直接向 SQLite 填“假污染”。普通样本仍只使用提供的助手回复，不执行终端或文件工具。

## 4. 评分口径

所有新指标在 `routing_v1` 下；没有 routing_schema 的评分不增加任何字段。旧 v0 的同一 8 份预测，在修改评分器前保存完整评分及 canonical JSON 的 SHA-256；之后的回归测试重新计算并比较，原 corpus/预测文件也核对 SHA-256。证据固定在 `eval/test/fixtures/v0-score-baseline.json`；其他环境没有被忽略的旧预测时，该项明确 skip，不声称验证通过。

- **明确绑定子集**：只取非歧义、非 one-off、explicit_binding=true 的消息，报告 n/accuracy、入口实际应用数量、unsupported 数量及应用集合准确率。native steer 的送达不意味着没有分类；零调用附加指标同时要求物理调用和产品逻辑调用都为 0，缺回执不会被当作快路。
- **纠正后恢复**：只在对应产品纠正事件确实 applied 后，评纠正后的下一条，以及该条起到下一次纠正前的所有非歧义普通输入；单列缺失的纠正事件。
- **撤回污染**：从旧 turn 的真实落点和旧 state_after 确认污染曾写入，检查当前 state_before 的原话题 card/keywords/facts 是否还含该案例专用标记。marker 在正确目标话题出现不算泄漏。分别列 observed、stale、not_learned、not_misrouted、missing_snapshot；只有 observed 是 stale_rate 的分母，无证据则 null。另核对排除来源是否保留，以及所有话题的活跃学习事件是否仍依赖该错误来源（retraction_sources）；后者可以发现文本已改写的卡片/关键词派生泄漏，但不替代事实版本的完整语义审计。
- **大目录召回**：目录 >16 的消息，按实际 trace.candidateIds 计算 Recall@16；另合并实际 review 页计算复查后 Recall。没有候选 trace 时单列 missing_trace，不能假定全目录召回成功。
- **成对/消融**：按 pair id 和消息键连接，报告完整/缺失配对数、两侧都正确、输出是否随拥有者改变。可用 --ablation 输入 drop-bindings 预测，报 full−ablated 的成对准确率差和“两侧都正确”的差。缺预测、重复预测、模式不同或混合消融配置均报错。
- **已知目录身份**：routing-v1 的预置 id 固定匹配，open 模式也不能把错误的 A 重新匹配为 gold B。仅对预置目录之外的新话题做一对一匹配。旧 v0 的匹配逻辑与评分不变。

整体准确率仍按旧算法分别统计原路由；纠正后的恢复使用新增指标，不把过去已经产生的错误回头改成正确。已有场景含刻意歧义的起点，不能用整体分数掩盖其与后续恢复的差别。

## 5. 离线验证记录

验证摘要保存在 [validation.json](../../eval/data/interleave-v1/validation.json)，其中含最终数据/预测 SHA-256、样本覆盖和测试计数。

| 检查 | 本轮实测结果 |
|---|---|
| `node node_modules/typescript/bin/tsc -p tsconfig.json` | 通过；后端产物与原 `dist/` 内容一致 |
| `tsc -p tsconfig.tests.json` 与 `tsc -p tsconfig.client.json --noEmit`（均经 node 直接运行 tsc） | 两项通过 |
| `node --test --test-isolation=none eval/test/*.test.mjs` | **45/45 通过**，含本轮新增 15 项 |
| `py -X utf8 -B -m unittest discover -s eval/test` | **32/32 通过**，含本轮新增 10 项 |
| `node --experimental-transform-types --test --test-isolation=none tests/*.test.ts` | **480 项结果，476 通过，4 项 EPERM，退出码 1** |
| v0 兼容 | 8 份旧预测、原 corpus 的文件哈希不变，完整评分对象与 canonical JSON 哈希逐位一致；夹具固定原计价参数 |
| 定向集再生成 | 256 段/448 条，重新生成字节一致，manifest SHA-256 相符 |
| `git diff --check` | 通过；`src/`、`dist/` 无内容改动 |

4 项未完成均有当前堆栈证据：`tests/client-topic-folder.test.ts` 和 `tests/client-update.test.ts` 的 esbuild 子进程无法启动；`the release archive includes ongoing-task documentation and excludes local data` 的打包子进程、`route statistics count bursts, topic changes and unrouted steering without printing any text` 的 Node CLI 子进程也被拒绝。错误均为 `spawn / spawnSync EPERM`。未修改测试来跳过这些断言，未将全量产品测试写成全绿。

三份最终离线预测共 **1,008 条完整唯一消息键**，均已通过评分：

| 组 | 会话/消息 | 最终输出（均在被忽略的 predictions/） |
|---|---|---|
| 定向集 open + cards，完整状态 | 256 / 448 | `eval/data/interleave-v1/predictions/step5-open-all-full-dry-v3.jsonl` |
| 同集 open + cards，drop-bindings | 256 / 448 | `eval/data/interleave-v1/predictions/step5-open-all-ablated-dry-v3.jsonl` |
| 自然措辞生成入口 --dry-run，closed + cards | 64 / 112 | `eval/data/interleave-v1/predictions/step5-closed-natural-dry-v3.jsonl` |

第三组使用 `eval/data/routing-step5-natural-v3-dry/sessions.jsonl`；“自然措辞”指生成入口，实际仍是固定假模型返回，不是真实模型生成数据。还分别核验了 dev/test/all 的完整性和消融连接，分别有 36/12/48 个完整配对。

收尾发现 Windows PowerShell 将一段通过 stdin 传给 Python 的中文替换成问号，影响新增误建场景的 8 段中文会话。已改用明确 UTF-8 的文件写入修复，并添加中文字符回归测试。先保留旧输入，逐段比较确认其余 248 段完全相同，再对 8 段分别重跑 full/ablated；自然措辞假模型集也重新生成并重跑 2 段变化会话，其余 62 段输入相同。最终 v3 文件合并的是这些新回放与已验证未变输入的原回放，重新做完整键、快照、评分核验；没有把旧损坏文本对应的预测当成新文本的结果。该过程在 validation.json 明确记录。

本次受控假模型的观测覆盖：

- 32 次纠正真实应用，纠正后首条 32 个观察点；32 次真实重建运行时；没有缺失纠正事件。
- 卡片/关键词/事实分别有 **48 / 16 / 32** 个“先学入、后检查”的有效观察点，残留均为 0；32 / 16 个未学入的关键词/事实检查明确从分母剔除。48 个活跃学习来源检查无泄漏。这些检查点包含同一错误轮次在重启前后的重复观察，不是 48 个独立错误。
- 48 条大目录消息都有实际候选 trace；首批命中 32 条、漏掉 16 条，能测到 v0 中没有的大目录遗漏。本套简单假模型没有触发 review 页；剩余目录的实际分页复查由专门 CREATE 夹具触发并验证，真实模型的触发率仍待作者运行。
- 112 条应绑定消息中，96 条回复/问题/审批输入明确记为入口不支持；16 条 native steering 实际送达。48 组配对的假模型输出没有随 shadow 拥有者改变，full−ablated 准确率差为 0；这是“当前状态未进入路由”的管线检查，不能当作真实模型效果或统计不变性证明。
- 完整组部分调用命中假模型缓存。假 token、价格、缓存比例与耗时不用于比较收益；共享一轮的快照/elapsed 也不能被当作精确逐输入端到端延迟。

已完成的逐位兼容检查覆盖 8 份原始/step3、open/closed、dev/test 预测。完整原始测试日志保存在本机 `%TEMP%/routing-rethink-step5-validation/`；预测放在被忽略的 `predictions/`，不纳入提交。

新增 Node 测试（15 项，`eval/test/routing-v1.test.mjs`）：

1. v1 validation rejects dangling references, future corrections and non-monotonic times
2. deterministic bilingual cases keep pairs identical except for their declared owner and gold
3. natural generator preserves structural labels and paired short text through the fake transport
4. reply and pending metadata stay unsupported instead of secretly mounting gold
5. correction uses the product API and retraction evidence survives a real restart
6. same-round steering goes through the live gateway
7. v1 replay refuses the legacy simulator and invalid ablation names
8. correction snapshots contain actual tool-written facts and remove them from the wrong topic
9. large catalog replay actually selects 16 candidates and executes remaining-page review
10. natural generation fails closed on missing rows and lost fact evidence
11. fact generator refuses to overwrite a routing dataset before asking any model
12. mistaken CREATE cases expose keyword learning before correction and retract it afterwards
13. delayed steering classification retains the actual destination and every transport call
14. event replay preserves product fallback errors in prediction telemetry
15. new-topic correction templates retain Chinese text instead of pipeline replacement characters

新增 Python 测试（10 项，`eval/test/test_score_routing_v1.py`）：

1. test_explicit_binding_reports_accuracy_and_unsupported_coverage_separately
2. test_seeded_catalog_ids_cannot_be_remapped_to_hide_a_wrong_route_in_open_mode
3. test_large_catalog_recall_distinguishes_search_misses_from_missing_telemetry
4. test_correction_recovery_checks_only_the_wrong_topic_and_observed_surfaces
5. test_missing_snapshots_never_count_as_clean_retraction
6. test_owner_pairs_and_ablation_are_joined_by_keys_not_file_order
7. test_mixed_state_ablations_and_incomplete_pairs_are_not_silent_successes
8. test_v0_scores_are_bit_identical_on_all_available_original_predictions
9. test_ablation_can_select_dev_from_files_containing_both_splits
10. test_retraction_detects_invalid_source_in_another_topics_paraphrased_card

## 6. 作者运行命令与提交

先在允许子进程的作者环境运行标准检查：

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
node --test eval/test/*.test.mjs
py -X utf8 -B -m unittest discover -s eval/test
git diff --check
```

以下命令没有在本轮调用真实模型。沿用作者已经配置的模型环境；不要把凭据写入仓库或命令记录。输出目录和文件名均为新名字，若已存在则更换运行编号。

```powershell
# 可选：真实模型只改写文本，保留事件计划；产物先做语义审查
node eval/generate-routing-v1.mjs --variants 8 --model YOUR_MODEL --out eval/data/routing-natural-20261101-r1

# 在固定的定向集上跑真实产品；建议先 dev，冻结分析后再 test
node eval/run-router.mjs --data eval/data/interleave-v1/sessions.jsonl --split dev --mode open --cards --model YOUR_MODEL --out eval/data/interleave-v1/predictions/step5-real-dev-full-r1.jsonl
node eval/run-router.mjs --data eval/data/interleave-v1/sessions.jsonl --split dev --mode open --cards --state-ablation drop-bindings --model YOUR_MODEL --out eval/data/interleave-v1/predictions/step5-real-dev-ablated-r1.jsonl
py -X utf8 -B eval/score.py eval/data/interleave-v1/sessions.jsonl eval/data/interleave-v1/predictions/step5-real-dev-full-r1.jsonl --split dev --ablation eval/data/interleave-v1/predictions/step5-real-dev-ablated-r1.jsonl

node eval/run-router.mjs --data eval/data/interleave-v1/sessions.jsonl --split test --mode open --cards --model YOUR_MODEL --out eval/data/interleave-v1/predictions/step5-real-test-full-r1.jsonl
node eval/run-router.mjs --data eval/data/interleave-v1/sessions.jsonl --split test --mode open --cards --state-ablation drop-bindings --model YOUR_MODEL --out eval/data/interleave-v1/predictions/step5-real-test-ablated-r1.jsonl
py -X utf8 -B eval/score.py eval/data/interleave-v1/sessions.jsonl eval/data/interleave-v1/predictions/step5-real-test-full-r1.jsonl --split test --ablation eval/data/interleave-v1/predictions/step5-real-test-ablated-r1.jsonl
```

若改测自然措辞数据，把 `--data` 改为新生成目录的 sessions.jsonl，预测也写到该目录的 predictions/。保持同模型、cards、计价和代码版本；同句但缺少绑定入口的随机输出变化不能视为状态因果效应。

作者审核后只提交本轮这些路径；不把原有未跟踪用户目录或 predictions 加入：

```powershell
git add -- eval/README.md eval/generate.mjs eval/generate-routing-v1.mjs eval/lib/routing-v1.mjs eval/lib/product-replay.mjs eval/run-router.mjs eval/score.py eval/score_routing_v1.py eval/test/fake-model.mjs eval/test/routing-v1.test.mjs eval/test/test_score_routing_v1.py eval/test/fixtures/v0-score-baseline.json eval/data/interleave-v1/sessions.jsonl eval/data/interleave-v1/manifest.json eval/data/interleave-v1/validation.json docs/design/routing-rethink-step5-report.zh.md
git diff --cached --check
git diff --cached --stat
git commit -m "Add routing event fixtures, product replay and recovery scoring"
```

## 7. 未覆盖与风险

1. **产品缺绑定入口**：reply_to、pending_response 只记录，不进入 actual routing；后台可见事件也只有 shadow 观察。本轮没有实现请求回复、审批执行或将 shadow 升级为路由依据。相关子集的失败是能力缺口，不靠评测补齐。
2. **隔日时间没有驱动产品时钟**：真实重启与数据库恢复已被执行；时间戳只是输入元数据，未验证以真实间隔计算的近期活跃度、衰减、过期请求。没有等待一天或改系统时间。
3. **Worker 行为是受限脚本**：验证真实 fact/state 工具与撤回；没有验证任意模型 Worker 的工具选择、真实文件写入、错误副作用回滚、handback/误退/循环。gold.refs 场景测路由引用，不等于跨项目工具权限验收。
4. **撤回检查有观测范围**：同时保存实际状态和来源，但字符串 marker 不能识别全部改写后的语义污染，也不能单凭没有标记判定未观测表面干净。无观察样本的指标为 null；明确报告分母。
5. **模板留出不等于新自然分布**：dev/test 按模板变体分组，跨语言和机制有相关性，留出组数少；本轮未给出真实模型置信区间或外推承诺。后续调策略需另设足量、人审、冻结留出集。
6. **同轮回执存在缺口**：原生转发可能没有独立持久化 receipt；能证明 Worker 收到了输入，但无法伪造该消息的路由 trace、候选或产品逻辑调用计数。该限制在行级输出中保留。
7. **没有真实收益、提交或部署**：所有新执行均为离线假模型；没有更新用户 profile、读取 Key、推送、合并或发布。标准构建/测试与本地 Git 提交由作者完成。
