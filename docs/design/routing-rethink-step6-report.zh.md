# 路由重想第六步：让明确绑定进入产品路由

2026-11-02 · 分支 `routing-depth` · 起点 `5d3efa6`

结论：已增加独立于 shadow 的可靠绑定入口，显式回复、仍有效的待答请求和指向正在运行轮次的补充，可直接形成路由提案。普通路由、绑定路由都沿用原来的 Worker、执行前对象检查和可撤回学习。后台自主续跑的通知不再挂载自己的话题；原生延迟问题的用户答案仍回到问题拥有者。

本轮只运行本地假模型与测试夹具，没有调用模型 API，也没有查找或读取任何 Key。`src/` 和后端 `dist/` 已同步。任务说明明确要求“不要 commit”，环境也将 `.git` 设为只读；因此没有暂存、提交、推送或发布。作者执行命令见后文。

## 宿主提供什么，插件维护什么

本轮核实的是本地安装的 DSH `0.2.1-rc.2` 类型和实现，并非推测未来宿主协议：

| 入口 | 实际字段与生命周期 | 本轮如何使用 |
|---|---|---|
| 普通消息 | `dsh-llm/lib/types/message.d.ts`：`UserMessage.id/content/source`，普通用户的 `source` 只有 `kind:'user'`；会话事件另有 session ID 和 seq。`dsh-api-session-controller` 提交后调用 `followup` 或 `steer`。没有通用的 `replyTo` 或“回复所指话题”字段。 | TheOne 观察实际前台助手消息，用 `sessionId:seq` 标识回复，并从运行轮次和真实路由取得拥有者及学习修订号。 |
| 普通宿主问题 | `AskUserQuestionItem.id` 在结构化答案的 `answers[].id` 中回传；等待请求携带 agent/signal，定时等待额外提供 `wait.callId`。同步回调本身已属于原 Worker，不需要另做分类。 | 在已有问题转发桥中生成插件 UUID，记录实际 owner、questionIds、可用的 callId；请求结束即关闭。客户端可通过新 GET 入口读取这些可引用记录。 |
| 延迟宿主问题 | `userQuestions.answer(agent, callId, answer)` 检查 live root、continued 状态、完整问题 ID 集和重复排队；随后生成 `source.kind='user-question-reply'`、`callId`、`outcome='answered'` 的消息。 | 沿用真实宿主方法把答案送到拥有该 callId 的 Worker；多个 Worker 同时声称拥有该 callId 时不再任取第一个。主聊天回执记录 question 绑定和带 worker session 的 callId。 |
| 宿主审批 | `approval/asked.id` 和 `approval/decided.id/outcome` 配对；请求回调给 agent、toolName、可选 callId、signal。没有“普通文本回答审批”的可信字段。 | 在已有审批转发桥维护插件 UUID 和可用的 callId，原生 outcome 仍由宿主回调返回。绑定不制造 `allowed-once`，也不更改权限。 |
| 同轮补充 | 原生 `Agent.steer(message)` 只表示入队边界；单凭它不能证明文字属于正在运行的话题。 | 新输入入口显式带 `steeringOf`，仅在它等于当前 gateway 的 live run 输入 ID 且拥有者有效时跳过分类。普通 steer 仍走原有判断。 |

主要核对位置：

- `node_modules/@deepseek-ai/dsh-llm/lib/types/message.d.ts`；
- `node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts`；
- `node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js`；
- `node_modules/@deepseek-ai/dsh-user-questions/lib/types/types.d.ts` 与 `lib/index.js`；
- `node_modules/@deepseek-ai/dsh-user-approval/lib/types/types.d.ts` 与 `lib/index.js`。

新增 `src/routing-bindings.ts`，数据保存在 `<contexts.db>.bindings.db`，按 gatewayKey 隔离。保存引用、来源类型、拥有者、请求关联字段、学习来源修订和输入所声明的引用；不保存消息正文或审批授权。shadow 继续只做观察，关闭它不影响绑定。

消息来源记录持久化；插件待答引用带当前 runtime 标识，重启后保守失效。旧引用不会自动恢复一个已经消失的等待回调。原生延迟问题仍由 DSH 的 continued 投影判定；若没有可恢复的拥有者，宿主方法不会凭旧插件记录执行答案。

## 产品入口与规则

新增的认证接口位于 DSH 原有的 `/api` 保护范围：

