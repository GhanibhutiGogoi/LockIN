#!/usr/bin/env python3
"""Download only webcam/label members needed for the local EOTT evaluation."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import time
from urllib.request import Request, urlopen
from zipfile import ZipFile

ARCHIVE = 'https://webgazer.cs.brown.edu/data/WebGazerETRA2018Dataset_Release20180420.zip'
PAGES = re.compile(r'_-study-(?:dot_test|dot_test_final)\.webm$')
READING = re.compile(r'_(\d+)_-study-(?:educational_advantages_of_social_networking_sites|benefits_of_running|tooth_abscess|where_to_find_morel_mushrooms)\.webm$')
PARTICIPANT = re.compile(r'P_(\d+)$')


class RangeArchive(io.RawIOBase):
    def __init__(self):
        self.offset = 0
        self.buffer_start = -1
        self.size, self.buffer = self.fetch('bytes=-65557')
        self.buffer_start = self.size - len(self.buffer)

    @staticmethod
    def fetch(interval):
        request = Request(ARCHIVE, headers={'Range': interval})
        for attempt in range(3):
            try:
                with urlopen(request, timeout=45) as response:
                    if response.status != 206:
                        raise OSError(f'Server returned {response.status} instead of HTTP 206')
                    bounds = response.headers['Content-Range']
                    match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', bounds)
                    if match is None:
                        raise OSError(f'Unexpected Content-Range {bounds}')
                    start, end, total = map(int, match.groups())
                    if not (interval == f'bytes={start}-{end}' or interval == f'bytes=-{end - start + 1}' and end == total - 1):
                        raise OSError(f'Mismatched range for {interval}: {bounds}')
                    data = response.read()
                    if len(data) != end - start + 1:
                        raise OSError(f'Truncated data for {interval}')
                    return total, data
            except (OSError, TimeoutError):
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)

    def tell(self):
        return self.offset

    def seekable(self):
        return True

    def seek(self, offset, whence=io.SEEK_SET):
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.offset, io.SEEK_END: self.size}[whence]
        if base + offset < 0:
            raise ValueError('Negative archive offset')
        self.offset = base + offset
        return self.offset

    def read(self, size=-1):
        end = self.size if size < 0 else min(self.offset + size, self.size)
        if end <= self.offset:
            return b''
        buffer_end = self.buffer_start + len(self.buffer)
        if self.offset < self.buffer_start or end > buffer_end:
            fetch_end = min(self.size, max(end, self.offset + (4 << 20)))
            _, self.buffer = self.fetch(f'bytes={self.offset}-{fetch_end - 1}')
            self.buffer_start = self.offset
        data = self.buffer[self.offset - self.buffer_start:end - self.buffer_start]
        self.offset = end
        return data


def selections(zipped):
    result = {}
    reading = {}
    metadata = []
    for info in zipped.infolist():
        path = PurePosixPath(info.filename)
        if info.is_dir() or '__MACOSX' in path.parts or path.name.startswith('.'):
            continue
        participant = next((part for part in path.parts[:-1] if PARTICIPANT.fullmatch(part)), None)
        if participant:
            if path.name == f'{participant}.txt' or re.fullmatch(r'\d+\.json', path.name) or PAGES.search(path.name):
                result.setdefault(participant, []).append(info)
            match = READING.search(path.name)
            if match:
                reading.setdefault(participant, []).append((int(match[1]), info))
        elif 'characteristic' in path.name.lower() or path.name.lower().endswith('.csv'):
            metadata.append(info)
    # The first recorded research page is fixed before seeing model outcomes.
    for participant, videos in reading.items():
        result.setdefault(participant, []).append(min(videos, key=lambda item: item[0])[1])
    return result, metadata


def extract(zipped, entries, folder):
    folder.mkdir(parents=True, exist_ok=True)
    for info in entries:
        path = folder / PurePosixPath(info.filename).name
        if path.is_file() and path.stat().st_size == info.file_size:
            continue
        temp = path.with_suffix(path.suffix + '.partial')
        try:
            with zipped.open(info) as source, temp.open('wb') as output:
                shutil.copyfileobj(source, output, 2 << 20)
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--participants', nargs='*', default=[])
    parser.add_argument('--jobs', type=int, default=3)
    parser.add_argument('--list', action='store_true')
    args = parser.parse_args()
    with ZipFile(RangeArchive()) as zipped:
        members, metadata = selections(zipped)
        participants = args.participants or sorted(members, key=lambda p: int(p[2:]))
        if args.list:
            print(json.dumps({
                'archive': ARCHIVE,
                'metadata': [m.filename for m in metadata],
                'participants': {p: [(m.filename, m.compress_size, m.file_size) for m in members[p]] for p in participants},
            }, indent=2))
            return
        extract(zipped, metadata, args.cache)

    def download(participant):
        try:
            with ZipFile(RangeArchive()) as zipped:
                extract(zipped, members[participant], args.cache / participant)
            print(f'{participant}: {len(members[participant])} members', flush=True)
        except Exception as error:
            print(f'{participant}: {type(error).__name__}: {error}', flush=True)
            return participant
        return None

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        failures = [p for p in pool.map(download, participants) if p]
    if failures:
        raise SystemExit('Failed downloads: ' + ', '.join(failures))


if __name__ == '__main__':
    main()
