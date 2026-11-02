# 路由重想第七步：不带用户标记的续接

## 结论

已实现由 TheOne 自有状态驱动的续接：唯一有效待答、非当前话题的前台回复可零分类调用落点；多个待答或前台与待答冲突交给模型；可明确识别的算术插问独立执行，裸续接返回原工作。主入口和运行中补充入口均已覆盖。自动推断仍是 inferred，不充当用户授权。

主要评测改为 `drop-user-refs`，保留 TheOne 自己掌握的前台、待答、后台和原生运行中补充状态。原 `drop-bindings` 保留为破坏状态的对照。修正了 routing-v1 的评分口径和夹具，把可识别问题与缺少信息的问题分开；原始语料和 step6b 真实预测均保留。

最终 v0 四组假模型回放共 **4,932 条**，去除运行耗时、按出现次序归一化随机 UUID 后，其余预测字段逐条相同；12 份既有真实预测的 v0 评分结果与修改前完整相同。最终专项 **76/76**、Node 评测 **48/48**、Python 评测 **38/38** 通过。全量产品入口 **527 项：523 通过，4 项因沙箱禁止子进程 EPERM 受阻**，不能写成全量全绿。后端编译与两项类型检查通过，`dist/` 已同步后端产物。

本轮未读取模型 Key、未调用真实模型 API、未 commit、未发布、未修改用户运行 profile。下面的假模型结果只证明回放管线与指定规则工作，不能证明真实模型准确率、费用或延迟提升。

## 1. 先审计：原始 step6b 逐条结果

基线提交：`3ce63f3b6c9f76c777a958aa083e939b016e1f1e`。读取任务指定的四份 step6b 真实预测，用修改前 `score_session` 逐条复算，覆盖 dev/test、full/drop-bindings，共 896 条预测。详细落点、文本、候选、调用数、挂载前后状态、事件和评分保存于 [audit-before.json](../../experiments/routing-rethink-step7/audit-before.json)。[audit.py](../../experiments/routing-rethink-step7/audit.py) 可用当前评分器重新审计，并拒绝覆盖既有审计文件。

以下“原始错数”指直接筛 `accurate == false`，**不是正式严格准确率的错误数**。

| 场景 | dev 原始错数 full / drop-bindings | 核实结果 |
|---|---:|---|
| foreground | 0/24、12/24 | 旧消融删除了前台来源；裸短句随后被 `short-continuation` 留在挂载 a。来源仍在时，产品也缺少无引用的前台续接规则。两层原因分别修复。 |
| question | 0/24、12/24 | 旧消融确实删除 pending 的拥有者。原夹具有两项待答，且前台固定 a；即使只删引用，也不能把它全部视为“唯一待答”。这是状态消融与可识别性设计问题，不能强制猜金标。 |
| approval | 0/24、12/24 | 与 question 相同；路由到审批拥有者不代表批准该审批。 |
| oneoff | 24/36、24/36 | 12 条算术本身正确隔离，但旧 `accurate` 对所有 gold=null 固定为 false，正式主准确率原本就不包含它们；另 12 条后续续接真的留在算术新话题，属于产品错误。test 的 drop-bindings 另有 1 条算术混进 a、续接恰好回对，不能把它当成隔离正确。 |
| correction | 11/36、12/36 | 全部错在标了 ambiguous 的初始预算句；纠正后、重启后续接均正确。初句没有区分两个 report.csv 的信息，保留作撤回实验，不计严格准确率。部分 CREATE 被记成 kind=correct 而 mapped=null 是评分分类不一致。 |
| correction_new | 12/24、12/24 | 首句都没有已有话题的区分信息；纠正后的 12 条全部正确。对已种入目录的 b 新建随机标签不应记为 kind=correct。 |
| large_catalog | 12/36、14/36 | 12 条末句只说“之前的数据发布项目、report.csv”，24 个候选都符合，没有指向 c23 的线索。另 2 条是 `rv1-4-en-large_catalog:1`、`rv1-5-en-large_catalog:1` 的 `ROUTER_REQUEST_FAILED` 回退，目标 c19 **已经在候选中**。没有发现可识别目标的检索漏召回。 |
| background / homonym / new_task / reference / restart / steering | 均 0 | 原预测未发现错误；保持这些行为并跑回归。 |