- `GET /api/theone/bindings`：返回有界的、当前有效的引用及其类型、来源会话、拥有者、可用的原生请求关联字段。
- `POST /api/theone/messages`：接受 `sessionId/text/mode/binding`；`mode` 为 `followup` 或 `steer`。`binding` 只允许 `replyTo`、`pendingResponse`、`steeringOf`，不能直接声明 topicId 或拥有者。
- 同一入口的服务方法为 `ctx.theone.submitMessage(...)`。它先保存引用，再创建普通 DSH 用户消息并入队，不给 DSH 编造额外的 source 字段。

例如，客户端先从 GET 返回值选取实际引用，再提交：

```json
{
  "sessionId": "<live main-chat session>",
  "text": "就按刚才那个调整",
  "binding": { "replyTo": "<server-issued message reference>" }
}
```

绑定必须同时满足：

1. 引用已由可信的进程内生产者登记，类型吻合，唯一解析到一个话题。
2. 话题仍在实际路由目录中，原始及继承的学习来源修订仍有效。
3. 待答引用尚未关闭且属于本次运行；steering 指向该主聊天当前仍运行的输入。
4. 若提交多个引用，它们必须指向同一个拥有者；同批多个输入不凭单条引用替整个批次作决定。

冲突、未知引用、删除/孤立话题、过期请求、后台通知、问号等推测来源、过期 steering 均不构成可靠绑定。这些带有无效引用的文本也不会再落入裸“继续”的快捷分支，而是回到正常分类。没有明确引用的输入继续使用既有路由策略。

可靠绑定只产生 KEEP/MOUNT/SWAP 提案，之后仍经过原来的 plan、Worker 恢复、单目标执行和 `checkTargets`。没有为绑定新增执行者；同轮补充转发给已有 Worker，并留下独立的路由回执和学习来源。前台本来就有允许的后台任务机制，本轮未增加其并发上限。

回执 `binding` 记录 applied/rejected、kind、refs、topicId、来源修订或拒绝原因。应用绑定的分类调用数为零；卡片、事实、纠正学习和真正的 Worker 回答仍可能有独立模型成本。`pendingResponse` 表示“这段文本回应哪个待答对象”，不替代宿主结构化答案接口，也不会完成审批或授予工具权限。

## 焦点与学习

实际模型请求新增有界的 `attention.foreground` 和 `attention.background`，分别描述最后展示的前台回复和最多三条后台记录。它们不是用户已读信号，也不构成硬绑定；初判、复核、目录复查接收同一份来源状态。

修复了真实 relay 路径的焦点问题：后台自主续跑的结果可以显示在主聊天，但不再自动挂载自己的话题。下一句裸“继续”仍承接前台话题。原生延迟问题的答案是明确用户输入，仍会转向问题拥有者。

绑定执行使用第三步的学习日志：完成后是 inferred，不把绑定或用户沉默升级成 confirmed；纠正后撤回派生学习。来源还沿后续明确回复传播，因此纠正上游绑定后，依赖它的新回复也不能成为有效绑定依据。

`src/learning-journal.ts` 未改动。有效性检查调用它原有的 `valid` 和阶段缓存；没有在路由热路径遍历所有来源逐条直接查库。新增回执查询按 message_id 读取，attention 读取最近的有界记录。

## 回放与费用边界

`eval/lib/product-replay.mjs` 的 routing-v1 分支：

- 将数据中的 foreground/pending/background 事件交给产品的可信观察生产者接口；这些事件是模拟宿主的测试输入，不是生产 HTTP 客户端可以伪造的 owner 字段。
- 用户输入经 `submitMessage` 进入真实产品；回复、待答和同轮补充引用均被传入。没有从 gold 读取目标，也没有为配对案例偷偷改 currentId。
- full 与 drop-bindings 分别运行；后者去掉显式引用及相应事件，steering 变为顺序普通输入。目录、文本、纠正、重启和后台事件保留。
- 预测记录实际回执与独立 Worker 送达观察；steering 不再靠“缺失回执但似乎送到了”冒充零调用。
- v0 评分器没有改动。

两组均完整完成 **256 段 / 448 条**，消息键无遗漏、无重复。运行时设置 `EVAL_REFRESH=1`，没有复用磁盘回答缓存。产物为：

- `eval/data/interleave-v1/predictions/step6-open-all-full-dry-r1.jsonl`
- `eval/data/interleave-v1/predictions/step6-open-all-ablated-dry-r1.jsonl`

这些预测按仓库规则被 git 忽略；文件哈希和 all/dev/test 评分已保存到 [validation.json](../../experiments/routing-rethink-step6/validation.json)。

