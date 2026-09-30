# TheOne：DSH 会话路由插件

用户始终在一个 Gateway 里聊天。TheOne 判断所属项目，挂载对应 Context，再交给该项目独立的 DSH Worker 执行。DSH 保存原始对话、运行模型与工具；TheOne 保存项目目录、摘要和路由记录。

**v0.2 增加 Web 侧栏固定主聊天入口。** 浅色主题使用鲜亮、低透明度的橙色外光晕，深色主题使用淡蓝色光晕；TheOne 字标带小光点。兼容 DSH `0.2.0-rc.2`、Node.js 24；类型检查、构建和 49 项测试通过。原 CLI / DeepSeek Worker 验收见 [v0.1 记录](./docs/plugin-v0.1.md)。

## 本地试用 Web 版

需要 Node.js 24，以及已登录 GitHub 的 `gh`。本仓库是独立的 DSH 插件。

```sh
gh repo clone YunongDai2005/dsh-theone
cd dsh-theone
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
npm ci --ignore-scripts
cp .env.example .env
```

编辑 `.env`，填写 `THEONE_ROUTER_API_KEY`，然后：

```sh
npm run install:local
npm run start:local
```

打开 DSH 在终端输出的本地链接，点击左侧固定的 **TheOne · 主聊天**。首次点击创建主聊天，以后点击或刷新继续复用它。主聊天直接使用 `theone/gateway`，路由和 Worker 默认都使用 DeepSeek Flash。

安装脚本使用 `~/.dsh-theone/home` 下的独立 Web profile；原来的 DSH profile 不受影响。聊天和数据库保存在本机 `~/.dsh-theone` 中，`.env` 不提交到 GitHub。端口默认 `3018`，可用 `THEONE_WEB_PORT` 修改。用 `THEONE_LOCAL_ROOT` 可更换保存目录；请使用支持 pnpm 锁文件操作的本机磁盘。

若 DSH 没有加入 PATH，可在 `.env` 中设置 `DSH_BIN=/absolute/path/to/dsh/lib/bin.js`。脚本会用当前 Node 运行该入口。构建后也可从 GitHub Release 下载 tgz，按下文原生 `plugin add` 安装到自己的 Web profile。

## 当前功能

- `KEEP / MOUNT / SWAP / CREATE / CLARIFY`。LLM 选择已有话题、新话题或澄清，代码计算挂载动作并校验目标。
- 每个 Context 一个独立、可恢复的 Working Session。切回项目时继续该 Worker，Gateway 的混合历史不会作为 Worker 的执行历史。
- DeepSeek Flash 路由读取短目录、当前项目和最多 12 条近期文字。重建 Gateway 时，从 DSH 历史引用恢复近期消息。
- 路由失败会澄清并保留挂载状态。权限/限流错误，以及连续三次其他错误，会暂停分类请求 60 秒。
- Worker 的 `theone_search_history` 工具按需检索自己的专用 Worker 和手工审核的历史事件范围；最多 10 个窗口、8000 字符摘录。
- Worker 的 `theone_update_state` 工具保存最多 800 字符的进展、疑问和下一步。项目标题保持不变，更新保留 Worker / 事件引用。
- 自动复用 Worker 已成功完成的 DSH compaction 摘要，保留摘要和完成事件引用，脱敏后截取最多 1200 字符；不额外调用模型重写整段历史。
- SQLite 保存目录、挂载、来源范围与执行状态；DSH 日志保存原始输入、工具结果和回答。历史资料作为参考，不能代替本轮用户授权。
- 取消会传给 Worker；同一实例的并发入口会明确拒绝。已开始的输入不会自动重放，避免重复工具副作用。

## 开发和测试

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run demo
npm run pack:plugin
```

普通测试使用真实 DSH 服务、AgentLoop、Session、SQLite Query、JSONL 持久化和 compaction。模型被模拟，不调用外部 API。演示目录中的 Qwen / 论文项目是虚构资料。

打包生成 `.dsh-test/dsh-theone-0.2.0.tgz`，包含后端、Web 客户端、bundle 配置和说明。包中不包含 `.env`、聊天快照、数据库或演示目录。

## 安装到独立 DSH profile

前提：`dsh --version` 为 `0.2.0-rc.2`，实际启动 DSH 的 Node 为 24。API Key 保留在被忽略的 `.env` 或已有 DSH 凭据中。

使用本项目 `.env` 时：

```sh
set -a
source .env
set +a
export THEONE_DATABASE_PATH="$PWD/.dsh-test/contexts.db"
export THEONE_ROUTER_MODE=llm
export DEEPSEEK_API_KEY="$THEONE_ROUTER_API_KEY"
```

最后一行让 DSH 自带的 `deepseek-official` Worker 使用同一个 Key。也可独立配置 Worker 的凭据和 provider。

创建专用 headless profile，再通过 DSH 自带插件管理安装：

```sh
DSH_HOME="$PWD/.dsh-test/home" dsh --profile one \
  --from-default-profile headless --help

