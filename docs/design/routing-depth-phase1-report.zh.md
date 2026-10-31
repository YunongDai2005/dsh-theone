# 路由深化阶段 1 实施与验证报告

日期：2026-10-31。基线：`e0e5e44`，分支：`routing-depth`。

已实现输入重排、固定系统提示词、40 字短理由提示、插件回执和评测指标。只做本地提交，不推送、不发版；没有运行真实模型评测或读取真实 API Key。真实路由准确率、输出 token、服务端缓存命中和延迟变化仍待实测。

## 离线前缀统计

在修改插件源码前先编写并测试 `eval/prefix-share.mjs`，构建原代码后测量基线；修改后使用同一脚本、同一份 `interleave-v0/sessions.jsonl` 重放。dev 为 40 段对话、1,971 条请求，test 为 10 段、495 条。

每条消息都生成请求；不应用快路、不调用模型、不生成卡片，以真实标签选择话题。closed 预先提供目录；open 在 thread 首次出现后创建话题。新话题标题取首条消息前 30 字、摘要前 200 字，keywords 按原 `run-router.mjs` 的 `describe` 合并 `topicTerms`，lastState 取最后一条消息前 400 字；单次问题各自创建孤立话题。recent 保留最近 12 条用户消息。未改原评测脚本的话题描述方式。

一个请求为系统提示词直接拼接序列化 payload；只与同一段对话的全部更早请求比较最长公共前缀。估算 token = 汉字数 / 1.5 + 其余字符数 / 4；每条可缓存前缀向下取 64 token 的整数倍。token 比例使用可缓存 token 总数 / 输入 token 总数，字符比例使用公共前缀字符总数 / 请求字符总数。首条请求按冷缓存计 0。结果是理想复用上限，未模拟缓存过期、逐出、服务端预热或真实分词。

表内 `前 → 后`；平均长度包含系统提示词与 payload。

| split / mode | 语言 | 请求数 | 平均字符 | 平均估算 token | 可缓存 token 比例 | 公共前缀字符比例 |
|---|---|---:|---:|---:|---:|---:|
| dev / open | zh | 991 | 3639.0 → 4865.0 | 1686.4 → 2225.0 | 59.50% → 77.63% | 57.03% → 76.24% |
| dev / open | en | 980 | 4507.1 → 5729.8 | 1641.8 → 2179.5 | 61.12% → 76.68% | 46.11% → 67.51% |
| dev / open | total | 1971 | 4070.6 → 5295.0 | 1664.2 → 2202.4 | 60.29% → 77.16% | 51.02% → 71.54% |
| dev / closed | zh | 991 | 3748.3 → 4955.3 | 1723.4 → 2257.2 | 58.22% → 75.73% | 55.37% → 73.74% |
| dev / closed | en | 980 | 4861.9 → 6067.4 | 1730.5 → 2263.9 | 57.99% → 74.36% | 42.75% → 64.63% |
| dev / closed | total | 1971 | 4302.0 → 5508.2 | 1726.9 → 2260.5 | 58.11% → 75.05% | 48.28% → 68.75% |
| test / open | zh | 242 | 3783.1 → 5014.8 | 1751.8 → 2291.8 | 57.25% → 77.52% | 54.83% → 76.32% |
| test / open | en | 253 | 4432.0 → 5646.5 | 1623.0 → 2158.7 | 61.92% → 77.39% | 47.00% → 68.27% |
| test / open | total | 495 | 4114.8 → 5337.7 | 1686.0 → 2223.8 | 59.55% → 77.46% | 50.52% → 71.97% |
| test / closed | zh | 242 | 3859.0 → 5071.4 | 1774.5 → 2309.7 | 56.51% → 75.25% | 53.75% → 73.48% |
| test / closed | en | 253 | 4783.8 → 5979.4 | 1711.0 → 2241.9 | 58.73% → 74.50% | 43.53% → 64.91% |
| test / closed | total | 495 | 4331.7 → 5535.5 | 1742.0 → 2275.1 | 57.62% → 74.87% | 47.98% → 68.74% |

固定提示词增加了缓存分母，不能只看命中比例。把可缓存 token 从输入 token 中扣除，平均未命中 token 的离线上限估算如下：

| split / mode | 改前未命中 token / 请求 | 改后 | 降幅 |
|---|---:|---:|---:|
| dev / open | 660.8 | 502.9 | 23.89% |
| dev / closed | 723.5 | 564.1 | 22.03% |
| test / open | 682.0 | 501.3 | 26.49% |
| test / closed | 738.2 | 571.6 | 22.56% |

对改后每条请求，找到公共前缀最长的历史请求，再定位其首个不同字段：dev/open 中 keywords 内容变化或长度变化占 1,655/1,971（83.97%），目录增长占 248 条，冷启动 40 条，lastState 占 28 条；dev/closed 中 keywords 占 1,817 条，目录增长占 86 条，其余同上。test/open 的对应计数为 keywords 414、目录增长 61、冷启动 10、lastState 10；test/closed 为 455、20、10、10。

