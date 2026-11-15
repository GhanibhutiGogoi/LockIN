"""Versioned prompts, kept separate from content facts and caption text."""

PROMPT_VERSION = "2026-11-15.1"
REFERENCE_TEXT = (
    "Here is the idea. Break a big problem into smaller steps, then connect them. "
    "Take a breath, look at the example, and explain it in your own words."
)
VOICE_PROFILES = {
    "hype": {
        "label": "Hype narrator",
        "direction": (
            "bright, playful, confident study buddy; energetic conversational delivery; "
            "crisp pronunciation, short pauses, natural emphasis, no shouting or singing"
        ),
    },
    "chill": {
        "label": "Chill narrator",
        "direction": (
            "warm, relaxed, friendly study buddy; conversational delivery; "
            "clear pronunciation, gentle emphasis, no whispering or singing"
        ),
    },
}


def directed_text(text: str, voice_id: str, slang_level: str = "mild") -> str:
    direction = VOICE_PROFILES[voice_id]["direction"]
    if slang_level == "plain":
        direction = "clear, composed educational narration; precise pronunciation; natural pauses"
    return f"[{direction}] {text}"


VIDEO_PRESETS = {
    "runner": (
        "A single continuous shot of an original stylized three-dimensional endless-runner scene. "
        "A small teal robot runs steadily forward on a wide tiled path through a bright toy city. "
        "The camera follows smoothly at a fixed distance and height behind the robot. "
        "Simple arches and geometric obstacles pass at an even pace. The robot stays centered, "
        "with generous space around it for a square crop. Clean geometry, consistent daylight, "
        "soft shadows, saturated teal and orange accents. Steady forward motion throughout, "
        "one shot with stable framing and lighting. "
        "A clean game scene with no interface or lettering."
    ),
    "parkour": (
        "A continuous first-person camera glides smoothly forward over a repeating course of "
        "wide pastel platforms above a turquoise sea. Gentle regular hops land at the center of "
        "each platform. Original minimalist three-dimensional game art, stable horizon, bright "
        "daylight, soft shadows and clear gaps. The next platform remains in the central crop. "
        "Constant forward pace, a single shot, no sudden camera turns. The environment is clean "
        "and contains only the platforms, water and sky."
    ),
    "kinetic-sand": (
        "A locked overhead macro view of a rectangular block of layered coral and turquoise "
        "kinetic sand on a plain dark tabletop. A simple metal cutter moves at a slow even pace, "
        "pressing clean parallel slices. Fine grains crumble gently along each cut with consistent "
        "texture and physically coherent contact. Soft studio light, subtle shadows, centered "
        "composition, satisfying repetitive motion. One continuous shot with fixed focus and "
        "exposure. Only sand, the cutter and the tabletop are visible."
    ),
    "marble": (
        "A fixed three-quarter overhead camera watches glossy teal and orange marbles circulating "
        "around an original closed circular track in a pastel three-dimensional toy world. "
        "The track has a shallow banked curve and a small gentle ramp. Each marble keeps its "
        "size and colour, rolling smoothly at a constant speed without intersecting the track. "
        "The full track stays in the central square. Soft studio light, crisp geometry, steady "
        "cyclical motion, a single uninterrupted shot with stable composition."
    ),
}


def broll_prompt(concept: str) -> str:
    return (
        f"A single clear educational visual: {concept.strip()}. "
        "Show one simple action with stable object identities, a clean uncluttered background "
        "and a fixed camera. Keep the subject centered with generous crop-safe margins. "
        "Use a restrained three-dimensional illustration style, soft lighting and smooth motion. "
        "The image contains no written labels; the player will supply the explanation."
    )
