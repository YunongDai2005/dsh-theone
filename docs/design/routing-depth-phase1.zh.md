# 路由深化 · 阶段 1：尺子、缓存重排、短理由（任务说明）

背景和整体方案见 `docs/design/routing-depth.zh.md`（A1、A2 和「三个维度怎么量」）。这一阶段只做三件事，都不改「怎么判断」的逻辑：

1. **尺子**：评测和插件都按层记录调用次数、token、缓存命中、延迟；评分报伤害代价。
2. **缓存重排（A1）**：路由请求里不变的内容放前面、会变的放后面，系统提示词每次完全一样，让 DeepSeek 的前缀缓存多命中。
3. **短理由（A2）**：模型输出的 JSON 把 `reason` 挪到最后、限 40 字，少生成一些 token。

真实模型的评测这次不跑（环境里没有 API Key，不要找、不要绕）。你要做到的是：代码改好、测试通过、离线的「可缓存前缀」统计给出改前改后的数字，评测脚本在 `--dry-run` 下能跑通。真实评测由我们之后跑。

## 工作方式

- 直接用 shell 执行命令，不要使用子代理和 node_repl。
- PowerShell 下用 `npm.cmd`（`npm.ps1` 被拦）；`python` 是 Windows 商店的空壳，用 `py`；读中文文件加 `-Encoding UTF8`。
- 仓库里这些未跟踪的文件夹不要动：`.claude/`、`.dsh/`、`.workbuddy/`、`experiments/`、`outreach/`、`promo*/`、`scripts/ui-check.mjs`。`git add` 只加你改过的具体文件。
- 当前分支 `routing-depth`，就在这个分支上提交。提交作者用仓库已配置的 git 用户，提交信息里不要加任何 Co-Authored-By 行。
- `dist/` 是构建产物，必须和源码一起提交（`npm.cmd run build`）。

## 1. 先量一遍「改之前」

在动任何代码之前，先写好第 4 节的 `eval/prefix-share.mjs`，在当前代码上跑一遍，把结果记下来（汇报里要用）。

## 2. 缓存重排（`src/llm-router.ts`，必要时 `src/index.ts`、`src/history-catalog.ts`）

### 2.1 路由输入的字段顺序

`buildPayload` 现在按 `text → contexts → currentId → recent → …` 输出，第一项就是本轮消息，后面全部无法命中缓存。改成下面的顺序（JSON 的键顺序就是插入顺序）：

1. `contexts`：每个话题只放不常变的字段：`id`、`title`、`summary`、`entities`、`keywords`、`project`。
2. `states`：每个话题常变的字段单独成一个数组，元素是 `{ id, lastState?, activity?, status? }`，顺序和 `contexts` 一样；某个话题这三项都没有就不放。
3. `projects`
4. `historyIncomplete`
5. `corrections`
6. `symbols`
7. `recent`
8. `running`
9. `recheck`
10. `currentId`
11. `text`（最后）

可选字段没有时照旧不出现。各字段的截断长度、`PAYLOAD_STEPS` 的逐级裁剪、`PAYLOAD_MAX`、脱敏都不变。

`ROUTING_PROMPT` 里描述话题目录的地方要跟着改：说明 `states` 是各话题的当前状态 / 最近活跃时间 / status，用 `id` 对应 `contexts`。原来写「目录中的 activity」「目录中的 project」「status 为 done」的句子，改成指向正确的位置。意思不要变。

### 2.2 话题的顺序固定

话题超过 16 个时，`HistoryCatalog.candidates` 按得分排序返回，每条消息顺序都不同，缓存从第一个话题起就断了。

- `RoutingInput` 新增可选字段 `catalogOrder?: readonly string[]`（话题 id 在目录里的原有顺序）。
- `routingPayload` 仍然用传入的 `contexts` 顺序做裁剪（排在后面的先裁掉，这是按得分的），裁剪完以后，输出到 payload 时按 `catalogOrder` 重新排；当前话题不特殊处理。没给 `catalogOrder` 就保持传入顺序。
- `src/index.ts` 里所有调用 `router.decide` 的地方（`classify` 的快速判断、复核、翻目录的几页，以及「分错了」的 `reroute` 等），都传 `catalogOrder: allContexts.map(c => c.id)`（或该处能拿到的完整目录顺序）。

### 2.3 系统提示词每次一样