因此当前上限主要受 `contexts[].keywords` 每条更新影响；新 thread 和单次问题扩展目录也会中断前缀。稳定目录之后才轮到 `states[].lastState`，再往后的 recent、running、recheck、currentId、text 仍然是动态后缀。未为提高数字冻结 keywords、改变描述策略或改变真实标签。

## 同一典型消息的请求长度

固定选取每种语言第一段 dev 对话的第 13 条消息（i=12）；改前改后选择同一消息。

| mode | 语言 / session / i | 改前字符 | 改后字符 | 改前估算 token | 改后估算 token |
|---|---|---:|---:|---:|---:|
| open | zh / zh-0001 / 12 | 3017 | 4201 | 1408.4 | 1936.5 |
| open | en / en-0002 / 12 | 5038 | 6258 | 1774.5 | 2311.6 |
| closed | zh / zh-0001 / 12 | 3343 | 4482 | 1518.7 | 2035.5 |
| closed | en / en-0002 / 12 | 5370 | 6575 | 1857.5 | 2390.8 |

普通请求的系统提示词从 2108 字符 / 1042.0 估算 token，增加到 3269 字符 / 1564.3 token；增量为 1161 字符 / 522.3 token。改后包括 symbols、projects、running、recheck 的固定说明；同一消息的初判和复核使用完全相同的系统字符串。

## 实现与统计口径

- payload 按任务规定排序，动态 lastState/activity/status 放入以 id 对应的 states；不存在的动态状态不产生空记录。catalogOrder 不进入请求，只控制输出顺序。
- 保留原有 PAYLOAD_STEPS、24,000 字符上限、各字段截断与脱敏。先按传入得分顺序决定保留哪些候选，再按完整目录顺序输出；输出时当前话题没有特殊位置。原代码超限时保留当前话题的裁剪规则继续保留，避免改变候选选择规则；这是对任务中“当前话题不特殊处理”按输出顺序的解释。
- 初判、复核、并发翻目录每页和纠错 reroute 都传完整目录顺序。判断、复核触发、翻页上限/并发和 settleUnclear 未改。
- JSON 输出说明按 action/contextId/relatedIds/imports/title/historyIndependent/projectId/candidateIds/question/reason 排列；reason 提示最多 40 字。校验仍接收最多 600 字并保存前 240 字。
- 插件统一在路由调用边界累加 calls、输入/输出 token、cacheHitTokens；失败复核和所有已发出的并发翻页也计数，包括匹配页之后未采用的页。未发模型请求的缺模型、熔断等预检失败不计模型调用。tier 表示最终采用的 rules/quick/recheck/review 结论；翻目录只改变 historyIndependent 时也记 review。
- 评测客户端在拿到并发槽并结束 EVAL_RPM 等待后开始计时，收到完整响应体结束；重试等待不计入，实际重试请求逐次计 calls/usage_by_call 并累加 latency_ms。无效复核的消耗保留，卡片消耗留在 card_usage；批量调用只计到首条成员，批量失败后的单条回退也保留先前消耗。
- 读取本地回答缓存的调用为 calls=0、latency_ms=0、usage_by_call=[]，via 继续标记 cache；旧 usage 字段照旧保存缓存文件中的原 token 估算，因此缓存重放时它表示原回答的预算，不表示本轮再次付费。混合“先发请求重试、后读缓存”的情况保留已发生的调用和耗时。
- score 的 calls_per_message、by_tier、cache_hit_rate、latency_ms、harm_per_100_messages、usd_per_1000_messages 同时进入 Markdown 与 JSON。旧文件不推测调用次数，也不把 elapsed_ms 当模型延迟；缺数据显示 – / JSON null。延迟包含快路 0，p50 为标准中位数，p90 为 nearest-rank。
- 伤害代价 = 现有 COST 加权总和 / 非歧义、非单次问题的计分消息数 × 100。美元预算使用与客户端一致的默认百万 token 单价 0.30/0.006/1.20，可由 EVAL_PRICES 覆盖；总预算包含卡片，JSON 另列路由/卡片分项。全部快路的预算是 0，旧的未知预算保持空值。没有修改反馈诊断、界面、README、版本号或发布说明。

## 现有测试调整

| 文件 / 测试 | 调整原因 |
|---|---|
| tests/llm-router.test.ts 的网关分类/回执测试 | 增加 fallback=rules、quick 和规则快路的 tier/calls/cacheHitTokens 检查；未改变旧路由结果断言。另加字段顺序、states、裁剪后重排、固定提示词、新输出顺序和长理由容忍测试。 |
| tests/topic-memory.test.ts 的卡片单测、卡片后台集成测试 | activity 从 contexts 移到按 id 查找的 states，关键词仍从 contexts 检查；缺 activity 时继续检查其不出现在状态记录中。 |
| tests/project-folder.test.ts 的项目/完成状态测试 | project 仍在 contexts，done 改从 states 读取；保留消息到达后话题重新打开的验证。 |
| tests/fact-links.test.ts 的共用路由夹具和关闭共享事实的测试名称 | FACTS_PROMPT 现在常驻，替换“只有 symbols 存在才附加”的旧断言；关闭共享仍验证没有事实工具、没有候选。 |
| tests/dsh-router.test.ts 的原生适配器测试 | 系统字符串由仅 ROUTING_PROMPT 改为完整固定 routingPrompt({})，其余身份、工具和会话隔离断言保留。 |
| tests/fallbacks.test.ts 的附件测试 | 禁止调用分类器的断言改为检查不以 ROUTING_PROMPT 开头，防止提示词扩展后旧的字符串不等断言失效；同时检查附件回执 rules/0/0。 |
| tests/routing-evidence.test.ts 的第二次判断测试 | 保留原有选题、思考预算与备用话题断言，分别注入 17/23 个命中 token，验证回执 recheck/2/40 及输入总量 240。 |
| eval/test/eval.test.mjs、eval/test/facts.test.mjs | 修复原有 Windows 绝对路径不能直接 ESM import 的问题，改成 pathToFileURL；没有改变生成、检查或话题描述逻辑。 |
| eval/test/test_score.py | 新增 5 个评分测试：分层/调用/缓存/伤害/花费、旧格式、偶数中位数与快路、卡片计费、全快路零预算。原有评分测试保留。 |

