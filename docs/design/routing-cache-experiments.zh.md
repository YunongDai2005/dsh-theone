# 路由缓存实验：snapshot 与 compact

日期：2026-11-04。基线：`routing-depth`，`332907d185fa2b6136179aceb0c604a58f996436`。

已实现默认关闭的 `none`、`snapshot`、`compact`、`snapshot+compact` 四组。只进行了离线验证，未读取或使用模型 Key，未调用真实模型 API，未修改用户运行 profile。

四组各完成 v0 dev/test × open/closed 回放，每组 4,932 条消息，合计 **19,728 条预测、0 回放错误**；16 份预测均通过原评分器。默认组 **5,825 次请求与改动前逐字一致，0 处差异**（仅将随机 UUID 按同一出现顺序归一化）。三个实验组的有效输入物化后也分别与这 5,825 次基线输入完全相同。

这些结果证明协议、状态还原和评测管线工作，不能证明真实模型的缓存命中、准确率、费用或延迟改善。实验保持默认关闭，等待作者真实评测。

## 1. 先测首个分叉点

使用 `product-v1` 真正的产品入口、假模型、`--cards`，逐次捕获路由、复核、目录翻页和卡片请求。分叉统计只比较**同一会话中相邻的路由请求**，不把卡片请求插进路由序列。

旧 `prefix-share.mjs` 的金标模拟每条消息重算关键词，与现在产品的卡片/纠正更新时机不同。本次新增 [cache-audit.mjs](../../eval/cache-audit.mjs)，复用旧工具的字符/token 估算函数，但输入来自真实产品链路；候选检索、卡片节奏、复核、翻页、快路均保持原实现。

| 数据 | 模式 | 相邻比较数 | recent | recheck | contexts 成员 | contexts.summary |
|---|---|---:|---:|---:|---:|---:|
| dev | open | 1,971 | 1,891（95.94%） | 40 | 40 | 0 |
| test | open | 495 | 475（95.96%） | 10 | 10 | 0 |
| dev | closed | 2,014 | 1,886（93.64%） | 83 | 39 | 6 |
| test | closed | 513 | 471（91.81%） | 28 | 10 | 4 |

因此本轮必须冻结 recent，不能只冻结目录。v0 假模型轨迹中没有 system/attention 或 keywords 首变，不代表这些字段在真实会话中不变；专项测试另行覆盖 attention 从无到有、纠正、状态移除及复核。

## 2. 实现与边界

实现集中在 [routing-experiments.ts](../../src/routing-experiments.ts)，由 [DshRouter](../../src/llm-router.ts) 调用。产品配置 `routingVariant` 默认 `none`，允许上述四个字符串；可在作者自己的 Cordis 配置中选择，修改后重新加载插件。本轮未增加 Settings 页面或修改运行中的配置。

### A：snapshot

请求为 `{protocol:"snapshot-v1",epoch,snapshot,overlay}`。基础快照是 epoch 开始时的完整、已脱敏且已裁剪的路由输入，包含 recent。epoch 内基础内容逐字不变，变化按顺序追加到 overlay：

- `contexts.upsert` 按 id 新增或整条替换；`remove` 删除；`order` 在候选成员/顺序变化时提供完整有效顺序。合并由删除旧 id、更新目标卡片表达，纠正由最新 corrections 字段表达。
- `recent.drop` 删除旧滑窗的前部，再 `append` 新消息。通过最长后缀/前缀重叠计算，重复文本、不同角色及重写也可准确表达。
- `set` 整个替换其他变化字段，包括 states、projects、symbols、corrections、attention、running、recheck、currentId 和 text；`unset` 显式撤去已经不存在的字段。
- 提示词用两句话规定从左到右应用，最新值优先，路由只看物化后的有效输入；旧候选、旧 text 和旧 recent 不具有额外效力。

快照以 gateway sessionId 为键，quick、recheck 和 review 使用同一个管理器；每个请求在等待模型前完成序列化，并持有自己的输出解码映射，因此并发页不会改写已经发出的请求。无 sessionId 时不跨请求共享。最多保留 64 个会话，LRU 淘汰或进程重启只导致冷快照。

