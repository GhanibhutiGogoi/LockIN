#!/usr/bin/env python3
"""Check frozen replay decisions against the actual production function and local models."""

import argparse
import importlib.util
import json
from pathlib import Path
import random
import time

script = Path(__file__).with_name('evaluate-memory-abstention.py')
spec = importlib.util.spec_from_file_location('abstention_eval', script)
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)

from lockin import semantic_memory, web_memory


class TimedModel:
    def __init__(self, model):
        self.model = model
        self.elapsed_ms = None
        self.document_count = None

    def scores(self, query, documents):
        self.document_count = len(documents)
        started = time.perf_counter()
        try:
            return self.model.scores(query, documents)
        finally:
            self.elapsed_ms = (time.perf_counter() - started) * 1000


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('/tmp/lockin-memory-benchmark-data'))
    parser.add_argument('--output-dir', type=Path, default=evaluation.ROOT / 'evaluation-results' / 'memory-abstention')
    parser.add_argument('--previous-results', type=Path, default=evaluation.ROOT / 'evaluation-results' / 'memory')
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--cases-per-dataset', type=int, default=12)
    args = parser.parse_args()
    if args.cases_per_dataset < 4 or args.cases_per_dataset % 4:
        parser.error('--cases-per-dataset must be a positive multiple of four')
    root = args.output_dir
    frozen = json.loads((root / 'frozen-policy.json').read_text(encoding='utf-8'))
    policy = frozen['policies']['rerank_calibrated']
    settings = (web_memory.RERANK_CANDIDATE_LIMIT, web_memory.MIN_RELEVANCE_SCORE, web_memory.MIN_CONFIRMED_COSINE)
    if settings != (policy['candidate_limit'], policy['minimum_relevance'], policy['minimum_cosine']):
        raise ValueError(f'Production settings do not match frozen policy: {settings}')
    scores = {evaluation.item_key(row): row for row in evaluation.read_rows(root / 'heldout-scores.jsonl')}
    if len(scores) != 1384:
        raise ValueError('Complete held-out replay before running the production probe')
    embedder = semantic_memory.configured_web_embedder()
    reranker = semantic_memory.configured_web_reranker()
    if embedder is None or reranker is None:
        raise RuntimeError('Both production model services must be configured')
    cases = {evaluation.item_key(row): row for row in evaluation.heldout_rows(args)}
    results = []
    rng = random.Random(evaluation.SEED)
    for dataset in evaluation.DATASETS:
        selected = []
        for positive in (True, False):
            pool = [key for key in sorted(scores) if key[0] == dataset and bool(scores[key]['positive_ids']) == positive]
            confirmed = [key for key in pool if evaluation.display(scores[key], policy)]
            abstained = [key for key in pool if not evaluation.display(scores[key], policy)]
            group_size = args.cases_per_dataset // 2
            confirmed_count = min(group_size // 2, len(confirmed))
            abstained_count = min(group_size - confirmed_count, len(abstained))
            selected.extend(rng.sample(confirmed, group_size - abstained_count))
            selected.extend(rng.sample(abstained, abstained_count))
        for key in selected:
            row = cases[key]
            query = web_memory.RetrievalQuery(deck_id=f'current-{row["qid"]}', source='replay', topic=row['query_topic'])
            records = [evaluation.previous.record(docid, row['candidate_topics'][docid])
                       for docid in reversed(row['candidate_ids'])]
            dense_timer, rerank_timer = TimedModel(embedder), TimedModel(reranker)
            started = time.perf_counter()
            status, actual = web_memory.recall_related(dense_timer, query, records, reranker=rerank_timer)
            elapsed = (time.perf_counter() - started) * 1000
            expected = evaluation.display(scores[key], policy)
            actual_ids = [hit['rescue_id'] for hit in actual]
            match = actual_ids == expected and status == ('confirmed' if expected else 'no_match')
            results.append({'dataset': dataset, 'qid': row['qid'], 'scenario': row['scenario'],
                            'candidate_count': len(records), 'reranked_count': rerank_timer.document_count or 0,
                            'status': status, 'expected_ids': expected, 'actual_ids': actual_ids, 'match': match,
                            'dense_ms': dense_timer.elapsed_ms, 'rerank_ms': rerank_timer.elapsed_ms,
                            'recall_related_ms': elapsed})
    result = {'cases': len(results), 'matches': sum(row['match'] for row in results),
              'production_elapsed_ms': evaluation.previous.score_distribution([row['recall_related_ms'] for row in results]),
              'production_rerank_ms': evaluation.previous.score_distribution(
                  [row['rerank_ms'] for row in results if row['rerank_ms'] is not None]),
              'production_reranked_counts': [row['reranked_count'] for row in results],
              'method': 'Seeded sample balanced across positive/control fixtures and, where possible, offline confirmed/abstained outcomes. Uses real current models, exact topics and production recall_related. It checks parity and latency, not population coverage.',
              'rows': results}
    evaluation.write_json(root / 'heldout-production-parity.json', result)
    print(json.dumps({key: value for key, value in result.items() if key != 'rows'}, indent=2))
    if result['matches'] != result['cases']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