| 观察项 | full | drop-bindings |
|---|---:|---:|
| 应绑定子集 | 112 条 | 同样 112 条 |
| 实际 applied | 112 | 0 |
| binding.unsupported | 0 | 0 |
| 子集物理分类调用 / 逻辑分类调用 | 0 / 0 | 40 / 40 |
| 只改前台来源或待答拥有者，落点随之改变 | 48 / 48 组 | 0 / 48 组 |
| 全集物理分类调用 / 逻辑分类调用 | 316 / 316 | 356 / 356 |

112 条包括 32 条明确回复、32 条问题回应、32 条审批关联文本、16 条同轮补充；full 全部有真实产品回执，物理和逻辑分类调用均为零，目标与该定向集标签一致。48 组 full 配对两侧都到达相应拥有者；消融后的 48 组两侧落点均不改变。消融中的部分裸“继续/好的”仍走既有快路，因此不能把 112 条都算成新增节省了一次请求。

额外的学习回归观察：32 次纠正已真实应用，缺失 0；32 次重启观察。卡片/关键词/事实分别有 48 / 16 / 32 个实际学入后的撤回检查点，残留分别为 0 / 0 / 0；有效来源检查 48 个，泄漏 0。未学入的表面不计入“干净撤回”的分母，具体计数保留在验证文件。

v0 评分器与原数据未改动。对现有 8 份冻结预测核对 corpus/预测 SHA-256，再用夹具固定计价参数重算；完整评分对象与 canonical JSON SHA-256 均逐位一致，相关测试未 skip。

这些假模型结果只证明控制流和计量管线。对于真实流量，只有能提供可靠引用的输入才有机会省去分类、复核和目录补查请求；普通输入的 attention 会增加少量状态 token。本轮没有实测真实绑定覆盖率、真实正确率、费用、缓存或延迟收益。

## 验证

| 检查 | 实测结果 |
|---|---|
| `node node_modules/typescript/bin/tsc -p tsconfig.json` | 通过；同步后端 dist |
| `node node_modules/typescript/bin/tsc -p tsconfig.tests.json` | 通过 |
| `node node_modules/typescript/bin/tsc -p tsconfig.client.json --noEmit` | 通过 |
| 产品全量：`node --experimental-transform-types --test --test-isolation=none tests/*.test.ts` | **501 项结果，497 通过，4 项 EPERM，退出码 1** |
| 最终专项：同上测试入口，仅 `tests/routing-bindings.test.ts tests/approval.test.ts tests/relay.test.ts` | **24/24 通过**：新增绑定测试 20、原审批/问题桥 2、原 relay 2 |
| `node --test --test-isolation=none eval/test/*.test.mjs` | **45/45 通过** |
| `py -X utf8 -B -m unittest discover -s eval/test -v` | **32/32 通过**，无 skip |
| 两组 routing-v1 dry-run、all/dev/test 评分和完整性断言 | 通过 |
| v0 冻结预测及评分 | 8/8 逐位一致 |
| `git -c core.safecrlf=false diff --check` | 通过；只在该命令禁用 CRLF 告警，未改 Git 配置 |

4 项受阻均为既有子进程限制：`tests/client-topic-folder.test.ts`、`tests/client-update.test.ts` 的 esbuild 进程；`the release archive includes ongoing-task documentation and excludes local data` 的打包进程；`route statistics count bursts, topic changes and unrouted steering without printing any text` 的 Node CLI 进程。实际错误为 `spawn / spawnSync EPERM`，与第五步同名受限项一致；未跳过断言，也不将全量测试写成全绿。前两项是文件加载失败条目，不能解释成已经运行了文件内部的全部断言。

全量测试与两组回放启动后，另补齐了原生延迟问题答案的学习来源结束区间。先由失败测试确认，再修复并完成最终 24 项专项、后端编译和两项类型检查。长进程结果对应其启动时的模块快照；新入口回放只提交普通用户消息，运行时也未安装 UserQuestions，所以该原生分支改动不影响上述回放。原生分支最终状态以 24 项专项为证，作者仍需在完整权限环境跑最终标准全套。

新增 `tests/routing-bindings.test.ts` 的 20 项测试名：

