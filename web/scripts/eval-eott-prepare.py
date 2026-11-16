#!/usr/bin/env python3
"""Pair actual EOTT webcam frame PTS with Brown recording anchors and Tobii labels."""

import argparse
from bisect import bisect_left
import csv
import json
import math
from pathlib import Path
import statistics
import subprocess

GRID = [(x, y) for y in range(3) for x in range(3)]
MAX_TOBII_LAG_MS = 25
FRAME_INTERVAL_MS = 500
CAL_INTERVAL_MS = 110


def recording(events, video):
    session = video.stem.replace('_-study-', '_/study/')
    entries = [e for e in events if e.get('sessionString') == session or e.get('sessionId') == session]
    start, = [e for e in entries if e.get('type') == 'recording start']
    stops = [e for e in entries if e.get('type') == 'recording stop']
    if len(stops) > 1:
        raise ValueError(f'{session}: multiple recording stops')
    elapsed = stops[0]['epoch'] - start['epoch'] if stops else None
    clock_delta = max(abs((event['epoch'] - start['epoch']) - (event['time'] - start['time'])) for event in entries if 'time' in event)
    return start['epoch'], elapsed, clock_delta, session


def dot_groups(events, session):
    groups = []
    for event in events:
        if event.get('sessionId') != session or event.get('type') != 'mouseclick':
            continue
        x, y = event['clientX'], event['clientY']
        w, h = event['windowInnerWidth'], event['windowInnerHeight']
        col = min(range(3), key=lambda i: abs(x - (40, w / 2, w - 40)[i]))
        row = min(range(3), key=lambda i: abs(y - (40, h / 2, h - 40)[i]))
        center_x, center_y = (40, w / 2, w - 40)[col], (40, h / 2, h - 40)[row]
        if math.hypot(x - center_x, y - center_y) > 90:
            continue
        if groups and groups[-1][0] == (col, row):
            groups[-1] = ((col, row), event)
        else:
            groups.append(((col, row), event))
    if [key for key, _ in groups] != GRID:
        raise ValueError(f'expected nine ordered 3×3 click cells, got {[key for key, _ in groups]}')
    return [event for _, event in groups]


def frame_times(video):
    probe = subprocess.run([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_streams',
        '-show_entries', 'stream=width,height:frame=best_effort_timestamp_time',
        '-of', 'json', str(video),
    ], check=True, capture_output=True)
    data = json.loads(probe.stdout)
    source = data['streams'][0]
    if (source['width'], source['height']) != (640, 480):
        raise ValueError(f"expected 640×480 source, got {source['width']}×{source['height']}")
    times = [float(frame['best_effort_timestamp_time']) * 1000 for frame in data['frames']]
    if len(times) < 2 or any(b < a for a, b in zip(times, times[1:])):
        raise ValueError('missing or non-monotonic webcam frame timestamps')
    return times


def sample_frames(times, begin, end, interval):
    samples = []
    target = begin
    while target < end:
        index = bisect_left(times, target)
        if index < len(times) and times[index] < end and times[index] - target <= min(80, interval / 2):
            samples.append((index, times[index]))
        target += interval
    return samples


