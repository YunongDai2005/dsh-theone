# TheOne：DSH 会话路由插件

用户始终在一个主聊天入口里聊天。TheOne 判断所属项目，挂载项目摘要，再交给该项目独立的 DSH Worker 执行。DSH 保存原始对话、运行模型与工具；TheOne 保存项目目录、摘要和路由记录。

左侧固定 **TheOne · 主聊天**：浅色主题为淡橙色外光晕，深色主题为淡蓝色。兼容 DSH `0.2.0-rc.2`、Node.js 24。

## 安装并使用

1. 先在 DSH 中配置好 API，并选择一个能正常聊天的模型。
2. 打开 **插件 → 添加插件**，粘贴 `https://github.com/YunongDai2005/dsh-theone`，点击安装。
3. 点击左侧 **TheOne · 主聊天**，直接开始聊天。

**v0.3.0 默认开启 LLM 路由，复用 DSH 的模型调用和 API 凭据，无需再填一个 API Key。** 路由和项目 Worker 使用打开 TheOne 前 DSH 选中的模型。改模型时，先在 DSH 选好新的普通聊天模型，再打开 TheOne。

仓库公开，包含编译后的后端和 Web 客户端，安装不需要本机编译或安装脚本。也可以用 DSH CLI：

```sh
dsh plugin --profile web add github:YunongDai2005/dsh-theone --ignore-scripts
```

DSH 当前没有插件自动更新；旧版用户按 DSH 插件页提示卸载后重新安装。升级后若默认模型已是 `theone/gateway`，先在 DSH 选择一次已配置的普通模型，再打开 TheOne。插件记住模型名称，重启后继续复用；凭据仍由 DSH 管理。

数据库默认保存在 `$DSH_HOME/theone/contexts.db`，未设置 DSH_HOME 时为 `~/.dsh/theone/contexts.db`。卸载重装应保留这个目录以继续原话题。每个数据库同时运行一个 profile 进程。

## 历史目录与话题工作区（v0.3.0）

启用后，插件在后台通过 `ctx.sessionQuery` 读取既有 DSH 会话，自动提取话题目录。优先使用已成功完成的 compaction 摘要；没有摘要的部分只读取有界的用户输入和回答摘录。每批最多 8 轮，通过用户在 DSH 配置的模型做轻量提取；不重新总结完整长会话。

相似、相关的话题自动归入同一个 **话题工作区**，在左侧入口中查看。不同话题仍有独立的工作会话，可以点击“继续聊天”回到主聊天，或点击“查看原会话”打开原始 DSH 记录。

话题工作区是插件保存的逻辑分组。DSH 原生工作区绑定磁盘目录，这个版本保留原来的文件执行目录，不把旧会话挪到新目录。历史导入保存摘要和原始事件范围；继续某个历史话题时使用独立 Worker，按需读取来源，不把整个混合会话灌入执行历史。

目录、分组、来源范围和索引进度保存在现有 TheOne SQLite 数据库；原始聊天仍由 DSH 保存。启动时后台整理，聊天结束后增量更新，并定期补扫；没有变化的会话不重复调用模型。每轮扫描最多 64 个提取批次，未完成的内容后续继续处理。历史多时首次整理需要时间并会消耗已配置 API 的额度。

路由可从自动目录中选择旧话题。目录多时先结合 DSH 全文搜索召回最多 16 个候选，再交给 LLM 判断。若判断为新事项，最多再复查 3 批剩余目录；仍有未检查的目录时会询问用户。整理尚未完成或有读取失败时，不能把未命中直接当成新话题；明确以“新话题：”要求创建时仍可创建。

关闭自动目录可设置 `THEONE_HISTORY_CATALOG=false`。已有目录和分组保留。失败会话会显示在整理状态中并在后续扫描重试；单个坏来源不会阻止其他来源。

## 当前功能

