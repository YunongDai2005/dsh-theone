# 话题细胞团：后端第一期（给 Codex 的任务说明）

## 背景

左侧栏 TheOne 主卡片下面，会挂一团“话题细胞”，取代原来的“话题工作区”一行。

- 界面原型：`experiments/sidebar-cell-capsule/foam.html`
- Claude 写的映射草案：`experiments/sidebar-cell-capsule/ROUTING-MAP.md`
- 你自己写的评审：`experiments/sidebar-cell-capsule/CODEX-REVIEW.md`，**以它为准**

客户端由 Claude 负责：引擎 `src/client-foam.ts` 已经写好，后面接入 `src/client.ts`。你只做后端：给细胞团提供可靠的只读状态和事件。

## 工作位置

- 仓库：`D:\doc\GitHub\dsh-theone-bubbles`（git worktree，分支 `topic-bubbles`，从 `routing-depth` 拉出）。`node_modules` 是指向主检出的目录联接，不要重装依赖。
- **不要改**：`src/client.ts`、`src/client-foam.ts`、`src/client-locales.ts`、`experiments/` 下的任何文件（这些是 Claude 的）。
- 不要碰 `.dsh/`、`.workbuddy/`、`promo*/`、`outreach/`。
- 不要切分支，不要 push，不要合并到别的分支。

## 本期范围：评审第 5.1 节的步骤 1–4，加上 `done` 的忙碌保护

1. **状态语义与只读投影。** 话题生命周期、当前挂载、work 执行阶段、主聊天交付阶段分开表示；拿不准的值明确给 `unknown` 或 `null`。
2. **运行与消息队列观测。** 每个 WorkerRun 一个 executionId；记录 messageIds 和 batchId；在分类、等项目锁、实际启动、完成、被主聊天选中、提交、取消这些边界通知聚合器。
3. **快照加事件接口，先做立即返回（waitMs=0）。** `GET /api/theone/bubbles`，带 epoch、version、seq、事件环和 reset，按评审 4.1–4.2 实现。
4. **有界长轮询。** 按评审 4.3：先检查、再注册 waiter、再检查一次；request.signal 和插件生命周期都能撤销挂起；插件卸载、数据库关闭之前释放所有挂起的请求。
5. **`status done` 的忙碌保护。** 话题有正在执行、或有尚未交付的结果时，`done` 返回明确的错误码（比如 `TOPIC_BUSY`），闲着时照常成功。

协议类型放在新文件 `src/bubble-types.ts`，只放类型，客户端会用 `import type` 引用。可以按评审 4.5 的草稿来，实现不了的字段先给 `null` 或 `unknown`，不要编造数据。

## 已采用的默认语义（提案，用户回来后还要确认）

用户暂时离开，下面这些按你在评审 5.3 里建议的默认值先做：

- 归档的话题：如果正在运行、有待展示的结果、或者是当前挂载的话题，照样出现在快照里。
- aside：结果交付成功之后，细胞才可以折叠（这是客户端的事）；后端不会自动标 done，也不会删除。
- 甩走（done）：只允许闲置的话题，所以有上面第 5 条的保护。
- 10 分钟内打开别的话题：保留现有的弱学习行为，只发 `route.hint` 事件，不发 `route.moved`。
- 合并排队：本期不做，下一期单独派。
- private：如实反映现有的单向语义。
- 本期不迁移聊天里的回执，只在报告里列出清单。

## 硬性要求

- 不改变路由选择、执行次数和 token 消耗：细胞团只观察，不触发模型调用或执行。GET 请求不能写数据库。
- 所有状态变化都走聚合器发布，不能只在 HTTP 写接口里递增版本。
- 测试写法参考评审 5.1 表里列的现有测试；第 1–5 步各自要有测试，并发场景用 `Promise.withResolvers()` 做栅栏，不要用 sleep。
- 每完成一步提交一次。提交信息仿照仓库现有风格：英文，一句话说清结果。作者用仓库已配置的 git 身份，**不要加任何 Co-Authored-By 行**。只 `git add` 你改过的文件。
- 收尾前跑 `npm run typecheck`、`npm test`、`npm run build`，三者都要通过。PowerShell 里用 `npm.cmd`。
- 直接用 shell 执行命令，不要使用子代理，不要用 node_repl。

## 汇报（中文）

- 每一步做了什么，对应的提交 hash。
- 一份真实的 `GET /api/theone/bubbles` 响应示例：从测试里截取，去掉正文。
- 客户端需要知道的事：字段含义、游标用法、长轮询参数、错误码。
- 没做完、或者没验证的部分，照实写。