`routingPrompt(payload)` 现在按 payload 里有没有 `symbols`、`projects`、`running`、`recheck` 追加不同的段落，系统提示词因此会变，复核调用也没法复用第一次调用的缓存。改成：

- 系统提示词固定为 `ROUTING_PROMPT + FACTS_PROMPT + PROJECTS_PROMPT + RUNNING_PROMPT + RECHECK_PROMPT`，和 payload 无关。保留 `routingPrompt(payload)` 这个函数和签名（评测和测试在用），只是返回值不再依赖参数。
- 每段的开头都写明「（可能没有）」，没有这个字段时什么都不用做。`RECHECK_PROMPT` 现在没写，要补上。
- 各段里「输出 JSON 时增加字段 …」的说法删掉，统一写进 2.4 的输出格式。

这样，同一条消息的复核调用和第一次调用，系统提示词完全一样，payload 也只在末尾附近多了 `recheck`，大部分输入能命中缓存。

## 3. 短理由（`src/llm-router.ts`）

`ROUTING_PROMPT` 里的输出格式改成下面的字段顺序，`reason` 放最后、不超过 40 字：

```
{"action":…,"contextId":…,"relatedIds":[…],"imports":[…],"title":…,"historyIndependent":…,"projectId":…,"candidateIds":[…],"question":…,"reason":"不超过40字的判断依据"}
```

- `imports`：没有 `symbols` 时为空数组；`projectId`：不是 CREATE、或没有 `projects` 时为 null。
- 其他字段的含义和约束不变。
- `validateRoutingDecision` 保持现在的宽容度（`reason` 仍然允许最长 600、保存时截到 240），不能因为模型偶尔写长了就判失败。
- 「一句话要同时用到多个已有话题」那一段、`FACTS_PROMPT` 等提到字段的地方，表述要和新顺序一致。

原理：`action`、`contextId` 在 `reason` 之前生成，`reason` 本来就影响不了选哪个话题；放到最后并缩短，只是少生成一些 token。`relatedIds`、`candidateIds` 现在排在 `reason` 后面，改完排在前面，这可能轻微影响它们，要靠之后的真实评测确认。

## 4. 尺子

### 4.1 离线的「可缓存前缀」统计：`eval/prefix-share.mjs`（新）

不调用模型，估算前缀缓存最多能命中多少：

- 读 `eval/data/interleave-v0/sessions.jsonl`，按 `--split dev|test`（默认 dev）和 `--mode closed|open`（默认 open）逐条重放，**用真实标签当路由结果**（closed 用给定的话题；open 时第一次出现的 thread 当作新建话题，话题的描述方式和 `eval/run-router.mjs` 的 `describe` 一致：标题用该 thread 第一条消息截断，`keywords` 用 `topicTerms`，`lastState` 用最后一条消息）。
- 每条消息按插件的方式拼出完整请求：`routingPrompt(payload)` 加 `JSON.stringify(routingPayload(input))`，`input` 带 `recent`（最近 12 条）。
- 对每个请求，算它和**同一段对话里之前任意一次请求**的最长公共前缀（系统提示词和用户消息首尾相接算一个字符串）。按 DeepSeek 以 64 token 为单位缓存，这里粗略按「每 1.5 个中文字符或 4 个英文字符约 1 token」换算，向下取到 64 token 的整数倍。也给出纯字符数的比例。
- 输出：请求数、平均请求长度（字符、估算 token）、平均可缓存比例（按估算 token 加权），中英文分开各一行再给总计。加 `--json` 时输出机器可读的结果。
- 只从 `dist/` 导入插件代码，和 `run-router.mjs` 一样。

先在改动前跑（第 1 节），改完再跑，两组数字都写进汇报。目标是 open 模式的可缓存比例明显提高；如果提高不明显，查清楚是哪个字段在每条消息都变（比如评测里当前话题的 `keywords` 每条都会变），在汇报里说明，不要为了数字去改评测的话题描述方式。

### 4.2 评测记录每次调用（`eval/run-router.mjs`、`eval/lib/llm.mjs`）