- LLM 选择已有话题、新话题或澄清；代码校验目标，并计算 `KEEP / MOUNT / SWAP / CREATE / CLARIFY`。
- 每个项目有一个独立、可恢复的 DSH Working Session；切回项目时继续该 Worker。
- 路由通过 `ctx.llm.prepareCall()` 调用已配置的 DSH provider。只发送短目录、本轮输入和最多 12 条近期文字，不带工具或完整历史。
- 路由每轮额外调用一次模型，会使用用户已有 API 的额度；最大输出 2048 tokens，30 秒超时。它与正式回答分开调用。
- 失败、无效 JSON、未知话题 ID、截断或取消均不会直接切换项目或启动 Worker。权限/限流错误、连续三次其他错误会暂停路由 60 秒。
- Worker 的 `theone_search_history` 按需检索自己专用的 Worker 和人工审核的历史事件范围；最多 10 个窗口、8000 字符摘录。
- `theone_update_state` 保存最多 800 字符的项目进展。自动复用 Worker 完成的 DSH compaction 摘要，脱敏后最多 1200 字符，不重新总结整个会话。
- SQLite 保存目录、来源范围、挂载和执行状态；原始输入、工具结果与回答保存在 DSH 日志。历史指令仅作为参考。
- 主聊天同时接受一个运行中的请求，取消传给路由和 Worker，不自动重放执行中的输入。

## 配置（可选）

正常安装不需要这些变量。

| 变量 | 用途 / 默认值 |
| --- | --- |
| `THEONE_HISTORY_CATALOG` | 默认开启；`false` 关闭后台目录整理 |
| `THEONE_DATABASE_PATH` | 覆盖默认目录数据库位置 |
| `THEONE_CONTEXTS_PATH` | 人工目录 JSON；省略时从空目录开始 |
| `THEONE_GATEWAY_KEY` | 入口标识，默认 `default` |
| `THEONE_ROUTER_MODE` | `llm`（默认）或 `rules` |
| `THEONE_ROUTER_TRANSPORT` | `dsh`（默认）；`legacy` 为旧的直接 DeepSeek 调用 |
| `THEONE_WORKER_PROVIDER` / `THEONE_WORKER_MODEL` | 固定模型覆盖，必须一起设置；默认跟随 DSH 选择 |

旧的直接路由仅在 `THEONE_ROUTER_TRANSPORT=legacy` 时使用 `THEONE_ROUTER_API_KEY`、`THEONE_ROUTER_BASE_URL` 和 `THEONE_ROUTER_MODEL`。默认不读取这把 key。

人工目录为 `ContextDescriptor[]`：`id / title / summary / entities / keywords / lastState`，只在首次初始化插入。Worker 不能使用 `theone` provider。

## 开发和测试

```sh
git clone https://github.com/YunongDai2005/dsh-theone.git
cd dsh-theone
npm ci --ignore-scripts
npm run typecheck
npm test
npm run pack:plugin
```

测试使用真实 DSH 服务、AgentLoop、Session、SQLite Query、JSONL 持久化和 compaction；模型被模拟，不调用外部 API。演示目录为虚构资料。

打包生成 `.dsh-test/dsh-theone-0.3.0.tgz`，包含后端、Web 客户端和配置，不包含 API Key、聊天快照或数据库。

本地隔离开发可运行 `npm run install:local` 和 `npm run start:local`，数据保存在 `~/.dsh-theone`。这是独立 profile，需要在其 DSH 设置中配置模型。可复制 `.env.example` 为 `.env` 调整端口等；`.env` 不提交到 GitHub。

## 服务接口

`ctx.theone.searchHistoryDetailed(contextId, query, limit)` 返回审核范围内的窗口、文本投影、来源错误码和 `partial` 标记；`searchHistory()` 只返回窗口。

手工关联的历史 Session 必须通过 `store.addSource(contextId, sessionId, {startSeq, endSeq})` 指定审核后的闭区间。自动目录使用模型分类后经校验的完整轮次范围。专用 Worker 才可关联整段 Session。

## 已知边界

- 主聊天身份保存在当前浏览器、当前 Web 路径的本地存储中；另一个浏览器可能创建另一个 Gateway，同一数据库继续复用项目 Worker。
- 目前面向文字入口，Worker 的 step 提交后转发回答。逐 token 转发、图片输出、工具卡片和审批界面转发尚未完成。
- 没有 embedding 或向量检索；当前候选召回使用短目录和 DSH 全文搜索，主题提取与关联分组由 LLM 判断。MULTI-MOUNT 和 Worker 自动轮换尚未实现。
- 目录更新和 DSH 日志不是跨数据库事务；中断后状态不明的请求需要检查原 Session。未验证硬断电恢复。
- 目录整理需读取 DSH 日志；未进行大规模吞吐验证。历史工具按审核范围扫描来源；Gateway 日志轮换待实现。

早期人工目录下 AI Box 回放为 75/79，不能代表新用户线上准确率。TheOne 尚未部署到 AI Box。旧版本验收见 [v0.1](./docs/plugin-v0.1.md) 和 [v0.2](./docs/plugin-v0.2.md)。
