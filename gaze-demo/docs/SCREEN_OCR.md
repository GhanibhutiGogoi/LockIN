# Local screen OCR on Windows

The screen-study path uses browser-authorized screen capture, a local FastAPI
endpoint, and PP-OCRv5 mobile detection/recognition on CPU. The recognition model
supports Chinese and English. No training or GPU is required. OCR only reads
text: the optional activity model is a separate service.

## File layout

- `backend/lockin/ocr_config.py`: shared model paths and worker environment.
- `backend/lockin/ocr_worker.py`: persistent PaddleOCR inference process.
- `backend/lockin/screen_ocr.py`: bounded worker lifecycle and request timeout.
- `backend/lockin/screen_text.py`: existing HTTP endpoint and readiness endpoint.
- `backend/requirements-ocr.txt`: optional pinned OCR dependencies.
- `scripts/ocr/prepare.py`: explicit model download and integrity manifest.
- `scripts/ocr/start.py`: cross-platform backend launcher selecting PaddleOCR.
- `scripts/ocr/check.py`: real English/Chinese HTTP smoke check.
- `.models/ocr/`: downloaded weights, manifest, and runtime cache; ignored by Git.
- `backend/tests/test_screen_ocr.py`: lifecycle and HTTP contract tests.
- `web/scripts/replay-screen-ocr.mjs`: synthetic screen stream with real local OCR.

## Install once

Run from the repository root with 64-bit Python 3.11 on Windows. The existing
`gaze-demo/.venv` can be reused. Only create it if it does not already exist.

```powershell
py -3.11 -m venv gaze-demo/.venv
.\gaze-demo\.venv\Scripts\python.exe -m pip install -r gaze-demo/backend/requirements-dev.txt -r gaze-demo/backend/requirements-ocr.txt
.\gaze-demo\.venv\Scripts\python.exe gaze-demo/scripts/ocr/prepare.py
.\gaze-demo\.venv\Scripts\python.exe -m pip check
```

Model downloads come from the official Paddle model host and are checked against
pinned archive SHA-256 hashes. Subsequent preparation checks local file hashes
and reuses verified files. Inference uses explicit
local model paths and disables optional orientation and document-unwarping
models. Screenshots are decoded in memory, not saved to disk. PaddleX 3.3.0 may
probe model-host availability during startup; screen inference uses local weights.

## Run

Terminal 1, from the repository root:

```powershell
.\gaze-demo\.venv\Scripts\python.exe gaze-demo/scripts/ocr/start.py
```

The backend binds to `127.0.0.1:8000`. Open
`http://127.0.0.1:8000/v1/web-screen/status` and wait for `status: ready`.
Startup warms the model once; a missing dependency or model produces an explicit
unavailable status. Inference timeouts and worker exits trigger automatic recovery
on health polling, with a two-second initial backoff capped at 30 seconds. A new
worker gets a separate response queue so late results cannot enter a later request.
Recognition batches up to eight text crops, with a 30-second worker timeout.
The worker deadline includes input-pipe writes. The browser gives an OCR/classification
job up to 45 seconds and observes screen changes independently, nominally every
750 ms. One inference and at most four waiting frames are retained, prioritizing
longer visits over transient changes. Final report analysis may take up to 90 seconds. Dense pages
take longer than short headings. Slow results are matched to their original
scene for historical analysis. A live result is usable only while new captures
confirm unchanged content; the old eight-second capture-age gate is no longer used.
See the [full screen-study flow](../../web/docs/SCREEN_STUDY_FLOW.md) for startup,
relevance, real video integration and timestamped report checks.

Terminal 2, from the repository root:

```powershell
cd web
npm run dev:gaze
```

Open `http://127.0.0.1:5181`. This uses real webcam gaze with demo recap providers.
It does not start the optional activity classification model. First leave the
study goal empty to isolate OCR; a goal requires the separate classifier before
related-content focus metrics and automatic recaps are available.

The legacy `start-backend.sh` keeps the Apple Vision path. To use PaddleOCR on a
supported Mac, install compatible native dependencies and run the same Python
launcher with `.venv/bin/python`; macOS is not validated by the Windows checks.

## Manual checklist

| Action | Expected result |
| --- | --- |
| Open the status URL | `ready`, engine `paddleocr`, device `cpu`, two PP-OCRv5 mobile models. |
| Click Share your screen, leave goal empty, select the target display/window | A browser picker appears; the session is labeled LockIn Screen Study. |
| Finish calibration/setup, then click WPS without resizing the calibrated LockIn window | After a capture and inference cycle, text is read from the authorized source. |
| Return to LockIn | The last detected text remains visible; new capture is paused while LockIn has focus for display/window sharing. |
| Show a page with Chinese and English text, wait several seconds, then return | Detected text includes both languages. |
| Change the shared page | Text updates after another capture; sharing one window does not follow other apps. |
| Share a blank page | No readable text on the shared screen; this is not a service error. |
| Press P to pause | Screen reading paused; OCR requests stop. Resume restarts reading. |
| Click Stop sharing | The browser stream ends; OCR requests stop. |
| Stop the backend while reading | An explicit OCR error appears, with no invented text. |
| Finish and download the report | Recognized screen moments appear in `deck.slides`; metadata appears in `log.screenDiagnostics`. |

The report does not save screenshot frames. Screen moment text is retained using
the existing session policy. OCR diagnostics record timestamps, status, line
count, dimensions, duration, and errors, but not OCR text. Missing context is not
logged as a default focused sample. Webcam diagnostics remain available separately.
Recovery diagnostics also include the failure stage and worker restart count.

## Automated checks

With the backend running, from the repository root:

```powershell
.\gaze-demo\.venv\Scripts\python.exe gaze-demo/scripts/ocr/check.py
```

This sends an in-memory bilingual image, a dense 24-line page, a blank image,
and an invalid JPEG. It
also verifies that the trial frontend's port 5181 origin is accepted. Pass
`--font` to use another Chinese-capable font on a different system.

The browser replay uses Playwright and a synthetic canvas stream instead of the
operating-system picker, but calls the real OCR backend through the Vite proxy:

```powershell
node web/scripts/replay-screen-ocr.mjs http://127.0.0.1:5181/
```

Set `LOCKIN_PLAYWRIGHT_MODULE` if Playwright is installed outside the project.
The replay does not validate a real screen picker or real webcam accuracy.
Background-tab webcam sampling remains a separate known limitation.

To test a real local screenshot repeatedly, add `--image PATH --expect TEXT`
to `check.py`. Images are sent only to the loopback OCR endpoint. To verify real
worker timeout and crash recovery without interrupting the HTTP service, run
`gaze-demo/scripts/ocr/check_recovery.py` using the project Python environment.
