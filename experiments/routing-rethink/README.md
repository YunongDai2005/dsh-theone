# routing-rethink：离线研究复现

结论、六条独立路线、现有实现核对、数据限制和迁移门槛在 [中文报告](../../docs/design/routing-rethink.zh.md)。本目录不实现产品功能。

## 运行

从仓库根目录，在 PowerShell 中运行：

```powershell
py -B experiments/routing-rethink/analyze.py
node --experimental-transform-types experiments/routing-rethink/source-probes.mjs
py -B experiments/routing-rethink/verify.py
py -B -m unittest discover -s eval/test -p test_score.py
git diff --exit-code -- src dist tests eval
git diff --check
git status --short
```

本轮运行环境为 Node v24.21.0、Python 3.14.2。Node 的类型转换会输出实验性功能警告，属于运行时提示。Windows 的 `python` 是商店占位符，因此使用 `py`；`-B` 禁止生成 `__pycache__`。无需安装依赖、下载模型、配置 Key 或运行 build。仓库已有 node_modules 和 dist；脚本会核对所用 source/dist 的数据请求一致性，但不重建它们。

没有网络请求、模型客户端、子代理或子进程编排。`analyze.py` 导入现有评分器和 BM25 的函数，不执行它们会写回 eval 的 CLI；`source-probes.mjs` 导入源码，候选查询只接空 FTS 服务桩，模型选择回调一旦被调用就报错，fetch 也被设为拒绝调用。不实例化真实 ContextStore，不读取 DSH 会话、设置或凭据，不启动目录扫描。

这些脚本只写本目录的 `results/`。原有评分器测试只读取仓库代码；本轮未运行全量 npm 测试和构建，因为没有产品代码改动，构建还会写入受保护的 dist。

## 证据怎么读

| 文件 | 内容与限制 |
| --- | --- |
| [phase1-before-code.md](phase1-before-code.md) | 本轮读路由源码与既有设计之前保存的六条假说；保留初稿原文，最终结论以报告为准。 |
| [analyze.py](analyze.py) | E1 数据质量、E2 仓库基线、E3 检索与历史反馈对照、E4 的 dev 阈值选择。只用本地标准库和仓库 Python 函数。 |
| [source-probes.mjs](source-probes.mjs) | E4 原有快路、唯一线索、真实候选函数的受控实验；E5 简单插话对照与不确定收尾；E6 前缀估算、source/dist 一致性和输入哈希。 |
| [analysis.json](results/analysis.json) | 各切分的数量、严格分母、分组错误、完整开发集选择性曲线、测试集固定阈值结果、同政策历史对照。 |
| [diagnostic-rows.jsonl](results/diagnostic-rows.jsonl) | 每条诊断预测、名次和分差。历史由之前的 gold 更新，属于理想历史诊断，不是端到端系统预测。 |
| `results/closed-*.jsonl` / `results/open-*.jsonl` | 原有基线完整预测。非 oracle 基线按自身预测更新。所有文件都包含 dev/test，评分时严格分开。 |
| [source-probes.json](results/source-probes.json) | 源码函数探针与前缀估算。候选实验里的当前话题与历史归属为 gold；干扰目录为固定 dev 描述，FTS 无命中、使用先验为空。 |
| [evidence-decisions.json](results/evidence-decisions.json) | 唯一线索的逐条归属与错误，包含单次问题。不能把“一处出现过”当成确定意图。 |
| [candidate-misses.json](results/candidate-misses.json) | 外加干扰目录后漏召回的原话，可据 session/i 回到原始数据。 |
| [mid-reply-decisions.json](results/mid-reply-decisions.json) | 手写插话集上的规则对照，不代表生产 LLM 的效果。 |
| [verify.py](verify.py) / [verification.json](results/verification.json) | 完整预测键、分母、损失计算、报告数字、输入哈希、先行原文和本地链接的独立一致性检查。 |

现有评分器 open 准确率用全会话事后标签匹配；污染类别用目标会话此前的多数内容，二者不是互补关系。原 scorer 的 `outcomes` 含歧义样本；本实验另存 `strict_outcomes`，用它计算报告污染率，避免分母混用。单次问题独立报告，不混入严格话题准确率。

选择性门槛从预设分差网格在 dev 选取，再应用到 test。所有数据最后都已供本次研究查看；后续若继续调参，需要新的冻结留出集。正确历史与自己的历史对照使用相同策略和目录，两组都由 oracle 隔离单次问题；仍属于受控诊断。

前缀结果中字符长度来自本地计算，token 和复用比例是估算。沿用原脚本的固定块舍入仅用于同口径比较，不模拟实际缓存落盘、分词、逐出或命中；没有账单和延迟实测。

## 本轮验证范围

- 两个实验脚本完成；评分器原有单测 10/10 通过。
- source/dist 共 4,932 次数据请求构造一致。
- `verify.py` 产出 `status: passed` 的验证记录；最后的 Git 范围检查确认 src/dist/tests/eval 无变更，HEAD 未变化。
- 没有模型 API、真实 Worker、嵌入模型、缓存账单、并行 UI 或自动恢复的验证，不把这些标为通过。
- 文件编辑工具无响应后改用 PowerShell；一次 inline Node 探针因 Windows 引号传参失败，改为本目录脚本后运行完成。未发生沙箱阻止离线实验的情况。
- 没有 commit、push、发布或用户确认弹窗。只新增本目录与指定中文报告。
