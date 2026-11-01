# routing-rethink-step4

任务交付：用四份既有 product-v1/cards/DeepSeek V4.1 Flash 基线分析复核、本地快路和候选召回。结论见 [中文报告](../../docs/design/routing-rethink-step4-report.zh.md)。没有改产品、没有真实模型调用、没有读取 step3 预测或凭据。

## 文件

- `protocol.md`：test 预测评估前记录的口径及 dev 冻结决定。
- `analyze.py`：严格白名单输入、逐消息审计、单步反事实、按整段对话 bootstrap、触发规则及成本统计。
- `dev-results.json` / `test-results.json`：四组小体积聚合、候选诊断和 `shadow_records`。不含整份预测或模型请求/响应副本。
- `freeze.json` / `test-evaluation-started.json`：冻结代码和 dev 输入哈希；test 一次性执行记录。
- `probe.mjs` / `source-probe-*.json`：直接调用源码/dist 的续接与收尾函数，只读语料，验证快路条件和缺失元数据。
- `bindings.mjs`：只在实验里运行的明确绑定建议；产品没有导入它。
- `test_analysis.py` / `bindings.test.mjs`：14 项手算/集成分析测试、6 项绑定边界测试。
- `validation.json`：本轮类型检查、测试数量、完整通过名称及 4 个子进程受限项。
- `render_report.py`：只读取保存的结果生成中文 Markdown 表格，不重新读取或评估 test 预测。
- `verify.py`：核验冻结代码、保存结果的算术和本地链接，不再次评估原始预测。
- `artifact-manifest.json`：交付文件哈希，供作者核验文件未被意外改变。

## 日常核验

在仓库根目录运行：

```powershell
py -X utf8 -B -m unittest discover -s experiments/routing-rethink-step4 -p test_analysis.py
node --test --test-isolation=none experiments/routing-rethink-step4/bindings.test.mjs
py -X utf8 -B experiments/routing-rethink-step4/verify.py
```

报告的数字只从冻结结果生成，使用 `py -X utf8 -B experiments/routing-rethink-step4/render_report.py` 可检查同一报告是否可重复生成。它不是重新分析 test。

首次开发执行顺序是 `analyze.py dev`、`probe.mjs dev`、`analyze.py freeze`、`analyze.py test`、`probe.mjs test`。Node 探针需加 `--experimental-transform-types`。当前已完成冻结与 test，因此程序拒绝继续 dev 调参、拒绝覆盖 test 启动记录或结果。不要删除锁复用同一 test 调参。若作者需要独立审计，应另存隔离审计副本、坚持同一规则，并标注复核不构成新留出集。

## 解释边界

复核效果和节约估算固定在基线真实预测形成的历史上；没有替代策略后续卡片、目录或执行的模型观测。open ID 映射仅用于评分。候选主表有意单列尚未创建的任务、canonical ID 缺失和前缀多数归属缺失，避免条件召回 100% 掩盖历史问题。K 是集合上限，不是相似度排名。

费用单价固定为比较口径 0.30/0.006/1.20 USD 每百万未缓存输入/缓存命中/输出 token，不是账单。测试中模型及 HTTP 服务均为夹具。全量产品测试 476 项通过、4 项因 spawn/spawnSync EPERM 未完成；标准构建、完整测试入口和提交由作者在可写 `.git`、可启动子进程的环境完成。