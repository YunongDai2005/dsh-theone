# 路由失败重试、模型插问与评分口径实施报告

基于 `routing-depth` 分支的 `b59ac2c`，按 `.codex-runs/briefs/routing-retry-aside.md` 实施。全程离线，没有调用真实模型 API，也没有查找或读取 Key。

## 行为变化

1. JSON 解析失败现在为 `ROUTER_INVALID_JSON`，detail 为 `json-parse`；`ROUTER_REQUEST_FAILED` 保留给请求/传输失败。语义验证的每个拒绝分支都有固定英文规则名，例如 `unknown-context-id`、`missing-title`、`bad-action`、`aside-action`。错误对象、回执和 trace 不携带无效模型输出或传输异常原文。
2. `DshRouter.decide` 对无效 JSON、无效决策、不完整响应、无效 compact ID，以及无 HTTP 状态或 5xx 的请求失败，最多重试一次。401、403、429、其他 4xx、调用方取消、熔断、缺少模型、递归调用不重试。两次尝试共享同一个超时 signal 和总预算；system、user、会话标识与输入消息复用。熔断只在本次 decide 最终失败后计数，保留原有并发失败的两秒合并窗口。
3. 成功结果或最终失败 metadata 提供 `attempts`，usage 汇总两次尝试。产品 `callDetails` 每次尝试一条，含 `attempt`、失败码和规则名；`trace.retries` 标明重试层、候选及次数。记录在实际发起 stream 时入队，确保并发目录复核的重试与 eval 传输记录顺序一致。未发送的调用不增加 calls。
4. v0 和 routing-v1 的产品回放均输出 `error_detail: { code, detail }`；最终失败优先，成功恢复时仍保留最后一次失败的诊断。主分类和纠正路由均传播 detail。现有 `usage_by_call` 汇总会纳入重试的调用、token、缓存 token、延迟及费用。未添加可选的 `error_output`，产品数据库和日志不新增原始输出存储。
5. 路由提示词和类型加入可选布尔 `aside`，只接受 CREATE；非 CREATE 的非空 aside 被拒绝。compact 提示词要求只在 true 时输出。false 或省略会归一为原有决策形状。最终 CREATE + aside=true 且存在有效当前话题时，主入口与运行中补充入口均复用 temporaryReturn，创建插问话题但不挂载；裸续接返回原工作，追问插问仍可进入其话题。无当前话题时正常挂载，不设置 temporary。初判被复核改成非 aside 时也不启用临时返回。规则回退逻辑、状态表保持原样。
6. 评分新增 `topics_per_thread_clear` 和表格列 `topics/thread (clear)`，只统计非 ambiguous 且有有效落点的线程消息。纯 ambiguous 线程、one-off、ERROR、CLARIFY 不进入该口径；沿用准确率对 routing-v1 state ablation 的 ambiguous 判定。没有改变任何旧评分字段或其数值。

## 修改文件

| 文件 | 用途 |
|---|---|
| `src/llm-router.ts` | 错误分类、规则名、重试、超时/usage/尝试记录，以及 aside 提示和校验 |
| `src/index.ts` | 两个插问入口、按尝试记录回执、主分类与纠正失败的 detail |
| `src/types.ts`、`src/routing-experiments.ts` | aside 类型和 compact 提示 |
| `dist/index.js`、`dist/llm-router.js`、`dist/llm-router.d.ts`、`dist/routing-experiments.js`、`dist/types.d.ts` | 与改动的后端源码同步 |
| `eval/lib/product-replay.mjs` | v0/v1 预测失败诊断 |
| `eval/score.py` | 新增清晰金标碎片口径和表格列 |
| `tests/routing-retry.test.ts`、`tests/routing-aside.test.ts` | 新增重试、取消、超时、熔断、privacy、aside 和运行中补充测试 |
| `tests/llm-router.test.ts`、`tests/routing-receipts.test.ts` | 更新重试次数、token 及输出 schema 预期 |
| `tests/routing-experiments.test.ts`、`tests/routing-replay.test.ts` | compact aside 往返校验，产品与回放一致性 |
| `eval/fixtures/routing-flow.json`、`eval/fixtures/routing-flow-baseline.json` | 有意增加重试的调用层列表，以及新提示词对应的请求指纹；原动作和选中话题逐项核对不变 |
| `eval/test/product-replay.test.mjs`、`eval/test/routing-v1.test.mjs` | 重试成功/耗尽、并发复核归属、usage、失败详情及纠正入口 |
| `eval/test/test_score.py`、`eval/test/test_score_routing_v1.py` | 新口径边界，以及排除新增字段后的原评分内容和哈希验证 |
| 本报告 | 行为变化、基线证据、验证和环境限制 |