对应 test：foreground/question/approval 的旧消融各错 4/8；correction、correction_new 的初句各 4 条歧义，纠正后均正确；large_catalog 的 4 条错均为缺少 c23 线索的末句。full 一次性算术后的 4 条续接全部错，drop-bindings 为 3 条。其余表列场景无错。

### 评分修正，仅作用于 routing-v1

- seeded 目录视作已经存在。给 seeded 金标新建随机标签计 `spurious_new`；路由到另一个已有话题计 `wrong_existing`，不再出现这类 `kind=correct` / `accurate=false` 的矛盾。
- 正确隔离的一次性问题，其逐条 `accurate` 为 true；ERROR/CLARIFY 不作为成功隔离。一次性问题继续独立报告，仍不混入线程准确率。
- R@16 只计算非歧义、可识别的目标，同时显式报告排除的 `ambiguous_n`。旧原始 0.667 是 24/36；可识别口径为 **24/24=1.000**，test 为 **8/8=1.000**。这是分母修正，不是检索性能提升。
- 新夹具的 `requires_user_ref` 冲突例，在消融掉用户引用后单列为不可识别，不混进严格准确率。`by_scenario` 保留总数、严格分母和排除数；原始成对诊断仍可检查。`pairs.identifiable` 和 `pairs.ablation` 只比较可识别样本，后者使用两边相同的成对样本，显式给 `comparable_pairs`。
- v0 所有分支保持旧定义。用原提交的评分器与本轮评分器复算本机 12 份完整 v0 原预测，完整 JSON 相等，详见 [v0-scores.json](../../experiments/routing-rethink-step7/v0-scores.json)。已有 8 份评分 fixture 的哈希断言也通过。

## 2. 新旧消融与修订语料

| 模式 | 用户 reply_to / pending_response 选择器 | 前台与待答来源 | 原生 steering 身份和到达时序 | 后台、纠正、重启 |
|---|---|---|---|---|
| none / full | 保留 | 保留 | 保留 | 保留 |
| drop-user-refs（主要指标） | 删除 | 保留 | 保留 | 保留 |
| drop-bindings（旧对照） | 删除 | 删除夹具提供的来源事件 | 删除绑定，并按旧逻辑顺序回放 | 保留 |

这里把 `input.pending_response` 当作夹具中用户选择的待答 ID；待答事件的 `owner_id` 是 TheOne 自有状态。`steering_of` 是宿主掌握的同轮输入身份，新的消融保留它。回放会记录 requested/submitted，区分夹具里原有引用和实际提交的引用。旧消融不会删除回放执行后自然产生的普通回复，因此它也不等于“删除产品里一切状态”。

新数据单独写入 [interleave-v1-step7](../../eval/data/interleave-v1-step7/manifest.json)，`benchmark_revision=step7`：320 会话、512 消息；dev 240 会话/384 消息，test 80 会话/128 消息。没有覆盖原来的 256 会话/448 消息。

- question/approval 主场景使用唯一待答，不再附上相互矛盾的前台来源。
- 原来的多待答成对结构保留为 question_conflict / approval_conflict，并标 `requires_user_ref=true`，缺引用时转模型，不要求快路猜中。
- large_catalog 末句补上对应 c23 的 SHARD 码，固定 `must_include`；现在三轮都有可检验的区分线索。
- correction 的初句仍为歧义，继续检验纠正、卡片/关键词/事实撤回与重启恢复。

没有改动文本检索打分，也没有扩大 16 候选上限。对于真的出现在自有状态里的话题，模型候选会保留当前话题、前台来源和有界待答拥有者；新增测试验证第 16 名以外的待答拥有者也进入请求。

## 3. 产品改动及边界

