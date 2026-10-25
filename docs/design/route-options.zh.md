# 拿不准的时候给选项：动手前核对、「分错了」没说去哪

## 目标

DSH 自带 `userQuestions` 服务（`@deepseek-ai/dsh-user-questions`），能在主聊天弹出带选项的问题，用户点一下就回答了；绑定了微信 / Telegram 时，选项也会发到手机上（回数字）。TheOne 已经用它把话题里的 `ask_user_question` 转到主聊天（`src/index.ts` 的 `forwardQuestions`，约 1932 行）。

这次把 TheOne **本来就要问用户**的两个地方，从「是/否」或「请你打字说」改成「点一个选项」。不新增任何提问时机：0.3.39 起 TheOne 不问「这条消息该放哪」（`src/routing-policy.ts` 的 `settleUnclear` 注释），这个原则不变。

1. **动手前核对**：话题第一次要改文件、跑命令、发东西，而这条消息也可能属于别的话题时，现在弹的是批准框（`checkTargets` / `targetDoubt`，约 1801 行，用 `approval.request`），只能允许或拒绝；拒绝后用户还得去话题工作区自己改。改成选项：就在这里做 / 其实是某某的（直接转过去） / 新开一个话题。
2. **「分错了」但没说该去哪**：现在 `reroute` 拿不准时返回 `correction-unclear`，主聊天回一段字「应该放到哪个话题？可以说……」（约 2710 行、`CLARIFY_TEXT`）。改成列出候选话题让用户点。

## 范围

允许改动：`src/index.ts`、`src/routing-policy.ts`（如需要）、`dist/`（构建产物，必须和源码一起提交）、`tests/` 下新增测试文件 `tests/route-options.test.ts`，以及为适配新行为必须调整的现有测试（逐条在汇报里说明为什么改）。

不做：

- 不在普通问答里新增提问。只改上面两个本来就会问的地方。
- 不改路由模型的提示词，不改评测。
- 不改版本号，不写 `.github/release-notes/`，不发版，不改 README。
- 不碰 `client.ts` / `client-locales.ts` 的界面（选项窗口是 DSH 自己画的）。
- 不做 dot 服务、头像相关的东西。

## 设计

### 0. 公共：在主聊天问一个单选题

写一个私有方法，例如 `askChoice(gateway: Agent, question: { header; question; detail?; options: { label; description? }[] }, signal): Promise<{ label?: string; custom?: string } | undefined>`：

- 用 `this.ctx.get('userQuestions')`，调用 `ask({ agent: gateway, signal, questions: [{ id: 'theone-route', header, question, detail, options, multiSelect: false }] })`。
- 返回用户选中的 label，或「其他」里打的字（`custom`）。服务不存在、抛错（`ASK_ABORTED`、`CALLER_NOT_LIVE`、`DELEGATED_CALLER` 等）、没有答案时返回 `undefined`，**调用方退回现在的做法**，不能让对话卡住或报错。
- signal 被取消时照常抛出取消（和现有代码处理 `signal.throwIfAborted()` 的方式一致）。
- 选项 label 必须两两不同：话题标题如果和固定选项撞了或彼此重名，在后面加「（2）」之类区分；label 超过 40 个字截断加「…」。
- 问话期间算「在等用户」（参考 `whileAsking` 的用法），和转发话题提问一样。

### 1. 动手前核对改成选项（`checkTargets`）

触发条件不变：`targetDoubt` 返回了疑问，且这条消息的 `alternateIds` 里有别的话题时，改问选项。**只有「要改的东西在另一个项目文件夹里」那种疑问（没有 alternateIds）保持现在的批准框不变。**

选项（最多 3 个备选话题，取 `alternateIds` 里还存在、没被排除的）：

| 选项 | 结果 |
|---|---|
| 就在「A」里做 | 和现在 `allowed-once` 一样：`markOnce('target:…')`，`next()` |
| 其实是「B」的（每个备选一项） | 这一轮在 A 里停下，消息转给 B 重新处理：复用 `handBack` 的那套（`moveRoute`、`startRun`、`misroute` 标记、`noteMisroute`、`applyCorrection` 学词），但**直接指定目标话题**，不再调用 `reroute`。把 `handBack` 拆出一个「交给指定话题」的内部方法给两边共用，不要复制一份。工具调用返回 `deny`，原因告诉 A：用户确认这条属于 B，已转交，不要改任何东西，也不要回答 |
| 新开一个话题 | 同上，但目标是 `newIndependentTopic(消息原文, …, 'correction')` 新建的话题 |
| 用户在「其他」里打了字 | 当作「分错了，是 <这段字>」：调用 `reroute(…, hint = 这段字)`；得到明确的话题就像上面那样转过去，拿不准就按「就在 A 里做」以外的拒绝处理（返回现在的 deny 文案） |
| 取消、超时、没有答案 | 回到现在的批准框流程（`approval.request`），行为和今天完全一样 |

转交失败（目标话题忙、已被删）时，和 `handBack` 现在一样把一切放回原样，按「就在 A 里做」继续。

`handBack` 有「每条消息只交一次」的标记（`handback:<inputId>`），这里也要遵守：已经交过一次的消息不再提供「其实是 B 的」选项，只走批准框。

### 2. 「分错了」没说去哪时给候选（`correction-unclear`）

