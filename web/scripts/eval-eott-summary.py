#!/usr/bin/env python3
"""Aggregate EOTT per-participant runs without dropping failed calibrations."""

import argparse
import csv
import json
import math
from pathlib import Path
import random
import statistics

MODELS = ('blazegaze', 'eyetheia')
TASKS = ('final_dot', 'reading')
ARCHIVE_MISSING_FINAL_DOT = ['P_37', 'P_38', 'P_39']


def percentile(values, fraction):
    if not values:
        return None
    index = min(len(values) - 1, math.ceil(fraction * len(values)) - 1)
    return round(sorted(values)[index], 3)


def stats(values):
    return {
        'n': len(values),
        'mean': round(statistics.mean(values), 3) if values else None,
        'median': round(statistics.median(values), 3) if values else None,
        'p95': percentile(values, .95),
    }


def bootstrap(differences):
    if len(differences) < 2:
        return None
    rng = random.Random(42)
    means = [statistics.mean(rng.choices(differences, k=len(differences))) for _ in range(5000)]
    return [percentile(means, .025), percentile(means, .975)]


def on_display(xy):
    return xy is not None and all(0 <= value <= 1 for value in xy)


def error(prediction, target, screen):
    return math.hypot(*((p + 0.5 - t) * dimension for p, t, dimension in zip(prediction, target, screen)))


