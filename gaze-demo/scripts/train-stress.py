#!/usr/bin/env python3
"""Train only from explicit compatible window features and self-report provenance."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from lockin.stress.training import train


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,help='JSONL: subject, session, start_ms, end_ms, label, vector[104]')
    p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--output',type=Path,default=ROOT/'backend/artifacts/stress-model.json')
    p.add_argument('--report',type=Path,default=ROOT/'docs/stress/training-report.json')
    args=p.parse_args()
    try:
        manifest=json.loads(args.manifest.read_text())
        if args.input is None:raise ValueError('No accessible compatible real-labelled input: see data-manifest.json; no model was trained.')
        if args.input.stat().st_size>100_000_000:raise ValueError('training feature file exceeds local budget')
        content=args.input.read_bytes()
        if hashlib.sha256(content).hexdigest()!=manifest.get('records_sha256'):raise ValueError('input SHA-256 does not match manifest')
        rows=[json.loads(line) for line in content.splitlines() if line.strip()]
        artifact,report=train(rows,manifest)
        report['input_sha256']=manifest['records_sha256'];report['model_id']=artifact['model_id']
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(artifact,indent=2,allow_nan=False))
    except (OSError,ValueError,KeyError,TypeError) as exc:
        # Never overwrite an old model with a fictitious successful training run.
        report={'status':'blocked_no_model_trained','reason':str(exc),'runtime_eligible':False,
            'real_training_completed':False,'project_user_validation':False}
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print(json.dumps(report,indent=2))
    return 0 if report['status']!='blocked_no_model_trained' else 2


if __name__=='__main__':raise SystemExit(main())
