#!/usr/bin/env python3
"""Summarize deadline sensitivity and classify misses after the held-out replay."""

import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path

script = Path(__file__).with_name('evaluate-memory-abstention.py')
spec = importlib.util.spec_from_file_location('abstention_eval', script)
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


def analyze(rows, policy, dense_ms, rerank_ms, fetch_ms, engine_ms):
    by_dataset = {}
    for dataset in evaluation.DATASETS:
        cases = [row for row in rows if row['dataset'] == dataset]
        floor = policy['minimum_cosine']
        needs_rerank = [floor is None or any(row['cosine_scores'][docid] >= floor for docid in row['relevance_scores'])
                        for row in cases]
        effective_rerank_ms = [row['rerank_ms'] if needed else 0 for row, needed in zip(cases, needs_rerank, strict=True)]
        combined = [row['dense_ms'] + elapsed for row, elapsed in zip(cases, effective_rerank_ms, strict=True)]
        misses = Counter()
        timed = Counter()
        for row, elapsed, stage_sum in zip(cases, effective_rerank_ms, combined, strict=True):
            positive = set(row['positive_ids'])
            if row['dense_ms'] > dense_ms or elapsed > rerank_ms or stage_sum > fetch_ms:
                timed['positive_unavailable' if positive else 'control_unavailable'] += 1
                continue
            displayed = evaluation.display(row, policy)
            if not positive:
                timed['control_returned' if displayed else 'control_abstained'] += 1
            elif positive.intersection(displayed):
                timed['positive_hit'] += 1
            else:
                timed['positive_miss'] += 1
            if not positive or positive.intersection(displayed):
                continue
            retained = positive & row['relevance_scores'].keys()
            above_cosine = {docid for docid in retained if floor is None or row['cosine_scores'][docid] >= floor}
            if not retained:
                misses['positive_below_dense_shortlist'] += 1
            elif not above_cosine:
                misses['positive_below_cosine_floor'] += 1
            elif not any(row['relevance_scores'][docid] >= policy['minimum_relevance'] for docid in above_cosine):
                misses['positive_below_reranker_threshold'] += 1
            else:
                misses['positive_below_display_top3'] += 1
        by_dataset[dataset] = {
            'cases': len(cases),
            'dense_stage_exceeds_deadline': sum(row['dense_ms'] > dense_ms for row in cases),
            'reranker_stage_exceeds_deadline': sum(elapsed > rerank_ms for elapsed in effective_rerank_ms),
            'no_reranker_call_in_production': len(cases) - sum(needs_rerank),
            'combined_stages_exceed_web_fetch': sum(stage_sum > fetch_ms for stage_sum in combined),
            'combined_stages_exceed_engine': sum(stage_sum > engine_ms for stage_sum in combined),
            'combined_stages_ms': evaluation.previous.score_distribution(combined),
            'all_top_k_rerank_and_dense_ms': evaluation.previous.score_distribution(
                [row['dense_ms'] + row['rerank_ms'] for row in cases]),
            'deadline_adjusted_outcomes': {key: timed[key] for key in ('positive_hit', 'positive_miss', 'positive_unavailable',
                                                                        'control_returned', 'control_abstained', 'control_unavailable')},
            'positive_miss_causes': {key: misses[key] for key in ('positive_below_dense_shortlist', 'positive_below_cosine_floor',
                                                                 'positive_below_reranker_threshold', 'positive_below_display_top3')},
        }
    return by_dataset


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=evaluation.ROOT / 'evaluation-results' / 'memory-abstention')
    parser.add_argument('--dense-ms', type=float, default=950)
    parser.add_argument('--rerank-ms', type=float, default=800)
    parser.add_argument('--fetch-ms', type=float, default=1300)
    parser.add_argument('--engine-ms', type=float, default=1500)
    args = parser.parse_args()
    root = args.output_dir
    frozen = root / 'frozen-policy.json'
    replay = root / 'heldout-scores.jsonl'
    rows = evaluation.read_rows(replay)
    if len(rows) != 1384 or not (root / 'heldout-summary.json').is_file():
        raise ValueError('Complete the 1,384-case held-out replay first')
    policy = json.loads(frozen.read_text(encoding='utf-8'))['policies']['rerank_calibrated']
    report = {
        'frozen_policy_sha256': evaluation.sha256(frozen), 'heldout_scores_sha256': evaluation.sha256(replay),
        'deadlines_ms': {key: getattr(args, key) for key in ('dense_ms', 'rerank_ms', 'fetch_ms', 'engine_ms')},
        'datasets': analyze(rows, policy, args.dense_ms, args.rerank_ms, args.fetch_ms, args.engine_ms),
        'note': 'Sensitivity estimate sums prior adapter dense measurement and current local reranker replay. It assigns zero reranker time where production skips the model because all candidates fall below the cosine floor and otherwise uses the full top-K reranker measurement as a conservative proxy for the shorter actual batch. Browser overhead and concurrent clients are outside this estimate. Deadline misses count as unavailable.',
    }
    evaluation.write_json(root / 'heldout-deadline-diagnostics.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
