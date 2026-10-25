# 整理旧会话前先征得同意，并可排除部分会话

## 目标

现在 TheOne 一装上，`HistoryCatalog` 就在后台把用户 DSH 里所有旧会话的摘录发给模型，整理成话题目录（`src/index.ts` 里 `config.historyCatalog ?? true` 那段，约 432 行）。用户访谈里，研究生和重度用户最担心这一步：不知情地被读、被花额度，也没法排除私密会话。

改成：

1. **新装用户**：不经同意不读旧会话、不调模型。主聊天欢迎语和「话题工作区」里都用平常说话的语气问一句，用户点「开始整理」才开始。
2. **可以排除**：按会话或按项目文件夹排除。被排除的会话不读、不发给模型、不进目录；随时可以改回来。
3. **老用户不受影响**：已经整理过的用户视为已同意，行为和现在一样。

## 范围

允许改动：`src/history-catalog.ts`、`src/catalog-types.ts`、`src/store.ts`、`src/index.ts`、`src/client.ts`、`src/client-locales.ts`、`dist/`（构建产物，必须和源码一起提交）、`tests/` 下新增测试文件，以及 README / README.zh.md 中与「装上就自动整理旧会话」相矛盾的事实性描述（只改那一两句，不加新版说明段落）。

不做：

- 不改版本号，不写 `.github/release-notes/`，不发版。
- 不改设置页里 `historyCatalog` 总开关的含义（关掉仍然完全不整理）。
- 不去删除已经整理进目录的内容（排除只影响以后，以及把只来自被排除会话的话题隐藏起来）。
- 不碰 dot 服务、头像相关的东西。

## 设计

### 1. 存储（`src/store.ts`）

新增两张表（`CREATE TABLE IF NOT EXISTS`，和现有写法一致）：

- `catalog_consent`：单行，`consent TEXT CHECK (consent IN ('granted','declined'))`、`at INTEGER`。
- `catalog_exclusions`：`kind TEXT CHECK (kind IN ('session','folder'))`、`value TEXT`、`at INTEGER`，主键 `(kind, value)`。`folder` 存项目文件夹的绝对路径。

新增方法：`catalogConsent(): 'granted' | 'declined' | undefined`、`setCatalogConsent(value)`、`catalogExclusions(): { sessions: Set<string>; folders: string[] }`、`setCatalogExcluded(kind, value, excluded: boolean)`、`hasIndexedHistory(): boolean`（`history_index` 里有 `status = 'ready'` 的行）。

### 2. 老用户迁移（`src/index.ts`）

创建 `HistoryCatalog` 之前：`catalogConsent()` 为空且 `hasIndexedHistory()` 为真 → `setCatalogConsent('granted')`。

### 3. 目录扫描（`src/history-catalog.ts`）

- 构造函数加一个选项 `askFirst`，**默认 false**（现有测试直接 new `HistoryCatalog`，不能因此全挂）。`src/index.ts` 创建时传 `true`。
- `askFirst` 且未同意（`undefined` 或 `'declined'`）时：
  - TheOne 自己的会话（`store.isGateway`、`store.ownedSessionIds()`）照现有逻辑处理（会被标记 skipped），`reconcile` 照常跑，这样归档/丢失话题的隐藏逻辑不受影响；
  - 其余用户会话**不读取内容、不调模型、不写 `history_index`**，只计数到 `status.waiting`；
  - `status.consent` 填 `'ask'` 或 `'declined'`。同意后填 `'granted'`。
- 被排除的会话（id 在排除列表里，或 `record.header.cwd` 位于某个被排除文件夹之内，路径比较要处理 Windows 大小写和分隔符）：任何时候都不读、不调模型，计数到 `status.excluded`，不算 pending。
- `incomplete`：`askFirst` 且未同意时返回 false（没有要等的历史，否则路由会一直以为历史没整理完，见 `index.ts` 约 2368 行 `CREATE` 被拦的逻辑）。被排除的会话不让目录变成 incomplete。
- `reconcile`：一个话题已知的所有会话都被排除 → 隐藏原因 `'excluded'`（`HiddenReason` 加这个值）。`store.unreachable()` 也要包含 `'excluded'`，让它不参与路由和简报。取消排除后下一次扫描自动恢复，和 archived 一样可逆。
- 同意、排除变化后调用 `requestRefresh()`。

`CatalogStatus` 增加：`consent?: 'ask' | 'declined' | 'granted'`、`waiting?: number`、`excluded?: number`。

### 4. 接口（`src/index.ts`，照现有 `connection.fetch!.register` 写法）

- `GET /api/theone/catalog`：status 里带上新字段（`this.catalog` 不存在时的 fallback 也要合理）。
- `POST /api/theone/catalog/consent`，body `{ consent: true | false }` → 记录并刷新；返回新的 status。目录被设置关掉时返回 409 `CATALOG_DISABLED`。
- `GET /api/theone/catalog/sessions` → 可选的用户会话列表：`{ folders: [{ path, name, excluded }], sessions: [{ id, title, folder: path | null, createdAt, excluded }] }`。不含 subagent、TheOne 自己的会话、DSH 已归档的会话。title 用 `sessionQuery.readTitle`，读不到就空字符串。文件夹用现有 `projectFolders()`。
- `POST /api/theone/catalog/sessions`，body `{ kind: 'session' | 'folder', value: string, excluded: boolean }`。`session` 必须在上面的列表里，`folder` 必须是 `projectFolders()` 里的路径，否则 400 `INVALID_INPUT`。

### 5. 主聊天欢迎语（`welcomeText`，`src/index.ts` 约 226 行）

