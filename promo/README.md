# TheOne 宣传片（竖屏 · 58 秒）

1080×1920 / 30fps。画面由 `promo.html` + `promo.js` 逐帧生成（每一帧都是时间 `t` 的纯函数），用 Playwright 截图后交给 ffmpeg 编码；音效由 `sfx.py` 现场合成，和 BGM 混在一起。

顶部 170px 只放背景，给手机刘海留空；字幕胶囊从 y=190 开始。

## 节拍与卡点

- BGM：77 BPM、4/4，一拍 0.779 s，一小节 3.117 s。
- BGM 在 1:33.279 处进入峰值（前面 87–93 s 是一段静音）。
- 视频从 BGM 的 68.344 s 开始截取，所以 **视频 24.935 s = BGM 1:33.279**。点击 The One 的那一帧、白闪和 3D 展开都落在这一拍上。
- 之后所有镜头都按 `B(n) = 24.935 + n × 0.779` 的拍点排布。

## 分镜

| 时间 | 镜头 | 声音 |
| --- | --- | --- |
| 0–2.4 s | 桌面。镜头跟随鼠标，便利贴写着“找到上周那个方案！！”，日历提醒“10:00 方案评审 😰”。字幕计数滚到 **1,284 个会话**。点击 Dock 里的 DSH 图标，窗口展开 | 计数滴答、鼠标点击 |
| 2.4–4.5 s | DSH 侧边栏，镜头从列表底部往上移 | — |
| 4.5–9.8 s | 会话列表变成机场翻牌板：“历史会话 SESSIONS”，日期从 2025年3月 翻到上周，状态栏一排“找不到 / 救命” | 机械翻牌声（每片翻动一次一声） |
| 9.8–12.5 s | 点开工作区「那个大项目」，再点「方案讨论 v3」 | 点击 |
| 12.5–18.7 s | **找错会话的蒙太奇（替代原来的叹气）**：三个名叫“方案讨论 v3”的会话，点开分别在聊猫踩键盘、今晚吃什么、77 BPM 快不快，盖章“不是这个！”，计数从 7 涨到 23，鼠标冒汗。第三个会话里 DSH 友善地提示：“想找以前聊过的内容，可以试试侧边栏**最上面那个** ☝️” | 盖章、womp-womp、转场 swish |
| 18.7–19.9 s | 动态模糊，列表一路冲到顶 | 风声 whoosh |
| 19.9–24.9 s | 到达 The One。周围变暗，光束、浮尘和光晕亮起，鼠标慢慢靠近 | 合唱 pad + 铃音闪光 + 上扬 riser（正好填满 BGM 的静音段） |
| **24.935 s** | **点击 → 白闪 → 3D 展开** | 点击 + 低频 boom，BGM 峰值进拍 |
| B0–B8 | 3D 分层：主聊天 → LLM 路由器 → 4 个独立 DSH 工作会话 → 话题目录（SQLite）/ DSH 原始对话 | 每层落下一声 thud |
| B8–B20 | 路由演示：“骑行路线加个吃午饭的地方”→ `EXISTING` → **SWAP** 到「周末骑行」并挂载摘要；“新话题：给猫做个喂食器”→ **CREATE**，新会话出现；“那个改一下”→ **CLARIFY**，先问用户 | pop、打字、ding |
| B20–B28 | 旧会话碎片飞进三个**话题工作区**，点“继续聊天”，DSH 回应“欢迎回来！上次我们聊到方案 v3 的预算部分…”，字幕“找到了！🎉” | whoosh、点击、闪光 |
| B28–B36 | 功能卡片按拍砸入：不用新 API Key / 一个话题一个工作会话 / 按需翻原始记录 / 拿不准就不乱切 / 中英双语 | thud |
| B36–58.2 s | 结尾：“所有聊天，一个入口。”，安装方式，浅色暖橙切到深色淡蓝光晕 | 闪光、ding |

彩蛋：会话“77 BPM 快吗”（BGM 的速度）、“debug 第 47 轮”、猫踩键盘后来成了新话题“自动喂食器”、结尾小字 *It's all part of The One's plan ✨*（呼应 BGM *God's Plan*）、鼠标冒汗和结尾随拍跳动。

## 构建

```sh
cd promo
npm install                      # 字体（Noto Sans SC / Inter / Nunito / JetBrains Mono）
pip install numpy scipy
# 1. 导出音效时间点
node render.mjs cues cues.json
# 2. 合成音效
python3 sfx.py                   # → sfx.wav
# 3. 混 BGM（自备 bgm.m4a；截取 68.3436 s 起的 58.2 s）
ffmpeg -i bgm.m4a -i sfx.wav -filter_complex \
  "[0:a]aresample=44100,atrim=start=68.3436:duration=58.2,asetpts=PTS-STARTPTS,afade=t=in:d=0.2,afade=t=out:st=56.5:d=1.7[m];[m][1:a]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=false[a]" \
  -map "[a]" -c:a pcm_s16le mix.wav
# 4. 渲染画面并合成
node render.mjs video video_noaudio.mp4 30
ffmpeg -i video_noaudio.mp4 -i mix.wav -c:v copy -c:a aac -b:a 256k -shortest theone-promo.mp4
```

预览单帧：`node render.mjs stills 1.4,24.935,40 out/`。也可以直接在浏览器里打开 `promo.html`，页面会自动循环播放（无声）。

BGM 和成片不在仓库里（`.gitignore` 已排除音频和视频）。BGM 是第三方曲目，公开发布前请确认授权。
