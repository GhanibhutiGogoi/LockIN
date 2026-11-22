import onnxruntime as ort
import soundfile as sf
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio, pad_or_trim
from faster_whisper.tokenizer import Tokenizer
from kokoro_onnx import Kokoro


class CpuModels:
    voices = {"hype": "am_puck", "chill": "af_heart"}

    def __init__(self, weights):
        onnx = weights / "kokoro-v1.0.int8.onnx"
        voices = weights / "voices-v1.0.bin"
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(onnx), options, providers=["CPUExecutionProvider"])
        self.voice = Kokoro.from_session(session, str(voices))
        self.asr = WhisperModel(
            str(weights / "asr"), device="cpu", compute_type="int8", cpu_threads=4
        )
        self.tokenizer = Tokenizer(self.asr.hf_tokenizer, False, task="transcribe", language="en")

    def synthesize(self, text, voice_id, output):
        speaker = self.voices[voice_id]
        samples, rate = self.voice.create(text, speaker, speed=1.0, lang="en-us")
        sf.write(output, samples, rate)

    def align(self, text, audio):
        # PyAV decodes the paced WAV produced by MediaService. Align known text
        # against the recording, including clips longer than a Whisper window.
        signal = decode_audio(str(audio), sampling_rate=16000)
        if len(signal) <= 480000:
            return self._align_window(signal, text, 0)
        words = []
        segments, _ = self.asr.transcribe(
            signal,
            language="en",
            beam_size=1,
            word_timestamps=True,
            condition_on_previous_text=False,
            initial_prompt=text,
        )
        # Use acoustic segments to split the known transcript near window boundaries.
        # For a single window align the transcript directly, irrespective of ASR spelling.
        from difflib import SequenceMatcher

        from lockin_media.alignment import normalize

        observed = [word for segment in segments for word in segment.words]
        expected = text.split()
        match = SequenceMatcher(
            None,
            [normalize(w) for w in expected],
            [normalize(w.word) for w in observed],
            autojunk=False,
        )
        anchors = {
            a + k: observed[b + k].start
            for a, b, size in match.get_matching_blocks()
            for k in range(size)
        }
        offset, start = 0.0, 0
        while len(signal) / 16000 - offset > 29.9:
            candidates = [
                i for i, t in anchors.items() if i > start and offset + 15 < t < offset + 28
            ]
            if not candidates:
                raise ValueError("Unable to anchor next alignment window")
            stop = max(candidates)
            end = anchors[stop]
            words.extend(
                self._align_window(
                    signal[round(offset * 16000) : round(end * 16000)],
                    " ".join(expected[start:stop]),
                    offset,
                )
            )
            start, offset = stop, end
        words.extend(
            self._align_window(signal[round(offset * 16000) :], " ".join(expected[start:]), offset)
        )
        return words

    def _align_window(self, signal, text, offset):
        features = self.asr.feature_extractor(signal)
        encoded = self.asr.encode(pad_or_trim(features))
        words = self.asr.find_alignment(
            self.tokenizer, [self.tokenizer.encode(" " + text)], encoded, features.shape[-1]
        )[0]
        return [
            {"text": w["word"], "start": offset + w["start"], "end": offset + w["end"]}
            for w in words
        ]
