# Worker 话题资料按需注入

日期：2026-11-04。分支：`briefing-on-change`。基线：`4d16ead`。

## 改动与条件

`startRun` 将完整资料和本轮恢复提示拆开。
完整资料仍是固定说明、实际发送的 descriptor 和 ownFacts。
用 SHA-256 比较这段完整文本。状态按当前 Worker 实例保存在内存中。
不跨 Worker 共用。插件或 Worker 重建后重新注入一次。

以下情况发送完整资料：

- 当前 Worker 第一次运行。
- 完整文本与上次不同。
- 上次发送后出现新的成功 `compaction/end`。
- 上次资料没有落到会话中，或已从当前模型可见历史中移除。例如取消了延迟启动，或误路由纠正排除了原轮次。

压缩识别依据已安装的 DSH `0.2.1-rc.2`。
`dsh-compaction-basic` 先记录 summary，再替换历史，最后记录 end。
这里只认不带 error 的 end。失败压缩不使缓存失效。
即使压缩保留了旧资料，成功 end 也会触发下一次启动时重新注入。
同时检查上次资料的消息 ID 是否仍在当前 surface 中。
尚未真正注入的消息不能算缓存命中。

`resumeFor`、`misrouteFor`、`returnNote` 不参与 hash。
有内容时另发一条短 recall。它仍声明历史指令不是本轮授权。
`briefingFor` 的 links 照常处理。

## handback 与来源记账

`theone_handback` 的现有工具说明已经包含完整规则：
明显属于另一件事时先调用，不先回答或操作；拿不准时照常回答。
工具定义每轮提供，所以保留该位置即可。无需再加一条每轮提示。
测试直接检查没有新增资料时的模型请求中的工具说明。

已检查 `src/` 中全部 recall 和 theone-context 消费点。
绑定和 shadow 逻辑只是排除 recall，随后找真实用户消息。
它们不要求每轮存在完整资料。
`learningJournal.bind` 仍每轮执行，并照常获取 `referenceSources`、links 和路由依赖。
新测试验证省略资料时，当前轮和历史依赖仍入账。
现有学习撤回测试也通过。

两处旧测试曾用完整资料作为轮次边界。
现在按真实用户消息或本轮新增事件检查提示。
去重断言保持不变。

## 风险与估算

摘要、进展或事实频繁变化时，仍可能每轮发送完整资料。
本改动不删除已经积累的历史副本。
压缩在下一次路由启动时检查；不在正在进行的一轮中途追加资料。
没有验证真实模型的回答质量、缓存命中率、延迟或账单收益。

引用[现有离线估算](token-savings-sim.zh.md)的敏感性表。
固定 100 万窗口、5 分钟 TTL 时，每轮 1,000 token 的基线费用为 $6.9886。
相对手动分会话多花 9.86%。
“仅新话题注入 1,000 token”情景为 $6.4950，多花 2.10%。
两种情景相差 $0.4936，约为基线费用的 7.06%。
这是既有模拟的情景差值，不是本改动的实测收益。
本实现还会在资料变化、压缩和重启后注入，不能直接承诺达到该数字。
没有重跑模拟。

## 验证与交付

- 新增 11 项集成测试。覆盖首次、重复、资料和事实变化、压缩、失败压缩、跨会话隔离、重启、三类恢复提示、历史排除、handback 和来源记账。
- 19 个相关产品测试文件共 178 项通过。使用真实 DSH 会话、循环、存储和工具，模型由本地 fixture 替代。
- eval 的 91 项 JavaScript 测试通过。
- `node node_modules/typescript/bin/tsc -p tsconfig.json` 成功。已同步 `dist/index.js` 与 `dist/index.d.ts`。
- 仅对改动的 3 个测试文件及其依赖做定向类型检查，诊断数为 0。
- `git diff --check` 通过。

任务指定的 `node_modules/.bin/tsx.cmd --test --test-isolation=none ...` 已尝试。
沙箱拒绝启动 esbuild 子进程，报 `spawn EPERM`。
产品测试改用 `node --experimental-transform-types --test --test-isolation=none ...`，运行相同测试文件。
eval 使用 `node --test --test-isolation=none eval/test/*.test.mjs`。
完整 `npm.cmd test`、客户端构建和全仓 typecheck 按任务要求留给作者。

未调用真实模型 API，未查找或读取 Key。
未改路由复核区域和 `src/llm-router.ts`。
任务书明确要求“不要提交，作者会提交”，因此保留待提交改动。
当前沙箱也不允许创建仓库的 `index.lock`，无法完成 Git 索引写入。
