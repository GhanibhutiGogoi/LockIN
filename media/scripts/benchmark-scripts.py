"""Benchmark the real writer using synthetic material (no personal screen text)."""

import argparse
import json
import os
import statistics
import tempfile
from pathlib import Path
from time import perf_counter

from fastapi.testclient import TestClient

from lockin_media.studio import create_app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="gpt-6.2-sol")
    parser.add_argument("--runs", type=int, choices=range(1, 11), default=3)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    os.environ["LOCKIN_LLM_PROVIDER"] = "codex"
    os.environ["LOCKIN_LLM_MODEL"] = args.model
    payload = {
        "slide": {
            "title": "Outlier detection",
            "text": (
                "Outlier detection identifies unusual observations. A boxplot shows the median "
                "and interquartile range. Values below Q1 minus 1.5 times IQR or above Q3 plus "
                "1.5 times IQR are potential outliers, not necessarily errors."
            ),
        },
        "variant": {"target_seconds": 30, "quiz_count": 1},
    }
    with tempfile.TemporaryDirectory() as scratch:
        os.environ["LOCKIN_DATA_DIR"] = scratch
        os.environ["LOCKIN_LLM_CACHE_SECONDS"] = "0"
        samples = []
        with TestClient(create_app(), base_url="http://127.0.0.1") as client:
            for _ in range(args.runs):
                start = perf_counter()
                response = client.post("/scripts", json=payload)
                response.raise_for_status()
                seconds = round(perf_counter() - start, 3)
                samples.append(seconds)
                print(f"Uncached script: {seconds}s", flush=True)
        # A fresh app uses a real cache. The second identical request must reuse its result.
        os.environ["LOCKIN_LLM_CACHE_SECONDS"] = "3600"
        with TestClient(create_app(), base_url="http://127.0.0.1") as client:
            first = client.post("/scripts", json=payload)
            first.raise_for_status()
            start = perf_counter()
            cached = client.post("/scripts", json=payload)
            cached.raise_for_status()
            cache_seconds = round(perf_counter() - start, 3)
            assert first.json() == cached.json()
        traces = [
            json.loads(line)
            for line in (Path(scratch) / "timings.jsonl").read_text(encoding="utf-8").splitlines()
        ]
        report = {
            "model": args.model,
            "uncached_seconds": samples,
            "median_seconds": statistics.median(samples),
            "cached_seconds": cache_seconds,
            "traces": traces,
            "sample_script": first.json(),
        }
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        print(f"Median: {report['median_seconds']}s; cache hit: {cache_seconds}s")


if __name__ == "__main__":
    main()