## 修改前后假模型回放

修改源码前保存完整基线，修改后再次运行同一脚本：`.codex-runs/routing-retry-aside/replay.mjs before` / `after`。脚本调用 `eval/run-router.mjs` 的 product-v1 实际产品路径，读取完整 `eval/data/interleave-v0/sessions.jsonl`，使用 `eval/test/fake-model.mjs` 的原始回答函数。该假模型不输出 aside、不制造失败。每次调用固定返回 input=17、cache_hit=7、output=3 的测试用量，避免把提示词长度估算误当作真实 token 收益。

open 和 closed 各 2,466 行，修改前后共 9,864 行回放输出，全部零失败。比较脚本为 `.codex-runs/routing-retry-aside/compare.py`：逐会话按首次出现归一化随机 UUID；只排除耗时字段 `elapsedMs`、`elapsed_ms`、`latency_ms` 以及新增观测字段 `attempt`、`error_detail`。其余整行深比较，包含 pred、action、decision、refs、trace、候选列表、calls、logical_calls、usage_by_call、usage，4,932 对预测零差异。同时额外断言修改后所有 attempt=1、error_detail=null。

归一后 SHA-256：

- open：`3300fee6a0a7e591a7d0ae90a089990dd64cfdd4f9e556cc451f917c905f5166`
- closed：`00daf12923c234e012b2bd11a9447353c3b2e40e8a79ad89df75a82d348b0913`

提示词有意新增 aside 指令，因此不会宣称请求字节与旧提示词相同；重试的两次请求相同由独立测试验证。这些离线结果不代表真实模型准确率、延迟或费用改善。

## 真实预测文件的评分兼容核对

只读既有文件 `eval/data/interleave-v0/predictions/cache-5e36590a72d5/none-open.jsonl`，修改前保存 dev/test/all 的完整评分。修改后仅移除新字段，再与修改前的全部 30 个字段深比较，三组完全一致。既有 `v0-score-baseline.json` 测试也继续验证旧字段及其 SHA-256，未重写旧评分基线。

| 范围 | 原 topics_per_thread，改前后不变 | 新 topics_per_thread_clear |
|---|---:|---:|
| dev | 1.395 | 1.136 |
| test | 1.293 | 1.049 |
| all | 1.374 | 1.118 |

预测文件 SHA-256：`e46eece3f3fbb9a5338445f02aa62610f9bced64b817947b761c2daa8d2ab0b4`；语料 SHA-256：`be37451e752841c6eea81c5c71dca2c82b6198cbe258f440e559deabef4a25a6`。

## 验证与限制

新测试先在旧实现上执行，确认缺少重试、aside 和新评分字段；随后实现并复验。单独补测还复现并修复了纠正路由 detail 丢失。

- 相关产品测试：174 项通过，零失败、零跳过。
- `node --test --test-isolation=none eval/test/*.test.mjs`：67 项通过，零失败、零跳过。
- `py -m unittest discover -s eval/test`：125 项通过。
- `npm.cmd run typecheck`：通过。
- `node node_modules/typescript/bin/tsc -p tsconfig.json`：通过，对应后端 dist 已同步。
- `git diff --check`：通过。
- `npm.cmd test`：默认隔离进程启动被沙箱 `spawn EPERM` 拒绝，未把该命令算作通过。
- 额外尝试的 `tests/route-stats.test.ts` 在内部 `execFileSync` 启动 CLI 时被 `spawnSync EPERM` 拒绝，未改这项无关测试。主路由相关测试使用下面的无隔离命令执行。
- `npm.cmd run build`：两个 TypeScript 编译阶段成功，`scripts/build-client.mjs` 的 esbuild 子进程被 `spawn EPERM` 拒绝。没有改前端源码；恢复本次编译中间产物覆盖的 `dist/client.js` 为任务开始时的版本，避免交付未打包的前端文件。完整打包仍须在可启动子进程的环境执行。

相关产品测试命令（Node v24.21.0 的参数属性需要 `--experimental-transform-types`）：

