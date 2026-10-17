# 调研：把 TheOne 做成 DSH 的 dot

状态：调研，不含实现（2026-10-17）。目的是弄清 OpenAI 的 dot 是什么、哪里做得好、哪里不好，以及 TheOne 现在离它有多远、能在哪里比它好。按计划表，结构性改动要先写方案；这份是方案之前的功课。

资料来源见文末。OpenAI 自己的发布页和帮助文档本次抓取被拒（403），下文对官方的引述来自转述官方材料的文章；第三方文章里的模型名、价格细节互有出入，只作参考。

## 一、dot 是什么

OpenAI 2026-09-29 在 DevDay 发布，放在 ChatGPT 里，首批给 Pro 和 Business Premium 用户。

- **一件"职责"，一直在干。** 你交给它一件持续的事，它在你们两次对话之间也继续做，自己决定什么时候暂停、什么时候接着干（比如等一封邮件回复）。可以按时间表跑，也可以在连接的服务支持时由事件触发。
- **协调者，不是干活的人。** 要写代码、做文档时，它开一个 Codex 或 ChatGPT Work 任务交出去，每个任务是一条独立线程，你可以打开、接管；做完它检查结果再向你汇报。10 月的更新里，它可以接着已有的 Codex 线程做，并且"更会判断该接着一条线程，还是新开一条"。
- **自己的笔记。** 记你的偏好、做过的决定、进行中的事，和 ChatGPT 的记忆互通。用户看不到也改不了单条笔记；断开某个应用，也不会删掉它从那里学到的东西；只能整个重置。
- **哪都能找到它。** ChatGPT（文字、语音）、Slack、Teams，手机 App 也能创建和对话；短信是小范围测试。它不能主动给你打电话。
- **有事才找你。** 需要你做决定、登录、重连应用或批准时才找你；可以设规则，比如日常进展留在 ChatGPT、要你拍板的事发 Slack。主动调研（自己去读你连接的应用，给你建议）只能读，不能发消息、改内容、操作浏览器。
- **按动作分级授权（Custom Rules）。** 四档：直接做、预先批准过才做、先问再做、交给你做。改密码等永远交给你；涉及账号和分享信息的动作有自动审查，用户批准也不能绕过；可疑操作会被暂停。
- **在云上跑。** 每个 dot 有 OpenAI 托管的电脑和浏览器，你的笔记本关了它照常工作；可以选择连一台自己的电脑（默认关）。
- **形象。** 可自定义名字、形状、颜色、眼睛、配饰的小圆点；先给一个"主 dot"，以后会有专门领域的 dot 和多个 dot 协作。
- **用量。** 和 dot 聊天不计入 ChatGPT 限额，它派出去的 Codex / Work 任务计入。

## 二、实际用起来怎么样（评测）

上线两周的公开评测，结论比较一致：

- **读和提醒做得好，动手不可靠。** 能把 Slack 和日历里的冲突串起来提醒你、发现表格权限不对；但发邮件、改日程、发私信常失败，例如以为你用 Gmail、发出三个坏链接。
- **启动阶段要人盯着。** 评测者要反复自己找下一步，问"这是不是违背了助手的初衷"。
- **说的先于做的。** 它会先宣布"已连接""已完成"，实际还没成功；评测者要反复去确认事情到底做完没有。
- **定时任务不一定跑。** 早上 8 点的日报到当天结束都没送达。
- **反应慢。** 一个请求 49 分钟后才被接手。
- **网页上的事卡在验证码、登录循环上。**
- **权限不等于结果对（dev.to 的批评）。** Custom Rules 只规定"能不能做"，不能规定"做成什么样才算对"。作者主张每件职责要有验收标准，按证据逐步放权，出错就收回。

## 三、和 TheOne 逐项对照

