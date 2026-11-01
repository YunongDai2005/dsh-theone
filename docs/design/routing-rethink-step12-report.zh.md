# 路由重想：第一、二步实施报告

2026-11-01，分支 `routing-depth`，起点 `efa742e`。

第一、二步已经实现，`dist/` 已同步。固定夹具验证了产品与回放的候选、调用顺序、最终落点及自动收尾一致；开关影子记录前后，路由请求与修改前的基线一致。本轮没有调用真实模型 API，没有查找或读取 API Key，没有推送。

**提交未完成，标准验证命令也并非全部通过。** `.git` 在沙箱中只读，第 0 步执行 `git add` 就报 `index.lock: Permission denied`，因此没有创建任何提交，所有改动留在工作区。Node 启动子进程受到 `EPERM` 限制，影响标准构建、测试入口；已完成下面列出的替代验证，并明确保留这项限制。

## 第 0 步：冻结上一轮研究

开始改代码前运行了 `py -B experiments/routing-rethink/verify.py`，通过：50 个会话、2,466 条消息、7 份预测、17,262 行预测、4,932 次源码/构建产物 payload 比对、15 个源码哈希、17 条本地链接。

原研究报告和 `experiments/routing-rethink/` 保留为修改前的历史记录，没有把本轮结果回填成旧研究结论。研究验证脚本锁定了当时的源码哈希，后续若验证该历史快照，应使用对应的旧源码；不能用修改后的源码假装通过旧哈希检查。

尝试的暂存命令：

```powershell
git add -- docs/design/routing-rethink.zh.md experiments/routing-rethink
```

返回：

```text
fatal: Unable to create 'D:/doc/GitHub/dsh-theone/.git/index.lock': Permission denied
```

仓库配置的身份仍是 `YunongDai2005 <yuriddaaii@gmail.com>`，HEAD 仍是 `efa742e`。没有改变 Git 配置、绕过沙箱、写入署名附注或尝试推送。原计划分成研究、真实链路回放、影子记录三个提交；由于暂存前置条件受阻，三个步骤均未提交。

## 第 1 步：回放实际产品链路

`eval/run-router.mjs` 默认使用 `product-v1`。`eval/lib/product-replay.mjs` 在临时目录启动真实 DSH 会话、SQLite 查询、TheOne 网关和实际的 `dist/index.js`，将模型传输接到评测客户端。没有另外复制一份分类函数。

因此候选筛选、`HistoryCatalog.candidates`、初判、第二次判断、最多三页的目录复查、失败回退、`settleUnclear`、话题创建/恢复、纠正路由及纠正学习都走产品代码。改动仅给产品加观察字段，没有更改路由条件、提示词、payload 构造或调用决策。

每条预测包含：

| 字段 | 内容 |
| --- | --- |
| `trace.candidateIds` | 实际参与判断的候选；无需筛选的快捷路径为空 |
| `trace.initial` | 初判结果 |
| `trace.recheck` | 是否尝试、触发原因（新建、不确定、证据冲突）、相关线索、是否采用复核结果 |
| `trace.review` | 是否翻目录，以及各页实际包含的话题 ID |
| `trace.autoSettled` / `trace.final` | 是否自动收尾，以及计划写入后真正的落点 |
| `call_details` | 产品侧逐次调用的层级、候选、是否发送、耗时、模型、token 和错误码 |
| `usage_by_call` | 传输侧每次实际请求，包括重试：层级、输入/缓存命中/输出 token、耗时 |
| `calls` / `logical_calls` | 物理请求数 / 产品调用数，避免把重试或磁盘响应缓存混成一次 |
| `card_usage` / `auxiliary_usage` | 话题卡与纠正学习调用的独立 token、层级和耗时；评分计入总费用，独立于路由延迟 |

失败尝试仍保留记录；尚未发出的调用标记 `sent: false`。本地响应缓存命中没有本轮实际传输次数。模型没有返回的 usage 不能视为实际账单证明。

旧模拟器保留在 `eval/run-router-legacy.mjs`，通过 `--replay legacy-v0` 显式选择。旧文件没有 `replay` 标记时，评分按 `legacy-v0` 处理。两个协议分表显示，混进同一个预测文件会报错。生成端和评分端都会拒绝缺失、重复和未知预测键，整场会话缺失也会报错。

`eval/README.md` 已同步新入口、缓存、协议边界和旧实验的使用方式。

## 第 2 步：来源和焦点只做影子记录

新增 `src/routing-shadow.ts`，数据库是 `<contexts.db>.shadow.db`；内存测试使用独立内存库。记录包括消息 ID、所属话题、来源、会话序号和事件序号组成的显示顺序，以及回复所对应的用户输入。不保存消息正文或模型 payload。