`RoutingBindings` 读取当前运行中、未关闭、目标仍可用、来源仍有效的待答；重启前的等待 ID 继续失效。只读有界记录，增加了 pending 查询索引，来源验证调用原 `LearningJournal.valid()`，没有绕过其路由阶段缓存逐条查学习库。

对于裸续接：

1. 可靠的显式引用仍走既有绑定协议。
2. 唯一有效待答且没有前台冲突时，零分类调用路由到它的拥有者。
3. 没有待答冲突、上一条前台回复来自非当前话题时，使用该前台来源。
4. 多个待答（包括同一话题的两项待答）、前台/待答冲突或返回来源失效时，交给模型。超过状态预算也保持冲突，不把截断后的列表当成唯一待答。
5. 无额外信息的普通当前话题续接保留原路径；原生目标轮次和显式同轮 steering 保持原优先级。

模型请求只在有信息量时带 attention：前台不同于 currentId、有待答/溢出，或有后台事件。普通 foreground=currentId 且没有其它事件时，attention 和其附加提示均不存在。模型最多收到 8 项待答、3 项后台来源及前台来源；遗漏待答显式带 `pendingOverflow`。只传 ID、话题和类型，不传来源账本。旧的普通路由主提示未修改。

算术插问使用既有保守词形识别（如 `17 * 23?`），创建隔离话题、保留原挂载，回执及回复来源保存返回目标。后续“继续/好的/ok/下一步”等返回原工作；“为什么/why/more”等解释型追问仍可承接算术回答。返回依据失效时交给模型。尚未把所有常识问答都自动判成一次性插问。

新增 `continuation` 回执与显式 `binding` 分开；自动落点仍按 inferred 学习。自动前台/待答、模型使用的状态都携带可撤回父来源，包括 Worker 在后台提前开始、主聊天尚未保存展示回执的时段。没有改变事实确认标准、`checkTargets` 或 Worker 执行权限。测试验证自动续接仍会经过跨项目写入检查，拒绝后工具零执行；同一补充输入只由一个 Worker 执行。

## 4. 假模型回放结果

两套语料均以 open/cards/`--dry-run` 跑 full、新消融、旧消融，覆盖 dev/test，共 2,880 条预测。路由错误回退与缺失回执均为 0。

| 语料 | 切分 | 模式 | 严格正确/分母 | 假模型准确率 | 路由逻辑调用总数 |
|---|---|---|---:|---:|---:|
| 原始 v1 | dev | none | 264/288 | 91.67% | 218 |
| 原始 v1 | dev | drop-user-refs | 240/288 | 83.33% | 268 |
| 原始 v1 | dev | drop-bindings | 228/288 | 79.17% | 242 |
| 原始 v1 | test | none | 88/96 | 91.67% | 78 |
| 原始 v1 | test | drop-user-refs | 80/96 | 83.33% | 96 |
| 原始 v1 | test | drop-bindings | 76/96 | 79.17% | 94 |
| step7 修订 | dev | none | 312/348 | 89.66% | 230 |
| step7 修订 | dev | drop-user-refs | 264/300 | 88.00% | 280 |
| step7 修订 | dev | drop-bindings | 228/300 | 76.00% | 262 |
| step7 修订 | test | none | 104/116 | 89.66% | 82 |
| step7 修订 | test | drop-user-refs | 88/100 | 88.00% | 100 |
| step7 修订 | test | drop-bindings | 76/100 | 76.00% | 106 |

新版的共同可识别 owner-pair 子集为 dev 36 对、test 12 对。full 与 drop-user-refs 两边逐条准确率和成对两边都对率均为 100%，差值为 0；旧 drop-bindings 的逐条准确率为 50%、成对两边都对率为 0。这只验证自有状态规则与消融接线。

六组中可识别目录 R@16 均为 1.000；新版每组 dev 为 36/36、test 为 12/12，旧版排除歧义后为 24/24、8/8。原始旧口径 0.667 → 可识别口径 1.000，以及新版补线索后的 1.000，都不能声称是检索算法改进。每组一次性隔离及返回原话题均为 dev 12/12、test 4/4。

