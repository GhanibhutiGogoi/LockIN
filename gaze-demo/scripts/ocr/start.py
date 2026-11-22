"""Start the local backend with PaddleOCR using the existing project environment."""
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ['LOCKIN_SCREEN_OCR'] = 'paddleocr'

if __name__ == '__main__':
    import uvicorn
    uvicorn.run('lockin.app:app', host='127.0.0.1', port=8000)