- 每次模型调用记录**真正发出请求到收到完整回答**的耗时（不含排队、不含 `EVAL_RPM` 的等待）。从缓存读出的回答不计耗时。
- 每条预测行新增：
  - `calls`：这条消息实际调用模型的次数（快路为 0；复核算 2；卡片不算，卡片另有 `card_usage`）。
  - `tier`：这条消息最后由哪一层定的：`fast`（快路）、`quick`（快速判断）、`recheck`（复核）。
  - `latency_ms`：各次调用耗时之和（快路为 0）。
  - `usage` 照旧是各次调用之和，包括 `cache_hit`；另加 `usage_by_call`：每次调用各自的 `{input, output, cache_hit}`，按调用顺序。
- 原有字段（`via`、`elapsed_ms`、`rechecked` 等）保留，旧的预测文件仍然能被评分。

### 4.3 评分报告（`eval/score.py`）

在现有输出上增加（旧的预测文件缺这些字段时显示 `–`，不能报错）：

- 每条消息平均调用次数；按 `tier` 的条数和比例。
- 缓存命中率：`cache_hit / input`（按 token 加总）。
- 延迟：`latency_ms` 的中位数和 90 分位，快路按 0 算；没有 `latency_ms` 的旧文件不报。
- 伤害代价：用文件里已有的 `COST` 表，算每 100 条计分消息的平均代价。
- 每千条消息的花费（已有就保持）。
- 表格和 JSON 输出都要有这些。`python3 -m unittest discover -s eval/test` 里补测试。

### 4.4 插件的回执（`src/llm-router.ts`、`src/index.ts`）

`RouterReceipt` 新增可选字段：

- `tier?: 'rules' | 'quick' | 'recheck' | 'review'`：这条消息最后由哪一层定的。规则快路、目标轮次、只有附件、模型不可用时的规则兜底都是 `rules`；复核跑过并且采用了复核结果是 `recheck`；新建前翻目录改变了结论是 `review`；其余调过模型的是 `quick`。
- `calls?: number`：这条消息调用路由模型的次数（快速判断、复核、翻目录每一页各算一次）。
- `cacheHitTokens?: number`：各次调用命中缓存的输入 token 之和。

`classify` 现在合并复核和翻目录的 usage 时丢掉了 `prompt_cache_hit_tokens`，要一起加上。`DshRouter` 已经从 `cacheReadTokens` 读出命中数，保持。

回执已经随路由记录保存（`recordRouteDetail`），不需要新表。界面（`src/client.ts`）这次不改。`src/feedback.ts` 的诊断信息里可以加上 `tier` 和 `calls`（不含聊天内容），加不加你看，加了要有测试。

## 5. 测试和验收

- `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run eval:test`（Windows 上把其中的 `python3` 换成 `py` 手动跑一次即可，不要改 package.json）全部通过。
- `tests/llm-router.test.ts` 补测试：payload 键的顺序（`text` 在最后、`contexts` 里没有 `lastState`/`activity`/`status`、`states` 对得上）；`catalogOrder` 的重排和裁剪按传入顺序；`routingPrompt` 对不同 payload 返回同一个字符串；新的输出字段顺序下 `validateRoutingDecision` 照常工作，`reason` 写长了不判失败。
- `tests/` 里有用到 `contexts[].lastState` 等旧位置、或断言提示词内容的测试，按新结构调整，并在汇报里逐条说明为什么改。
- 回执：补测试覆盖 `tier`、`calls`、`cacheHitTokens`（快路、快速判断、复核、翻目录几种情况）。
- `node eval/run-router.mjs --mode open --policy theone --recheck --cards --dry-run`（参数以脚本实际支持的为准）能跑通，`py eval/score.py` 能读它的输出并显示新指标。

## 不做

- 不跑真实模型的评测，不找、不读任何 API Key。
- 不改路由的判断规则（快路、复核触发条件、翻目录、`settleUnclear` 等）。
- 不改界面、README、版本号、`.github/release-notes/`，不发版，不推送。
- 不做流式提前开工（方案里 A2 的另一半，先不做）。
- 不动第 4.1 节以外评测的话题描述方式。

## 汇报要回答

1. 改动前后 `prefix-share.mjs` 的数字（open / closed，中英文和总计）。可缓存比例的上限主要被哪些字段卡住？
2. 一条典型消息的请求，改前改后各多长（字符、估算 token），系统提示词变长了多少。
3. 改了哪些现有测试，为什么。
4. 有没有哪里你觉得会影响路由准确率、需要在真实评测里重点看的。
5. 所有测试命令和结果。
