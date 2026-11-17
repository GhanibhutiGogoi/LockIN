#!/usr/bin/env python3
"""Check EOTT offset sensitivity on a fixed intersection of held-out webcam frames."""

import argparse
from importlib import import_module
import json
import math
from pathlib import Path
import statistics

prepare = import_module('eval-eott-prepare')
OFFSETS_MS = (-500, -250, 0, 250, 500)
TASKS = ('final_dot', 'reading')
MODELS = ('blazegaze', 'eyetheia')


def summarize_participant(data, cache):
    windows = [
        (alignment['anchorEpochMs'], alignment['anchorEpochMs'] + alignment['lastPtsMs'])
        for task, alignment in data['alignment'].items() if task in TASKS
    ]
    participant = data['participant']
    tobii = prepare.tobii_samples(cache / participant / (participant + '.txt'), windows)
    result = {}
    for task in TASKS:
        records = [data['models'][m]['records'][task] for m in MODELS]
        errors = {offset: {model: [] for model in MODELS} for offset in OFFSETS_MS}
        for pair in zip(*records, strict=True):
            if not all(frame['gaze'] is not None for frame in pair):
                continue
            epoch = data['alignment'][task]['anchorEpochMs'] + pair[0]['ptsMs']
            labels = [prepare.pair_label(epoch + offset, *tobii)[0] for offset in OFFSETS_MS]
            if not all(xy is not None and all(0 <= value <= 1 for value in xy) for xy in labels):
                continue
            for offset, label in zip(OFFSETS_MS, labels, strict=True):
                for model, frame in zip(MODELS, pair, strict=True):
                    error = math.hypot(*(
                        (prediction + .5 - expected) * size
                        for prediction, expected, size in zip(frame['gaze'], label, data['screen'], strict=True)
                    ))
                    errors[offset][model].append(error)
        result[task] = {
            offset: {'n': len(values[MODELS[0]]), **{
                model: round(statistics.mean(samples), 3) if samples else None
                for model, samples in values.items()
            }} for offset, values in errors.items()
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reports', type=Path)
    parser.add_argument('cache', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    people = {}
    for path in sorted(args.reports.glob('P_*.json')):
        data = json.loads(path.read_text())
        if 'models' in data and all(data['models'][model].get('calibration', {}).get('fitted') for model in MODELS):
            people[data['participant']] = summarize_participant(data, args.cache)
    summary = {}
    for task in TASKS:
        summary[task] = {}
        for offset in OFFSETS_MS:
            rows = [person[task][offset] for person in people.values() if person[task][offset]['n']]
            summary[task][offset] = {
                'pairedFrames': sum(row['n'] for row in rows), 'subjects': len(rows),
                **{model: round(statistics.mean(row[model] for row in rows), 3) if rows else None for model in MODELS},
            }
    result = {
        'scope': 'Fixed sensitivity analysis, same gaze predictions and same frames valid at all five approximate recording-start offsets. Zero is the predeclared primary label pairing. No offset is selected or fitted. Values are subject-weighted average errors in pixels.',
        'offsetsMs': OFFSETS_MS, 'tasks': summary, 'subjects': people,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
