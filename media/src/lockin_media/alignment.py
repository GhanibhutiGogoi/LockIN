import math
import unicodedata

from .schemas import Caption


class AlignmentError(ValueError):
    pass


def normalize(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold() if c.isalnum())


def to_captions(text: str, aligned: list[dict], duration: float) -> list[Caption]:
    """Reattach punctuation/merge subwords without inventing word timings.

    Aligner tokenization differs from the UI's whitespace tokenization. Match
    the complete normalized character stream, then map overlapping spans.
    A lexical mismatch is an error, never silently replaced by uniform times.
    """
    if not math.isfinite(duration) or duration <= 0:
        raise AlignmentError("Invalid audio duration")
    spans, cursor, last_start = [], 0, 0.0
    actual = ""
    for item in aligned:
        word = normalize(item["text"])
        if not word:
            continue
        start, end = float(item["start"]), float(item["end"])
        if not all(math.isfinite(x) for x in (start, end)):
            raise AlignmentError("Non-finite alignment timestamp")
        if start < last_start or start < 0 or end < start or end > duration + 0.1:
            raise AlignmentError("Alignment timestamps are out of order or outside the audio")
        spans.append((cursor, cursor + len(word), min(start, duration), min(end, duration)))
        cursor += len(word)
        actual += word
        last_start = start
    expected = "".join(normalize(w) for w in text.split())
    if not expected or expected != actual:
        raise AlignmentError("Aligned words differ from the spoken script; inspect this take")
    captions, cursor, last_end = [], 0, 0.0
    for word in text.split():
        n = len(normalize(word))
        matching = [s for s in spans if s[0] < cursor + n and s[1] > cursor] if n else []
        start = matching[0][2] if matching else last_end
        end = max(s[3] for s in matching) if matching else last_end
        captions.append(Caption(word=word, start=start, end=end))
        cursor += n
        last_end = end
    return captions


def mock_captions(text: str, pacing: float) -> list[Caption]:
    step = 0.38 / pacing
    return [Caption(word=w, start=i * step, end=(i + 1) * step) for i, w in enumerate(text.split())]
