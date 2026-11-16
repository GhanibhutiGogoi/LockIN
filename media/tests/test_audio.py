import pytest

from lockin_media.audio import duration, encode_soundtrack, pace_audio, run_ffmpeg


def test_pacing_precedes_alignment_and_music_does_not_extend_narration(tmp_path):
    raw, paced, music, result = [
        tmp_path / n for n in ("raw.wav", "paced.wav", "music.wav", "result.mp3")
    ]
    run_ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", str(raw)])
    run_ffmpeg(["-f", "lavfi", "-i", "sine=frequency=120:duration=1", str(music)])
    pace_audio(raw, paced, 1.25)
    assert duration(paced) == pytest.approx(3 / 1.25, abs=0.05)
    encode_soundtrack(paced, result, music)
    assert duration(result) == pytest.approx(duration(paced), abs=0.08)