重建条件为：**累计 overlay 的估算 token 超过 `max(512, snapshot 估算 token × 50%)`，或 JSON user 长度超过 32,000 字符**。估算沿用 Han/1.5 + 其他字符/4，仅作为内部大小预算。50% 限制冗余历史，512 下限避免空/极小目录每条消息重建；32,000 是相对基线 24,000 字符输入上限的额外保险。没有改候选检索或基线裁剪策略。此阈值是首版工程选择，没有用 test 集调参。

本次各组有 100 个会话实例（50 个会话 × 两种模式）；snapshot 共形成 497 个快照（含 100 个初始快照），组合组 498 个，单 epoch 最多累积 14 条覆盖记录。

### B：compact

普通已有话题只需输出 `{"action":"EXISTING","contextId":"候选 routeId"}`。本地补默认理由 `match`，其余空值沿用原语义校验器的默认处理。CREATE 的 title、historyIndependent、projectId，CLARIFY 的 question/candidateIds，以及 relatedIds/imports 在需要时保留；显式 `false` 不被删掉，缺省与 false 不混同。可选理由为几个字，编码器保留已有的非默认理由，以便做严格往返检查。

只替换原提示词中的密集输出格式及相关空值要求，语义规则保留。复核沿用相同稀疏协议；**quick 仍为 2,048、recheck 仍为 8,192 maxTokens**，没有用输出截断制造收益。

目录项附加 `routeId`：长度超过 16 的真实 id 用 `@` 加 SHA-256 前 12 个十六进制字符，短 id 保留本身。别名由真实 id 决定，不按列表位置或快照重建重新编号。同次请求中别名碰撞会失败；解码只接受该请求实际提供的候选别名，已删除/未提供的别名报 `ROUTER_COMPACT_ID_INVALID`，不猜测目标。contextId、relatedIds、candidateIds 都经过映射；facts 和 projects 保持原 id。未增加全局共享的可变目标映射。

### 评测开关与 salt

[run-router.mjs](../../eval/run-router.mjs) 支持：

```text
--variant none|snapshot|compact|snapshot+compact
--cache-salt <string>
```

每行预测记录 variant；提供 salt 时另记 cache_salt。两项只允许 product-v1，拼错变体在创建模型客户端前报错。salt 只在评测传输层添加到 system 最开头：`[cache-salt:"本组标记"]`，覆盖路由、复核、翻页、卡片和 terms。未传 salt 时不增加任何字符。每组使用独立的新 salt，也会进入已有本地响应缓存的请求哈希。

## 3. 离线缓存上界

以下为**实际产品假模型请求**的 system + JSON user 长度，使用 Han 字符/1.5、其他字符/4 估算 token。每次取同会话所有此前请求中最长公共字符前缀，将可复用 token 向下取整到 64；每个会话第一条为冷请求，不跨会话预热。没有 salt，避免把标记长度算作方案收益。表中输入统计包含 quick/recheck/review，卡片单独计账，不混入路由缓存比例。

64-token 粒度是原工具的估算假设，**不是提供商保证**。没有模拟异步落盘、逐出、等待、上下文角色包装、真实分词或不同 thinking 参数下的缓存键。此表不能替代服务端 usage。

| split | mode | variant | 路由请求数 | 理想可缓存比例 | 平均输入 token/请求 | 未命中 token/请求 | 未命中 token/用户消息 |
|---|---|---|---:|---:|---:|---:|---:|
| dev | open | none | 2011 | 86.72% | 1910.5 | 253.8 | 258.9 |
| dev | open | snapshot | 2011 | 94.05% | 2393.9 | 142.4 | 145.3 |
| dev | open | compact | 2011 | 85.90% | 1891.5 | 266.7 | 272.2 |
| dev | open | snapshot+compact | 2011 | 94.11% | 2374.8 | 139.8 | 142.6 |
| dev | closed | none | 2054 | 87.70% | 2135.3 | 262.6 | 273.7 |
| dev | closed | snapshot | 2054 | 93.72% | 2623.1 | 164.6 | 171.6 |
| dev | closed | compact | 2054 | 87.65% | 2131.3 | 263.1 | 274.2 |
| dev | closed | snapshot+compact | 2054 | 93.70% | 2619.0 | 164.9 | 171.9 |
| test | open | none | 505 | 86.51% | 1921.3 | 259.2 | 264.4 |
| test | open | snapshot | 505 | 93.99% | 2409.2 | 144.7 | 147.6 |
| test | open | compact | 505 | 85.42% | 1902.3 | 277.4 | 283.0 |
| test | open | snapshot+compact | 505 | 94.07% | 2390.5 | 141.7 | 144.6 |
| test | closed | none | 523 | 87.66% | 2155.7 | 266.1 | 281.1 |
| test | closed | snapshot | 523 | 93.66% | 2645.6 | 167.8 | 177.2 |
| test | closed | compact | 523 | 87.45% | 2152.1 | 270.1 | 285.3 |
| test | closed | snapshot+compact | 523 | 93.70% | 2640.1 | 166.4 | 175.8 |

