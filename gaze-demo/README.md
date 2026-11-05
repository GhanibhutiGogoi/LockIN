# LockIN Gaze Demo

本地实验原型：WebEyeTrack 预训练 gaze 模型、9 点个人校准、3 点独立位置验证，以及可调节的屏幕外规则。仅用于观察效果，尚未验证自然学习场景中的分心检测准确率。

## 运行

需要 Node.js 22.18+（建议 Node.js 24），以及支持摄像头、WebGL / WebAssembly 的桌面浏览器。

```sh
npm install
npm run dev
```

打开终端显示的 localhost 地址（默认 http://127.0.0.1:5173/）。允许摄像头后等待模型预热，再点击「开始校准」。保持窗口大小和坐姿基本不变，按顺序注视圆点，无需点击。窗口尺寸改变后必须重新校准。

首次推理可能需要十几秒编译 WebGL 着色器。停止按钮会终止模型线程、关闭摄像头并丢弃本次个人校准。刷新页面后也需要重新校准。不要在后台标签页中评估实时性能；本原型在页面隐藏时暂停判断。

## 怎样试

1. 正常阅读，依次看屏幕中心、四角和边缘，观察蓝点和是否误报。
2. 转头看向两侧，或低头看手机位置，停留超过持续时间阈值，观察「疑似屏外 → 看向屏幕外」。
3. 看回来，持续约 1 秒，观察恢复。
4. 误报多时调大「几何容差」；反应太慢时可调小持续时间。参数只用于试验，不是已验证的注意力阈值。

## 模型与校准

- 预训练模型：WebEyeTrack / BlazeGaze，TensorFlow.js 本机推理。
- 校准：利用上游 `adapt` 的仿射映射修正（`stepsInner = 0`），不进行 CNN 或预测头的梯度训练。9 个目标，每个目标采集 7 帧，保留其中 1 帧用于坐标映射；全部有效帧用于估计个人几何范围。
- 验证：另外 3 个位置，显示预测点与目标点距离相对于窗口对角线的平均比例。此数字是本次引导验证结果，不代表阅读时的真实定位精度。
- gaze 点显示在当前浏览器视口内。本版没有屏幕共享、外部窗口内容识别或桌面坐标映射。

## 屏幕外规则

以个人校准数据中头部方向 X/Y、左右眼虹膜相对眼角的位置（共 6 维）的 2%–98% 范围为基准，加上可调容差。

- 头部方向明显越界，或两只眼睛的相对位置同时越界，作为屏外证据。
- 默认连续 2 秒才显示「看向屏幕外」；回到范围持续 1 秒才确认恢复。
- 闭眼、脸部丢失、无效数据、超过 1 秒的采样间隔会中断证据累计；不会被计作分心。
- 该规则可能漏掉头部不动的细微眼球偏转，也可能把校准后坐姿变化误判为屏外。看着屏幕仍然可能走神，本原型不判断脑内走神。

## 数据

摄像头画面与眼部裁剪仅在浏览器内存中用于推理与校准；不录制、不上传、不写入 localStorage。模型与 WASM 由本地服务器提供。启动后不需要连接外部 AI API。

## 来源与修改

`vendor/webeyetrack/` 来自 https://github.com/RedForestAI/WebEyeTrack ，固定版本 `75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c`，保留上游 MIT LICENSE。

本地修改：

- MediaPipe 使用本地同版本 WASM 与模型，并在 GPU 不可用时尝试 CPU。
- 添加校准重置与平滑重置；零梯度步骤时不创建优化器，释放临时合并张量。
- 使用独立、串行处理帧的 classic Worker；不使用上游任意鼠标点击自动校准的 Proxy。
- 在应用适配层过滤闭眼、缺脸占位坐标，不以裁剪到屏幕内的 gaze 坐标判断屏外。

`public/web/` 中的预训练权重来自同一上游版本。MediaPipe Face Landmarker 原始来源：
https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

当前官方域名无法解析，因此从公开镜像下载了同一模型：
https://github.com/sanderdesnaijer/mediapipe-model-mirrors/releases/download/v1/face_landmarker.task

已验证模型 SHA256：`64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`。

## 检查

```sh
npm test
npm run build
```

`tests/worker-smoke.html` 是浏览器中的真实模型集成检查，不访问摄像头。需要在 `public/.qa/face.jpg` 放置公开的人脸测试图，例如 OpenCV 的 `samples/data/lena.jpg`，再通过本地服务打开此测试页。它检查人脸推理、空白帧处理、校准接口和校准重置；不测量人的实际注视精度。

本 demo 尚未推送到 GitHub；后续推送应使用分支与 PR，并且不添加 AI / agent 贡献者署名。


# 注意力闭环（2026-11-04）

在原 gaze demo 上新增独立于 UI 的 TypeScript 分析模块：`src/core/attention.ts`、`recovery.ts`、`session.ts`、`memory.ts`。这些模块可以由浏览器输入或离线时间序列直接驱动，并非仅有前端状态文字。

## 试用闭环

