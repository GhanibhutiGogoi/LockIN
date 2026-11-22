"""Shared paths and model selection for local screen OCR."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODEL_ROOT = Path(os.getenv('LOCKIN_OCR_MODEL_DIR', ROOT / '.models' / 'ocr'))
MODELS = ('PP-OCRv5_mobile_det', 'PP-OCRv5_mobile_rec')
MODEL_FILES = ('inference.json', 'inference.pdiparams', 'inference.yml')


def missing_models() -> list[str]:
    return [f'{name}/{file}' for name in MODELS for file in MODEL_FILES
            if not (MODEL_ROOT / name / file).is_file()]


def worker_environment() -> dict[str, str]:
    env = dict(os.environ)
    env['PYTHONPATH'] = str(ROOT / 'backend') + os.pathsep + env.get('PYTHONPATH', '')
    env['PYTHONIOENCODING'] = 'utf-8'
    env['PADDLE_PDX_CACHE_HOME'] = str(MODEL_ROOT / 'cache')
    return env
