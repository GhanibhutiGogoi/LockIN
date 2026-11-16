#!/usr/bin/env python3
"""Record this local benchmark run's model artifacts, process IDs, and score fingerprints."""

import importlib.util
import json
from pathlib import Path
import subprocess

script = Path(__file__).with_name('evaluate-memory-abstention.py')
spec = importlib.util.spec_from_file_location('abstention_eval', script)
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


def main():
    root = evaluation.ROOT / 'evaluation-results' / 'memory-abstention'
    assets = evaluation.ROOT / 'gaze-demo' / '.models'
    files = {'dense': assets / 'embeddinggemma-2' / 'embeddinggemma-2-Q8_0.gguf',
             'reranker': assets / 'memory-reranker' / 'qwen3-reranker-0.6b-q8_0.gguf'}
    weights = {name: evaluation.sha256(path) for name, path in files.items()}
    if any(value != evaluation.KNOWN_MODELS[name]['gguf_sha256'] for name, value in weights.items()):
        raise ValueError('Running model artifacts differ from the pinned benchmark weights')
    backend_bin = assets / 'embeddinggemma-2' / 'llama-b12110' / 'llama-server'
    runtime_version = subprocess.run([backend_bin, '--version'], check=True, text=True,
                                     capture_output=True)
    listeners = {}
    for model, port in [('dense', 8003), ('reranker', 8004)]:
        process_ids = subprocess.run(['lsof', '-nP', '-t', f'-iTCP:{port}', '-sTCP:LISTEN'], check=True,
                                     capture_output=True, text=True).stdout.splitlines()
        if len(process_ids) != 1:
            raise ValueError(f'Expected one local model listener on {port}')
        process = subprocess.run(['ps', '-p', process_ids[0], '-o', 'lstart=', '-o', 'command='], check=True,
                                 capture_output=True, text=True).stdout.strip()
        if str(files[model]) not in process or str(backend_bin) not in process:
            raise ValueError(f'Model listener on {port} does not use the pinned local artifacts')
        listeners[model] = {'port': port, 'pid': int(process_ids[0]), 'process': process}
    names = ('development-split.json', 'development-dense.jsonl', 'development-scores.jsonl',
             'development-batch-stability.json',
             'frozen-policy.json', 'heldout-replay-manifest.json', 'heldout-scores.jsonl',
             'heldout-summary.json', 'heldout-deadline-diagnostics.json', 'heldout-production-parity.json')
    if len(evaluation.read_rows(root / 'heldout-scores.jsonl')) != 1384:
        raise ValueError('Complete the held-out replay before recording final artifact digests')
    record = {
        'known_model_pins': evaluation.KNOWN_MODELS,
        'verified_local_model_files_sha256': weights,
        'llama_server_version': (runtime_version.stdout + runtime_version.stderr).strip(),
        'local_listeners_at_audit': listeners,
        'artifacts_sha256': {name: evaluation.sha256(root / name) for name in names if (root / name).is_file()},
        'notes': [
            'In this run each development model stage completed in one invocation using unchanged local model services; no partial score files were resumed.',
            'This audit records the verified on-disk assets and process IDs at audit time. It does not make older partial files interchangeable between model builds.',
            'For a different GGUF, runtime, scoring format, split or policy, use a new --output-dir and regenerate both development model stages before freezing.',
        ],
    }
    evaluation.write_json(root / 'run-provenance.json', record)
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
