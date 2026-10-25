# 手机入口：在微信、Telegram、iMessage 里和主聊天说话

状态：微信、Telegram、iMessage 都已实现，0.3.33 作为实验功能发布。微信在真实 DSH 0.2.0-rc.2 里对着模拟 iLink 服务端做了端到端检查（`e2e/README.md`「WeChat」）；Telegram 在真实 DSH 里调用过真实的 Telegram 接口（token 校验），收发在测试里对着模拟的 Bot API；iMessage 只有对着伪造的「信息」数据库的测试，没有在 Mac 上跑过。真实扫码登录微信、真实 Telegram 机器人的收发都还没有人试过。图片收发未做。

下文先写微信（方案最早为它写），Telegram 和 iMessage 见「Telegram」「iMessage」两节。

## 要做的事

用户在 TheOne 的设置里扫一次码，把自己的微信绑上。之后在微信里给这个 bot 发消息，就等于在主聊天里说话：
同样按话题分流、同样在后台干活，回复发回微信。回到电脑上打开主聊天，看到的是同一段对话。

扫码和收发用的是腾讯 iLink bot 接口，也就是 OpenClaw 微信插件（`@tencent-weixin/openclaw-weixin`，MIT）用的那套：
官方通道，不是逆向的网页版微信。

## 和社区插件 openclaw-weixin-dsh 的区别

那个插件给**每个微信联系人**建一个 DSH 会话，消息直接丢进去。TheOne 不这样做：

- 微信不开新会话，它只是**主聊天的另一个输入框**。消息进主聊天，由 TheOne 原有的路由分到话题。
- 默认**只认绑定者本人**（扫码时服务端返回的 `ilink_user_id`），别人发来的消息不进主聊天。这是遥控自己的电脑，不是对外的客服机器人。

## 按六条设计语言检查

| 设计语言 | 做法 |
| --- | --- |
| 一个入口 | 微信消息进同一个主聊天，不多出会话，侧栏不变。 |
| 只说话 | 授权和 AI 给的选项发成微信文字（"回 1 允许，回 2 拒绝"），回一个数字就继续。10 分钟不回就按安全默认处理（授权按拒绝，提问记为没有回答）。 |
| 无感 | 工具卡片不发到微信，只发最终回复。做得久的先发"正在输入"（`sendtyping`），不刷屏。 |
| 只整理，不改动 | 不碰用户自己的会话和设置。登录状态存在 TheOne 自己的数据目录里（`~/.dsh/theone/`，和 `contexts.db` 放在一起），不写进工作区。 |
| 装前关后没有区别 | 默认关闭。关掉就停止收消息，并通知服务端（`notifystop`）。登录状态保留，再打开直接恢复。只有点"退出登录"才删掉。 |
| 和原生能力一致 | 话题能做的事一样都不少，微信只是换了输入和输出。微信里只发最终回复的文字；改动卡片、文件在电脑上的主聊天里看。 |

## 用到的接口

基础地址 `https://ilinkai.weixin.qq.com`。扫码确认后，服务端会返回该账号专用的 `baseurl`，之后的请求都发到那里。

| 接口 | 用途 |
| --- | --- |
| `ilink/bot/get_bot_qrcode?bot_type=3` | 拿二维码 |
| `ilink/bot/get_qrcode_status?qrcode=…` | 长轮询扫码状态：wait / scaned / scaned_but_redirect / need_verifycode / expired / confirmed（这时返回 `bot_token`、`baseurl`、`ilink_bot_id`、`ilink_user_id`） |
| `ilink/bot/msg/notifystart`、`notifystop` | 开始和停止时告诉服务端 |
| `ilink/bot/getupdates` | 长轮询收消息，带同步游标 `get_updates_buf` |
| `ilink/bot/sendmessage` | 发回复，带上入站消息里的 `context_token` |
| `ilink/bot/getconfig`、`sendtyping` | "正在输入" |
| `ilink/bot/getuploadurl` + CDN（AES-128-ECB） | 收发图片（第二步做） |

协议部分照 OpenClaw 原版移植（MIT，保留版权声明），只取用到的约 400 行。不依赖 `openclaw/plugin-sdk`，也不把整个包装进来。

## 怎么保持一直在线

读过 openclaw-weixin-dsh 的源码，它的 DSH 版漏了原版的几项保活。这里都补上：

1. **随 TheOne 一起启动。** 插件启动时，如果已经登录且开关打开，就自动开始收消息，不用去面板点。
2. **游标存盘。** 每次收消息成功都把 `get_updates_buf` 写进数据库，重启后接着收，不丢消息也不重复。
3. **长轮询超时是正常的。** 服务端没消息时本地超时，当作"这一轮没消息"，不算失败。
4. **失败退避**：2 秒、4 秒……最长 60 秒，带随机抖动。网络恢复后马上回到正常节奏。
5. **token 失效（错误码 -14）**：先停一小时再试，和原版一样。连续失效就把状态标成"需要重新扫码"，在主聊天里说一句（主聊天是用户唯一会看的地方），不无限空转。
6. **收消息和处理分开。** 收消息的循环只负责把消息放进主聊天的队列，不等回复。主聊天本来就会按发送顺序处理排队的消息，所以 agent 跑长任务时微信照样能收新消息。
7. **看门狗。** 循环超过三个轮询周期没有动静就重新拉起；循环意外退出也会在退避后自己重启。
8. **宿主常驻**是 DSH 自己的事：电脑睡眠或 DSH 退出时收不到消息。README 里说明怎么开机自启，插件本身不做。

