# LockIN backend / agent harness

这是独立的本机后端与模块调试入口。原有 `index.html`、`src/main.ts`、`src/study-ui.ts` 不接入此服务，也没有改动主界面。

## 启动

```sh
cd lockin-gaze-demo
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-dev.txt
# 可选：本地语义检索模型
.venv/bin/python -m pip install -r backend/requirements-models.txt
./scripts/start-backend.sh
```

- 调试页：http://127.0.0.1:8000/debug
- API 文档：http://127.0.0.1:8000/docs
- 后端测试：`./scripts/test-backend.sh`（Python 域逻辑/API + JavaScript 资源生命周期）
- 原有前端仍使用：`npm run dev`（5173 端口）

本机已建立 `.venv` 并下载 `.models/e5`。如果浏览器 worker 不存在，先执行 `npm run build`（只生成构建产物）。

## 按模块 debug

| 模块 | 代码 | 输入 → 输出 | 单独验证 |
|---|---|---|---|
| Gaze | `static/gaze.js` + 原有 `src/gaze.worker.ts` | 摄像头 → 预训练 WebEyeTrack + 9 点个人校准、3 点独立验证 → 派生 gaze | 演示页真实输入设置，不上传摄像头图像 |
| 屏幕理解 | `lockin/providers.py` | 共享屏幕稀疏截图 + 目标 → 内容类型、任务相关性、置信度、学习内容 | `/frames`；模型异常输出 unknown |
| 分心门控 | `lockin/signals.py` | gaze + 屏幕结果 + 画面变化 → 原因、持续时长、触发 | `test_signals.py`，演示页回放 |
| 恢复评估 | `lockin/recovery.py` | 作答后 120 秒时序 → 任务比例、恢复延迟、复发、覆盖率 | `test_signals.py`；真实或回放返回学习 |
| 用户记忆 | `lockin/store.py`, `memory.py` | 用户隔离的事件与结果 → 相关记忆与可撤回的行为观察 | `test_store.py`、`test_harness.py`、`/bank` |
| Agent harness | `lockin/harness.py` | 触发 → 检索 → 提示词 → 本地视频 → 题目 → 评估 → 记忆 | `test_harness.py`、独立页步骤轨迹 |
| 数据验证 | `lockin/evaluation.py` | 你和 Yingwen 的区间标注 + 观测 → 描述性 precision/recall | `/annotations`、`/evaluation`、用户 JSON 导出 |

### 一次完整的回放

1. 创建用户 A，保持回放模式并开始会话。
2. 点“回放学习”，再点“回放娱乐”。门控显示四条触发原因，提示词采用分心前学习内容。
3. 播放本地视频，结束后答题，随后点“回放返回学习 120 秒”。
4. 查看恢复数据、记忆更新和 bank。回放会留下事件记忆和明确标记的 `replay_sandbox` 演示推断，可再次触发检查检索；**不会形成或影响真实用户偏好推断**。
5. 再次触发，检查刚更新的演示记忆进入提示词；标记误报，查看撤回。结束会话后创建用户 B，检查其 bank 为空；切回 A 可见 A 的记录。

回放的合成时钟在检查输出时暂停，视频播放仍按真实时间推进，避免读调试信息的等待被误当作缺失数据。

真实自动偏好更新由有效 `model` 来源触发及整个返回阶段产生；单次即形成带样本数的 tentative 观察，无需用户确认。重复观察提高样本数；候选视频按收缩后的观察均值选择。该分数不是经校准的心理学注意力分数。`test_full_automatic_lifecycle_teaches_next_prompt_without_confirmation` 通过完整时序验证自动推断和下次读取，`test_automatic_inference_and_retraction` 验证撤回；这类测试数据只写入临时数据库，不混进你的 bank。

## 模型配置与已知状态

### Gaze

复用 WebEyeTrack 的预训练 BlazeGaze 与 MediaPipe；无需我们训练 CNN。9 点校准只是个人映射适配。验证误差阈值是初始工程规则，尚无真实用户准确率结论。上游将 gaze 坐标夹在屏幕范围内，因此此处的 `on_screen` 是有效注视的粗略代理，**不能用来可靠判定看向屏幕外**；本轮明确不做该情况。窗口尺寸变化会使校准失效。浏览器在后台可能降低采样频率，时间缺口按未知处理。

### 屏幕

配置环境变量（密钥只在服务器，不进入浏览器或导出）：

```sh
export LOCKIN_VLM_BASE_URL=https://your-compatible-provider/v1
export LOCKIN_VLM_MODEL=qwen2.5-vl-7b-instruct
export LOCKIN_VLM_API_KEY=...
```

也可沿用服务器环境中的 `DASHSCOPE_API_KEY`。默认区域为中国内地；国际区请显式修改 base URL。原百炼环境凭据实测返回 401 invalid_api_key。2026-11-05 已改为 NVIDIA 的免费原型视觉端点，见下方 NVIDIA 配置；Qwen 不再是当前 demo 的屏幕模型。没有静默替换为人工标签或假模型。

