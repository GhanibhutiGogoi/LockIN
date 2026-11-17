#!/usr/bin/env python3
"""Audit production decisions, local model timing and weighted replay budget sensitivity."""

import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path
import random
import sys
import time

source = Path(__file__).with_name('evaluate-memory-weighted-rerank.py')
spec = importlib.util.spec_from_file_location('memory_weighted_rerank', source)
weighted = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = weighted
spec.loader.exec_module(weighted)
wide, old = weighted.wide, weighted.old

from lockin import semantic_memory, web_memory


class Scores:
    def __init__(self, values, expected_topics):
        self.values = values
        self.expected_topics = expected_topics
        self.calls = 0

    def scores(self, query, topics):
        if topics != self.expected_topics:
            raise AssertionError('Production uses a different candidate set or order')
        self.calls += 1
        return self.values


def recall(fixture, embedder, reranker):
    query = web_memory.RetrievalQuery(deck_id=f"current-{fixture['qid']}", source='replay', topic=fixture['query_topic'])
    records = [old.previous.record(docid, fixture['candidate_topics'][docid]) for docid in reversed(fixture['candidate_ids'])]
    status, results = web_memory.recall_related(embedder, query, records, reranker=reranker, wide=True)
    return status, [item['rescue_id'] for item in results]


def verify(fixtures, rows, policy):
    totals = Counter()
    for key, row in rows.items():
        fixture = fixtures[key]
        for field in ('candidate_ids', 'positive_ids', 'cosine_scores'):
            if fixture[field] != row[field]:
                raise AssertionError(f'Frozen {field} changed for {key}')
        dense_ids = row['candidate_ids']
        rerank_ids = wide.candidates(row, policy)
        if list(row['relevance_scores']) != rerank_ids:
            raise AssertionError(f'Replay shortlist mismatch for {key}')
        dense = Scores([row['cosine_scores'][docid] for docid in dense_ids],
                       [fixture['candidate_topics'][docid] for docid in dense_ids])
        rerank = Scores([row['relevance_scores'][docid] for docid in rerank_ids],
                        [fixture['candidate_topics'][docid] for docid in rerank_ids])
        expected = weighted.display(row, policy)
        actual = recall(fixture, dense, rerank)
        if actual != ('confirmed' if expected else 'no_match', expected) or dense.calls != 1 or rerank.calls != bool(rerank_ids):
            raise AssertionError(f'Production and frozen report differ for {key}: {actual} vs {expected}')
        totals[actual[0]] += 1
    return dict(totals)


def sample_live(fixtures, rows, policy):
    embedder, reranker = semantic_memory.configured_web_embedder(), semantic_memory.configured_web_reranker()
    if embedder is None or reranker is None:
        raise ValueError('Both local models required for live adapter check')
    rng = random.Random(old.SEED)
    observations = []
    for dataset in old.DATASETS:
        for positive in (False, True):
            for confirmed in (False, True):
                eligible = [key for key, row in rows.items() if key[0] == dataset
                            and bool(row['positive_ids']) == positive and bool(weighted.display(row, policy)) == confirmed]
                for key in rng.sample(eligible, min(3, len(eligible))):
                    expected = weighted.display(rows[key], policy)
                    start = time.perf_counter()
                    status, ids = recall(fixtures[key], embedder, reranker)
                    elapsed = (time.perf_counter() - start) * 1000
                    observations.append({'key': key, 'status': status, 'ids': ids, 'expected_ids': expected,
                                         'matches': (status, ids) == ('confirmed' if expected else 'no_match', expected),
                                         'elapsed_ms': elapsed})
    return {'cases': len(observations), 'matches': sum(row['matches'] for row in observations),
            'elapsed_ms': old.previous.score_distribution([row['elapsed_ms'] for row in observations]),
            'observations': observations}


