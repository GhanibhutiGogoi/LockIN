# NVIDIA visual demo integration — 2026-11-05

User steering: short demo only; investigate NVIDIA free visual APIs and allow replacing Qwen-VL. Continue the already authorized goal of getting screen interpretation working without changing the main UI.

Verified primary sources:
- https://build.nvidia.com/nvidia/nemotron-3.5-super-vl-120b-a12b — Free Endpoint Available, image/text input, OpenAI-compatible API.
- https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning — Free Endpoint Available, image/text input.

Existing NVIDIA environment credential authenticated successfully (HTTP 200 model inventory). No credential value was output. The selected model is Nemotron 3.5 Super VL. Credential configuration is saved only under ignored backend/data with mode 600; no secret in code, browser, user bank, logs or this document.

Changes:
- Extend private cloud configuration with NVIDIA service and nvapi credential validation; preserve existing Beijing/Singapore format.
- Disable extra reasoning for short screen-classification JSON on Super VL and Nano Omni.
- Keep the existing gaze, gate, recovery and memory interfaces.
- Change independent debug capture interval to 3 seconds; preserve 4-second stale inference protection. Main entry source unchanged.

TDD: three regressions failed first (NVIDIA config and both model option contracts), then passed. Full final backend test command scripts/test-backend.sh: 43 Python tests and 8 JS tests passed. Debug JS syntax check passed.

Actual free cloud smoke, generated images only:
- Super VL: mean teaching screenshot → study/related, 1.96 s; simulated social feed → entertainment/unrelated, 2.24 s.
- Nano Omni: teaching → study/related, 2.46 s; simulated feed → entertainment/unrelated, 2.63 s.
- Actual production ScreenProvider with saved configuration: teaching → study/related, 1.17 s.

End-to-end running HTTP service verification at 127.0.0.1:8000:
- /debug HTTP 200; /v1/status reports NVIDIA model.
- Two /frames requests returned HTTP 200 and the expected study/entertainment classifications, 2.01 s and 3.92 s.
- Gaze was deliberately invalid/unvalidated, so no attention episode was created. Probe session closed cleanly. No user camera or real screen was accessed.

These samples establish API/config/schema plumbing, not a real-world accuracy or latency benchmark. Free endpoints may queue or rate-limit; responses exceeding the current freshness guard remain unknown. Human gaze calibration and actual screen-switching trials are the next validation step. No Git push was performed.