分母差异是显式的：新 full 包括可凭用户引用识别的冲突题；新消融剔除这部分不能唯一识别的题。不要直接把不同分母的总准确率差当成收益；成对比较使用 `comparable_pairs`。假模型只认识简单标题前缀、否则偏向 currentId，不能理解 SHARD 等语义，故本轮的模型分支准确率不能代表真实模型。

| v0 组 | 消息数 | 归一化预测差异 |
|---|---:|---:|
| open-dev | 1971 | 0 |
| open-test | 495 | 0 |
| closed-dev | 1971 | 0 |
| closed-test | 495 | 0 |

比较覆盖决策、trace、候选、层级、调用、usage、card_usage 等其余字段；仅归一化随机 UUID，并去除 `elapsed_ms`、`latency_ms`、`elapsedMs`。原始 JSONL 本来就包含新的随机 ID 和运行计时，不能声称原始文件字节相同。[v0-comparison.json](../../experiments/routing-rethink-step7/v0-comparison.json) 保存归一化哈希、差异列表和前后评分。

## 5. 验证与测试

| 最终检查 | 结果 |
|---|---|
| `node node_modules/typescript/bin/tsc -p tsconfig.json` | 通过；同步 `dist/` 后端 JS/声明 |
| `node node_modules/typescript/bin/tsc -p tsconfig.tests.json` | 通过 |
| `node node_modules/typescript/bin/tsc -p tsconfig.client.json --noEmit` | 通过 |
| `node --experimental-transform-types --test --test-isolation=none tests/*.test.ts` | 527 项，523 通过，4 EPERM 受阻 |
| routing-bindings / routing-shadow / learning-provenance / approval / routing-receipts 专项 | 76/76 通过 |
| `node --test --test-isolation=none eval/test/*.test.mjs` | 48/48 通过 |
| `py -X utf8 -B -m unittest discover -s eval/test` | 38/38 通过 |
| `git -c core.safecrlf=false diff --check` | 通过；仅单次关闭 safecrlf 告警，未改 Git 配置 |

4 项受阻与任务说明一致：

- `tests/client-topic-folder.test.ts`：加载测试文件时 esbuild 无法启动子进程。
- `tests/client-update.test.ts`：同上；这两个文件内部的测试不算已经执行通过。
- `the release archive includes ongoing-task documentation and excludes local data`：打包子进程 `spawn EPERM`。
- `route statistics count bursts, topic changes and unrouted steering without printing any text`：统计 CLI 的 `spawnSync EPERM`。

未跳过或放宽这些断言。旧 shadow 算术集成用例改为检查“产品挂载和 shadow 焦点都保持原工作”，与本轮产品变化一致。首次写 Python 补丁时遇到 PowerShell stdin 中文编码问题，已显式改为 UTF-8、修正文本，并通过类型检查、中文夹具校验和测试；未把乱码留入产物。

新增失败用例先复现，再修复并重跑。新增产品覆盖的测试名称包括：

`tests/routing-bindings.test.ts` 共 44 项通过，其中新增 23 项：

- `an automatic continuation still checks another project before executing a write`
- `a bare continuation uses the unique live question owner without user references`
- `a bare continuation uses the unique live approval owner without user references`
- `a bare continuation follows a non-current foreground reply without a user reference`
- `two-owners delegates a bare continuation to the model with live state`
- `same-owner-two-requests delegates a bare continuation to the model with live state`
- `foreground-conflict delegates a bare continuation to the model with live state`
- `a non-current foreground source reaches semantic routing even without background events`
- `a closed pending request cannot capture an unmarked continuation`
- `a deleted pending request cannot capture an unmarked continuation`
- `a excluded pending request cannot capture an unmarked continuation`
- `a background pending request cannot capture an unmarked continuation`
- `temporary arithmetic is isolated and an unmarked continuation returns to the original topic`
- `asking why after temporary arithmetic can still refer to the arithmetic reply`
- `automatic foreground continuation inherits retractable learning sources`
- `more pending requests than the payload budget remain a conflict`
- `temporary arithmetic also works when no topic has been mounted`
- `semantic routing from conflicting state retains the observed sources for retraction`
- `an unmarked continuation arriving during a reply can reach another live pending owner once`
- `semantic in-flight routing preserves pending-state sources`
- `temporary returns survive a restart without reviving expired pending waits`
- `semantic routing includes a pending owner outside the first sixteen lexical candidates`
- `an invalidated temporary return cannot force a route or contaminate new model learning`

