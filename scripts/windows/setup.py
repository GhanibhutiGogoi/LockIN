"""Install the Windows screen-study stack inside the repository."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / 'gaze-demo/.models/screen-activity'
TOOLS = ROOT / 'media/.tools'


def download(url, path, checksum):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        with path.open('rb') as existing:
            if hashlib.file_digest(existing, 'sha256').hexdigest() == checksum:
                return
    partial = path.with_suffix(path.suffix + '.partial')
    print(f'Downloading {path.name}', flush=True)
    for attempt in range(4):
        offset = partial.stat().st_size if partial.exists() else 0
        request = urllib.request.Request(url, headers={'Range': f'bytes={offset}-'} if offset else {})
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                resume = offset and response.status == 206 and response.headers.get('Content-Range', '').startswith(f'bytes {offset}-')
                with partial.open('ab' if resume else 'wb') as output:
                    total, last = offset if resume else 0, time.monotonic()
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk); total += len(chunk)
                        if time.monotonic() - last >= 10:
                            print(f'{path.name}: {total / 1_000_000:.0f} MB', flush=True)
                            last = time.monotonic()
            break
        except (OSError, TimeoutError):
            if attempt == 3:
                raise
            print(f'Resuming {path.name} after a download interruption.', flush=True)
    with partial.open('rb') as downloaded:
        if hashlib.file_digest(downloaded, 'sha256').hexdigest() != checksum:
            raise ValueError(f'SHA-256 mismatch: {path.name}')
    partial.replace(path)


def unpack(archive, target):
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            if not (target / member.filename).resolve().is_relative_to(target.resolve()):
                raise ValueError('Archive path escapes installation directory')
        bundle.extractall(target)


def activity():
    archive = MODEL / 'llama-b12110-bin-win-cpu-x64.zip'
    download('https://github.com/ggml-org/llama.cpp/releases/download/b12110/' + archive.name,
             archive, '98901e327c252875accaf2d1bf364e10e868843b0b63468baad1aa945cdc5da2')
    unpack(archive, MODEL / 'llama-b12110')
    download('https://huggingface.co/LaksKodi/Qwen3-4B-Instruct-2507-GGUF/resolve/main/qwen3-4b-instruct-2507-q4_k_m.gguf',
             MODEL / 'qwen3-4b-instruct-2507-q4_k_m.gguf',
             '5f9aafd13452cac6486fe42eae016debb8a4d9f6a2cb13724ca8a172a4065296')


def studio():
    archive = TOOLS / 'ffmpeg-8.0.1-essentials_build.zip'
    download('https://github.com/GyanD/codexffmpeg/releases/download/8.0.1/' + archive.name,
             archive, 'e2aaeaa0fdbc397d4794828086424d4aaa2102cef1fb6874f6ffd29c0b88b673')
    unpack(archive, TOOLS / 'ffmpeg')
    python = ROOT / 'media/.venv/Scripts/python.exe'
    if not python.exists():
        subprocess.run([sys.executable, '-m', 'venv', str(ROOT / 'media/.venv')], check=True)
    fix_editable_path()
    subprocess.run([str(python), '-m', 'pip', 'install', '-e', str(ROOT / 'media'), 'pytest>=8,<10'], check=True)
    fix_editable_path()
    subprocess.run([str(python), '-m', 'lockin_media.library'], cwd=ROOT / 'media', check=True)


def fix_editable_path():
    # Python 3.11 reads .pth files using the Windows locale, even in UTF-8 mode.
    for path in (ROOT / 'media/.venv/Lib/site-packages').glob('*lockin_media.pth'):
        source = json.dumps(str(ROOT / 'media/src'), ensure_ascii=True)
        path.write_text(f'import sys; sys.path.insert(0, {source})\n', encoding='ascii')


if __name__ == '__main__':
    os.environ['PYTHONUTF8'] = '1'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', choices=['activity', 'studio'])
    args = parser.parse_args()
    jobs = [activity] if args.only == 'activity' else [studio] if args.only == 'studio' else [activity, studio]
    with ThreadPoolExecutor(max_workers=2) as executor:
        for result in executor.map(lambda job: job(), jobs):
            pass
    print('Windows dependencies are ready.', flush=True)