按是否已同意给两个版本。语气要像人说话，不要像系统通知。

未同意（新装）：

> 你好，我是 TheOne。以后不管什么事，都在这儿跟我说就行。我会分清你说的是哪件事，交给那件事自己的后台会话去做，过程都显示在这里。
>
> 你以前在 DSH 里的聊天，我一条都还没看。要不要我把它们整理成话题目录？整理好之后，你提到以前的事，我就能接上。原来的会话一个都不会删，不想让我看的也可以先挑出来。想好了去左边的「话题工作区」点一下就行，不着急。

> Hi, I'm TheOne. From now on you can bring anything here. I'll work out which thing you're talking about, hand it to that topic's own background session, and show the work right here.
>
> I haven't looked at any of your earlier DSH chats yet. Want me to sort them into a topic directory? Then when you mention something from before, I can pick it up. Nothing gets deleted, and you can leave out any chats you'd rather I didn't read. Whenever you're ready, it's one click in **Topic workspaces** on the left. No rush.

已同意（老用户）：

> 你好，我是 TheOne。以后不管什么事，都在这儿跟我说就行。我会分清你说的是哪件事，交给那件事自己的后台会话去做，过程都显示在这里。你以前的聊天在左边的「话题工作区」里，原来的会话都还在。

> Hi, I'm TheOne. From now on you can bring anything here. I'll work out which thing you're talking about, hand it to that topic's own background session, and show the work right here. Your earlier chats are in **Topic workspaces** on the left, and the original conversations are all still there.

`historyCatalog` 设置关掉时用已同意版本去掉最后一句即可。

### 6. 话题工作区（`src/client.ts` 的 `CatalogPanel`，文案进 `src/client-locales.ts`，中英文都要）

**询问卡片**（`status.consent === 'ask'` 时放在工具栏下方、路由列表上方）：

- 标题：要不要整理以前的聊天？ / Sort out your earlier chats?
- 正文：你在 DSH 里有 {count} 个以前的会话。整理之后，你在主聊天里提到以前的事，TheOne 能找到并接着做。 / You have {count} earlier conversation(s) in DSH. Once they're sorted, TheOne can find them when you bring something up in main chat and carry on from there.
- 三条小字：
  - 原来的会话一个都不删，也不会改。 / Nothing is deleted or changed.
  - 会用你在 DSH 里选的模型读一遍，会花一点额度。 / It reads them once with the model you picked in DSH, which uses a little of your quota.
  - 不想让它看的，可以先挑出来。 / Anything you'd rather keep out, you can leave out first.
- 按钮：「开始整理」（主按钮）、「先挑一挑」、「以后再说」 / Start / Choose chats first / Not now

**拒绝后**（`'declined'`）：一行安静的提示「以前的聊天没有整理。想整理的时候点这里。」/ "Your earlier chats aren't sorted. Click here whenever you want them to be." 加按钮「整理以前的聊天」/ "Sort earlier chats"。

**挑选列表**（「先挑一挑」打开；同意后在工具栏加一个安静按钮「选择要整理的会话」/ "Choose chats" 也能打开）：

- 顶部一句：勾掉的会话不会被读，也不会进目录。随时可以改。 / Unchecked chats won't be read or added to the directory. You can change this any time.
- 按项目文件夹分组，每组标题旁一个「整个文件夹」复选框；不属于任何项目的放在「其他会话」/ "Other chats"。每个会话一行复选框（勾上 = 整理），显示标题（没有标题显示「未命名会话」/ "Untitled chat"）和创建日期。
- 每次勾选立即调用 POST 接口；失败时用现有的错误提示样式。
- 询问状态下，列表底部给「开始整理」按钮。

**被排除的话题**：卡片上 `hidden === 'excluded'` 时显示「这个话题来自你排除的会话，不会再被用到。」/ "This topic comes from chats you left out, so it won't be used." 样式参考现有 `topic.hiddenArchived`。

**空目录文案**：未同意时 `catalog.empty` 那里不要说「正在整理」，改为空白或引导到询问卡片。

样式沿用 `catalogCss` 里已有的 class 和变量，暗色模式也要能看。

## 验收

1. 新建 `tests/catalog-consent.test.ts`，至少覆盖：
   - `askFirst` 且未同意：`refresh()` 后没有任何 `CATALOG_PROMPT` 请求，`status.consent === 'ask'`，`status.waiting` 等于用户会话数，`incomplete === false`；
   - 同意后：会话被整理，和现在行为一致；
   - 排除一个会话、排除一个文件夹：这些会话的内容从不出现在发给模型的请求里；
   - 已有 `ready` 索引的老库启动时自动视为同意；
   - 话题的会话全被排除 → `hidden: 'excluded'`，并且在 `unreachable()` 里；取消排除后恢复；
   - 两个新接口的正常路径和非法输入（400 / 409）。
   测试写法参考 `tests/history-catalog.test.ts` 的 `harness`、`FixtureModel`、`peered`。
2. `npm run build`、`npm run typecheck`、`npm test` 全部通过（原有 321 项不能少）。`dist/` 一起提交。
3. 在分支 `theone/catalog-consent` 上提交，可以分几次提交。提交作者用 `YunongDai2005 <yuriddaaii@gmail.com>`，**提交信息里不要加 Co-Authored-By 或任何 AI 署名行**。不要 push，不要改写历史。

## 汇报要回答

- 改了哪些文件，各做了什么。
- 测试总数和结果。
- 有没有偏离本文设计的地方，为什么。
- `askFirst` 未同意时，TheOne 自己的会话和 `reconcile` 是否照常工作，怎么验证的。
- 还有什么没做完或你拿不准的地方。