目标为每 3 秒一帧，单个请求完成后再调度下一帧：1.2 秒请求再等 1.8 秒，3.9 秒请求立即继续，避免固定计时器跳帧变成 6 秒。总请求或浏览器调度超过 4 秒仍会产生缺口，按未知处理。固定画布 960×540，JPEG .65；未勾选屏幕上传同意不发送。客户端需选择整块屏幕。画面平均像素变化率只是活动代理，不是其他应用的键鼠事件。服务端入站及推理结束都检查截图年龄，超过 4 秒的总年龄或推理耗时使模型结果失效，返回 `stale_model_result`。原始截图仅在请求期间处理，不落盘。应用仅适合本机受信环境；不要把服务绑定公网。

Gaze 采集额外检查摄像头轨道 live/muted、视频暂停/结束以及 `currentTime` 推进，冻结画面不重新打上新时间戳；最后一个真实采样超过 1.2 秒失效。上述检查属于输入有效性保护，不验证注视点精度。

### 标注评估口径

`/evaluation` 的 `labelled_ms` 包含全部明确的 on-task/off-task 标注时间，无观测、超过 4 秒的缺口、无效 gaze 都保留在 `unknown_ms`。`coverage` 是有效联合证据占比。顶层 `recall` 将缺失时间计为未检测到，`conditional_frame` 仅统计能判断的时间，因此两者必须结合覆盖率阅读。例如 120 秒分心只有最后 10 秒可判断：覆盖率和总体召回率为 8.33%，条件帧召回率为 100%。

`events` 单独使用真实门控触发，报告每个分心段是否触发、延迟、漏报段和误报；不把帧级识别正确当作最终触发。真人会话保留截图 `t_ms` 和后端完成编排的 `emitted_at_ms`，事件匹配及延迟使用后者，包含推理与记忆读取等待，但未测客户端收到并显示的时间；回放使用合成时间。旧记录缺少发出时间时明确标记 `time_basis: capture_time_legacy` 或混合依据，不能视为实测交付延迟。短于 8 秒的标注段也列出并标记 `shorter_than_dwell`。新会话单独保留触发历史，避免最近 200 条调试 decision 滚动后丢失早期事件；历史会话已丢失的事件不能补造，`history_complete` 会说明限制。该报告是描述性试用结果，不能证明视频的因果效果。

### 语义检索

默认寻找 `.models/e5`，或设置 `LOCKIN_E5_PATH`。下载：

```sh
.venv/bin/python - <<'PY'
from sentence_transformers import SentenceTransformer
m = SentenceTransformer('intfloat/multilingual-e5-small', device='cpu')
m.save('.models/e5')
PY
```

模型先按身份从 SQL 中筛选自己的记忆，之后才编码检索。中英文都使用 `query:` / `passage:` 前缀和归一化向量，384 维。模型文件不在时明确降级到词片段检索，episode 中记录实际 `retrieval_method`。本机已实测 E5 语义检索。

### 提示词 / Agent

Agent harness 已实现持久化状态、工具边界、证据检索、提示词组装与记忆更新。**当前提示词用确定性的 grounded template 编排，没有额外调用聊天 LLM，也没有实际生成视频。** 后续视频接口接收 `episode.prompt`、记忆来源和学习上下文即可。学习材料和记忆作为不可信数据放入 JSON，模型消费方仍须维持自己的系统约束。

## 重要语义

- 分心是“在电脑上持续参与与当前学习目标无关的娱乐”，不因访问 YouTube 等域名就断定分心。
- 视频期间注视屏幕只算视频参与；作答后持续回到学习才算行为恢复。
- 120 秒完整窗口、至少 60% 有效覆盖、至少 30 秒有效数据才够形成恢复证据。需要服务收到后续样本才能完成窗口；停止/中止不记成功。
- 规则、模型识别和观察关联都待真人标注验证。提高专注时长不是硬性承诺；有无视频的对照试验才支持因果效果判断。
- 本地视频未匹配学习目标、回放/人工输入、误报、中止、低覆盖都不形成真实偏好；回放只更新自己的演示 namespace。推断会自动更新，不设人工批准门槛。
- API 保存各用户 bank；本机浏览器只保存账号令牌。没有生产登录、账户找回或跨设备同步；丢失令牌会失去该身份访问入口。不要将令牌发给别人。
- 原浏览器 IndexedDB 的旧记录没有自动迁移到新 bank，二者独立。这样避免把旧手工信号误当作真实自动证据。

## API 路径

`POST /v1/users` 返回本机身份 token；其他 `/v1` 接口用 `Authorization: Bearer <token>`。