- `the product input endpoint resolves an observed reply without invoking the router`
- `an explicit question id selects its owner among competing pending requests`
- `an explicit approval id selects its owner among competing pending requests`
- `conflict binding falls back to model classification even for a bare continuation`
- `duplicate-owner binding falls back to model classification even for a bare continuation`
- `deleted binding falls back to model classification even for a bare continuation`
- `closed binding falls back to model classification even for a bare continuation`
- `background binding falls back to model classification even for a bare continuation`
- `inferred binding falls back to model classification even for a bare continuation`
- `unknown binding falls back to model classification even for a bare continuation`
- `foreground and background provenance reach the classifier without granting a binding`
- `a corrected bound route retracts learning and invalidates replies produced by that route`
- `a bound route still checks another project before executing a write`
- `restart expires pending requests while retaining verified message provenance`
- `a stale steering reference cannot bypass the classifier`
- `the public input rejects invented ownership fields and an unrelated session`
- `same-round explicit steering has a zero-call receipt and retractable learning`
- `an autonomous background relay cannot change the foreground topic or a bare continuation`
- `a native delayed question answer keeps its host call identity in the routing receipt`
- `correcting a binding ancestor also invalidates replies derived through that binding`

另在现有 `tests/approval.test.ts` 两项中核实桥接期间引用的 callId/questionIds、实际拥有者，以及完成后引用关闭。评测 45 项中更新了 3 项预期：reply/pending 进入产品绑定而非 shadow-only、steering 有独立回执、可靠 live steering 不再等待慢分类器。

[validation.json](../../experiments/routing-rethink-step6/validation.json) 保存全量产品通过名称、4 项失败名称、最终专项名称、评测测试名称、评分和相关文件 SHA-256。原始日志位于本机 `%TEMP%/routing-step6-{product,targeted-final,eval-node,python,full,ablated}.log`；这些临时日志不纳入提交。

## 作者执行的验证、真实评测与提交命令