DSH_HOME="$PWD/.dsh-test/home" dsh plugin --profile one \
  add "$PWD/.dsh-test/dsh-theone-0.2.0.tgz" --ignore-scripts

DSH_HOME="$PWD/.dsh-test/home" dsh --profile one --json \
  "新话题：学习日语。先制定一个短计划。"
```

DSH 安装命令会启用 bundle，默认模型成为 `theone/gateway`。每次 headless 调用启动新进程；使用输出的 Session ID 和 `--session-id` 可恢复同一个 Gateway。重建 Gateway 后，Context 和 Worker 仍可从数据库及 DSH 持久化恢复。

### 环境配置

| 变量 | 用途 / 默认值 |
| --- | --- |
| `THEONE_DATABASE_PATH` | 必填，项目目录数据库的绝对路径 |
| `THEONE_CONTEXTS_PATH` | 可选，人工目录 JSON；省略时从空目录开始 |
| `THEONE_GATEWAY_KEY` | 入口标识，默认 `default` |
| `THEONE_ROUTER_MODE` | `rules` / `llm`，默认 `rules` |
| `THEONE_ROUTER_API_KEY` | 路由凭据，配置文件只引用变量名 |
| `THEONE_ROUTER_BASE_URL` | 默认 `https://api.deepseek.com` |
| `THEONE_ROUTER_MODEL` | 默认 `deepseek-flash` |
| `THEONE_WORKER_PROVIDER` | 默认 `deepseek-official` |
| `THEONE_WORKER_MODEL` | 默认 `deepseek-flash` |

人工目录是 `ContextDescriptor[]`：`id / title / summary / entities / keywords / lastState`。只在首次初始化时插入；修改文件不会覆盖已有项目。Worker 不能使用 `theone` provider。

`npm run profile:prepare` 可生成加载本地 `dist/index.js` 的开发覆盖层。默认空目录；设置 `THEONE_CONTEXTS_PATH` 才加载人工目录。

### 真实 API 验收

```sh
node --env-file=.env scripts/test-cli-plugin.mjs /absolute/path/to/dsh-runtime
```

参数指包含 `node_modules/@deepseek-ai/dsh` 的运行时目录。默认使用本机缓存中的 `dsh-runtime-0.2.0-rc.2`。脚本通过 DSH `plugin add` 安装打包产物，在私有临时 home 和空工作目录中测试。它调用真实模型，仅允许 TheOne 的两个元数据工具；原 DSH profile 和历史不被修改。

## 服务接口

`ctx.theone.searchHistoryDetailed(contextId, query, limit)` 返回审核范围内的窗口、文本投影、来源错误码和 `partial` 标记；`searchHistory()` 只返回窗口。

历史 Session 必须通过 `store.addSource(contextId, sessionId, {startSeq, endSeq})` 指定审核后的闭区间。专用 Worker 才可关联整段 Session。

进度工具由模型按需调用，不保证每轮更新。压缩摘要在 Worker 恢复或后续执行时复用，正文可通过来源引用查阅。

## 已知边界

- 固定入口通过 DSH 的 `sidebar.panellist` 扩展打开原生 Conversation。主聊天身份保存在当前浏览器、当前 Web 路径的本地存储中；另一个浏览器可能创建另一个 Gateway，但同一数据库仍复用话题 Worker。原始主聊天 Session 仍可在 DSH 会话列表和搜索中找到。
- 当前面向文字入口。回答在 Worker 的 step 提交后转发；逐 token 流、图片输出、工具卡片和审批界面转发尚未完成。无可用审批通道的请求按 DSH 策略处理。
- 每个数据库同时运行一个 profile 进程；没有跨进程排队。
- 未实现 `MULTI-MOUNT`、自动历史聚类、自动历史导入、Worker 自动 ROLLOVER、embedding 或语义检索。
- 目录更新和 DSH 日志不是跨数据库事务；中断后状态不明的请求需检查原 Session。尚未验证硬断电恢复。
- 检索逐 Session 扫描，尚无大规模性能验证。Gateway 日志轮换仍待实现。

AI Box 历史的旧目录回放为 75/79（94.9%），属于人工目录下的回顾式路由评估；本次没有把它当作新版本线上准确率。TheOne 尚未部署到 AI Box。
