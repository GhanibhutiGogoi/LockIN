# 独立紧绷估计 / 放松实验

## 当前交付状态

已实现：现有摄像头模型的 52 项面部动作输出、30 秒可检查基线、20 秒因果特征窗口、便携 JSON 分类器推断与兼容性检查、独立状态机、猫狗本地 SVG 动画、反馈/纠错/个体记忆、标注导出及可运行训练管线。

**尚未完成真实压力模型训练：没有取得兼容且带真实压力标签的授权数据。** 默认 `/stress-debug` 的真人压力分类保持 unknown，不会自动弹动画；合成回放可以检查完整流程。没有压力准确率或减压有效性结论。

这条边界很关键：面部特征的 pretrained 模型已可直接运行，压力判别模型仍待真实标签。不能把表情概率改名为压力指数，也不能用微笑当作恢复证据。

## 本机运行

从仓库根目录：

```sh
cd gaze-demo
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-stress.txt
npm ci
npm run build
./scripts/start-backend.sh
```

打开 <http://127.0.0.1:8000/stress-debug>。默认不访问云端、不需要新 API key；摄像头仅在用户自己点击后启动。注意力调试仍为 `/debug`，原主界面仍通过 `npm run dev` 在 5173 端口运行。

本次隔离开发复用了原目录的、被 Git 忽略的 `.venv`、`node_modules`、`.models` 符号链接；它们没有提交到仓库。全新 checkout 按上面命令自行安装即可。现有本机验收服务沿用了原 `LOCKIN_DB`，没有迁移或公开私有 bank。

## 不用摄像头也能检查的流程

1. 创建一个测试用户，选择“合成回放”，点开始。
2. “回放持续紧绷”提交预设状态；持续 10 秒后显示猫猫打哈欠/狗狗伸懒腰动画，8 秒后自动收起，也可随时关闭。
3. 点“有帮助/没什么帮助”，展开检查区看事件、读到的记忆与更新。
4. 点“误触发，排除记录”，偏好会重新计算并撤回；重复反馈不会增加样本数。
5. 结束后换用户查看隔离。回放记忆在 `replay_sandbox`，永远不会改变真实用户偏好。

动画与学习干预相互独立。学习视频/答题期间不显示新的放松动画；无题目解锁或强制播放。系统尊重浏览器减少动态效果的偏好。

## 真实输入和自评标注

摄像头模式不要求 gaze 注视点校准；复用冻结模型，仅提取面部动作。30 秒基线表示观察到的自然表情，不保证用户处于放松状态，当前不进入分类器输入，避免与离线训练不一致。

模型缺失、特征契约不符、摄像头停止/muted/冻结、帧陈旧、覆盖不足都会成为 unknown。原始图像只在浏览器处理；本机后端保存派生特征。当前没有上传云端面部图像或使用远程压力 API。

你和 Yingwen 可自愿对“刚才 20 秒”的紧绷程度打 0–10 分并保存该窗口。0–3→低、7–10→高、4–6→不明确（训练排除）。这是本 demo 的初始标注规则，不是临床分界。记录归各自身份所有，导出 JSON 中带特征版本、时间、评分与来源；相同窗口的重标注会替换旧评分。两个人足以调试，不能证明跨用户准确率。

## 模型与数据选择

- **选择冻结的 MediaPipe Face Landmarker 0.10.18。** 52 个命名 blendshape 分数，固定顺序；实际预训练 worker 已用公共静态人像输出 52/52 项有效特征。没有使用真人摄像头。
- 压力分类器候选为带正则的 logistic 和小随机森林，另有 majority dummy。推断只读数字 JSON，不加载 pickle。模型与尺度在参与者隔离的训练集拟合，按验证集选型，最后才评估测试参与者。
- **EmpathicSchool：** 论文写 public，但最新实际 Zenodo 记录是 restricted，需签数据使用协议。未代签、未请求访问、未下载受限数据。
- **StressID：** 官方仓库有 OpenFace AU/gaze 特征，但对应压力标签需要数据集访问；OpenFace 特征也不能直接代替 MediaPipe blendshape。不能据此训练并声称能直接运行。
- 排除 FER 表情→压力分数映射模型和合成启发式目标模型。具体来源和排除依据见 [data-manifest.json](data-manifest.json)。

没有新增模型下载；只做了访问元数据、代码和约 200KB 公共特征预览核查。审计流量按保守 16MB 计入 3GB 预算预留，未进行大规模下载。缓存/数据不上传仓库。

来源：[MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)、[EmpathicSchool 最新访问记录](https://zenodo.org/records/15556502)、[StressID 官方项目](https://project.inria.fr/stressid/)、[StressID 代码](https://github.com/robustml-eurecom/stressID)。

## 训练接口与可复现性

输入是一行一个已标注窗口的 JSONL：`subject`, `session`, `start_ms`, `end_ms`, `label`（0/1）, `vector`（52 均值再 52 标准差）。特征由 `lockin/stress/features.py` 同一因果聚合函数生成。每段 20 秒，最大有效相邻间隔 1500ms，至少 80% 有效覆盖；未知标签不能充当负样本。

先按实际授权数据填写 `training-input-manifest.example.json`，明确来源、许可、压力自评标签含义与输入 SHA-256。示例是说明文件，不是现成训练数据。

```sh
.venv/bin/python scripts/stress-data.py
.venv/bin/python scripts/stress-data.py --input .stress-data/windows.jsonl --manifest .stress-data/manifest.json
.venv/bin/python scripts/train-stress.py --input .stress-data/windows.jsonl --manifest .stress-data/manifest.json
```

固定 seed=42，按参与者 60/20/20 分训练、验证、测试；至少 12 人且每个划分都有两个类别才可达到最低实验门槛。固定的验证门槛：balanced accuracy≥0.60，macro-F1≥dummy+0.05。门槛只是预声明的工程启用条件，不能证明我们用户上的准确率。报告包括被试划分、混淆矩阵、每个测试参与者结果、候选验证分数及最终测试分数；最终测试不用于选型。

便携 artifact 默认写 `backend/artifacts/stress-model.json`（Git 忽略），可通过 `LOCKIN_STRESS_MODEL` 指向；重启后端生效。未达门槛、不兼容、合成数据训练的 artifact 均拒绝启用。当前训练尝试结果见 [training-report.json](training-report.json)：明确 blocked，没有生成压力模型权重。软件测试中的人工数组只验证数学/流程，不是压力数据。

## 检查与模块位置

```sh
./scripts/test-backend.sh
npm test
npm run build
```

| 模块 | 位置 |
|---|---|
| 特征契约与因果窗口 | `backend/lockin/stress/features.py`, `backend/static/stress-contract.js` |
| 冻结模型输出/摄像头有效性 | `src/gaze.worker.ts`, `backend/static/gaze.js` |
| 训练与便携推断 | `backend/lockin/stress/training.py`, `model.py`, `scripts/train-stress.py` |
| 触发/冷却/反馈/记忆/标注 | `backend/lockin/stress/service.py` |
| 身份隔离 API | `backend/lockin/stress/api.py`, `schemas.py` |
| 独立页面和本地动画 | `backend/static/stress.html`, `stress.js`, `stress-pets.js`, `stress.css` |

反馈目前只形成“这类动画可能对我有帮助”的暂定观察，不自动记为客观压力下降。真正的减压效果需真人自评和有无动画的对照；这是后续研究工作。
