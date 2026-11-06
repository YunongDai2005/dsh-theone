# 话题细胞团后端第 4 阶段报告

日期：2026-11-06。对应 `docs/design/topic-bubbles-backend-4.zh.md`。

已修复空 Worker 合并后目标被误判为 orphaned 的问题，并保留真实会话消失、归档、排除及恢复的原有行为。后端源码和相关 dist 已更新；没有修改四个禁止编辑的前端源文件，没有暂存、提交或推送，由 Claude 审查后提交。本报告不代表已在用户本地 DSH 部署或完成桌面视觉验收。

## 原因

`ContextStore.mergeTopicsValue()` 把源话题的 Worker 作为整段来源交给目标，同时写入 `history_index(status='excluded', through_seq=Number.MAX_SAFE_INTEGER)`，防止扫描器把这个 Worker 再次提取成独立话题。即使该 Worker 从未创建过会话，这条排除记录也会生成。

原 `HistoryCatalog.reconcile()` 用 `indexState(sessionId) !== undefined` 判断会话是否曾经存在。这把“禁止再次索引”的控制标记当成了“扫描器曾见到会话”的证据：两个 Worker 都不存在时，合并后的目标因此满足 `known.length > 0` 且全部会话缺失，被写入 `hidden_contexts`，继而从路由候选和细胞团投影中消失。

回归还确认了同一根因的两个边界：空来源会阻碍目标真实历史的 archived/excluded 判定；若源会话是在合并后才被扫描到，拆回恢复原来的空索引时会丢掉其存在证据。

## 修法与已有数据库恢复

新增一个仅保存会话 ID 的 `catalog_seen_sessions` 表，把存在证据与索引进度／排除控制分开：

- 成功取得会话列表后批量记下观察到的 ID。使用已有列表元数据，不额外读取会话正文，也不新增模型调用。
- `ready / failed / skipped` 索引保留存在证据；合并／删除生成的 `excluded` 标记本身不产生证据。之前已有的证据也不会因写入 excluded 而消失。
- `reconcile()` 仍按每次扫描重算 hidden 的方式工作，只把有存在证据的会话计入 known。空 Worker 占位不再使目标成为 orphaned，也不再妨碍 archived/excluded 的判定。
- `mergeTopicsValue()` 和 `unmergeTopic()` 的合并、来源转移及索引恢复逻辑保持原样。存在证据独立持久化，不会因拆回恢复旧索引而丢失；拆回后的下一次扫描会按两边各自的来源重新判定隐藏状态。

数据库打开时自动、幂等地回填两类旧证据：当前 `history_index` 中的 ready/failed/skipped，以及 `topic_merges.journal.index.row` 保存的合并前真实索引。日志中原索引为 null 的空 Worker 不会被当作真实历史；只有 excluded 而没有观察证据的标记也不会被当成证据。

**已被错误隐藏的目标会在修复版本启动后的下一次成功扫描自动恢复，无需手工改 hidden 或重新合并。** 启动时保留原 hidden，扫描完成后用原有 `replaceHidden()` 重算并清除错误标记。会话列表读取失败时不会清空 hidden。新表不保存正文，不删除或改写原索引、合并日志、会话或话题。

旧数据库的 fixture 覆盖了“空 Worker 错误 orphaned”和“源会话曾 ready/failed 后真正消失”三种情况，并再次重开数据库核验：前者恢复，后两者保持隐藏。拆回后，真实丢失来源只影响恢复出的源话题，空目标恢复可见。归档仍沿用原语义：细胞团中收起，但仍可作为路由候选被重新提及；excluded/orphaned 则不可达。

## 验证

新增 `tests/merge-orphans.test.ts`，共 10 项，覆盖：

1. 两个 Worker 都未运行的合并与拆回，目录、路由候选、细胞团投影都保持正确，模型调用数为 0。
2. 目标真实会话消失／恢复；拆回后空源可见、丢失会话的目标仍隐藏。
3. 仅源会话真实存在时的合并、消失及拆回，两边分别正确判定。
4. 合并后才观察到的源会话，其证据跨数据库重开保留；拆回恢复空索引后仍能识别其消失。
5. 空合并来源不阻碍目标真实历史的归档／排除，解除后恢复。
6. 三种旧数据库状态的自动修复或保持隐藏，以及拆回、再次重开的结果。
7. 实际运行 fixture Worker，将隔离测试根目录中的持久化会话文件移走，重开后目标隐藏；恢复文件、再次重开后目标重新可见。此项不替换 sessionQuery；其他部分边界测试沿用现有 orphans 测试在会话列表处模拟消失的做法。

