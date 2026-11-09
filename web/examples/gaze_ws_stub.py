"""
Gaze-tracking WebSocket stub. Streams FocusSample JSON at 10 Hz so the UI can
run against a separate process. Replace `read_signals()` with MediaPipe.

    pip install websockets
    python gaze_ws_stub.py            # ws://localhost:8765

Type a letter + Enter in this terminal to change the simulated state:
    f = focused, p = on phone, c = eyes closed, a = away (no face)
"""
import asyncio
import json
import random
import sys
import threading
import time

import websockets

STATE = {"mode": "f"}
SIGNALS = {
    "f": dict(gaze=0.92, head=0.95, eyes_open=1.0, face_present=1.0),
    "p": dict(gaze=0.02, head=0.1, eyes_open=1.0, face_present=1.0),
    "c": dict(gaze=0.5, head=0.9, eyes_open=0.0, face_present=1.0),
    "a": dict(gaze=0.0, head=0.0, eyes_open=0.0, face_present=0.0),
}


def read_signals() -> dict:
    # TODO: MediaPipe Face Landmarker (+ WebEyeTrack) on the camera frame
    base = SIGNALS[STATE["mode"]]
    return {k: max(0.0, min(1.0, v + random.uniform(-0.05, 0.05))) for k, v in base.items()}


def score(s: dict) -> float:
    if s["face_present"] < 0.5:
        return 0.0
    return 100 * (0.35 * s["gaze"] + 0.20 * s["head"] + 0.15 * s["eyes_open"] + 0.15 * s["face_present"]) / 0.85


async def handler(ws):
    running = False

    async def reader():
        nonlocal running
        async for raw in ws:
            msg = json.loads(raw)
            if msg["type"] == "start":
                running = True
            elif msg["type"] == "stop":
                running = False
            elif msg["type"] == "calibrate_point":
                await asyncio.sleep(0.8)  # TODO: collect samples while the user looks at (x, y)
                await ws.send(json.dumps({"type": "calibrate_point_done", "id": msg["id"]}))
            elif msg["type"] == "probe":
                print("probe:", msg)

    task = asyncio.create_task(reader())
    await ws.send(json.dumps({"type": "status", "status": "running"}))
    try:
        while True:
            if running:
                s = read_signals()
                await ws.send(json.dumps({"t": int(time.time() * 1000), "score": round(score(s), 1), "confidence": 0.9, "signals": s}))
            await asyncio.sleep(0.1)
    except websockets.ConnectionClosed:
        task.cancel()


def keyboard():
    for line in sys.stdin:
        k = line.strip()[:1]
        if k in SIGNALS:
            STATE["mode"] = k
            print("mode →", k)


async def main():
    threading.Thread(target=keyboard, daemon=True).start()
    async with websockets.serve(handler, "localhost", 8765):
        print("gaze stub on ws://localhost:8765  (f/p/c/a + Enter)")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
