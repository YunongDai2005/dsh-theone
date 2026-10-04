<h1 align="center">TheOne</h1>

<p align="center"><b>只开一个对话框，聊你所有的事。</b><br>它自己分清每句话属于哪件事，每件事的上下文互不干扰。</p>

<p align="center">
  <img alt="DSH 0.2.0-rc.2" src="https://img.shields.io/badge/DSH-0.2.0--rc.2-a75b1e">
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24-3c873a">
  <img alt="中文 / English" src="https://img.shields.io/badge/界面-中文%20%2F%20English-4a7fb5">
</p>

<p align="center"><a href="./README.md">English</a> | 简体中文</p>

<p align="center"><img src="docs/images/theone-film-preview.webp" alt="TheOne 宣传片：One 按钮化作 3D 钥匙，把每条消息路由到对应的会话" width="100%"></p>

---

你的 DSH 侧边栏里是不是躺着几十个会话？想回到上周那件事，得一个个翻；懒得新建，就在一个会话里什么都聊，结果上下文越聊越乱，压缩一次细节就没了。

**TheOne 把这些都交给它。** 你只管在一个主聊天里说话：

```text
你：Qwen 在 9070 XT 上跑 FP8 还是报错
    → Qwen / RX 9070 XT
你：顺便把论文第三章的消融表补上
    → 视频注意力论文
你：把刚才 Qwen 的测速结果也放进去
    → 视频注意力论文 · 参考：Qwen / RX 9070 XT
你：分错了，是显卡那个的
    → Qwen / RX 9070 XT        （上一条交给它重新处理，以后也记住了）
```

<sub>示意。默认只在切换话题时显示一行提示。</sub>

每件事都有自己的后台会话，在里面推理、调用工具、压缩上下文；你看到的始终是一个普通的对话。

## 为什么值得一试

| | 平时的用法 | 装了 TheOne |
| --- | --- | --- |
| 开始一件新事 | 新建会话、起名字 | 直接说 |
| 回到之前的事 | 在侧边栏里翻 | 直接提，它自己找回来 |
| 一个会话聊杂了 | 上下文互相干扰，压缩后丢细节 | 每件事一份独立上下文 |
| 两件事要结合 | 来回复制粘贴 | 自动把另一件事的进展带过来 |
| 分错了 | 手动挪 | 说一句「分错了」 |

- **和原生会话一模一样**：思考从第一个字起就在原位置，工具卡片、授权、提问、待办、重试、回答中途插话，全都照常。
- **相关的事会互通，无关的事互不打扰**：相关话题自动共享进展，并从你的使用中学习哪些话题有关联；话题的约束（比如「预算数字不能写进论文」）每次都原样带上，压缩不会把它丢掉。
- **越用越准**：说「分错了」或在目录里点「改到…」，TheOne 会学到哪些词把这类消息和正确话题联系起来（只需一次很小的模型调用），类似的消息以后直接分对；话题目录里能看到分配的准确率。
- **旧会话自动变成话题目录**：装上后它会在后台读取你已有的会话，整理成话题并按工作区分组，直接接着聊。
- **零额外配置**：不用另填 API Key，路由和后台都用你在 DSH 里选好的模型。选中 TheOne 时，模型按钮旁边会出现一个带图层图标的按钮，显示并切换分配话题和干活用的模型。

