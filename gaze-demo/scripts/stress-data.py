#!/usr/bin/env python3
"""Inspect the frozen access audit or validate a prepared labelled feature file.

This command never signs agreements, downloads restricted files or opens devices.
Raw data stays under .stress-data (ignored); use authorized sources only.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from lockin.stress.training import validate_dataset


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path)
    p.add_argument('--manifest',type=Path)
    args=p.parse_args()
    if args.input is None:
        print((ROOT/'docs/stress/data-manifest.json').read_text());return
    if args.manifest is None:p.error('--manifest is required with --input')
    if args.input.stat().st_size>100_000_000:p.error('prepared features exceed 100 MB local limit')
    content=args.input.read_bytes();manifest=json.loads(args.manifest.read_text())
    if hashlib.sha256(content).hexdigest()!=manifest.get('records_sha256'):p.error('input checksum mismatch')
    rows=[json.loads(line) for line in content.splitlines() if line.strip()]
    try:validate_dataset(rows,manifest)
    except ValueError as e:p.error(str(e))
    print(json.dumps({'valid':True,'rows':len(rows),'participants':len({r['subject'] for r in rows}),'source_kind':manifest['source_kind']}))


if __name__=='__main__':main()
