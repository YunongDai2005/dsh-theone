# TheOne v0.1 插件验收

[English](./plugin-v0.1.md) | 简体中文

日期：2026-09-30。目标是完成可安装、可运行的 DSH 插件。AI Box 接入作为后续工作。

## 交付

`dsh-theone@0.1.0` 提供 Cordis Service、`theone/gateway` provider，以及标准 `dsh.bundle.patch` 元数据。安装包位于项目 `.dsh-test/dsh-theone-0.1.0.tgz`。DSH `0.2.0-rc.2` 的 `plugin add` 可安装并启用该 bundle。

运行路径：Gateway 输入 → 规则 / DeepSeek Flash 分类 → 校验及 SQLite 规划 → 所属 Context 的独立 DSH Worker → 模型和工具循环 → 已提交的文字回答返回 Gateway。

不提供预置真实聊天目录。省略 `THEONE_CONTEXTS_PATH` 时从空目录开始；首次明确的新话题创建 Context 和专用 Worker。

## 本次补齐

1. 原生 bundle 元数据、安装配置、独立测试 profile 和打包检查。
2. `theone_search_history`：只注册到所属 Worker，目标由调用身份绑定，不接受模型选择其他项目。DSH 完整日志先做文本投影，再输出审核范围内的窗口，避免非连续窗口投影错误。
3. `theone_update_state`：保存简短进展与事件引用，保持项目身份。拒绝过长状态及常见凭据格式。
4. 成功 compaction 的短摘要复用：使用 DSH 已生成的摘要，保留 summary/end seq，脱敏并限制长度。同一 checkpoint 不重复更新，进展状态独立保留。
5. Gateway 重建后的近期消息恢复：SQLite 只保存入口引用，从 DSH 查询最近的已完成 Gateway，不复制完整聊天。
6. Worker 创建 / 恢复时初始化 DSH 模型选择，并继承入口的工作目录元数据。这修复了真实 CLI 中 `{{cwd}}` 无法组装的问题。
7. API 失败冷却和路由调用元数据：记录模型、耗时、Token 数及错误码，持续不可用时暂停重复分类请求。

## 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm test`：41 项通过，0 失败。
- 原生安装：通过 DSH `plugin add` / pnpm 安装本地 tgz，自动启用 bundle；没有版本豁免或手工改写安装依赖。
- 真实模型：路由为 DeepSeek Flash Chat Completions，Worker 为 DSH 自带 `deepseek-official/deepseek-flash` Messages adapter。

| 真实 CLI 场景 | 结果 |
| --- | --- |
| 初次挂载显卡项目并保存测试代号 | MOUNT，完成 |
| 切到论文项目，使用不同测试代号 | SWAP，完成 |
| 切回显卡项目，找回原代号 | SWAP，完成；回答未包含论文代号 |
| 调用历史工具查阅显卡项目 | KEEP，完成；工具结果按 callId 配对确认成功，来源隔离 |
| 创建盆栽项目 | CREATE，完成 |
| 新进程恢复同一个 Gateway，继续盆栽项目 | KEEP，完成 |
| 不加载任何目录文件，首次创建英语项目 | CREATE，完成 |

这些调用在私有 DSH home 和空工作目录运行。只允许两个 TheOne 元数据工具；核对日志确认没有执行其他工具。原 DSH profile、凭据文件和历史不被修改。CLI 测试每轮启动新进程，也验证了 Worker 的持久化恢复。

工具与 compaction 测试额外覆盖：Gateway 看不到 Worker 的专属工具；其他项目无法通过附加 contextId 参数读取本项目；范围边界、坏来源、中文匹配、摘录限长；进度重启恢复及证据引用；真实 DSH compaction 引擎生成摘要后的复用、脱敏和幂等。

验证中曾误用不存在的 `toolName` 字段判断工具结果，现已改为按 `toolCallId` 与 `tool/call` 配对。工具实际成功；已重新读取原始测试日志确认，不仅依据模型最终回答判断。

## 范围

这是 v0.1 的文字 CLI 验收。Web UI、工具审批交互与卡片转发、实时 token 流、图片输出、自动历史导入、MULTI-MOUNT 和自动 Worker ROLLOVER 仍待实现。进度更新由模型按需调用，不保证每轮执行。

之前 AI Box 79 条真实历史的 94.9% 是人工目录下的回顾式路由评估。本次验证了新的插件功能，没有重新测定线上路由准确率。TheOne 尚未部署到 AI Box。