| 检查 | 实际结果 |
| --- | --- |
| 修复前回归 | 首批 9 项中 5 失败、4 通过；失败包括错误 orphaned、旧错误状态不恢复、归档／排除判断和拆回后丢失证据 |
| 首轮相关测试 | 37/37 通过，0 失败／取消／跳过，约 75.0 秒；包括原 orphan、merge undo、catalog consent 回归 |
| 最终新增回归 | 10/10 通过，0 失败／取消／跳过，约 20.4 秒；包含重启和实际文件移走／恢复 |
| `npm.cmd run typecheck` | 通过；包含后端、测试和客户端类型检查，最后一次在全部新增测试写完后执行 |
| `npm.cmd run build` | 两个 tsc 阶段通过，最后的前端 esbuild 打包因 `spawn EPERM` 失败，不能声称整包构建通过 |
| 编译后后端 smoke | 直接导入 `dist/store.js` 和 `dist/history-catalog.js`，无模型调用下验证错误 orphaned 自动恢复、合并／拆回和路由候选，通过 |
| 全量源测试 | 662 项：657 通过、4 失败、1 超时取消、0 跳过，约 1166.9 秒；详情及对照复跑见下文 |

全量中的 4 个失败均已从最终堆栈确认是子进程权限限制：

- `tests/client-topic-folder.test.ts`、`tests/client-update.test.ts`：esbuild 启动子进程时 `spawn EPERM`。
- `tests/pack-plugin.test.ts`：打包调用 `execFile` 时 `spawn EPERM`。
- `tests/route-stats.test.ts`：启动 Node 脚本时 `spawnSync ... EPERM`。

另有 `tests/routing-policy.test.ts` 的 `native gateway never asks back...` 用例超过原有 30 秒限时，被 runner 记为 **cancelled**。完整运行、单独复跑均复现。为了区分本轮回归与已有问题，又从任务开始时的提交 `af5f034` 提取未修改的 `src/store.ts` 和 `src/history-catalog.ts`，通过临时 loader 在原模块 URL 下加载原文件，运行同一个用例。两个原文件的 blob 哈希与该提交完全一致，loader 也已验证实际加载旧版 ContextStore。**原提交对照同样超过 30 秒限时取消，随后当前版本再次单独运行也超时。** 没有放宽测试限时，也没有把超时记为通过。

因此，全量套件和标准整包 build 仍未全绿；交给 Claude 在允许子进程的环境复跑上述 4 项、该路由超时项及整包构建。修复前后对照只替换临时 loader 的输入，没有改写工作区中的源码。对照日志为 `.theone/backend-4-routing-policy-baseline.log`，当前版两次复跑日志为 `backend-4-routing-policy-rerun.log`、`backend-4-routing-policy-final.log`。

默认测试隔离首先遇到 `spawn EPERM`。按任务要求使用 `npm.cmd exec --offline -- tsx --test --test-isolation=none tests/merge-orphans.test.ts` 后，tsx 的 esbuild 编译子进程仍被沙箱拒绝。因此复用上一阶段的进程内 TypeScript loader，通过 Node `registerHooks` 与已安装的 `typescript.transpileModule` 执行同一批源测试，没有改动 package.json、依赖或断言。已核实 `node_modules` 是指向 `D:\doc\GitHub\dsh-theone\node_modules` 的现有 Junction，所以错误堆栈出现主工作树的依赖路径；所有命令的工作目录仍为 `D:\doc\GitHub\dsh-theone-bubbles`，没有修改共享依赖。实际验证命令：

```powershell
node --import ./.theone/backend-4-loader.mjs --test --test-isolation=none tests/merge-orphans.test.ts tests/orphans.test.ts tests/merge-undo.test.ts tests/catalog-consent.test.ts
node --import ./.theone/backend-4-loader.mjs --test --test-isolation=none tests/merge-orphans.test.ts
node --import ./.theone/backend-4-loader.mjs --test --test-isolation=none tests/*.test.ts
npm.cmd run typecheck
npm.cmd run build
node .theone/backend-4-dist-smoke.mjs
```

首轮原有 archived 测试的 workspaceRegistry fixture 曾打印缺少 `unarchiveSession` 的日志，但测试断言通过；没有为此修改已有测试或生产归档逻辑。测试使用真实 ContextStore、HistoryCatalog、DSH 会话持久化等组件和 fixture 模型，没有访问真实用户数据库或调用真实模型。

## 文件与交付边界

待 Claude 审查并提交的文件：

```text
src/history-catalog.ts
src/store.ts
tests/merge-orphans.test.ts
dist/history-catalog.js
dist/store.js
dist/store.d.ts
docs/design/topic-bubbles-backend-4-report.zh.md
```

完整 build 在失败前曾把 `dist/client.js` 写成中间产物，已恢复为原 HEAD 的精确字节，原始 blob 哈希一致；其他客户端产物没有内容差异。四个指定前端源文件没有差异。工作开始前已有的未跟踪文件 `experiments/sidebar-cell-capsule/harness.js` 未改动。

临时 loader、原提交对照文件、dist smoke 脚本与日志保留在已忽略的 `.theone/`，不纳入提交。主要证据为 `backend-4-red.log`、`backend-4-focused.log`、`backend-4-regressions.log`、`backend-4-full-test.log`、`backend-4-typecheck.log`、`backend-4-build.log`、`backend-4-dist-smoke.log` 和 `backend-4-tsx-no-isolation.log`。

本轮只通过 shell 执行，没有子代理、node_repl 或选择／确认弹窗。没有进入 `.dsh/`、`.workbuddy/`、`promo*/`、`outreach/`；没有部署、发布、登录或改账号设置。遵循用户最后的明确要求及任务说明，**没有执行 git add/commit/push，提交留给 Claude**。