```powershell
node --experimental-transform-types --test --test-isolation=none tests/dsh-router.test.ts tests/llm-router.test.ts tests/routing-bindings.test.ts tests/routing-receipts.test.ts tests/routing-replay.test.ts tests/routing-experiments.test.ts tests/mid-reply.test.ts tests/routing-retry.test.ts tests/routing-aside.test.ts tests/routing-evidence.test.ts tests/routing-policy.test.ts tests/routing-shadow.test.ts tests/fallbacks.test.ts tests/router.test.ts
```

日志与前后基线留在被忽略的 `.codex-runs/routing-retry-aside/`，不纳入提交。未触碰任务禁止的目录或已有无关未跟踪文件。

## 提交状态

任务文件写“不提交”，但本轮用户明确要求“验证、提交”，因此以本轮指令为准尝试本地提交。仅对本任务的 24 个文件执行 git add，创建 `.git/index.lock` 时收到 `Permission denied`，退出码 128。当前沙箱将 `.git` 设为只读，暂存被拒绝，因此未执行 git commit、未产生新提交；索引为空，HEAD 仍为 `b59ac2c`。未请求弹窗授权、未修改权限、未绕过限制。全部修改与报告已保留在工作区，没有推送或发布。

## 真实模型配对评测（作者补测，2026-11-04）

**结论：四组准确率都提高，伤害降低 27%～63%，碎片减少；代价是路由费用多 7%～16%，中位耗时多 2%～18%。**

### 怎么测的

- **对照：**旧版是 b59ac2c，在单独的工作副本里运行；新版是 5e67e79。两版同时运行，避免供应商在不同时段的速度和稳定性差异影响比较。
- **模型：**DeepSeek V4.1 Flash，经 OpenCode Go，关闭思考，开卡片。
- **数据：**interleave-v0 全部 2,466 条消息，open 和 closed 两种模式。
- **缓存：**每组用独立的缓存盐，四组都从冷缓存开始。
- **计价：**费用按 Go 非高峰价 0.15 / 0.003 / 0.60 计算（单位：美元 / 百万 token，依次为输入 / 缓存命中 / 输出）。
- 预测保存在 `eval/data/interleave-v0/predictions/pair-80520c30cbf0/`（git 忽略）。

### 主要指标（旧 → 新）

| 组 | 准确率 | 改对 / 改错 | 伤害/百条 | 插问混进话题 | 话题/事（排除含糊） | 规则回退条数 | $/千条 | p50 ms |
|---|---|---:|---|---|---|---|---|---|
| open · dev | 97.6% → 98.2% | 16 / 6 | 7.2 → 5.3 | 38.6% → 31.8% | 1.12 → 1.08 | 15 → 1 | 0.212 → 0.243 | 2718 → 2793 |
| open · test | 99.3% → 99.8% | 2 / 0 | 3.8 → 2.1 | 70.0% → 40.0% | 1.07 → 1.02 | 2 → 0 | 0.187 → 0.221 | 2795 → 3311 |
| closed · dev | 98.6% → 99.1% | 18 / 10 | 3.6 → 1.4 | 46.6% → 35.2% | 1.12 → 1.05 | 21 → 5 | 0.182 → 0.201 | 2835 → 2899 |
| closed · test | 98.6% → 99.5% | 6 / 2 | 3.8 → 1.4 | 75.0% → 50.0% | 1.15 → 1.05 | 9 → 1 | 0.163 → 0.174 | 2769 → 3125 |

- 四组合计改对 42 条、改错 18 条，方向一致。test 组只有 10 段对话，单组不能单独作为证据。
- 原口径的 topics/thread 也在下降：1.364 → 1.321、1.293 → 1.293、1.438 → 1.352、1.415 → 1.244。
- 碎片分桶（dev）：D 桶（失败回退等）从 10 降到 5（open），从 14 降到 5（closed）。剩下的碎片里，C 桶（金标含糊）占 79%～90%。

### 重试和插问实际做了什么

- **重试：**新版有 33（open）和 36（closed）条消息触发了重试，其中 32 条和 30 条重试后成功。
  - 第一次失败的原因主要是模型输出的 JSON 写坏了（`json-parse`，49 次）。旧版里这类失败都被记成"请求失败"。全程只有 1 次真正的传输失败。
  - 重试后仍失败的 7 条全部是 `duplicate-title`：模型想新建一个话题，但给的标题和已有话题一模一样。closed 模式下这个问题在调用层出现了 23 次。