| dot | TheOne 现在 | 位置 |
| --- | --- | --- |
| 协调者把活派给线程，可接管 | ✅ 主聊天把消息派给话题会话，话题能打开继续 | `src/index.ts` 路由、`run.ts` |
| 判断接着旧线程还是新开 | ✅ 这正是 TheOne 的核心（路由），而且有评测：InterleaveBench 事先给话题 91.6%、从零开始 86.6% | `llm-router.ts`、`eval/` |
| 一件持续的职责 | 🟡 只有"持续任务"：只读地盯公开 GitHub PR，有持久队列、租约、重试、通知 | `work-store.ts`、`work-scheduler.ts`、`persistent-work.ts` |
| 时间表 / 事件触发 | 🟡 持续任务有定时检查；DSH 的 `/goal` 能按轮推进 | 同上 |
| 笔记 | 🟡 话题描述、路由卡片、要点（默认关）；没有"关于你"的记忆 | `topic-memory.ts`、`facts.ts` |
| 哪都能找到 | ✅ 主聊天，微信 / Telegram / iMessage（实验） | `remote-*.ts`、`weixin*.ts` 等 |
| 有事才找你、手机上批准 | 🟡 授权和提问能发到手机；没有"什么事发到哪"的规则 | `remote-relay.ts` |
| 分级授权、自动审查 | 🟡 用 DSH 自己的权限模式和 Auto 审查（0.3.34 修好同步）；没有按动作的四档规则 | `index.ts` 权限同步 |
| 同时动手的冲突 | ✅ 同一项目的回合排队 | `project-queue.ts` |
| 重启后接着干 | ✅ 中断的不重做；持续任务恢复 | `store.ts`、`work-store.ts` |
| 一直在线 | ❌ DSH 要开着；电脑睡了就停 | — |
| 连接外部应用 | 🟡 靠 DSH 的插件和工具，没有成体系的"连接" | — |
| 形象 | ❌ | — |

骨架大半已经在：协调者结构、选线程（路由）、多个入口、排队、持久队列。缺的是"职责"这个单位、关于你的笔记、提醒规则、一直在线。

## 四、TheOne 能比 dot 好的地方

1. **选线程是 TheOne 的看家本领，而且有数。** dot 10 月才说"更会判断续用还是新开"；TheOne 从第一天做的就是这个，有公开评测可以每个版本对比。
2. **笔记透明。** dot 的笔记看不到、改不了，是评测和用户最直接的痛点之一。TheOne 可以让"关于你"的每一条都能看、能改、能删、能看到出处。
3. **状态看得见、说的就是做到的。** dot 被批评"先宣布后做到""看不到做完没有"。TheOne 的主聊天把后台话题的工具卡、改动卡、待办都照原样显示，可以坚持"只在真正完成后才说完成"，并给每件职责一个看得见的进度。
4. **验收标准。** 把 dev.to 提出的缺口直接做成设计：每件职责写清楚"做成什么样算对"，按证据放权。
5. **在你自己的机器上、用你自己的模型。** 数据不出你的电脑（或你的服务器），用 DeepSeek 等你在 DSH 里选的模型，不受 ChatGPT 套餐限制。
6. **中文用户的入口。** 微信是 dot 没有的。

## 五、要补的东西（按对 dot 的重要性）

1. **职责。** 一件职责 = 目标 + 时间表或触发条件 + 执行者（某个话题会话）+ 授权规则 + 验收标准 + 汇报方式。持续任务的持久队列（状态、租约、重试、通知去重）可以直接复用；要新加的是"派给话题会话执行"和"按规则先问再做"。现在持续任务明确只读、不动手，这一点要放开，也是风险最大的一步。
2. **关于你的笔记。** 从对话里记下偏好、人物、决定、长期的事，跨话题可用；面板里能看、能改、能删、能看到出处。现有要点（facts）的证据和版本机制可以复用，但它是按话题存的，要加一层"属于你、不属于某个话题"。
3. **提醒规则。** 什么事发到手机、什么只留在主聊天、什么不打扰；"完成"只在验收通过后发。
4. **分级授权。** 把 dot 的四档对到 DSH 的权限模式和 TheOne 的转发：直接做 = 话题会话照常执行；先问再做 = 走现有的授权转发（主聊天或手机）；交给你做 = 只发说明不执行。
5. **一直在线。** DSH 能在服务器上不开界面运行。最现实的路是"自己托管的 dot"：DSH + TheOne 装在一台常开的机器上，配手机入口。需要部署指南和服务器场景下的登录与安全。
6. **外部应用。** 先不追 4000 个连接；靠 DSH 已有的插件，挑最常用的几个（邮件、日历、GitHub）做成职责的数据来源。
7. **形象（可选）。** 主聊天的身份和一个可自定义的小形象。