snapshot 将平均请求增加约 23%–25%，但此理想模型下绝对未命中输入减少约 37%–44%。compact 单独并不提高输入缓存比例；它针对输出冗余，真实输出量必须等模型实验确认。组合结果也不是两个百分比的相加。

## 4. 验证结果

| 验证 | 结果 |
|---|---|
| 新增覆盖层/协议测试 | 6/6 通过：新增、更新、删除、合并、纠正、recent 滑动、可选字段撤销、重建、会话隔离、初判/复核/翻页、所有动作与可选字段往返、失效短 ID、默认请求 |
| product-v1 变体/salt 集成测试 | 6/6 通过：四种配置、无 salt 请求不变、卡片/复核隔离、保留输出预算、非法参数拒绝 |
| 分叉统计/绝对未命中统计测试 | 2/2 通过 |
| 分层用量与 v0 配对工具测试 | 2/2 通过 |
| Node eval 全集 | 62/62 通过 |
| Python eval 全集 | 100/100 通过 |
| 产品测试全集 | 533 项：529 通过，4 项被 sandbox 的 `spawn EPERM` 阻止，不能表述为全绿 |
| 后端编译、tests 类型检查、client 类型检查 | 均通过；dist 后端产物已同步 |
| 完整假模型矩阵 | 16 组、19,728 条预测、0 回放错误；16 份 `score.py` 评分成功；所有组与对应基线的可评分消息配对均为 0 胜 / 0 负 |
| 实际 CLI 参数烟测 | `--dry-run --variant snapshot+compact --cache-salt offline-cli-ab --cards --mode open --limit 1`：51 条消息通过 |
| 全量有效输入等价 | 每组 5,825 次调用；快照物化、去掉仅作别名的 routeId 后，与修改前输入深比较均为 0 差异 |

四个受限项分别是 `tests/client-topic-folder.test.ts`、`tests/client-update.test.ts`、`tests/pack-plugin.test.ts`、`tests/route-stats.test.ts`。错误来自启动 Node/esbuild/打包子进程；没有修改或跳过这些测试。`npm test`、tsx 加载器和完整客户端打包在这个沙箱不适用；作者需在普通终端运行下方补验。

假模型的 usage/CLI 美元显示都是程序估算，实际模型请求和实际费用均为零。假模型按固定词形选择，绝不能用其准确率或输出长度宣称产品性能改善。

### 默认请求不变的证据

改源代码前，先用基线编译产物捕获 v0 全集、open/closed、cards 开启时的所有模型入口请求：5,093 次路由请求 + 732 次卡片请求 = 5,825 次。改动后相同假模型/参数再跑；按每会话同一出现顺序将随机 UUID 换成占位符，仅归一化身份，不删改提示词、文本、maxTokens、override 或 tag。

捕获条目包含 session_id、split、mode、system、user、maxTokens、override（如有）、tag。基线与默认组的 5,825 条序列逐字相同；`none` 与未指定 variant/未提供 salt 的集成测试也相同。JSON 数组去掉文件末尾换行后的 SHA-256 均为：

```text
f33ccf1d557e37fdd21ccd4f31e30ce3c68d6f69a05e914ca9107344faf78c07
```

原始离线证据位于未跟踪的 `.codex-runs/cache-experiments/`：`before-requests.json`、各变体的 `requests.json`/`summary.json`、`materialization.json`、`scores.json` 和测试日志。它们来自仓库自带 v0 数据，未读取用户真实 profile；大文件不加入提交。

