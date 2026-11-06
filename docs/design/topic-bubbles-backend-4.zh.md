# 话题细胞团后端第 4 阶段（给 Codex）：合并后目标话题被隐藏

## 现象（Claude 在本地 DSH 复现）

隔离的本地 DSH（rules 路由、无模型密钥，所以 Worker 从没真正运行过）里，把话题 A 合并进话题 B 之后，B 在目录里变成 `hidden: 'orphaned'`，从细胞团和路由候选里消失。`/api/theone/catalog` 里 `健身计划`、`周报整理` 两个合并目标都是这样。

## 初步原因

`store.mergeTopicsValue` 会 `markIndex(source.workingSessionId, MAX, 'excluded')`，并把源话题的 Worker 会话作为整段来源加给目标。`history-catalog.ts` 的 `reconcile()` 只要目标的会话里有一个「已索引」（indexState 已定义），而且没有一个在磁盘上存在，就判为 orphaned。源 Worker 会话从没写到磁盘（Worker 没运行过）时，合并恰好制造了这个条件。真实使用中，源或目标话题的 Worker 从未运行（例如刚建、导入、或运行失败）时也会发生。

## 要求

- 找到确切原因并修复：合并不应让仍然有效的目标话题变成 orphaned。注意不要破坏 orphaned 的原意（会话真被删除或归档时隐藏，恢复后回来）。也检查 `unmergeTopic` 拆回后两边的隐藏状态。
- 加回归测试：两个都没跑过 Worker 的话题合并后，目标仍可见、仍是路由候选；目标的会话真被删除时仍按原规则隐藏。
- 本地数据库里已经被错误隐藏的话题，修复后下一次扫描能否自动恢复？如果不能，说明需要什么迁移，并实现最小的安全修正。

## 规则

- 不要修改 `src/client-foam.ts`、`src/client-foam-host.ts`、`src/client.ts`、`src/client-locales.ts`（Claude 在改）。
- 直接在 shell 里运行命令；不要用子代理或 node_repl；npm 用 `npm.cmd`。默认测试隔离遇到 spawn EPERM 时用 `--test-isolation=none`，并在报告中说明。
- 不要进入 `.dsh/`、`.workbuddy/`、`promo*/`、`outreach/`。不要提交（你的沙箱写不了 git 锁文件），Claude 会核对后提交。
- 报告写到 `docs/design/topic-bubbles-backend-4-report.zh.md`：原因、修法、测试、改了哪些文件。
