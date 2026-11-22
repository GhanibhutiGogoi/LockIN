"""Download the two pinned PP-OCRv5 inference models into .models/ocr."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from lockin.ocr_config import MODEL_FILES, MODEL_ROOT, MODELS

BASE = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0'
ARCHIVE_HASHES = {
    'PP-OCRv5_mobile_det': '50446e5d01ac2a73d5319c89513281f6578414c888c602f9af13f93feefffc58',
    'PP-OCRv5_mobile_rec': '566b9512b34e34a9f0db54d87b51fa5a0b9ed2cf1ab7e49728cc0b8b5a64f414',
}


def prepare():
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    manifest_path = MODEL_ROOT / 'manifest.json'
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest = {}
    for model in MODELS:
        destination = MODEL_ROOT / model
        hashes = previous.get(model, {}).get('files', {})
        if previous.get(model, {}).get('archiveSha256') == ARCHIVE_HASHES[model] and hashes and all((destination / name).is_file() and
                          hashlib.sha256((destination / name).read_bytes()).hexdigest() == hashes.get(name)
                          for name in MODEL_FILES):
            print(f'{model}: existing verified files', flush=True)
            manifest[model] = previous[model]
            continue
        url = f'{BASE}/{model}_infer.tar'
        archive = MODEL_ROOT / f'{model}.tar.part'
        print(f'Downloading {model}...', flush=True)
        with urllib.request.urlopen(url, timeout=60) as response, archive.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
        if archive_hash != ARCHIVE_HASHES[model]:
            archive.unlink()
            raise RuntimeError(f'Model archive checksum mismatch: {model}')
        destination.mkdir(exist_ok=True)
        with tarfile.open(archive) as bundle:
            for name in MODEL_FILES:
                entries = [entry for entry in bundle.getmembers() if entry.isfile() and Path(entry.name).name == name]
                if len(entries) != 1:
                    raise RuntimeError(f'Unexpected model archive: {model}/{name}')
                with bundle.extractfile(entries[0]) as source:
                    (destination / name).write_bytes(source.read())
        manifest[model] = {'url': url, 'archiveSha256': archive_hash,
                           'files': {name: hashlib.sha256((destination / name).read_bytes()).hexdigest()
                                     for name in MODEL_FILES}}
        archive.unlink()
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'Models ready: {MODEL_ROOT}', flush=True)


if __name__ == '__main__':
    prepare()
