import pytest

from lockin_media.alignment import AlignmentError, to_captions


def test_preserves_punctuation_contractions_and_multiword_terms():
    words = ["POV", "you", "re", "using", "ATP", "energy"]
    aligned = [{"text": w, "start": i * 0.2, "end": (i + 1) * 0.2} for i, w in enumerate(words)]
    result = to_captions("POV: you’re using ATP—energy!", aligned, 1.4)
    assert [c.word for c in result] == ["POV:", "you’re", "using", "ATP—energy!"]
    assert result[1].start == 0.2
    assert result[1].end == pytest.approx(0.6)
    assert result[-1].end == pytest.approx(1.2)


def test_punctuation_only_token():
    result = to_captions(
        "Hello — there!",
        [
            {"text": "Hello", "start": 0, "end": 0.5},
            {"text": "there", "start": 0.6, "end": 1},
        ],
        1,
    )
    assert result[1].word == "—" and result[1].start == result[1].end == 0.5


@pytest.mark.parametrize(
    "aligned",
    [
        [{"text": "wrong", "start": 0, "end": 1}],
        [{"text": "Hello", "start": -1, "end": 1}],
        [{"text": "Hello", "start": 1, "end": 0}],
        [{"text": "Hello", "start": 0, "end": 3}],
        [{"text": "Hello", "start": float("nan"), "end": 1}],
        [],
    ],
)
def test_does_not_guess_missing_or_invalid_timings(aligned):
    with pytest.raises(AlignmentError):
        to_captions("Hello", aligned, 1)


def test_rejects_reordered_timings():
    with pytest.raises(AlignmentError):
        to_captions(
            "Hello there",
            [
                {"text": "Hello", "start": 0.5, "end": 1},
                {"text": "there", "start": 0.2, "end": 1},
            ],
            1,
        )