def budgets(rows, policy, fetch_ms, engine_ms):
    result = {}
    for dataset in old.DATASETS:
        group = [row for row in rows.values() if row['dataset'] == dataset]
        limits = Counter()
        for row in group:
            dense, rerank = row['dense_ms'], row['rerank_ms']
            limits['dense_above_950'] += dense > 950
            limits['rerank_above_1000'] += rerank > 1000
            limits['combined_above_fetch'] += dense + rerank > fetch_ms
            limits['combined_above_engine'] += dense + rerank > engine_ms
            if dense > 950 or rerank > 1000 or dense + rerank > fetch_ms:
                limits['unavailable_positive' if row['positive_ids'] else 'unavailable_control'] += 1
            elif row['positive_ids']:
                limits['positive_hit'] += bool(set(row['positive_ids']).intersection(weighted.display(row, policy)))
            else:
                limits['control_returned'] += bool(weighted.display(row, policy))
        result[dataset] = {key: limits[key] for key in ('dense_above_950', 'rerank_above_1000', 'combined_above_fetch',
                           'combined_above_engine', 'unavailable_positive', 'unavailable_control', 'positive_hit', 'control_returned')}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=old.ROOT / 'evaluation-results' / 'memory-wide-rerank')
    parser.add_argument('--previous-results', type=Path, default=old.ROOT / 'evaluation-results' / 'memory')
    parser.add_argument('--cache', type=Path, default=Path('/tmp/lockin-memory-benchmark-data'))
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--fetch-ms', type=float, default=2100)
    parser.add_argument('--engine-ms', type=float, default=2300)
    args = parser.parse_args()
    root = args.output_dir
    frozen_file = root / 'weighted-policy.json'
    score_file = root / 'heldout-scores.jsonl'
    frozen = json.loads(frozen_file.read_text())
    policy = frozen['policy']
    actual_constants = {
        'candidate_limit': web_memory.WIDE_RERANK_CANDIDATE_LIMIT,
        'minimum_cosine': web_memory.WIDE_MIN_CONFIRMED_COSINE,
        'minimum_weighted_score': web_memory.MIN_COMBINED_SCORE,
        'cosine_weight': web_memory.COSINE_SCORE_WEIGHT,
        'gap_weight': web_memory.RERANK_MARGIN_WEIGHT,
    }
    if (any(policy[name] != value for name, value in actual_constants.items())
            or frozen['parameters']['cosine_center'] != web_memory.COSINE_SCORE_CENTER
            or frozen['parameters']['gap_cap'] != web_memory.MAX_RERANK_MARGIN
            or web_memory.relevance_logit(0) != weighted.logit(0)
            or web_memory.relevance_logit(1) != weighted.logit(1)):
        raise AssertionError('Production wide constants differ from frozen policy')
    fixtures = {old.item_key(row): row for row in old.heldout_rows(args)}
    rows = {old.item_key(row): row for row in old.read_rows(score_file)}
    if len(rows) != 1384 or fixtures.keys() != rows.keys():
        raise ValueError('Exact frozen replay cases required')
    audit = {'policy_sha256': old.sha256(frozen_file), 'score_file_sha256': old.sha256(score_file),
             'production_constants': actual_constants,
             'deterministic_production_parity': verify(fixtures, rows, policy),
             'live_production_parity': sample_live(fixtures, rows, policy),
             'budgets_ms': {'embedding': 950, 'rerank': 1000, 'web_fetch': args.fetch_ms, 'web_engine': args.engine_ms},
             'deadline_estimates': budgets(rows, policy, args.fetch_ms, args.engine_ms),
             'latency_scope': 'Prior dense timings plus current sequential reranker timings, excluding browser/route overhead. Live probe calls both production adapters when shortlist is nonempty.'}
    old.write_json(root / 'production-audit.json', audit)
    print(json.dumps({**audit, 'live_production_parity': {key: value for key, value in audit['live_production_parity'].items()
                      if key != 'observations'}}, indent=2), flush=True)
    live = audit['live_production_parity']
    if live['matches'] != live['cases']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