现在 `reroute` 在拿不准时返回 `{ action: 'CLARIFY', reason: 'correction-unclear' }`，主聊天输出固定文字。改成：在主聊天显示 `CLARIFY` 文字**之前**，如果原因是 `correction-unclear` 且能凑出至少 1 个候选，就先问选项：

候选（去重、排除上一条原本所在的话题、排除已不可用的话题，最多 3 个，按顺序取）：

1. 上一条消息路由时的 `alternateIds`；
2. `this.catalog.candidates(上一条原文)` 给出的话题；
3. `similarCorrections(上一条原文)` 里以前被纠正去的话题；
4. 最近用过的话题（按最近活动时间）。

再加一项「新开一个话题」。

| 用户选择 | 结果 |
|---|---|
| 某个话题 | 等同于用户说了「分错了，是 <那个话题>」：生成 `{ action: 'MOUNT', contextId, reason: 'correction', correctionOf: previous.id }`，后面走现有的纠正流程（`applyCorrection`、`correctedInput` 等），不另写一套 |
| 新开一个话题 | `newIndependentTopic(previous.text, …, 'correction')`，同样带 `correctionOf` |
| 「其他」里打了字 | 当作 hint 再调用一次 `reroute`；仍然拿不准就输出现在的固定文字 |
| 取消、超时、没有答案、候选为 0 | 输出现在的固定文字，和今天一样 |

注意这一步发生在主聊天自己的回合里（路由阶段），要确认 `ask({ agent: gateway })` 在这个时机能弹出来；测试里要覆盖。

## 文案（中英文都要，按消息原文的语言选，用现有的 `writtenInEnglish`）

动手前核对：

- header：`放在哪个话题` / `Which topic`
- question：`这条消息放在了「{A}」，但也可能是「{B}」的事。在哪里做？`（多个备选时：`……也可能是「{B}」或「{C}」的事……`） / `This message went to "{A}", but it may be about "{B}". Where should it be done?`（多个：`"{B}" or "{C}"`）
- 选项：`就在「{A}」里做` / `Do it in "{A}"`；`其实是「{B}」的` / `It's about "{B}"`；`新开一个话题` / `Start a new topic`
- 选项说明（description）：第一项 `照常做，不再问` / `Go ahead; no more asking for this message`；转交项 `交给「{B}」重新处理，这里什么都不改` / `Hand it to "{B}" to redo; nothing changes here`

「分错了」没说去哪：

- header：`分错了` / `Wrong topic`
- question：`上一条应该放到哪个话题？` / `Which topic should the last message go to?`
- 选项：话题标题原样作 label；`新开一个话题` / `Start a new topic`
- 话题选项的 description：来自第 1 类候选的写 `当时也考虑过它` / `It was considered at the time`；来自第 4 类的写 `最近用过` / `Used recently`；其余不写。

## 验收

1. 新建 `tests/route-options.test.ts`，写法参考 `tests/targets.test.ts`（动手前核对）、`tests/controls.test.ts` / `tests/routing-policy.test.ts`（纠正），提问的模拟参考 `tests/approval.test.ts` 里 `user-questions/request` 的写法。至少覆盖：
   - 有 `alternateIds` 时弹的是选项而不是批准框；选「就在 A 里做」后工具照常执行，同一条消息后续改动不再问；
   - 选「其实是 B 的」：A 的工具没有执行，消息由 B 重新处理，主聊天显示 B 的回答，A 那一轮不进 A 的历史，学到的纠错词记在 B；
   - 选「新开一个话题」：新建话题并由它处理；
   - 「其他」打字走 `reroute` 的 hint；
   - 取消 / 服务不可用 / `ask` 抛错时退回批准框，行为和改动前一致；
   - 只有「另一个项目文件夹」疑问（无 alternateIds）时仍是批准框；
   - 已经交回过一次的消息不再给转交选项；
   - 「分错了」不说去哪：弹出候选，顺序和去重符合上面的规则，选中后走现有纠正流程；选「新开一个话题」；取消或没有候选时输出原来的固定文字；
   - 英文消息用英文文案；
   - 选项 label 重名时被区分开。
2. `npm.cmd run build`、`npm.cmd run typecheck`、`npm.cmd test` 全部通过（现有 344 项不能少；为适配新行为改动的旧测试逐条说明）。`dist/` 一起提交。

## 工作方式

- 直接用 shell 执行命令，不要使用子代理和 node_repl。PowerShell 里用 `npm.cmd`；需要 Python 用 `py`；读中文文件用 `-Encoding UTF8`。
- 在分支 `theone/route-options` 上提交，可以分几次提交。作者用 `YunongDai2005 <yuriddaaii@gmail.com>`，**提交信息里不要加 Co-Authored-By 或任何 AI 署名行**。不要 push，不要改写历史。
- 仓库里未跟踪的用户文件夹（`.dsh/`、`.workbuddy/`、`outreach/`、`promo/`、`promo-4k/`、`promo-demo/`、`promo-fish/`、`promo-horus/`）不要碰；`git add` 只加你改过的文件。

## 汇报要回答

- 改了哪些文件，各做了什么。
- 测试总数和结果；改了哪些旧测试、为什么。
- 主聊天路由阶段（「分错了」那一步）调用 `userQuestions.ask` 是否能正常弹出、怎么验证的。
- `handBack` 拆出来的共用方法长什么样，两边是否都走它。
- 有没有偏离本文设计的地方，为什么。
- 还有什么没做完或拿不准的。
