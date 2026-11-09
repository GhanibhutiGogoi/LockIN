"""
Stub services for the three HTTP teams, so each team can start from a working
shape and replace the bodies with real models.

    pip install fastapi uvicorn python-multipart
    uvicorn services_stub:content --port 8000
    uvicorn services_stub:media   --port 8001
    uvicorn services_stub:adaptive --port 8002

Then in the UI press ` and switch each module to "http".
"""
from __future__ import annotations

import random
import re
import statistics
import uuid

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware


def make_app(title: str) -> FastAPI:
    app = FastAPI(title=title)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health():
        return {"ok": True}

    return app


# ─────────────────────────── AI 分析 · content ───────────────────────────
content = make_app("LockIn content (AI analysis)")
DECKS: dict[str, dict] = {}


@content.post("/decks")
async def ingest(file: UploadFile = File(...)):
    # TODO: Docling / PaddleOCR-VL; LibreOffice for PPTX → PDF; serve pdf_url
    deck_id = "deck_" + uuid.uuid4().hex[:6]
    slides = [{"index": i, "title": f"Slide {i + 1}", "text": "Replace with parsed text."} for i in range(5)]
    deck = {"id": deck_id, "title": file.filename, "source_type": "pdf", "slide_count": len(slides), "slides": slides}
    DECKS[deck_id] = deck
    return deck


@content.post("/scripts")
def script(body: dict):
    # TODO: Claude Sonnet with the prompt from the proposal + Haiku fact-check
    slide = body["slide"]
    v = body["variant"]
    title = slide["title"]
    words = re.findall(r"[A-Za-z][A-Za-z-]{4,}", slide.get("text", "")) or [title]
    term = max(words, key=len)
    hook = {"plain": f"{title}, in brief.", "mild": f"Quick one: {title}.", "unhinged": f"POV: {title} is about to cook you."}[v["slang_level"]]
    return {
        "variant": {k: v[k] for k in ("target_seconds", "slang_level", "humour_style")},
        "hook": hook,
        "script": f"Here's the key idea: {slide.get('text', title)[:240]} Back to the slide.",
        "key_terms": [{"term": term, "broll_prompt": f"{term}, bold cartoon, neon, portrait"}],
        "quiz": [
            {
                "question": f"Which word is the key term on “{title}”?",
                "options": [term, "Entropy", "Osmosis", "Catalyst"],
                "answer_index": 0,
                "if_right": "W. Locked in.",
                "if_wrong": f"Not quite. It's “{term}”.",
            }
        ][: v.get("quiz_count", 1)],
        "plain_summary": slide.get("text", title)[:200],
        "fact_checked": True,
    }


@content.post("/decks/{deck_id}/prewarm")
def prewarm(deck_id: str, body: dict):
    return {"queued": body.get("slide_index")}


@content.post("/feedback/wrong-fact")
def wrong_fact(body: dict):
    print("wrong fact retracted:" if body.get("retracted") else "wrong fact flagged:", body)
    return {"ok": True}


# ─────────────────────────── 做影片 · media ───────────────────────────
media = make_app("LockIn media (video)")


@media.post("/media")
def render(body: dict):
    # TODO: Ming-3.0-tts → audio file; Qwen3-ForcedAligner → word timings; LTX-2.5 b-roll
    s = body["script"]
    text = f"{s['hook']} {s['script']}"
    t, captions = 0.1, []
    for w in text.split():
        d = 0.18 + 0.11 * max(1, len(re.findall(r"[aeiouy]+", w.lower())))
        captions.append({"word": w, "start": round(t, 3), "end": round(t + d, 3)})
        t += d + (0.3 if w.endswith((".", "!", "?")) else 0)
    return {"duration_sec": round(t + 0.4, 2), "captions": captions, "broll": []}  # add "audio_url" when you have audio


@media.get("/library/gameplay")
def gameplay():
    # Portrait, muted, seamless loops. Leave "url" out to let the UI draw a placeholder.
    return [{"id": "runner-1", "type": "runner", "energy": 0.7}, {"id": "marble-1", "type": "marble", "energy": 0.5}]


@media.get("/library/music")
def music():
    return []


@media.get("/voices")
def voices():
    return [{"id": "hype", "label": "Hype narrator"}, {"id": "chill", "label": "Chill narrator"}]


# ─────────────────────────── 個人化 AI · adaptive ───────────────────────────
adaptive = make_app("LockIn adaptive (personal AI)")
ARMS: dict[str, list[int]] = {}
MEMOS: dict[str, str] = {}


@adaptive.post("/config")
def config(body: dict):
    s = body["settings"]
    return {"drift_to_lapse_sec": round(12 - 8 * s["sensitivity"]), "cooldown_sec": s["cooldown_sec"]}


@adaptive.post("/choose")
def choose(body: dict):
    # TODO: linear Thompson sampling with ~15 context features + hierarchical prior
    ctx = body["context"]
    arms = [(length, g) for length in (20, 40) for g in ("runner", "parkour", "kinetic-sand", "marble")]
    holdout = random.random() < 0.05

    def sample(arm):
        a, b = ARMS.get(f"{arm[0]}s·memes·{arm[1]}", [1, 1])
        return random.betavariate(a, b)

    length, g = random.choice(arms) if holdout else max(arms, key=sample)
    variant = {
        "id": f"{length}s·memes·{g}", "target_seconds": length, "slang_level": "unhinged", "humour_style": "memes",
        "voice_id": "hype", "pacing": 1.1, "gameplay_type": g, "recap_or_preview": "recap",
        "quiz_count": 1 if ctx["rescue_in_row"] == 1 else 1,
    }
    return {"variant": variant, "is_holdout": holdout, "is_explore": False, "action": "clip"}


@adaptive.post("/outcomes", status_code=204)
def outcome(o: dict):
    q = [x["correct"] for x in o["quiz"]]
    r = (o.get("attention_after") or 0) - 0.6 + 0.5 * (sum(q) / len(q) if q else 0) - 0.1 * o["clip_seconds"] / 60
    arm = ARMS.setdefault(o["variant_id"], [1, 1])
    arm[0 if r > 0 else 1] += 1


@adaptive.post("/sessions")
def session(log: dict):
    # TODO: Claude Opus writes the memo from the session summary
    runs, run = [], 0
    for s in log["samples"]:
        if s["state"] == "focused":
            run += 1
        elif run:
            runs.append(run)
            run = 0
    if run:
        runs.append(run)
    focused = sum(1 for s in log["samples"] if s["state"] == "focused")
    memo = "Stub memo: replace with the profile model's notes."
    MEMOS[log["user_id"]] = memo
    return {
        "score": {
            "sustained_episode_median_sec": statistics.median(runs) if runs else 0,
            "on_task_share": focused / max(1, len(log["samples"])),
            "lapses_per_30_min": len(log["rescues"]) / max(1, len(log["samples"]) / 1800),
            "time_to_refocus_median_sec": None,
            "quiz_accuracy": None,
            "focused_minutes": focused / 60,
            "delta_vs_baseline": None,
        },
        "profile_memo": memo,
        "tips": [],
    }


@adaptive.get("/profile/{user_id}")
def profile(user_id: str):
    return {"memo": MEMOS.get(user_id)}
