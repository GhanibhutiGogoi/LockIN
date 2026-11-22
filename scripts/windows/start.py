"""Start missing screen-study services without replacing occupied ports."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LOGS = ROOT / '.runtime/windows'


def listening(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=1):
            return True
    except OSError:
        return False


def launch(name, port, command, cwd, env=None):
    if listening(port):
        print(f'{name}: port {port} is already in use; existing process retained.')
        return
    LOGS.mkdir(parents=True, exist_ok=True)
    with (LOGS / f'{name}.log').open('ab') as output:
        process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                   stdout=output, stderr=subprocess.STDOUT,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
    (LOGS / f'{name}.pid').write_text(str(process.pid))
    print(f'{name}: started PID {process.pid}; log: {LOGS / (name + ".log")}')


def main():
    os.environ['PYTHONUTF8'] = '1'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', choices=['ocr', 'activity', 'studio', 'web'])
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        for name, url in [('ocr', 'http://127.0.0.1:8000/v1/web-screen/status'),
                          ('activity', 'http://127.0.0.1:8005/health'),
                          ('studio', 'http://127.0.0.1:8013/recaps')]:
            try:
                with urllib.request.urlopen(url, timeout=5) as response:
                    value = json.load(response)
                    print(f'{name}: OK ({len(value)} saved videos)' if isinstance(value, list) else f'{name}: {value}')
            except Exception as error:
                print(f'{name}: unavailable ({error})')
        return
    selected = lambda name: args.only is None or args.only == name
    if selected('ocr'):
        launch('ocr', 8000, [str(ROOT / 'gaze-demo/.venv/Scripts/python.exe'), 'scripts/ocr/start.py'], ROOT / 'gaze-demo')
    if selected('activity'):
        model = ROOT / 'gaze-demo/.models/screen-activity'
        binary = next((model / 'llama-b12110').rglob('llama-server.exe'), None)
        if not binary:
            raise SystemExit('Run scripts/windows/setup.py --only activity first.')
        launch('activity', 8005, [str(binary), '--model', str(model / 'qwen3-4b-instruct-2507-q4_k_m.gguf'),
               '--alias', 'lockin-screen-activity', '--jinja', '--parallel', '1', '--ctx-size', '4096',
               '--threads', '4', '--host', '127.0.0.1', '--port', '8005', '--no-ui',
               '--cors-origins', 'http://127.0.0.1:8005', '--no-cors-credentials'], ROOT)
    if selected('studio'):
        env = os.environ.copy()
        ffmpeg = next((ROOT / 'media/.tools/ffmpeg').rglob('ffmpeg.exe'), None)
        if not ffmpeg:
            raise SystemExit('Run scripts/windows/setup.py --only studio first.')
        env['PATH'] = str(ffmpeg.parent) + os.pathsep + env.get('PATH', '')
        launch('studio', 8013, [str(ROOT / 'media/.venv/Scripts/python.exe'), '-m', 'uvicorn',
               'lockin_media.studio:create_app', '--factory', '--host', '127.0.0.1', '--port', '8013'], ROOT / 'media', env)
    if selected('web'):
        node = shutil.which('node')
        if not node:
            raise SystemExit('Install Node.js before starting the web app.')
        launch('web', 5181, [node, 'scripts/start-gaze.mjs'], ROOT / 'web')


if __name__ == '__main__':
    main()