- 来源区分用户、前台回复、后台完成/通知、系统提示。没有具体话题的全局系统提示允许 `topicId: null`；路由提示关联到被路由的用户输入。
- 后台 Worker 的完成以不可见后台事件保存；实际显示的通知另存为后台来源。两者都不更新前台焦点。
- 焦点关联具体用户输入和最新回复；旧输入、旧会话、迟到的临时回复、同一输入下倒序到达的回复，均不能覆盖较新的焦点。
- 结构化问题与批准请求各自保存拥有者话题，随宿主请求打开/关闭。正文以问号结尾的回复只标记为 `question-form` 推测，不假装已可靠理解或匹配了后续答案。
- 简单独立算术表达式可标记 `arithmetic-form` 临时问答。回复完成后，影子焦点恢复到原话题和原消息；实际产品当前话题仍完全遵循原路由。通用的一次性问答语义识别不在本轮实现范围。
- 元数据、待答拥有者、临时返回点均持久化；重复事件幂等。初始化/写入失败只记录 `shadowError`，不能阻止路由和回复。

`routingShadow` 是观察开关，默认开启。路由代码不会读取影子库来构造请求、挑选候选或改变落点；也没有增加用户选择流程。

## 验证结果

完整测试名称、分组数量、构建产物与关键源码 SHA-256、包校验、命令状态见 [validation.json](../../experiments/routing-rethink-step12/validation.json)。不把重复复测相加当作新增测试数。

| 要求的命令 | 实际结果 |
| --- | --- |
| `npm.cmd run build` | 两段 TypeScript 编译通过；`scripts/build-client.mjs` 启动 esbuild 子进程时报 `EPERM`。后端最终源码另经 `tsc -p tsconfig.json` 生成；客户端使用同版本原生 esbuild、相同参数完成构建，最终 `dist/client.js` 与原提交无差异 |
| `npm.cmd run typecheck` | 通过，最终源码已复测 |
| `npm.cmd test` | 标准 tsx/Node 测试入口无法创建测试子进程，`EPERM` |
| `node --test eval/test/*.test.mjs` | 标准隔离入口无法创建测试子进程，`EPERM`；单进程模式 30/30 通过 |
| `py -B -m unittest discover -s eval/test` | 22/22 通过 |

替代测试没有修改仓库里的既有测试来跳过断言：

1. `node --experimental-transform-types --test --test-isolation=none tests/*.test.ts`：报告 463 项，459 通过、4 处受限。受限的是两个客户端文件加载时调用 esbuild，以及打包测试内部调用 npm、统计测试内部调用 Node。两个文件错误占位不能当作两个实际测试用例。
2. 客户端先用原生 esbuild 生成临时包，再在临时副本中保留原测试断言，7/7 通过：`client-topic-folder.test.ts` 2 项，`client-update.test.ts` 5 项。
3. 打包按 `pack-plugin.mjs` 的原白名单建立临时目录，从 shell 执行离线 `npm pack`。101 个文件，实际 tar 成员与 npm 清单一致，关键 dist 文件与最终工作区逐字节一致，包含新的影子模块，没有本地私有/测试目录。覆盖原打包用例 1 项；未发布或安装该包。
4. 统计测试原来的计算断言通过，再从 shell 运行实际 CLI：输出 4 条路由且没有夹具中的秘密文本。覆盖原统计用例 1 项。
5. 最后两个影子边界修正和纠正回放补齐后，复测 `routing-replay`、`routing-shadow`、`approval`、`mid-reply`、`manage`、`lifecycle`、`route-options` 共 84/84 通过。
6. 实际 CLI 桩模型冒烟：2 个会话各取前 6 条，闭目录 12 条、开目录并启用卡片 12 条，全部生成唯一完整预测并成功评分。桩输出的 token/费用估计和准确率不构成真实模型结果。

### 本轮关键测试名称

`tests/routing-replay.test.ts` 共 20 项：每个场景分别在 `shadow=false` 和 `shadow=true` 下运行。

| 场景 | 覆盖内容 |
| --- | --- |
| `quick` | 普通初判 |
| `fast` | 不调用模型的续接路径 |
| `conflict` | 独有线索与初判冲突，触发复核 |
| `unclear` | 不确定后自动选已有话题 |
| `unclear-empty` | 空目录不确定后自动新建 |
| `create` | 新建前第二次判断 |
| `recheck-invalid` | 复核无效，保留初判 |
| `review` | 55 个话题，实际复查三页目录 |
| `review-invalid` | 目录页无效后的产品回退 |
| `model-error` | 模型失败后的规则回退 |

这些测试比较源码产品与 dist 回放的候选、初判、复核、目录页、最终 action/落点、自动收尾、调用层级及实际请求序列。新建后的随机话题 ID 仅在比较时归一为 CREATE。`routing-flow-baseline.json` 在修改产品前生成；对固定夹具的 `{system, user, maxTokens}` 请求序列保留 SHA-256，并断言调用次数和落点，开关影子记录均逐字节匹配。可见路由提示的序列化也有完成状态断言。

`tests/routing-shadow.test.ts` 共 9 项，名称如下：

