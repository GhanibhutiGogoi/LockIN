"""Persistent CPU OCR worker. Stdout is reserved for the JSON line protocol."""
import base64
import contextlib
import io
import json
import os
import sys
import time

from .ocr_config import MODEL_ROOT, MODELS, missing_models


def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def main():
    try:
        if missing_models():
            raise RuntimeError('OCR models are missing. Run scripts/ocr/prepare.py first.')
        with contextlib.redirect_stdout(sys.stderr):
            import numpy as np
            from PIL import Image, ImageDraw
            from paddleocr import PaddleOCR
            ocr = PaddleOCR(
                text_detection_model_name=MODELS[0],
                # Paddle's Windows native loader cannot open Unicode absolute paths.
                # The worker cwd is gaze-demo, so the default relative paths are ASCII.
                text_detection_model_dir=os.path.relpath(MODEL_ROOT / MODELS[0]),
                text_recognition_model_name=MODELS[1],
                text_recognition_model_dir=os.path.relpath(MODEL_ROOT / MODELS[1]),
                text_recognition_batch_size=8,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                device='cpu', enable_mkldnn=True, cpu_threads=4,
            )
            warmup = Image.new('RGB', (1280, 720), 'white')
            ImageDraw.Draw(warmup).text((60, 60), 'Local screen OCR warmup', fill='black', font_size=40)
            list(ocr.predict(np.asarray(warmup)[:, :, ::-1].copy()))
        emit({'status': 'ready'})
    except Exception as error:
        emit({'status': 'error', 'message': f'OCR initialization failed: {error}'})
        return

    for line in sys.stdin:
        started = time.perf_counter()
        try:
            request = json.loads(line)
            emit({'status': 'progress', 'stage': 'decoding'})
            frame = base64.b64decode(request['frame'], validate=True)
            with Image.open(io.BytesIO(frame)) as image:
                width, height = image.size
                if image.format != 'JPEG' or not 0 < width <= 1920 or not 0 < height <= 1920:
                    raise ValueError('Expected a JPEG with each side at most 1920 pixels.')
                pixels = np.asarray(image.convert('RGB'))[:, :, ::-1].copy()
            emit({'status': 'progress', 'stage': 'inference'})
            with contextlib.redirect_stdout(sys.stderr):
                result = list(ocr.predict(pixels))[0].json['res']
            blocks = []
            for text, score, polygon in zip(result['rec_texts'], result['rec_scores'], result['rec_polys']):
                text = text.strip()
                if not text or float(score) < 0.5:
                    continue
                blocks.append({'text': text[:240], 'confidence': round(float(score), 4),
                               'polygon': [[int(x), int(y)] for x, y in polygon]})
                if len(blocks) >= 192:
                    break
            emit({'status': 'ready' if blocks else 'no-text',
                  'lines': [block['text'] for block in blocks], 'blocks': blocks,
                  'image': {'width': width, 'height': height}, 'engine': 'paddleocr',
                  'durationMs': round((time.perf_counter() - started) * 1000)})
        except (ValueError, KeyError, OSError) as error:
            emit({'status': 'error', 'code': 422, 'message': str(error)})
        except Exception:
            emit({'status': 'error', 'code': 503, 'message': 'Local OCR inference failed.'})


if __name__ == '__main__':
    main()