- `/v1/sessions`、`/v1/sessions/{id}`、`/{id}/end`
- `/{id}/observations`（回放或明确人工输入）、`/{id}/frames`（真实模型路径）
- `/v1/episodes/{id}`、`/{id}/media`、`/{id}/answer`、`/{id}/correction`
- `/v1/bank`、`/v1/videos`、`/v1/status`
- `/v1/sessions/{id}/annotations`、`/{id}/evaluation`

状态转换与更新在 SQLite `BEGIN IMMEDIATE` 事务内完成。相同媒体事件 ID/观测时刻重试不重复记忆；不回收历史证据，修正会重算并停用已失效推断。JSON 导出不包含 token、原始截图或摄像头帧。

试用建议：两人各录几个明确的“看 PPT → 相关资料/视频 → 无关娱乐 → 返回学习”片段，标注起止时间；先比较误报/漏报/延迟和缺失比例，再调整门控阈值。多人验证时按用户与会话划分训练/验证，避免相邻帧泄漏。未来是否训练小分类器应由这些结果决定。

模型参考：[WebEyeTrack](https://github.com/RedForestAI/WebEyeTrack)、[multilingual E5](https://huggingface.co/intfloat/multilingual-e5-small)、[Qwen2.5-VL](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct)。

## 百炼首次配置（本机隐藏输入）

先按[官方指引](https://help.aliyun.com/zh/model-studio/get-api-key/)完成账号注册、实名认证（如提示）、开通百炼，并创建普通按量计费 API Key。选择密钥所属地域，不要使用 Token/Coding Plan 专属密钥给本后端调用。

在自己的 macOS 终端运行（密钥不会显示，也不作为命令行参数进入历史）：

```sh
cd '/Users/melly/Downloads/大四上/HCI/projects/lockin-gaze-demo'
.venv/bin/python scripts/configure-bailian.py --region beijing
```

新加坡密钥使用 `--region singapore`。如需更换模型，在命令后加 `--model <控制台中可用的视觉模型ID>`。配置保存在已被 Git 忽略的 `backend/data/cloud-config.json`，文件权限 600。本机配置文件优先于旧环境变量，后端重启后生效；不写入前端或用户 bank。

配置完成后由协作者重启本机后端，再运行：

```sh
.venv/bin/python scripts/probe-screen.py
```

该脚本只向百炼发一张项目自制的平均值教学测试图，并输出类型、相关性、置信度和延迟，不上传用户屏幕或摄像头图像。通过后再由用户在独立演示页启动真实共享。


## 当前 demo：NVIDIA 免费视觉端点（2026-11-05）

当前模型为 `nvidia/nemotron-3.5-super-vl-120b-a12b`，Base URL 为 `https://integrate.api.nvidia.com/v1`。

官方模型页标记 [Free Endpoint: Available](https://build.nvidia.com/nvidia/nemotron-3.5-super-vl-120b-a12b)。适合本项目短期原型测试；限流和服务可用性以账号及服务返回为准，不承诺无限调用或长期 SLA。

本机已有 NVIDIA 凭据，已在不输出密钥的情况下验证并保存到权限为 600、Git 忽略的 `backend/data/cloud-config.json`。配置中的 `region: nvidia` 表示 NVIDIA 服务，不是阿里云地域。其优先级高于旧环境变量。更换凭据后需重启后端。

适配器对 Super VL 发送 `chat_template_kwargs: {enable_thinking: false}`，对备选 Nano Omni 发送 `reasoning_budget: 0`，以便尽快返回短 JSON，避免输出被思考过程占满。

真实云端冒烟测试仅使用两张自制图片：
- 平均值教学图 → `study / task_related=true`。
- 模拟社交短视频页面 → `entertainment / task_related=false`。

两模型均返回 HTTP 200，初次测试约 2–3 秒；真实 ScreenProvider 再测 Super VL 约 1.17 秒。这不是性能或准确率基准。尚未上传真实用户屏幕，也没有访问摄像头。

调试页目标采样间隔为 3 秒，并按请求完成时刻继续调度；推理超过 4 秒或观测总年龄过期时仍按未知处理。主学习界面未改动。

端到端后端验证也已通过：实际运行的 `/frames` 接口用自制学习图和娱乐图分别返回预期分类（约 2.01 / 3.92 秒）。使用无效 gaze，因此没有生成注意力判断或学习偏好。完整结果见 `docs/superpowers/plans/2026-11-05-nvidia-demo-verification.md`。

## 无需真人参与的独立工程验收

运行 `.venv/bin/python scripts/verify-demo.py` 可用三张自制页面调用实际 NVIDIA，再用模拟 gaze/媒体事件和临时数据库检查完整干预及记忆闭环。实际 E5 也参与后续记忆检索。此命令不会开启摄像头、截取用户桌面或修改真实 bank。验收结果及真人测试边界见 `docs/superpowers/plans/2026-11-05-independent-demo-test.md`。