## 六、和现有设计语言的冲突

- 第 4 条"只整理，不改动"、第 5 条"装前关后没有区别"：dot 的本质是替你做事。要改成类似"动手前按你的规则问你；做了什么都看得见、可撤回"。
- #8 宣布"暂停新功能"：和 dot 方向冲突，需要重定指标（见下）后再决定是否合并。
- "一个入口、只说话、无感"三条和 dot 完全一致，保留。

## 七、可以衡量的指标

- **选线程准确率**：InterleaveBench 现成，重点看"过度拆分"（现在平均 2.1 个话题一件事）。
- **职责完成率**：按验收标准算，不按模型自己说的"完成"。
- **说到做到率**：说"完成 / 已发送"的事里，实际完成的比例（直接针对 dot 被批评的问题）。
- **打扰有没有用**：主动消息里，用户回应的比例 vs 忽略、关掉的比例。
- **笔记召回准确率**：隔几天问它之前说过的事，答对的比例。

## 八、建议的第一步

不先追全套，先做一件能完整演示 dot 价值的事："每天早上把我关心的事汇总发到微信"，或"盯着这个 PR，CI 挂了就派话题去查原因，先问我再改"。后者能复用持续任务、路由、话题会话、授权转发和手机入口，几乎每一层都现成，缺的只是"派出去执行"和"验收"。

## 九、要用户决定的

1. 先接受"电脑开着才在"，还是把自托管服务器当正式用法？
2. 职责能动手到什么程度：先只做"派出去、你确认后执行"，还是允许按规则直接做？
3. 要不要形象？
4. 主要给谁用：开发者（代码、PR、项目）还是日常生活和工作？
5. 设计语言第 4、5 条和 #8 怎么处理？

## 来源

- [TechCrunch：OpenAI launches Dots](https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/)
- [The Next Web：dots, always-on AI agents with their own cloud computers](https://thenextweb.com/news/openai-dots-always-on-ai-agents-cloud-computers-devday)
- [Reworked：DevDay 2026 highlights](https://www.reworked.co/ai-news/the-biggest-announcements-from-openai-devday-dots-agents-new-500-plan/)
- [Flavio Copes：A deep dive into OpenAI dots](https://flaviocopes.com/openai-dots/)
- [Vellum：Official OpenAI Dots breakdown](https://www.vellum.ai/blog/official-openai-dots-breakdown)
- [OpenAI 开发者社区：Create in the mobile app, delegate to Codex](https://community.openai.com/t/fresh-dots-updates-create-in-the-mobile-app-delegate-to-codex/1404834)
- [OpenAI Developers（X）：Your dot learns how you work…](https://x.com/OpenAIDevs/status/2106152299026661641)
- [OpenAI：Introducing dots](https://openai.com/index/introducing-dots/)、[Getting started with your dot](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot)（本次未能直接读取）
- [The Slide Factory：首日实测](https://www.theslidefactory.com/post/openai-dots-review)
- [Geeky Gadgets：24 小时实测](https://www.geeky-gadgets.com/chatgpt-dots-review-24-hours/)、[Neoteo：实测](https://www.neoteo.com/en/a-reported-openai-dots-test-finds-useful-follow-up-and-a-hard-stop)
- [dev.to：OpenAI's dots need acceptance criteria, not just Custom Rules](https://dev.to/ascotlan/openais-dots-need-acceptance-criteria-not-just-custom-rules-38da)