Node 评测新增 3 项：`drop-user-refs removes reply and pending references but retains the server observations`、`drop-user-refs keeps native in-flight steering identity and arrival timing`、`step7 templates provide unmarked unique waits and identifiable distant catalog targets`。Python 新增 6 项覆盖 seeded 新建误分类、一次性隔离、可识别 R@16、新消融、引用依赖题的严格分母、同样本成对比较。

完整通过/失败名称、各组评分、文件 SHA-256 见 [validation.json](../../experiments/routing-rethink-step7/validation.json)。本机完整日志位于 `%TEMP%/routing-step7-*-final.log` 和 `%TEMP%/routing-step7-final-*.log`，不纳入源码提交。验证期间补齐的运行中来源继承和返回失效边界，已纳入最终编译后的全量测试及最终回放。

## 6. 作者执行：标准验证和真实模型评测

沙箱环境已明确不能启动 esbuild/npm 流程所需子进程，本轮按任务允许的替代入口验证，没有反复尝试标准构建。作者在正常权限环境审查后执行：

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
node --test eval/test/*.test.mjs
py -X utf8 -B -m unittest discover -s eval/test
git diff --check
```

真实模型命令本轮未执行。沿用作者已经配置的模型环境；不需要给本任务提供 Key。使用新文件名，若同名已存在，改 `r1` 为新编号。先 dev，审阅后将 `$splits` 改为 `@('test')`：

```powershell
$model = 'deepseek-v4.1-flash' # 按作者现有模型名调整
$env:EVAL_REFRESH = '1'
$splits = @('dev')
$data = 'eval/data/interleave-v1-step7/sessions.jsonl'
foreach ($split in $splits) {
  foreach ($ablation in @('none', 'drop-user-refs', 'drop-bindings')) {
    $out = "eval/data/interleave-v1-step7/predictions/step7-real-$split-$ablation-r1.jsonl"
    node eval/run-router.mjs --data $data --split $split --mode open --cards --state-ablation $ablation --model $model --out $out
    if ($LASTEXITCODE -ne 0) { throw "Replay failed: $split $ablation" }
    py -X utf8 -B eval/score.py $data $out --split $split
    if ($LASTEXITCODE -ne 0) { throw 'Scoring failed' }
  }
  $full = "eval/data/interleave-v1-step7/predictions/step7-real-$split-none-r1.jsonl"
  $primary = "eval/data/interleave-v1-step7/predictions/step7-real-$split-drop-user-refs-r1.jsonl"
  py -X utf8 -B eval/score.py $data $full --split $split --ablation $primary
  if ($LASTEXITCODE -ne 0) { throw 'Paired scoring failed' }
}
```

`score.py` 会生成输入预测旁的 `.score.json`；上面 full 的最终评分带与主要消融的同样本成对比较。旧消融已有单独评分，如需旧成对差另用它作为 `--ablation`，注意保存两次 full 的评分文件，避免覆盖比较结果。计费应由作者按服务商实际价格设置 `EVAL_PRICES`，本报告未用假模型的伪价格估算收益。

v0 四组真实回归同样写新标签，逐条与 step3/step6b 所采用的基线配对，并检查失败回退、准确率与会话自助抽样区间：

```powershell
foreach ($mode in @('open', 'closed')) {
  foreach ($split in @('dev', 'test')) {
    $out = "eval/data/interleave-v0/predictions/step7-real-$mode-$split-r1.jsonl"
    if (Test-Path -LiteralPath $out) { throw "Output exists: $out" }
    node eval/run-router.mjs --data eval/data/interleave-v0/sessions.jsonl --split $split --mode $mode --cards --model $model --out $out
    if ($LASTEXITCODE -ne 0) { throw "v0 replay failed: $mode $split" }
    py -X utf8 -B eval/score.py eval/data/interleave-v0/sessions.jsonl $out --split $split
    if ($LASTEXITCODE -ne 0) { throw 'v0 scoring failed' }
  }
}
```

如需直接与原 step6b 语料对照，把 v1 命令中的路径换为 `interleave-v1`，使用另一组新输出标签。原 question/approval 中引用依赖的歧义未追改到旧文件，不应把旧数据的 unmarked 总分当成新的主要指标。

本轮没有执行 `git add`、`git commit`、push 或发布；由作者审查后提交。请只选本任务相关文件，不要把用户原有未跟踪目录带入提交。

## 7. 剩余边界

- 没有真实模型评测和桌面交互验收，不能据此断言实际准确率、服务商缓存、账单或延迟改善；“v0 不变”的本轮证据是离线回放、普通请求路径和评分一致性。
- 无用户引用且状态确实冲突时，信息本身可能不足。按要求交给模型，仍可能误路由；没有增加要求用户选话题的交互。
- 一次性问题目前保守识别算术词形；一般知识问答、带文字的计算语境和多步插问还需要更广的真实语料验证。没有自动删除临时话题或历史。
- 自有待答注册仍依赖宿主生产者，前台来源表示“已展示”，不表示用户已读。本轮未改变原生提问回答/审批消费流程，更没有把“好的”直接当成跨项目写授权。
- 待答随运行重启失效；持久回复和算术返回状态通过来源校验恢复。来源为输入/轮次级，失效撤回可能偏保守；不能撤销已发生的外部工具副作用。
- 完整客户端构建与上述 4 个受限测试仍需作者在正常权限环境补验。直接 shell、无子代理、无 node_repl、无选择或确认弹窗的要求已遵守。

## 8. 作者补测：真实模型评测

DeepSeek V4.1 Flash（OpenCode Go，`reasoning_effort: none`，open/cards），2026-11-02，数据 `interleave-v1-step7`。

| 组 | 严格准确率 | harm/100 | 调用/条 | $/千条 |
|---|---|---:|---:|---:|
| dev 带用户引用（none） | 100% | 0 | 0.60 | 0.131 |
| dev **只去掉用户引用（drop-user-refs，主要指标）** | **99.7%** | 1.0 | 0.74 | 0.136 |
| dev 旧消融（drop-bindings） | 87.7% | 37.0 | 0.67 | 0.125 |
| test 带用户引用 | 98.3% | 5.2 | 0.63 | 0.145 |
| test **只去掉用户引用** | **100%** | 0 | 0.77 | 0.128 |
| test 旧消融 | 87.0% | 39.0 | 0.84 | 0.143 |

按场景看（只去掉用户引用）：前台续接 dev 24/24、test 8/8；唯一待答问题 24/24、8/8；唯一待答审批 24/24、8/8；一次性算术隔离并返回 36/36、12/12。第六步同口径下这几类都只有一半左右（问题/审批的旧数据还混有冲突题）。

两边信息真冲突的 `requires_user_ref` 题（多个待答、前台与待答不一致）不带引用时 dev 25/48、test 8/16，约等于抛硬币，符合预期：这部分信息本身不足，按设计交给模型，不计入严格准确率，单独列出。

费用：比带引用多约 0.14 次调用/条（冲突题和续接走模型），每千条费用在 ±5% 内。v0 没有重跑：离线回放 4,932 条归一化后零差异，普通请求与第六步修正后逐字相同。

结论：在不需要用户做任何标记的前提下，TheOne 自有状态（唯一待答、非当前话题的前台回复、一次性插问的返回点）让这些续接场景达到和带引用相同的水平；剩下的只有信息本身不足的冲突情形。