新增 tests/routing-receipts.test.ts 覆盖失败复核、三页并发翻目录、匹配后未采用页和失败页的消耗；eval/test/metrics.test.mjs 覆盖逐调用指标、队列/限速/完整响应体、缓存、JSON 重试、失败回退及批量计数；eval/test/prefix-share.test.mjs 覆盖 64-token 舍入、非相邻最优前缀、真实标签重放、recent 窗口、语言与 split 隔离。

## 真实评测需要重点看

1. relatedIds、imports、historyIndependent、candidateIds 现在先于 reason 生成，重点检查多话题参考、共享事实导入和澄清候选是否变化。
2. 所有可选说明常驻，重点检查没有 symbols/projects/running/recheck 时是否被无关说明干扰，以及复核能否正确使用可选证据。
3. states 需要通过 id 对应上下文；候选改回目录顺序会改变首位偏向和当前话题位置。重点看相近话题、旧话题返回、done/waiting 和后台进行中消息。
4. 拆分 states 会重复少量 id；24,000 字符预算仍旧不变，边界请求可能更早减少描述或尾部候选。重点看大目录和临界长度场景。
5. reason 变短是否影响后续字段已无同样的生成依赖，但实际输出长度、语义准确率仍须跑配对真实评测；不能由本次离线前缀上限或 fake 模型结果推断。冷缓存首条请求因系统提示词变长，输入成本会升高。

## 验证命令与结果

以下采用 PowerShell 的 npm.cmd 与 Windows py；没有修改 package.json。`eval:test` 按任务许可将 python3 手动替换为 py 执行等价两段命令。

| 命令 | 结果 |
|---|---|
| npm.cmd test | 439/439 通过（最终完整运行约 111.2 秒） |
| npm.cmd run typecheck | 通过 |
| npm.cmd run build | 通过；dist 与源码一起提交 |
| node --test eval/test/*.test.mjs | 25/25 通过 |
| py -m unittest discover -s eval/test | 18/18 通过 |
| node eval/prefix-share.mjs --split dev --mode open（及 dev/closed、test/open、test/closed；各加 --json 保存） | 改前、改后均通过，数字见上表 |
| node eval/run-router.mjs --mode open --policy theone --recheck --cards --dry-run --out .codex-runs/routing-depth-phase1/dry-run.jsonl | 1,971 条消息 / 40 段对话，0 模型流程失败 |
| py eval/score.py eval/data/interleave-v0/sessions.jsonl .codex-runs/routing-depth-phase1/dry-run.jsonl | 通过；生成新表格和 dry-run.score.json |
| git diff --check | 通过 |
| dry-run 逐行 schema 与 usage_by_call 加总校验 | 1,971 行全部一致；2,011 次路由调用、290 次卡片调用 |

开发过程中按先失败后实现验证新增行为，修正了测试夹具一个多余字段、旧状态/提示词断言、两处 Windows 导入兼容，并补上全快路成本与混合缓存重试的边界测试。首轮全量为 438/439，通过调整 project-folder 的旧 status 读取后重新跑最终全量，结果为 439/439。定向命令 `npx.cmd tsx --test tests/llm-router.test.ts tests/routing-evidence.test.ts tests/topic-memory.test.ts tests/fact-links.test.ts tests/routing-receipts.test.ts` 为 36/36 通过；`npx.cmd tsx --test tests/project-folder.test.ts tests/dsh-router.test.ts tests/fallbacks.test.ts` 为 12/12 通过。初始 `node --test eval/test/prefix-share.test.mjs` 为 2/2 通过，后续新增 split 隔离用例与指标测试一起纳入最终 Node 25 项。

完整 dry-run 只用于验证管道：quick=1,931，recheck=40，fast=0；路由调用 2,011，卡片另有 290 次，未混入 calls。模拟器的准确率、毫秒延迟、token 与美元预算均不代表真实模型表现。

本机详细证据位于 `.codex-runs/routing-depth-phase1/`（已忽略，不纳入提交），包含 before/after 的四组 JSON、limiting-fields.json、测试日志、dry-run.jsonl 和 dry-run.score.json。