def summarize(reports, task):
    aligned = []
    per_person = []
    failed = []
    for report in reports:
        name = report['participant']
        models = report.get('models')
        if not models or any('error' in models.get(model, {'error': 'missing'}) for model in MODELS):
            failed.append({'participant': name, 'reason': report.get('error') or {
                model: models.get(model, {}).get('error') for model in MODELS
            }})
            continue
        if any(task not in models[model]['records'] for model in MODELS):
            failed.append({'participant': name, 'reason': 'missing task webcam'})
            continue
        rows = list(zip(*(models[model]['records'][task] for model in MODELS), strict=True))
        calibrated = all(models[model]['calibration']['fitted'] for model in MODELS)
        matched_errors = {model: [] for model in MODELS}
        lag = []
        for pair in rows:
            blaze, eye = pair
            for key in ('sourceFrame', 'ptsMs', 'tobii', 'lagMs'):
                if blaze[key] != eye[key]:
                    raise ValueError(f'{name} {task}: unmatched {key}')
            target = blaze['tobii']
            if target is not None:
                lag.append(abs(blaze['lagMs']))
            aligned.append((calibrated, target, pair, report['screen']))
            if calibrated and on_display(target) and all(sample['gaze'] is not None for sample in pair):
                for model, sample in zip(MODELS, pair):
                    matched_errors[model].append(error(sample['gaze'], target, report['screen']))
        per_person.append({
            'participant': name, 'setting': report['setting'], 'pairedCalibrationSucceeded': calibrated,
            'calibration': {model: models[model]['calibration'] for model in MODELS},
            'sampledFrames': len(rows), 'TobiiValidFrames': len(lag), 'absTobiiTimeDeltaMs': stats(lag),
            'matchedErrorPx': {model: stats(errors) for model, errors in matched_errors.items()},
            'alignment': report['alignment'].get(task),
        })

    both_calibrated = [(target, pair, screen) for calibrated, target, pair, screen in aligned if calibrated]
    # Spatial error uses the same on-display labels and mutually usable frames.
    paired = [(target, pair, screen) for target, pair, screen in both_calibrated
              if on_display(target) and all(sample['gaze'] is not None for sample in pair)]
    model_stats = {}
    for i, model in enumerate(MODELS):
        usable = [sample for _, _, pair, _ in aligned if (sample := pair[i])['gaze'] is not None]
        all_timings = [pair[i]['workerMs'] for _, _, pair, _ in aligned]
        timing_same_frames = [pair[i]['workerMs'] for _, _, pair, _ in aligned if all(sample['gaze'] is not None for sample in pair)]
        on_screen_samples = [pair[i] for target, pair, _ in both_calibrated if on_display(target)]
        off_screen_samples = [pair[i] for target, pair, _ in both_calibrated if target is not None and not on_display(target)]
        model_stats[model] = {
            'gazeFrames': len(usable),
            'gazeCoverage': round(len(usable) / len(aligned), 4) if aligned else None,
            'gazeAtClippedEdgeFrames': sum(any(abs(value) == 0.5 for value in sample['gaze']) for sample in usable),
            'gazeAtClippedEdgeRate': round(sum(any(abs(value) == 0.5 for value in sample['gaze']) for sample in usable) / len(usable), 4) if usable else None,
            'faceFrames': sum(pair[i]['face'] for _, _, pair, _ in aligned),
            'workerMsAllFrames': stats(all_timings),
            'workerMsMutuallyValidGazeFrames': stats(timing_same_frames),
            'pairedErrorPx': stats([error(pair[i]['gaze'], target, screen) for target, pair, screen in paired]),
            'pairedErrorPercentScreenDiagonal': stats([
                100 * error(pair[i]['gaze'], target, screen) / math.hypot(*screen) for target, pair, screen in paired
            ]),
            'offscreenGeometryCounts': {
                'TobiiOnDisplay': {name: sum(sample['outside'] is flag for sample in on_screen_samples)
                                   for name, flag in [('inside', False), ('outside', True), ('unknown', None)]},
                'TobiiOutsideDisplay': {name: sum(sample['outside'] is flag for sample in off_screen_samples)
                                        for name, flag in [('inside', False), ('outside', True), ('unknown', None)]},
            },
        }
    participants_with_errors = [p for p in per_person if p['matchedErrorPx']['blazegaze']['n']]
    differences = [p['matchedErrorPx']['eyetheia']['mean'] - p['matchedErrorPx']['blazegaze']['mean'] for p in participants_with_errors]
    return {
        'attemptedParticipants': len(reports),
        'participantsWithBothOutputs': len(per_person),
        'participantsWithBothCalibrations': sum(p['pairedCalibrationSucceeded'] for p in per_person),
        'participantsWithPairedSpatialErrors': len(participants_with_errors),
        'sampledFrames': len(aligned),
        'TobiiValidFrames': sum(target is not None for _, target, _, _ in aligned),
        'TobiiOnDisplayFrames': sum(on_display(target) for _, target, _, _ in aligned),
        'mutuallyValidGazeFrames': sum(all(sample['gaze'] is not None for sample in pair) for _, _, pair, _ in aligned),
        'pairedSpatialErrorFrames': len(paired),
        'absValidTobiiTimeDeltaMs': stats([abs(pair[0]['lagMs']) for _, target, pair, _ in aligned if target is not None]),
        'models': model_stats,
        'participantWeightedMeanErrorPx': {
            model: stats([p['matchedErrorPx'][model]['mean'] for p in participants_with_errors]) for model in MODELS
        },
        'pairedParticipantMeanErrorDeltaPxEyeTheiaMinusBlazeGaze': stats(differences),
        'pairedParticipantBootstrap95PercentCI': bootstrap(differences),
        'perParticipant': per_person,
        'excluded': failed,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('participants', nargs='+')
    args = parser.parse_args()
    reports = []
    for participant in args.participants:
        path = args.folder / (participant + '.json')
        reports.append(json.loads(path.read_text()) if path.exists() else {'participant': participant, 'error': 'no run output'})
    result = {
        'participants': args.participants,
        'archiveParticipants': 51,
        'archiveMissingFinalDotVideo': ARCHIVE_MISSING_FINAL_DOT,
        'taskDefinitions': {
            'final_dot': 'Held-out EOTT Final Dot Test.',
            'reading': 'First webcam clip from an EOTT search-results browsing task, sampled for up to 30 seconds.',
        },
        'runtime': next((report['runtime'] for report in reports if report.get('runtime')), None),
        'provenance': next(({k: v for k, v in report['provenance'].items() if k != 'manifest'}
                            for report in reports if report.get('provenance')), None),
        'tasks': {task: summarize(reports, task) for task in TASKS},
        'limitations': [
            'Recording-start epochs plus FFprobe source PTS are approximate; nearest-label lag is not actual camera synchronization error.',
            'Final-dot and first research-page clips are sampled at 2 Hz; no 30-second live offscreen-trigger timing claim.',
            'Personal fit uses original clicked screen locations and the first seven usable frames for each target; no Tobii data in fitting.',
            'Original EOTT footage does not contain the three LockIN validation targets; fitted means affine fit completed.',
            'Resetting the filter before each held-out clip avoids leaking smoothing state across separate recordings.',
            'Spatial error is paired on identical valid on-display Tobii frames and participants for which both affine fits completed.',
            'EOTT records screen gaze positions; there are no task-independent attention labels or deliberate 30-second away trials.',
        ],
    }
    for report in reports:
        if report.get('provenance') and any(report['provenance'].get(k) != v for k, v in result['provenance'].items()):
            raise ValueError(f"{report['participant']}: conflicting worker, asset, or harness fingerprints")
    (args.folder / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
    with (args.folder / 'participants.csv').open('w', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow([
            'participant', 'task', 'setting', 'joint_fit', 'sampled_frames', 'tobii_valid_frames',
            'paired_on_display_frames', 'blazegaze_mean_error_px', 'eyetheia_mean_error_px',
            'median_absolute_tobii_label_lag_ms', 'recording_duration_minus_log_ms', 'exclusion_reason',
        ])
        for task, metrics in result['tasks'].items():
            included = {row['participant']: row for row in metrics['perParticipant']}
            exclusions = {row['participant']: row['reason'] for row in metrics['excluded']}
            for participant in args.participants:
                row = included.get(participant)
                if row is None:
                    writer.writerow([participant, task, '', '', '', '', '', '', '', '', '', exclusions[participant]])
                    continue
                writer.writerow([
                    participant, task, row['setting'], row['pairedCalibrationSucceeded'],
                    row['sampledFrames'], row['TobiiValidFrames'], row['matchedErrorPx']['blazegaze']['n'],
                    *(row['matchedErrorPx'][model]['mean'] for model in MODELS),
                    row['absTobiiTimeDeltaMs']['median'], row['alignment']['videoMinusLogDurationMs'],
                    '' if row['pairedCalibrationSucceeded'] else 'one or both affine fits failed',
                ])
    for task, metrics in result['tasks'].items():
        print(task, {k: metrics[k] for k in ('participantsWithBothCalibrations', 'sampledFrames', 'pairedSpatialErrorFrames', 'participantWeightedMeanErrorPx', 'pairedParticipantBootstrap95PercentCI')})


if __name__ == '__main__':
    main()
