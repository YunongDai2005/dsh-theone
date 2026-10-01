# TheOne v0.2 Web 入口

[English](./plugin-v0.2.md) | 简体中文

日期：2026-09-30。基于已完成 CLI 验收的 v0.1 增加浏览器客户端。

## v0.2.1 安装修复（2026-10-01）

GitHub 直接安装会按 package.json 的 files 列表打包，但旧仓库忽略了 dist，导致安装后的包没有后端和客户端入口。现在将编译产物随源码提交，CI 在重新构建后检查产物是否一致；安装不依赖生命周期脚本。

未设置 THEONE_DATABASE_PATH 时，目录数据库使用 `$DSH_HOME/theone/contexts.db`，DSH_HOME 未设置时使用 `~/.dsh/theone/contexts.db`。

Web 会话切换模型不会修改 Agent 初始 options。路由现在按当前轮次的 prompt assembly 模型判断，支持普通会话切入 TheOne 及切回其他模型。预览 assembly 不会覆盖执行中的路由。新增默认数据库和 Web 模型切换的真实 DSH 集成回归，共 51 项测试通过。

## 行为

- 主聊天固定在普通会话浏览器上方，独立于按更新时间排列的会话列表。
- 浅色主题使用高饱和、低透明度的橙色外光晕，深色主题保留淡蓝色；无循环动画。
- TheOne 使用轻巧的 The、圆润微倾的 One 和小光点。
- 点击入口创建或恢复同一个 Gateway，设置 `theone/gateway` 模型并打开 DSH 原生 Conversation。
- 同一浏览器刷新后继续使用已保存的身份；清除浏览器存储或换浏览器可能新建 Gateway。话题状态和 Worker 仍在服务端保存。
- 重复点击共用创建过程；导航被其他操作取代时，异步完成不会把用户拉回主聊天。失败可重试，使用已经预留的 Session ID，避免不确定的 RPC 结果创建重复会话。

## 接入

包声明 `dsh.client.platform: web` 和 `./client` 构建产物。通过 `slots.inject` 等待 DSH 声明 `sidebar.panellist` 和 `main`；沿用 Session Controller、模型选择和 ui-workspace 的导航。CSS 只选择包含插件自己标记的侧栏按钮，不依赖生成的 DSH 类名。停用插件会撤回样式和入口。

普通 Workspace 浏览器保持原生实现；不会用自制列表替换原始会话和搜索。入口身份是浏览器本地元数据，不包含聊天正文、API Key 或数据库路径。

## 验证

类型检查、后端和客户端构建通过。49 项测试通过，包括 7 项新入口的恢复、并发点击、导航取消、模型准备失败、RPC 不确定结果和存储失败测试。

在独立本机 Web profile 中，通过原生 `plugin add` 安装 tgz 后完成浏览器实测：首次点击创建带工作区的 Gateway、自动选择 TheOne 模型、发送消息并收到真实 DeepSeek Flash 回复、刷新后恢复同一聊天记录、折叠侧栏后打开入口，以及浅色橙色 / 深色淡蓝色光晕。真实 API 测试只允许 TheOne 的元数据工具；测试限制不写入发布包。

工具卡片、逐 token 流、Worker 审批转发和图片输出仍沿用 v0.1 的边界。本次不是这些功能的验收。
