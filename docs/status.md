# 项目现状与分支整理（2026-10-17）

同时在 Codex、Claude Code 和本机开发，分支和 PR 积了不少。这份文档写清楚现在有什么、哪些还有用，以及以后怎么避免再乱。下面的整理动作**都还没做**，等用户确认。

## 现在的主线

- `main` = npm 上的 **0.3.36**（2026-10-15）。之后没有新提交。
- `main` 在 2026-10-06 重新起过根：从 0.3.21 的完整快照开始，之前的提交历史都压进了这一个起点。所以很多 10 月初的分支和 `main` 没有共同祖先，看起来"领先很多"，其实内容早已包含在内。
- 发版方式：把 `.github/release-notes/v<版本>.md` 和对应的版本号一起推到 `main`，流水线会自动打 tag、建 GitHub Release、发 npm。

## 远端分支（21 条）

逐条验证过：有共同祖先的，模拟合并看结果是否和 `main` 一样；没有共同祖先的，比对它的文件是否全在 `main` 的起点里。

### ① 已合并发布，可以删

| 分支 | PR | 进了哪个版本 |
| --- | --- | --- |
| `codex/fix-client-typecheck-isolation` | #7 | 0.3.34 |
| `codex/fix-custom-permission-inheritance` | #10 | 0.3.34 |
| `codex/persistent-work` | #12 | 0.3.36 |
| `codex/nebius-hackathon-demo` | #6 | 0.3.32 |

（#11 的分支 `codex/fix-update-reload` 已经删了。）

### ② 重写前的旧历史，可以删

都是 0.3.6–0.3.20 的版本，比 `main` 的起点 0.3.21 还老，没有一个文件是 `main` 里没有的。

`claude/readme-film`（#1）、`claude/theone-logic-fixes`、`codex/npm-publishing`（#4）、`fix/shared-facts-audit`

### ③ 备份

`backup/main-before-author-rewrite`、`backup/wizardly-before-author-rewrite`：改作者名之前留的备份。建议改成 tag 保存，再删分支，内容不丢。

### ④ 还开着的 PR

| PR | 分支 | 状况 | 建议 |
| --- | --- | --- | --- |
| #2 宣传片 | `claude/wizardly-wozniak-wibtf1` | 9300 行视频工程（`promo/`、`promo-4k/`），不属于插件 | 挪到单独的仓库，关掉 PR |
| #8 产品指标 | `docs/product-metrics` | 写了"暂停新功能"，和现在的方向（做成 DSH 的 dot）冲突；没用上现成的 InterleaveBench | 关掉，指标改到 dot 方案里重写 |
| #9 拆大文件 | `refactor/split-core-modules` | 基于 0.3.33，之后 #10、#12 大改了同样的文件，已冲突 | 关掉（分支保留），功能稳定后在最新代码上重拆 |

### ⑤ 比赛和 hackathon 原型

都在 `examples/` 或 `benchmarks/` 下，是独立原型，不打算合进插件。

| 分支 | 内容 | tag |
| --- | --- | --- |
| `codex/hackathon-graph-memory` | FalkorDB 话题记忆 | `graph-memory-prototype-20261015` |
| `codex/hackathon-qloo-taste` | Qloo 话题口味 | `qloo-topic-taste-prototype-20261015` |
| `codex/hackathon-flow-state` | ArmorIQ MCP | — |
| `codex/hackathon-amazon-mcp` | Alexa MCP 话题记忆 | — |
| `codex/hackathon-paypal-ai` | PayPal Sandbox 发票 | — |
| `codex/competition-gemma-coder` | Gemma 编程 agent | — |
| `codex/kaggle-topic-routing` | Kaggle 路由诊断 | — |

建议统一改到 `lab/` 前缀，和主线开发分开（Codex 还在用的先别改）。更彻底的做法是挪到单独的 `theone-labs` 仓库。

### ⑥ 进行中

`claude/epic-hawking-xzrmak`：dot 调研（`docs/dot-research.md`）、职责方案（`docs/duties.md`）、计划表更新、Windows 下 iMessage 测试的 EBUSY 修复。还没进 `main`。

## 以后怎么不乱（建议）

1. **`main` 是唯一的准。** 任何工具开工前先拉最新的 `main`；不在 `main` 上直接改。
2. **一件事一条分支，前缀标明是谁在做。** `codex/…`、`claude/…`、`local/…`、`lab/…`（原型）。
3. **同一件事只在一个地方做。** 比如 Codex 在改 `index.ts`，Claude 就别同时改它；要换地方做，先把分支推上去，另一边从这条分支接着做。
4. **都走 PR 合进 `main`，合并后删分支。** 这样分支列表里只剩还在进行的事。
5. **发版只从 `main` 发。** 一个版本一个 PR，里面带 release notes 和版本号。
6. **本机的改动当天推上去。** 本机没推的提交，别的工具看不到，最容易乱。
7. **计划表的执行规则要跟着改。** 现在 `docs/roadmap.md` 写的是"推到 main"，实际已经改用 PR 流程了。

## 一键整理（确认后执行）

```sh
# ① ② 已合并和重写前的旧分支
git push origin --delete codex/fix-client-typecheck-isolation codex/fix-custom-permission-inheritance \
  codex/persistent-work codex/nebius-hackathon-demo \
  claude/readme-film claude/theone-logic-fixes codex/npm-publishing fix/shared-facts-audit

# ③ 备份改成 tag
git tag backup/main-before-author-rewrite origin/backup/main-before-author-rewrite
git tag backup/wizardly-before-author-rewrite origin/backup/wizardly-before-author-rewrite
git push origin backup/main-before-author-rewrite backup/wizardly-before-author-rewrite   # 推的是 tag
git push origin --delete refs/heads/backup/main-before-author-rewrite refs/heads/backup/wizardly-before-author-rewrite

# ⑤ 原型改到 lab/（示例：一条）
git push origin origin/codex/hackathon-graph-memory:refs/heads/lab/graph-memory
git push origin --delete codex/hackathon-graph-memory
```

PR #2、#8、#9 的处理在 GitHub 上做（关闭时分支保留）。