- **插问：**模型标记了 68（open）和 60（closed）条插问。插问混进话题的比例四组都下降了。

### 费用为什么上升

- **提示词变长：**加了 aside 的说明，每条消息的输入多 5%～7%。
- **复核变多：**模型标记的插问都是 CREATE，而 CREATE 一律会触发复核。复核比例从 13.1% 升到 13.9%（open · dev），从 7.0% 升到 8.4%（closed · dev）。68 和 60 条插问全部被复核了。
- **缓存命中率略降：**0.767 → 0.724（open · dev）。

### 可以接着做的两件事

1. **`duplicate-title` 不再算失败：**CREATE 的标题和某个已有话题完全相同时，直接当作选了那个已有话题。
2. **插问不再复核：**插问不挂载话题，之后还会回到原来的工作，所以错放的代价很小。省掉这次复核，大约能收回一半的费用增量。

两件都需要再跑一轮真实评测确认。

## 第二轮：重名当作选已有话题、插问不复核（2026-11-04）

**结论：复核少了 19%～31%，路由费用比上一版降 1%～8%，四组伤害都下降；准确率的差别主要来自个别对话的连锁错误，不能算显著。**

### 怎么测的

- **对照：**旧版 4d16ead，新版 0fcd706。两项改动在 08022a7；0fcd706 另含 Worker 资料按需注入，路由评测不会启动 Worker，所以那一项不影响这里的数字。
- **口径：**和上一轮相同，每组同时跑 8 段对话。
- 预测保存在 `pair-8beb511e588c/`。

**作废的一轮：**并发开到每组 16 段的那一轮（`pair-5dde62c3f33c`）作废。四组合计约 64 段对话同时请求，供应商变慢，每组约 150～190 次调用撞上 30 秒超时，6%～7% 的消息退回了规则判断，结果没有比较价值。降到 8 段后，每组仍有 31～46 次超时，约占消息的 1.2%～1.8%，新旧两边都有。以后评测每组并发不超过 8 段。

### 主要指标（旧 → 新）

| 组 | 准确率 | 改对 / 改错 | 伤害/百条 | 复核比例 | 规则回退 | $/千条 | p90 ms |
|---|---|---:|---|---|---|---|---|
| open · dev | 97.4% → 97.9% | 25 / 17 | 7.8 → 7.2 | 13.2% → 10.7% | 27 → 31 | 0.2406 → 0.2330 | 5322 → 5168 |
| open · test | 98.8% → 99.1% | 3 / 2 | 4.0 → 3.8 | 13.3% → 9.7% | 2 → 6 | 0.2261 → 0.2082 | 5578 → 4737 |
| closed · dev | 94.9% → 99.0% | 77 / 10 | 2.5 → 2.4 | 8.1% → 5.6% | 32 → 23 | 0.2146 → 0.2031 | 4924 → 4350 |
| closed · test | 97.9% → 95.0% | 3 / 15 | 2.1 → 1.2 | 7.1% → 5.5% | 9 → 6 | 0.1778 → 0.1765 | 4519 → 4009 |

**规则回退：**几乎都是超时，两边随机出现，表里的增减不反映代码差别。

**准确率波动大：**
- **closed · test：**15 条改错里有 12 条出在同一段对话。前面一次分错，后面的消息连着错。
- **closed · dev：**基线这次偏低，改对的 77 条里有 67 条是基线的模型判断本身错了。
- 逐条核对后，**没有一条改错是因为插问跳过了复核**。改错要么是超时回退，要么是模型自身的波动。

### 两项改动实际做了什么

- **重名新建：**基线每组有 2～19 次因重名而判失败，新版降为 0。
- **插问跳过复核：**open 跳过了 62 次，closed 跳过了 65 次。有证据冲突的插问仍照常复核。
- **剩余的失败：**主要是超时，以及偶尔写坏的 JSON。写坏的 JSON 都由重试救回。

### 和最初的 b59ac2c 比

第一轮新版的费用比 b59ac2c 高 7%～16%。这一轮在此基础上又降了 1%～8%，大约收回了三分之一到一半。准确率和伤害的改善都保留住了。两轮不是同一时段跑的，只能看大致方向。
