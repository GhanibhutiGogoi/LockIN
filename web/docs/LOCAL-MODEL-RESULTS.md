# LockIn 本地模型验证

2026-11-13 · macOS arm64 · Chrome 157

本机 Demo 在 [LockIn Web](http://127.0.0.1:5180/)。通过 **Integrations → Gaze tracking** 切换 **EyeTheia + MediaPipe** 和 **BlazeGaze + MediaPipe**。选好后打开课件并完成校准。当前 Demo 默认使用 BlazeGaze。

## 跨课件记忆

Web 回放上传了一份合成 PDF《Bioenergetics》，走完干预、答题和报告流程。EmbeddingGemma 2 从同一浏览器身份的回放记录中找回《Cellular respiration / How cells make ATP》。报告显示了来源、原记录的讲解风格和恢复期观测。法语语法、跳过的记录和 live 记录均未出现在报告中。同课件可用证据数为 0。

| 历史记录 | 余弦相似度 | 结果 |
| --- | ---: | --- |
| Cellular respiration / How cells make ATP | 0.749 | 召回 |
| French grammar / Past tense agreement | 0.451 | 低于 0.60 |

模型层另外用 5 份合成候选课件测试。6 条中英文相关查询均把目标排在第一，无关查询最高分 0.486。Web 当前从最近最多 12 个有合格记录的不同课件页选候选，取相似度至少 0.60 的前 3 条。阈值和窗口是本地 Demo 参数，效果仍需用实际课件检验。模型服务离线时，同课件历史和风格轮换可继续使用。旧历史里的记录需要带有课件页主题才能参与跨课件召回。

运行 Web 回放时，先按 [README](../README.md#embeddinggemma-2-and-cross-deck-recall) 启动模型服务和使用临时 SQLite 的后端。随后在 `web/` 执行：

```bash
node scripts/replay-cross-deck.mjs http://127.0.0.1:5180/
node scripts/replay-memory.mjs http://127.0.0.1:5180/
```

使用 [EmbeddingGemma 2 模型说明](https://huggingface.co/google/embeddinggemma-2) 和 [Q8_0 GGUF 权重](https://huggingface.co/ggml-org/embeddinggemma-2-GGUF)。Web 后端用 768 维向量计算余弦相似度，模型服务绑定本机回环地址。

## 眼动对比

两种模型分别在 Web worker 中预热 3 帧，再处理同一张 640×480 画布上的静态人像 12 次，最后处理一张空白帧。计时包含 MediaPipe、预处理和视线推理。

| 模型 | 浏览器后端 | 初始化 | 每帧中位数 | P95 | 人像有效 / 空白输出 |
| --- | --- | ---: | ---: | ---: | --- |
| BlazeGaze | WebGL | 162.9 ms | 25.85 ms | 29.70 ms | 12/12 / 无视线 |
| EyeTheia MPIIFaceGaze | ONNX Runtime Web WASM | 736.9 ms | 65.85 ms | 67.50 ms | 12/12 / 无视线 |

表中是包含 UI 验证的一次回放，另一轮 worker 回放的中位数为 BlazeGaze 18.3 ms 和 EyeTheia 68.0 ms。两轮中 EyeTheia 的中位耗时约为 BlazeGaze 的 2.5–3.7 倍。UI 回放验证了 EyeTheia 选择在重载后保留，用模拟摄像头加载该模型并进入校准，以及切回 BlazeGaze 后加载对应权重并进入校准。两轮眼动推理都只用了一张静态人像。本次没有带注视点标注的真人视频，因此准确率、校准后的角度误差和分心触发误报率仍未测量。

启动 Web 后，在 `web/` 执行：

```bash
curl -fL https://storage.googleapis.com/mediapipe-assets/portrait.jpg -o /tmp/lockin-portrait.jpg
node scripts/compare-gaze.mjs /tmp/lockin-portrait.jpg
```

使用 [EyeTheia 官方 MPIIFaceGaze 权重与代码](https://github.com/patherstevenson/EyeTheia/tree/13c3d444da4f7ef9e26a856bc9f46756ae818d87) 导出的 ONNX 模型。导出脚本会校验上游文件，并用固定随机输入检查导出适配前后的 PyTorch 输出。

## 回归检查

- Python 后端 114/114、Web Vitest 50/50、采集和 worker 的 Node 测试 95/95、独立 gaze-demo 核心和规则 31/31。
- Web 类型检查和生产构建通过。浏览器同课件记忆回放验证了 Direct → Analogy → Humor 轮换与报告证据。