标准构建/测试需要允许子进程的作者环境。本轮不尝试已明确受限的标准入口：

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
node --test eval/test/*.test.mjs
py -X utf8 -B -m unittest discover -s eval/test
git diff --check
```

真实模型部分本轮未执行。沿用作者已配置好的模型环境，不向本任务提供凭据。使用新输出文件名；已存在时换编号。建议先 dev，固定分析后再 test：

```powershell
$model = 'YOUR_MODEL'
$env:EVAL_REFRESH = '1'
# 如需核算账单，另设置实际模型每百万输入、缓存命中、输出 token 的价格：
# $env:EVAL_PRICES = 'input,cached,output'
foreach ($split in @('dev', 'test')) {
  $full = "eval/data/interleave-v1/predictions/step6-real-$split-full-r1.jsonl"
  $drop = "eval/data/interleave-v1/predictions/step6-real-$split-drop-bindings-r1.jsonl"
  node eval/run-router.mjs --data eval/data/interleave-v1/sessions.jsonl --split $split --mode open --cards --model $model --out $full
  if ($LASTEXITCODE -ne 0) { throw 'Full replay failed' }
  node eval/run-router.mjs --data eval/data/interleave-v1/sessions.jsonl --split $split --mode open --cards --state-ablation drop-bindings --model $model --out $drop
  if ($LASTEXITCODE -ne 0) { throw 'Ablated replay failed' }
  py -X utf8 -B eval/score.py eval/data/interleave-v1/sessions.jsonl $full --split $split --ablation $drop
  if ($LASTEXITCODE -ne 0) { throw 'Scoring failed' }
}
```

标准验证完成并审查 diff 后，作者可按本轮文件范围提交；不要使用 `git add .` 带入用户原有目录：

```powershell
git add -- src/index.ts src/llm-router.ts src/store.ts src/types.ts src/routing-bindings.ts dist/index.js dist/index.d.ts dist/llm-router.js dist/llm-router.d.ts dist/store.js dist/store.d.ts dist/types.d.ts dist/routing-bindings.js dist/routing-bindings.d.ts eval/lib/product-replay.mjs eval/test/routing-v1.test.mjs eval/README.md tests/approval.test.ts tests/routing-bindings.test.ts docs/design/routing-rethink-step6-report.zh.md experiments/routing-rethink-step6/validation.json
git diff --cached --stat
git commit -m "Route explicit replies and live request bindings without classification"
```

以上命令本轮没有执行。没有修改用户原有未跟踪目录，也没有更新用户运行 profile；本轮不提供 push 或发布命令。

## 尚未覆盖与风险

- 没有增加桌面“回复此消息”的按钮，也没有给普通 DSH 编辑器自动补引用。新入口可由可信客户端/适配器调用；原生问题答案路径已集成。真实桌面交互尚未验收，不能把定向集覆盖率当作日常编辑器覆盖率。
- 插件维护的等待 ID 重启后安全失效，不跨运行恢复回调；旧消息来源可继续解析。原生延迟问题的恢复能力仍取决于 DSH 投影和可用 Worker。
- 回放的前台/待答事件由受控夹具模拟，并非实际浏览器点击。假模型和脚本工具不证明真实模型理解、真实并发工作质量或 UI 可用性。
- attention 是来源提示，不是注意力或已读判断；没有明确引用的省略句仍可能误路由。
- 保留既有检查及学习边界不等于能撤销外部工具已经发生的副作用。

## 8. 作者补测：真实模型评测与 attention 修正

模型 DeepSeek V4.1 Flash（OpenCode Go，`reasoning_effort: none`，cards），2026-11-02 跑。v0 和第三步那次逐条配对，按会话自助抽样给 95% 区间。

### v0：第六步 vs 第三步

| 组 | 第三步 → 第六步 | 修好 / 改坏 | 差值 [95% CI] | 改坏里：请求失败或格式无效 / 留在当前话题 / 其他 |
|---|---|---:|---|---|
| open dev | 98.2% → 97.5% | 24 / 36 | −0.64 pp [−1.68, +0.36] | 6 / 14 / 16 |
| open test | 99.1% → 98.8% | 7 / 3 | +0.84 pp [+0.00, +1.75] | 1 / 0 / 2 |
| closed dev | 96.9% → 96.5% | 65 / 65 | 0 [−3.71, +3.77] | 12 / 33 / 20 |
| closed test | 99.8% → 97.4% | 3 / 16 | −2.74 pp [−4.32, −1.43] | 8 / 5 / 3 |

closed test 的下降区间不跨 0。一半来自服务商侧的失败回退（该组请求失败/格式无效 4 → 10 条），另一半是模型把明确开新事的消息（"ok new thing — I'm moving out…"）或别的话题的追问留在当前话题，理由里直接写"当前挂载 t2……"。open dev 的改坏里"留在当前话题"也从第三步对基线的 8 条升到 14 条。费用每千条 +0.1% 到 +3.4%（每条多 41–138 个输入 token）。

原因：v0 没有后台事件，`attention` 里只有 foreground，而 foreground 就是当前挂载话题的最后一条回复，和 `currentId`、`recent` 重复；再加上一句"不能取代前台焦点"的说明，模型更倾向于留下。

**修正**（本节一起提交）：`buildPayload` 只在候选里确实有后台完成/通知时才带 `attention`（带上时仍附 foreground 作对照）；否则请求里没有这个字段，也不追加那句说明。新增测试"a foreground reply alone adds no attention field, so ordinary requests stay as they were"。v0 没有后台事件、没有绑定，修正后每个路由请求与第三步逐字相同，所以 v0 不再重跑，结论沿用第三步（第三步报告第 8 节）。

### v1：带绑定 vs 去掉绑定（修正前那次）

| 组 | 准确率 | 绑定子集 | 成对两边都对 | harm/100 | 调用/条 | $/千条 |
|---|---|---|---|---:|---:|---:|
| dev 带绑定 | 96.5% | 100%（84） | 100% | 4.2 | 0.77 | 0.169 |
| dev 去掉绑定 | 83.3% | 57.1%（84） | 0% | 42.4 | 0.85 | 0.347 |
| test 带绑定 | 96.9% | 100%（28） | 100% | 5.2 | 0.81 | 0.179 |
| test 去掉绑定 | 83.3% | 57.1%（28） | 0% | 41.7 | 1.00 | 0.391 |

绑定全部生效、全部落对；去掉后模型只能猜，绑定子集掉到 57%，成对案例全错，危害约十倍。纠正后下一条全对，卡片/关键词/事实无残留。注意 v1 是专门造的定向集，绑定消息占比远高于日常；日常收益取决于客户端多常送绑定（目前只有原生延迟提问会送）。

### v1：修正后重跑

| 组 | 准确率 | 绑定子集 | 成对两边都对 | harm/100 | 调用/条 | $/千条 |
|---|---|---|---|---:|---:|---:|
| dev 带绑定 | 95.8% | 100%（84） | 100% | 4.2 | 0.78 | 0.139 |
| dev 去掉绑定 | 82.6% | 57.1%（84） | 0% | 43.8 | 0.87 | 0.309 |
| test 带绑定 | 95.8% | 100%（28） | 100% | 4.2 | 0.84 | 0.161 |
| test 去掉绑定 | 84.4% | 57.1%（28） | 0% | 40.6 | 0.99 | 0.354 |

和修正前逐条比，落点不同的几乎都是新建话题的随机 id（同样是新建）；真正换了落点的只有个别同名、大目录和一次性消息，dev 差约 2 条、test 约 1 条，在模型波动范围内。绑定子集、成对案例、纠正后撤回和 harm 两次完全一致。结论不变：可靠绑定直接落点，比让模型猜少一半费用、少约九成危害。