## 消息怎么进出主聊天

- **入站。** 绑定者的文字消息（语音消息用微信附带的转写文字）交给 DSH 的会话控制器（`sessionController.prompt`），和浏览器里打字走同一条路；主聊天没加载时控制器会把它唤醒。请求 id 写成 `weixin:<消息 id>`，DSH 把它存在消息的 `source.rpcId` 上，不改 DSH 的消息格式。路由、分话题、并行、"分错了"全部照旧。
- **出站。** 主聊天这一轮结束（`turn/end`）时，如果这一轮回答的是一条微信来的消息，就取最终回复文字，去掉 Markdown，按微信长度上限分段发回。
- **电脑上发的消息**不转发到微信，免得两边吵。要不要转发可以以后再加开关。
- **授权和提问。** 来源是微信的那一轮里，`approval` 和 `user-questions` **只在微信里问**。原计划两边同时出现、哪边先答用哪边，但 DSH 的应答链（waterfall）一旦交给浏览器就收不回，微信答了以后浏览器的弹窗还会挂着；问这条消息的人在手机上，所以只问微信。多个问题排队，一次问一个。

## 放在哪

通用的三层，每个聊天软件只写自己的协议和登录：

- `src/remote-relay.ts`：消息进主聊天、这一轮结束后把回复发回去、授权和提问转发。每个聊天软件提供一个 `RemoteChannel`（名字、能不能发、怎么发、可选的"正在输入"）。
- `src/remote-link.ts`：一直在线：收消息循环、游标存盘、退避、凭证失效处理、看门狗、去重。每个聊天软件提供一个 `LinkSource`（怎么拉一轮新消息、只留本人的）。
- `src/remote-app.ts`：把上面两者接起来、随 TheOne 启停，加上设置页共用的暂停 / 恢复 / 退出登录。
- `src/remote-plain.ts`：Markdown 转纯文本、按长度分段。
- 微信：`src/weixin-ilink.ts`（iLink 协议）、`src/weixin-link.ts`（扫码登录）、`src/weixin.ts`。
- Telegram：`src/telegram-bot.ts`（Bot API 和配对）、`src/telegram.ts`。
- iMessage：`src/imessage-db.ts`（读「信息」数据库、AppleScript 发送）、`src/imessage.ts`。
- 登录状态存在 `contexts.db` 的 `remote_links` 表里，每个聊天软件一行（token 只在本机，接口和页面都拿不到）。
- 设置页每个聊天软件一栏，点了立即生效，不经过下面的"保存"。接口是 `/api/theone/weixin`、`/api/theone/telegram`、`/api/theone/imessage`。

不做成单独插件，是因为它需要知道主聊天的身份、一轮的起止，还要插进授权流程，这些都是 TheOne 内部的东西。
协议层不依赖 DSH，以后做独立路由（`docs/backlog.md`）时可以直接拿走。

## 分步

1. [x] 协议层加单元测试（模拟服务端），包括扫码各种状态、超时、-14、游标、看门狗（`tests/weixin.test.ts`）。
2. [x] 设置页扫码登录，状态存盘。
3. [x] 收发文字：入站进主聊天，出站发回复（`tests/weixin-main-chat.test.ts`）。真实 DSH 里 e2e 验证（`e2e/fake-ilink-server.mjs`）。
4. [x] 授权和提问转发。
5. [ ] 图片收发。
6. [ ] 发版，README 加说明（包括"这是腾讯私有协议，请遵守微信规范"）。

## 已定的事（2026-10-13 用户确认）

1. 只认扫码的本人。
2. 电脑上发的消息不同步到微信。
3. 授权 10 分钟不回按拒绝。
4. 放进 TheOne 包里。

## Telegram

- **绑定**：用户在 @BotFather 建机器人，把 token 填进设置；TheOne 用 `getMe` 校验，然后显示一个 6 位配对码和打开机器人的二维码（`https://t.me/<bot>?start=<码>`）。第一个给机器人发来配对码的人成为主人，之后只认他的私聊，群聊一律不进。
- **收发**：`getUpdates` 长轮询（30 秒），游标是下一个 `update_id`；`sendMessage` 每段最多 4096 字；`sendChatAction` 显示"正在输入"。
- **失效**：401 表示 token 被重置，标为失效并在主聊天里说一句；409 且提示有 webhook 时，清一次 webhook 后接着收。
- 计划表要求"不要求用户粘贴 Token"，Telegram 做不到（不粘 token 就得走用户账号登录，复杂得多）；用户 2026-10-13 要求照做，接受这一点。

## iMessage

- 没有接口，只能在 Mac 上：读「信息」自己的数据库 `~/Library/Messages/chat.db`（只读，要给运行 DSH 的程序"完全磁盘访问"），每 2 秒看一次新消息；回复用 AppleScript 让「信息」发送，文字作为参数传入，不拼进脚本。
- **绑定**：用户填自己发消息用的手机号或 Apple ID；从当前最新一条消息开始收，不读历史。手机号按后 9 位比较（国家码、空格写法不同），邮箱不分大小写。只认一对一聊天，群聊不进。
- **给自己发消息**：如果填的号码就是这台 Mac 自己的账号，用户的消息在数据库里也算"发出"，回复同样出现在这个聊天里。这时按文字区分：5 分钟内我们发过的文字不算用户的；同一条消息的发出和收到两份副本只算一次。
- 新版 macOS 只把正文存在 `attributedBody`（序列化的 NSAttributedString），从中读出文字。
- 没在真的 Mac 上跑过；测试用伪造的数据库和假的 osascript。