def decode_frames(video, rows, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    frame_ids = [row['sourceFrame'] for row in rows]
    if sorted(set(frame_ids)) != frame_ids:
        raise ValueError(f'duplicate/unordered selected frames in {video.name}')
    expression = '+'.join(f'eq(n,{i})' for i in frame_ids)
    subprocess.run([
        'ffmpeg', '-nostdin', '-v', 'error', '-threads', '1', '-i', str(video),
        '-filter_threads', '1', '-vf', f"select='{expression}'", '-fps_mode', 'passthrough',
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-y', str(path),
    ], check=True)
    if path.stat().st_size != len(rows) * 640 * 480 * 4:
        raise ValueError(f'FFmpeg frame count mismatch in {video.name}')


def tobii_samples(path, windows):
    lower = min(start for start, _ in windows) - 1000
    upper = max(stop for _, stop in windows) + 1000
    rows = []
    with path.open() as stream:
        for line in stream:
            event = json.loads(line)
            epoch = float(event['true_time']) * 1000
            if not lower <= epoch <= upper:
                continue
            eyes = []
            for side in ('left', 'right'):
                xy = event[f'{side}_gaze_point_on_display_area']
                if event[f'{side}_gaze_point_validity'] and len(xy) == 2 and all(math.isfinite(v) for v in xy):
                    eyes.append(xy)
            rows.append((epoch, [statistics.mean(axes) for axes in zip(*eyes)] if eyes else None))
    rows.sort(key=lambda row: row[0])
    times = [time for time, _ in rows]
    return times, [point for _, point in rows]


def pair_label(epoch, times, labels):
    after = bisect_left(times, epoch)
    candidates = [i for i in [after - 1, after] if 0 <= i < len(times)]
    if not candidates:
        return None, None
    i = min(candidates, key=lambda i: abs(times[i] - epoch))
    lag = round(times[i] - epoch, 3)
    return (labels[i] if abs(lag) <= MAX_TOBII_LAG_MS else None), lag


def task_files(folder):
    initial = list(folder.glob('*_-study-dot_test.webm'))
    final = list(folder.glob('*_-study-dot_test_final.webm'))
    reading = [file for file in folder.glob('*.webm') if file not in initial + final]
    if len(initial) != 1 or len(final) > 1 or len(reading) > 1:
        raise ValueError(f'unexpected task file counts {list(map(len, (initial, final, reading)))}')
    return dict(zip(('initial_dot', 'final_dot', 'reading'), (initial[0], next(iter(final), None), next(iter(reading), None))))


def prepare(folder, output, metadata):
    screen = [int(metadata['Display Width (pixels)']), int(metadata['Display Height (pixels)'])]
    events = json.loads((folder / f"{metadata['Participant Log ID']}.json").read_text())
    videos = task_files(folder)
    recordings = {task: recording(events, path) for task, path in videos.items() if path}
    windows = [(anchor, anchor + (duration or 32_000)) for task, (anchor, duration, _, _) in recordings.items() if task != 'initial_dot']
    if not windows:
        raise ValueError('no held-out webcam video')
    tobii = tobii_samples(folder / f'{folder.name}.txt', windows)
    clips = {}
    for task, video in videos.items():
        if video is None:
            continue
        anchor, duration, clock_delta, session = recordings[task]
        times = frame_times(video)
        video_duration = times[-1] + statistics.median(b - a for a, b in zip(times, times[1:]) if b > a)
        duration_delta = video_duration - duration if duration is not None else None
        if clock_delta > 100 or duration_delta is not None and abs(duration_delta) > 1250:
            raise ValueError(f'{task}: recording clock drift or clip duration mismatch ({clock_delta:.1f} ms, duration difference {duration_delta} ms)')
        rows = []
        targets = []
        if task == 'initial_dot':
            previous = anchor
            for event in dot_groups(events, session):
                stop = event['epoch'] - anchor - 25
                begin = max(times[0], previous - anchor + 200, stop - 1230)
                targets.append([event['screenX'] / screen[0] - 0.5, event['screenY'] / screen[1] - 0.5])
                for index, pts in sample_frames(times, begin, stop, CAL_INTERVAL_MS):
                    rows.append({'sourceFrame': index, 'ptsMs': pts, 'target': len(targets) - 1})
                previous = event['epoch']
            if any(not -0.5 <= coordinate <= 0.5 for xy in targets for coordinate in xy):
                raise ValueError('calibration click outside the primary display')
        else:
            # Avoid start/end UI transitions and bound the first research-page clip.
            stop = min(times[-1], duration or times[-1]) - 500
            if task == 'reading':
                stop = min(stop, 31_000)
            for index, pts in sample_frames(times, 1000, stop, FRAME_INTERVAL_MS):
                label, lag = pair_label(anchor + pts, *tobii)
                rows.append({'sourceFrame': index, 'ptsMs': pts, 'tobii': label, 'lagMs': lag})
        if not rows:
            raise ValueError(f'{task}: no webcam frames after sampling')
        path = output / f'{task}.rgba'
        decode_frames(video, rows, path)
        clips[task] = {
            'video': video.name, 'file': path.name, 'frames': rows, 'targets': targets,
            'alignment': {'videoFrames': len(times), 'firstPtsMs': times[0], 'lastPtsMs': times[-1],
                          'duplicatePtsFrames': len(times) - len(set(times)),
                          'anchorEpochMs': anchor, 'logDurationMs': duration,
                          'epochVsPageClockMs': round(clock_delta, 3),
                          'videoMinusLogDurationMs': round(duration_delta, 3) if duration_delta is not None else None},
        }
    return {'participant': folder.name, 'screen': screen, 'setting': metadata['Setting'], 'clips': clips}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--participants', nargs='+', required=True)
    args = parser.parse_args()
    with (args.cache / 'participant_characteristics.csv').open() as stream:
        characteristics = {row['Participant ID']: row for row in csv.DictReader(stream)}
    prepared = args.cache / 'prepared'
    for participant in args.participants:
        output = prepared / participant
        try:
            data = prepare(args.cache / participant, output, characteristics[participant])
        except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
            data = {'participant': participant, 'error': str(error)}
        output.mkdir(parents=True, exist_ok=True)
        (output / 'manifest.json').write_text(json.dumps(data, indent=2))
        print(participant, data.get('error') or {task: len(c['frames']) for task, c in data['clips'].items()}, flush=True)


if __name__ == '__main__':
    main()