1. 创建/选择本地用户，输入学习目标和当前学习内容；或点击「使用 12 秒示例」自动载入平均值例子与配套视频、选择题。
2. 选择你自己的 MP4/WebM，标注其风格/节奏，并可填写回忆问题。可为同一个学习目标加入多种视频。刷新后视频文件需重新选择，个人记录仍保留。
3. 启用摄像头，完成校准，再开始学习会话。人工选择「学习/娱乐/不确定」作为当前屏幕标签；本版不自动识别屏幕。持续离屏或观看被标注为娱乐的内容，会自动触发一个视频。
4. 可以先点「手动测试视频」验证播放和答题；手动测试记录不用于学习视频风格偏好。
5. 视频实际播放后才开始观看测量。视频结束后必须回答问题再正常返回。自选视频的文字回忆题不自动评分；示例视频有可核验的选择题。可以随时结束本次学习，但会记作中断。
6. 返回原学习任务并按实际情况更新屏幕标签。观察 120 秒：持续 4 秒任务相关注视确认恢复；恢复后持续 2 秒脱离任务确认再次分心。窗口内不重复触发，完成后冷却 15 秒。
7. 对每条记录标注是否误报、视频是否帮助与备注，可导出 JSON 供 Jiaqi/Yingwen 后续试用分析与模型训练。

## 测量解释

- 播放期间看屏比例只衡量看屏，不代表学习恢复。生成/读取等待、暂停、答题时间与返回后观察分开。
- 返回后任务相关注视比例的分母是有效观测时间，同时报告有效覆盖率。无数据不算专注或分心。
- 闭眼、缺脸、后台标签页、失去校准、过期采样间隔均会中断证据。当前 Web 原型不能可靠持续监控隐藏标签页；后台时间为未知。
- 窗口提前结束、摄像头停止、视频失败等记录会标记未完成/censored，不记为成功。
- 这些是可观测代理指标，尚未通过真实用户验证；不能证明视频造成了改善，也不能检测看着课件时的脑内走神。

## Memory bank

- IndexedDB `lockin-attention-v1`，独立保存本地 profile、session、episode。只保存偏好、派生样本、上下文、答题、恢复汇总和人工标注。每秒保留一个派生样本，每次会话上限 20,000 个，超出会在导出中标记。
- 不保存摄像头图像、眼部裁剪或视频文件；停止/刷新后重新校准。没有账户、云同步或跨浏览器同步。浏览器清除站点数据也会清除记忆，建议导出备份。
- 本人明确设置的偏好与观察证据分开。只统计同一用户、同一学习目标、完整 120 秒自动干预、有效覆盖至少 60%、有效观测至少 30 秒、未标注误报的记录。校验不足和手动测试均不进入观察偏好。
- 每种风格至少 3 条可评估记录后，使用向中性先验收缩的返回后任务相关比例影响已有视频排序；同时保留本人风格/节奏/时长偏好。该计分是可解释的初始策略，不是已验证的推荐模型。
- 人工纠正为误报后会重新计算证据，原始测量仍保留。

## 后续接入边界

`VideoProvider.prepare(GenerationRequest): Promise<VideoAsset>` 是 Ghani 后续生成接口的替换点。当前 `LocalVideoProvider` 从已选择本地文件中排序选取，**不会生成或改写视频**。可在页面导出实际生成请求，包含学习目标、分心前学习上下文、明确偏好和带样本量的观察记忆。

`Observation.screen` 与 `source` 是自动屏幕识别的接入点：目前由人工标注提供，后续模型可产出 `study/entertainment/unknown`，同时保留来源记录。底层 gaze 继续使用 WebEyeTrack 预训练权重，本版没有训练新的注意力分类网络。

## 浏览器集成检查

打开 `/tests/attention-smoke.html`，运行独立测试数据库、真实本地 MP4 播放/结束事件、答题门控、合成 gaze 时间序列恢复统计、用户隔离和标注纠正检查。合成时间序列仅检查程序行为，不是人类试用数据或准确率证据。

`src/profile-bank.ts` provides a serialized write queue and dirty cache per profile: failed writes remain exportable while switching users within the same page; they are not durable across a full reload until a write succeeds. The UI reports storage errors. Profile loading locks identity-sensitive operations and commits profile+records together. All annotation writes use the same queue as session snapshots.

Camera results retain their original capture timestamps. Frames older than 1.5 seconds, duplicated or out of order are rejected; the session timer is separate from the observation ordering clock. Exported `startedAtT` plus ISO `startedAt` anchors each derived sample to session time.

`/tests/attention-ui-smoke.html` additionally exercises the actual controller/player UI, forced answers, delayed profile reads, failed writes, cache restoration and export-button output in an isolated test database.

## 独立后端与个人 Memory Bank

新增 FastAPI + SQLite 后端、用户隔离的 memory bank / agent harness 和独立 `/debug` 入口。主学习界面保持原样。启动、模块边界、测试和真实模型连接状态见 [backend/README.md](backend/README.md)。