![TheOne 主聊天与话题工作区](https://raw.githubusercontent.com/YunongDai2005/dsh-theone/main/docs/images/theone-topic-workspaces-en.png)

## 30 秒装好

1. 在 DSH 中配置好 API，选一个能正常聊天的模型。
2. 打开 **插件 → 添加插件**，粘贴 `https://github.com/YunongDai2005/dsh-theone`，点击安装。
3. 点击左侧 **TheOne · 主聊天**，开始说话。

命令行安装：`dsh plugin --profile web add github:YunongDai2005/dsh-theone --ignore-scripts`。兼容 DSH `0.2.0-rc.2` 与 Node.js 24；界面跟随 DSH 的语言（简体中文 / English）。也可以从 npm 安装 `dsh-theone`，但 DSH 的包管理器只接受发布满 24 小时的版本，所以用 GitHub 地址安装能最早拿到新版本。遇到这种情况，更新按钮会说明原因，并可以只为 TheOne 放行、立即安装。

> 非官方社区项目，由社区成员独立维护，与 DeepSeek 不存在隶属或背书关系。

## 它是怎么工作的

**分配话题。** 每条消息先判断：接着当前话题、回到某个旧话题，还是开个新的。默认用你选的模型做一次简短分类（关闭深度思考，最多 2048 token），候选话题由 DSH 全文搜索召回。

- 没有匹配就直接开新话题，不会问你「是不是新话题」；只有你明确提到一段找不到的旧聊天，或者确实分不清是哪一件时才追问。
- 一句话同时用到几件事时，交给真正做事的那件，其余作为参考带上。
- 「好的」「继续」直接接着当前话题，不等判断；只发图片或文件也接着当前话题。
- 分类调用失败时改用规则判断，拿不准就留在当前话题。规则模式（`THEONE_ROUTER_MODE=rules`）完全不调用模型。

**话题联动。** 后台开始工作时会收到一份参考简报，没有新内容就不发：

- 刚切换话题时，附上主聊天最近几轮，「把刚才那个……」能接上；
- 相关话题自上次以来的变化：最近一次压缩摘要（注明截至时间）和之后的进展；
- 各话题的约束，原样附上，每次都带。

简报标注为参考资料而非指令；需要细节时，后台可以用 `theone_read_topic`、`theone_search_history` 去查。联动范围可选「自动学习」（默认）、「仅同一工作区」或「关闭」。在目录里可以手动关联或解除关联、把话题标记为「不共享」，你的设置永远优先。

**话题目录。** 每个话题卡片显示最新进展和约束。点 **管理** 可以重命名、改摘要和约束、移到别的工作区、合并、删除，或把已有的 DSH 会话关联为可检索的历史；**＋ 新话题** 手动新建。**最近的话题分配** 列出每条消息去了哪里、原因、所用模型和耗时。历史较多时，第一次整理需要一些时间和 API 额度；设置 `THEONE_HISTORY_CATALOG=false` 可关闭。

<details>
<summary><b>设置</b></summary>

右键左侧的 TheOne 按钮，选择 **设置**。保存后立即生效，只有历史整理相关的设置需要重启 DSH。

| 设置 | 说明 |
| --- | --- |
| 话题提示 | 主聊天里怎样显示话题切换：隐藏、仅切换时显示一行（默认）、每条都显示并注明原因 |
| 联动范围 | 自动学习（默认）、仅同一工作区、关闭 |
| 模型 | 跟随 DSH（默认），或从 DSH 已配置的模型中固定后台模型；固定的设置优先于主聊天里的选择 |
| 路由方式 | LLM 判断（默认）或规则判断 |
| 历史整理 | 开关与补扫间隔 |
| 内容限制 | 话题资料长度；后台每一步回复的长度（含思考） |
| 人工话题目录文件 | 可选的 JSON 话题目录，保存时导入 |

数据库位置和主入口标识会让 TheOne 换用另一份数据，只能用环境变量 `THEONE_DATABASE_PATH`、`THEONE_GATEWAY_KEY` 设置。另外可选：`THEONE_CONTEXTS_PATH`，以及须一起设置的 `THEONE_WORKER_PROVIDER` / `THEONE_WORKER_MODEL`。
</details>

<details>
<summary><b>数据与隐私</b></summary>

- 原始对话和工具结果由 DSH 保存；TheOne 只在自己的 SQLite 数据库（`$DSH_HOME/theone/contexts.db`，默认 `~/.dsh/theone/`）里保存目录、摘要、关联和路由记录。
- 发给路由和写进参考简报的内容会去掉 API Key、密码等敏感信息。
- 标记为「不共享」的话题，不会出现在其他话题的简报、最近对话和查阅结果里。
- 作者发布的公告从 `https://yulid.org/theone/notice.json` 读取，只是一次普通的下载，不发送你的任何数据；可以在设置里关闭。
- 主聊天变长时，DSH 通过 TheOne 压缩它：常用话题保留较长摘要和最近几轮，不常用的只保留简短状态，不额外调用模型。
- 有新版本时，左侧 TheOne 入口右边会出现一个下载图标，点一下由 DSH 的插件管理器安装，并就地重新加载 TheOne，不用重启 DSH（不支持插件热加载的 DSH 会在下次启动时生效）；话题都保存在数据库里，不受影响。
</details>

<details>
<summary><b>已知限制</b></summary>

- 同一时间只处理一个请求；回答期间排队的消息要等本轮结束。
- 新话题的文件默认写在 `~/.dsh/theone/gateway`，暂时不能指定项目目录。
- 主聊天保存了工具调用的副本，长期使用记录会变大；入口日志轮换尚未实现。
- 主聊天身份按浏览器保存：换浏览器或桌面端会出现另一个主聊天，话题仍然共用。同一数据库同时只应由一个 DSH 进程使用。
- 图片输出尚未转发；没有向量检索；暂不支持拆分话题。
- 主聊天里的工具卡片只显示、不执行，这依赖 TheOne 位于 DSH 工具流程的最前面；其他插件也抢到最前面时可能看到这些镜像调用，但工具不会执行两次。
</details>

<details>
<summary><b>开发</b></summary>

```sh
git clone https://github.com/YunongDai2005/dsh-theone.git
cd dsh-theone
npm ci --ignore-scripts
npm run typecheck
npm test
```

测试使用真实的 DSH 运行时（AgentLoop、Session、SQLite、JSONL 持久化、压缩），只模拟模型，不调用外部 API。`npm run pack:plugin` 生成安装包；`npm run install:local` 和 `npm run start:local` 会在 `~/.dsh-theone` 启动一个独立的 DSH profile。

服务接口：`ctx.theone.searchHistoryDetailed(contextId, query, limit)` 检索话题的已审核历史；`store.addSource(contextId, sessionId, { startSeq, endSeq })` 关联会话的一部分。旧版本验收记录见 [v0.1](./docs/plugin-v0.1.zh.md) 和 [v0.2](./docs/plugin-v0.2.zh.md)。
</details>

---

<p align="center">觉得有用的话，点个 ⭐ 让更多人看到。遇到问题或有想法，欢迎 <a href="https://github.com/YunongDai2005/dsh-theone/issues">提 Issue</a>。</p>