- `main-chat visible messages retain their identity, topic, source and display order`
- `background B completion and its displayed notice cannot take foreground focus from A`
- `two pending questions and an approval keep independent topic owners`
- `a temporary one-off reply returns shadow focus to the ongoing work`
- `late user bindings, replies and temporary completions cannot overwrite newer focus`
- `restart recovers provenance, focus, temporary return and unresolved owners idempotently`
- `an actual arithmetic detour restores only shadow focus, leaving product routing unchanged`
- `late events from an earlier main-chat session cannot replace a newer session focus`
- `failed shadow writes cannot stop a real route or its reply`

此外，在既有 `approval.test.ts` 的 2 项真实宿主问题/批准测试，以及 `mid-reply.test.ts` 的后台完成场景中增加了拥有者、来源和焦点断言。

`eval/test/product-replay.test.mjs` 共 5 项：

- `product replay executes the real fast path and writes complete unique predictions`
- `open product replay creates a real topic, rechecks and restores it for the next turn`
- `every transport attempt retains its own layer, tokens and duration`
- `legacy experiments are explicitly labelled and cannot silently replace the product policy`
- `correction replay records its candidates and lets real correction learning update the next request`

Python 评分新增 4 项：`test_missing_predictions_are_errors_including_a_whole_session`、`test_duplicate_predictions_and_mixed_replays_are_errors`、`test_protocols_are_reported_separately_and_extra_keys_are_rejected`、`test_correction_learning_has_a_separate_bill`。完整 22 项名称在验证清单中。

## 作者自行运行真实评测

以下命令本轮未执行真实模型部分。请在作者自己已配置模型访问的终端运行；无需向本任务提供凭据。先在允许子进程的本地环境完成标准构建和四项检查：

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
node --test eval/test/*.test.mjs
py -B -m unittest discover -s eval/test
```

将模型与价格占位符换成此次实际使用的值；价格顺序是每百万输入、命中、输出 token 的美元单价。`EVAL_REFRESH=1` 禁用评测磁盘响应缓存，服务端前缀缓存命中仍按返回的 usage 统计。

```powershell
$model = '实际模型 ID'
$env:EVAL_PRICES = '输入单价,命中单价,输出单价'
$env:EVAL_REFRESH = '1'

foreach ($split in @('dev', 'test')) {
  foreach ($mode in @('closed', 'open')) {
    $out = "eval/data/interleave-v0/predictions/product-v1-$mode-$split-cards.jsonl"
    node eval/run-router.mjs --replay product-v1 --mode $mode --policy theone --cards --split $split --model $model --out $out
    if ($LASTEXITCODE -ne 0) { throw 'Replay failed' }
    py -X utf8 -B eval/score.py eval/data/interleave-v0/sessions.jsonl $out --split $split
    if ($LASTEXITCODE -ne 0) { throw 'Scoring failed' }
  }
}
```

`--cards` 对应产品默认开启话题卡的配置；评测入口默认关闭卡片以便复现仅有用户文本的 v0 条件。若需要无卡片对照，另建输出文件并去掉 `--cards`，不要覆盖或混入已有结果。模型、价格、源码提交、卡片开关都应随结果保留；比较多个模型也使用不同的输出文件名。

需要保留旧模拟器作为对照时，使用独立协议和独立输出：

```powershell
node eval/run-router.mjs --replay legacy-v0 --mode open --policy theone --recheck --cards --split dev --model $model --out eval/data/interleave-v0/predictions/legacy-v0-open-dev-reference.jsonl
py -X utf8 -B eval/score.py eval/data/interleave-v0/sessions.jsonl eval/data/interleave-v0/predictions/legacy-v0-open-dev-reference.jsonl --split dev
```

不要把两个协议当作同口径的前后提升。dev/test 分开，完整结果才能评分；用 `--limit` 冒烟产生的少量预测不能拿全量数据评分。

## 发现的问题和证据边界

- 新回执最初含有嵌套 `undefined`，DSH 拒绝把可见提示写入会话。已改为深层 JSON 序列化并补上完成状态断言，相关回归通过。
- 路由提示最初缺少话题归属；同一输入的倒序回复也可能覆盖较新回复焦点。两项均先通过失败测试复现，再修正并复测。
- 简单算术标记的后缀处理最初留下尾部空格，真实问答测试发现并修复。
- 纠正路由需要单独记录候选；纠正学习模型调用也会影响下一条输入。现在两者均走真实产品路径并独立记账，测试检查下一条请求实际包含学到的词。
- Windows 当前 Python 标准输出是 GBK，评分表中的 `B³` 会造成打印异常；上面的评分命令使用 `-X utf8`，已验证成功。
- 影子焦点是消息顺序与来源的观察，不是用户已读状态。问号推测和算术形式标记均保留依据，不声称具备通用语义识别。
- 回放使用隔离临时会话和给定目录快照，不扫描作者的真实历史；消息顺序发送，Worker 回复使用 `turn.reply`（v0 缺失时为空），不执行 Worker 工具。它验证完整路由控制流，不证明真实多模态、后台并发或任务执行质量。后台来源/焦点另由产品集成测试验证。
- 真实模型准确率、前缀缓存收益、成本和速度尚未验证。本轮没有获得可宣称为真实模型提升的新分数。