### 重现与作者补验

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.tests.json
node node_modules/typescript/bin/tsc -p tsconfig.client.json --noEmit
node --experimental-transform-types --test --test-isolation=none tests/*.test.ts
node --test --test-isolation=none eval/test/*.test.mjs
py -X utf8 -B -m unittest discover -s eval/test
node eval/cache-audit.mjs --out eval/.cache/cache-audit
# 对比本机本轮保留的改动前请求：
node eval/cache-audit.mjs --variant none --baseline .codex-runs/cache-experiments/before-requests.json --out eval/.cache/cache-audit-none
# 普通、允许子进程的终端补验：
npm test
npm run build
```

Node v24.21.0 的默认 strip-only 模式不能读取仓库原有的 TypeScript parameter properties，因此测试命令增加 `--experimental-transform-types`，仍采用 isolation=none，不使用 tsx 子进程。Python 为 3.14.2。部分 PowerShell 的 stderr 重定向会把成功的进度输出包装成 NativeCommandError；应读取原生 `$LASTEXITCODE` 和完整结果。本轮最终 Python/类型检查/评分 CLI 已显式检查退出码。

## 5. 作者运行真实评测的命令（本轮未执行）

前提：作者已在自己的终端配置 OpenCode Go 的端点、凭据和真实模型 ID（`EVAL_MODEL`），如有套餐对应价格也设置 `EVAL_PRICES`。本轮没有检查这些配置；不把默认直连价格当成 OpenCode Go 的实际账单。

下面每个 mode 同时启动四组，四组 salt 后缀 00/01/02/03 等长且互不相同；run 每次新生成，避免复用此前实验缓存。每组 `--split all` 跑 dev/test，评分再分别报告。四进程各自还有回放并发，应按服务商**共享**限流配置每进程 EVAL_CONCURRENCY/EVAL_RPM，避免四倍冲击。

```powershell
$repo = (Get-Location).Path
$run = 'cache-' + [guid]::NewGuid().ToString('N')
$out = Join-Path $repo ('eval/data/interleave-v0/predictions/' + $run)
New-Item -ItemType Directory -Path $out | Out-Null
if (-not $env:EVAL_MODEL) { throw '请在作者终端设置 OpenCode Go 的实际 EVAL_MODEL' }
$variants = @('none', 'snapshot', 'compact', 'snapshot+compact')
foreach ($mode in @('open', 'closed')) {
  $jobs = for ($i = 0; $i -lt $variants.Count; $i++) {
    $variant = $variants[$i]
    $salt = '{0}-{1}-{2:00}' -f $run, $mode, $i
    $file = Join-Path $out ($variant + '-' + $mode + '.jsonl')
    Start-Job -ArgumentList $repo,$mode,$variant,$salt,$file,$env:EVAL_MODEL -ScriptBlock {
      param($repo,$mode,$variant,$salt,$file,$model)
      Set-Location -LiteralPath $repo
      node eval/run-router.mjs --replay product-v1 --data eval/data/interleave-v0/sessions.jsonl --split all --mode $mode --cards --model $model --variant $variant --cache-salt $salt --out $file
      if ($LASTEXITCODE -ne 0) { throw "回放失败：$variant / $mode" }
    }
  }
  $jobs | Wait-Job | Receive-Job
  if ($jobs.State -contains 'Failed') { throw '至少一组失败；不要混用不完整预测' }
  $jobs | Remove-Job
}
```

文件分别为 `none-open.jsonl`、`snapshot-open.jsonl`、`compact-open.jsonl`、`snapshot+compact-open.jsonl`，以及相应的 `*-closed.jsonl`。若只运行一个模式，删去另一个 mode 即可；为公平对照，不要只给某一组开启 cards。

保持 [score.py](../../eval/score.py) 原口径。它当前的 paired 功能属于 routing-v1 状态消融，v0 没有通用的 `--baseline` 参数；因此新增 [cache-report.py](../../eval/cache-report.py)，只读预测、复用 `score.evaluate/score_session` 做 v0 同消息配对。它另列 quick/recheck/review/card/terms 的 token 加权命中率及输出 token；缺失用量保持未知，不把缺项当零。

```powershell
foreach ($mode in @('open', 'closed')) {
  $baseline = Join-Path $out ('none-' + $mode + '.jsonl')
  $a = Join-Path $out ('snapshot-' + $mode + '.jsonl')
  $b = Join-Path $out ('compact-' + $mode + '.jsonl')
  $ab = Join-Path $out ('snapshot+compact-' + $mode + '.jsonl')
  foreach ($split in @('dev', 'test')) {
    py -X utf8 -B eval/score.py eval/data/interleave-v0/sessions.jsonl $baseline $a $b $ab --split $split
    foreach ($variant in @('snapshot', 'compact', 'snapshot+compact')) {
      $candidate = Join-Path $out ($variant + '-' + $mode + '.jsonl')
      py -X utf8 -B eval/cache-report.py eval/data/interleave-v0/sessions.jsonl --baseline $baseline --candidate $candidate --split $split
    }
  }
}
```

`score.py` 会将 score.json 写在预测旁边；同一预测分别评 dev/test 时后一次会覆盖该附属 score.json（预测本身不变）。需长期保留分 split 结果时，将每次 score.json 另存成带 dev/test 后缀的文件，或将只读配对工具 stdout 保存成独立文件。配对工具报告逐条胜负及两组原评分，不把消息当独立随机样本做伪精确的置信区间。

## 6. 剩余风险与交付

- 模型是否正确执行覆盖优先级、忽略旧 text/已删除候选、按稀疏协议输出，仍需真实实验；假模型在本地直接物化，无法证明模型遵循提示词的能力。
- 快照更长，CPU 序列化/模型读取成本和真实缓存未命中成本均需观测。quick/recheck 即使字符串前缀相同，提供商的 reasoning 参数、异步落盘和逐出规则也可能阻止复用。
- compact 增加 routeId 输入字段并可能带来未知别名/格式失败。别名采用截断内容哈希，同次候选碰撞会被拒绝；真实评测应监控 `ROUTER_COMPACT_ID_INVALID` 和所有回退。原路由失败处理保持不变。
- 目前只做会话内有界内存缓存，重启/淘汰后重新建快照，不承诺跨进程复用。候选成员频繁变化可能导致较多覆盖或重建。
- v0 不覆盖真实多前台 attention、长期历史、提供商计费和自然语言复核质量；新增单元/集成测试补了协议边界，不等同线上验收。
- 没有触碰用户原有未跟踪的 `.claude/`、`.dsh/`、`.workbuddy/`、`promo*/`、`outreach/`、`experiments/agent-workbench-wallpaper/`、`scripts/ui-check.mjs`。
- 任务文件写“不要 commit”，用户本轮明确要求“验证、提交”，按本轮指令处理本地提交。当前沙箱将 `.git` 设为只读；最终提交结果见下方记录，不涉及 push、合并或发布。

提交记录：已按用户本轮指令执行精确文件列表的 `git add`，在创建 `.git/index.lock` 时被拒绝（`Permission denied`，退出码 128）。因为暂存失败，后续 `git commit` 未执行；没有产生新提交，HEAD 仍为 `332907d`。未请求提权或弹出确认，也未尝试绕过沙箱。所有实现、报告和验证产物已保留。

作者在允许写 `.git` 的普通终端可仅提交本任务文件：

```powershell
$files = @(
  'src/index.ts', 'src/llm-router.ts', 'src/routing-experiments.ts',
  'dist/index.d.ts', 'dist/index.js', 'dist/llm-router.d.ts', 'dist/llm-router.js',
  'dist/routing-experiments.d.ts', 'dist/routing-experiments.js',
  'eval/run-router.mjs', 'eval/lib/product-replay.mjs', 'eval/test/fake-model.mjs',
  'eval/cache-audit.mjs', 'eval/cache-report.py',
  'eval/test/cache-audit.test.mjs', 'eval/test/cache-experiments.test.mjs', 'eval/test/test_cache_report.py',
  'tests/routing-experiments.test.ts', 'docs/design/routing-cache-experiments.zh.md'
)
git add -- $files
if ($LASTEXITCODE -eq 0) { git commit -m 'Add opt-in routing snapshot and compact cache experiments' }
```

