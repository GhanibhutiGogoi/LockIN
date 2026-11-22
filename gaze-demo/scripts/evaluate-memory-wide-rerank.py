#!/usr/bin/env python3
"""Calibrate wider local reranking on the saved train rows, then replay frozen evaluation pools."""

import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path
import sys
import time

import numpy as np

source = Path(__file__).with_name('evaluate-memory-abstention.py')
spec = importlib.util.spec_from_file_location('memory_abstention', source)
old = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = old
spec.loader.exec_module(old)

CAPS = (8, 10, 12)
FLOORS = (.60, .64, .68, .70, .72, .74, .76, .78)
BANDS = (.72, .74, .76, .78, .80, .82, .84)
THRESHOLDS = np.asarray(sorted({0, *(n / 100 for n in range(60, 100)), *(n / 1000 for n in range(991, 1000)),
                                *(n / 10000 for n in range(9990, 10000)), .99995, .99999, 1}))
LIMITS = {'scifact-test': .15, 'miracl-zh-dev': .05}
EXPECTED = {'scifact-test': (300, 300), 'miracl-zh-dev': (393, 391)}


def candidates(row, policy):
    floor = policy['minimum_cosine']
    return sorted((doc for doc, score in row['cosine_scores'].items() if score >= floor),
                  key=row['cosine_scores'].get, reverse=True)[:policy['candidate_limit']]


def displayed(row, policy):
    dense, relevance = row['cosine_scores'], row['relevance_scores']
    ids = candidates(row, policy)
    if not ids:
        return []
    upper = policy['upper_cosine_band']
    eligible = [doc for doc in ids if relevance[doc] >= (policy['minimum_relevance']
                if upper is None or dense[doc] >= upper else policy['low_band_minimum_relevance'])]
    return sorted(eligible, key=lambda doc: (relevance[doc], dense[doc]), reverse=True)[:3]


def metrics(rows, policy):
    outcomes = [(row, displayed(row, policy)) for row in rows]
    pos = [(row, ids) for row, ids in outcomes if row['positive_ids']]
    ctrl = [(row, ids) for row, ids in outcomes if not row['positive_ids']]
    hits = sum(bool(set(row['positive_ids']) & set(ids)) for row, ids in pos)
    returns = sum(bool(ids) for _, ids in ctrl)
    ranking = [old.previous.ranking_metrics(ids, set(row['positive_ids'])) for row, ids in pos]
    widths = [len(candidates(row, policy)) for row in rows]
    return {'positive_hits': hits, 'positive_cases': len(pos), 'hit_at_3': hits / len(pos),
            'recall_at_3': sum(row['recall_at_3'] for row in ranking) / len(pos),
            'ndcg_at_3': sum(row['ndcg_at_3'] for row in ranking) / len(pos),
            'control_returns': returns, 'control_cases': len(ctrl), 'control_return_rate': returns / len(ctrl),
            'rerank_called': sum(width > 0 for width in widths), 'rerank_call_rate': sum(width > 0 for width in widths) / len(widths),
            'rerank_shortlist_mean': sum(widths) / len(widths), 'rerank_shortlist_p95': old.previous.p95(widths),
            'returned_passages': sum(len(ids) for _, ids in outcomes),
            'labeled_positive_passages': sum(len(set(row['positive_ids']) & set(ids)) for row, ids in pos)}


def grid_arrays(rows, cap, floor):
    relevance = np.full((len(rows), cap), -1.)
    cosine = np.full_like(relevance, -1.)
    positive = np.zeros_like(relevance, dtype=bool)
    for index, row in enumerate(rows):
        ids = candidates(row, {'candidate_limit': cap, 'minimum_cosine': floor})
        dense, scores = row['cosine_scores'], row['relevance_scores']
        ids.sort(key=lambda doc: (scores[doc], dense[doc]), reverse=True)
        for rank, doc in enumerate(ids):
            relevance[index, rank] = scores[doc]
            cosine[index, rank] = dense[doc]
            positive[index, rank] = doc in row['positive_ids']
    return relevance, cosine, positive


def band_grid(arrays, control_mask, band):
    relevance, cosine, positive = arrays
    # No real entry has a negative score. Padding cannot satisfy any searched threshold.
    high = cosine >= band if band is not None else relevance >= 0
    low = ~high & (relevance >= 0)
    high_earlier = high.cumsum(axis=1) - high
    low_accepted = low[None, :, :] & (relevance[None, :, :] >= THRESHOLDS[:, None, None])
    low_earlier = low_accepted.cumsum(axis=2) - low_accepted
    # For low-band positive hits, all higher-scoring docs are accepted because
    # the high-band relevance cutoff is never stricter than the low-band cutoff.
    low_hit = (low_accepted[:, :, :3] & positive[None, :, :3]).any(axis=2)
    # For high-band positives, only earlier low-band candidates depend on the stricter cutoff.
    viable_high = high[None, :, :] & positive[None, :, :] & (high_earlier[None, :, :] + low_earlier < 3)
    max_high_pos = np.where(viable_high, relevance[None, :, :], -1).max(axis=2)
    max_high_neg = np.where(high, relevance, -1).max(axis=1)
    hits = ((max_high_pos[:, None, :] >= THRESHOLDS[None, :, None]) | low_hit[:, None, :])[:, :, ~control_mask].sum(axis=2)
    false = ((max_high_neg[None, None, :] >= THRESHOLDS[None, :, None]) |
             low_accepted.any(axis=2)[:, None, :])[:, :, control_mask].sum(axis=2)
    return hits, false


def compare(rows):
    grouped = {name: [r for r in rows if r['dataset'] == name] for name in old.DATASETS}
    masks = {name: np.array([not r['positive_ids'] for r in group]) for name, group in grouped.items()}
    good = np.tri(len(THRESHOLDS), dtype=bool)
    best = {}
    for cap in CAPS:
        for floor in FLOORS:
            arrays = {name: grid_arrays(group, cap, floor) for name, group in grouped.items()}
            for band in (None, *(gate for gate in BANDS if gate > floor)):
                data = {name: band_grid(arrays[name], masks[name], band) for name in old.DATASETS}
                allowable = good.copy() if band is not None else np.eye(len(THRESHOLDS), dtype=bool)
                for name in old.DATASETS:
                    allowable &= data[name][1] <= LIMITS[name] * int(masks[name].sum())
                for low_i, high_i in np.argwhere(allowable):
                    zh_hits, zh_false = (int(table[low_i, high_i]) for table in data['miracl-zh-dev'])
                    en_hits, en_false = (int(table[low_i, high_i]) for table in data['scifact-test'])
                    policy = {'candidate_limit': cap, 'minimum_cosine': floor, 'upper_cosine_band': band,
                              'minimum_relevance': float(THRESHOLDS[high_i]),
                              'low_band_minimum_relevance': float(THRESHOLDS[low_i]) if band is not None else None}
                    # Prefer the simpler single gate when it gives identical quality and then smaller K.
                    key = (zh_hits, en_hits, -zh_false, -en_false, band is None, -cap, floor,
                           float(THRESHOLDS[high_i]), float(THRESHOLDS[low_i]))
                    for label in ('overall', 'single_gate' if band is None else 'two_bands', f'k{cap}'):
                        if label not in best or key > best[label][0]:
                            best[label] = key, policy
    return {label: {'policy': policy, 'metrics': {name: metrics(group, policy) for name, group in grouped.items()}}
            for label, (_, policy) in best.items()}


def freeze(args):
    path = args.output_dir / 'frozen-policy.json'
    if path.exists():
        raise FileExistsError(f'Frozen policy already exists: {path}')
    previous_frozen = args.previous_abstention / 'frozen-policy.json'
    manifest = json.loads(previous_frozen.read_text())
    dev_path = args.previous_abstention / 'development-scores.jsonl'
    if old.sha256(dev_path) != manifest['development_source_sha256']:
        raise ValueError('Development score digest mismatch')
    rows = old.read_rows(dev_path)
    if len(rows) != 600 or len({old.item_key(row) for row in rows}) != 600:
        raise ValueError('Expected 600 unique independent train cases')
    comparison = compare(rows)
    selected = comparison['overall']['policy']
    previous_policy = {**manifest['policies']['rerank_calibrated'], 'upper_cosine_band': None,
                       'low_band_minimum_relevance': None}
    for name, details in comparison['overall']['metrics'].items():
        if details['control_return_rate'] > LIMITS[name]:
            raise ValueError(f'Optimized search does not match explicit ranking for {name}')
    report = {'policy': selected, 'previous_policy': previous_policy, 'development_only': True,
              'prior_frozen_policy_sha256': old.sha256(previous_frozen),
              'development_scores_sha256': old.sha256(dev_path), 'script_sha256': old.sha256(Path(__file__)),
              'model_metadata': manifest['reranker_model_metadata'],
              'policy_grid': {'candidate_limits': CAPS, 'cosine_floors': FLOORS, 'upper_cosine_bands': BANDS,
                              'relevance_thresholds': THRESHOLDS.tolist()},
              'development_constraints': LIMITS,
              'selection_order': ['maximize MIRACL zh Hit@3', 'maximize SciFact Hit@3',
                                  'minimize MIRACL zh false recalls', 'minimize SciFact proxy returns',
                                  'prefer single threshold', 'prefer smaller shortlist', 'prefer stricter gates'],
              'development_comparisons': comparison,
              'previous_development': {name: metrics([row for row in rows if row['dataset'] == name], previous_policy)
                                       for name in old.DATASETS},
              'notes': 'Only the previously saved development-score rows enter search. The previous evaluation pools are already known; they serve as a frozen comparison. The same score rule applies in both languages.'}
    old.write_json(path, report)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


def replay(args):
    frozen_path = args.output_dir / 'frozen-policy.json'
    frozen = json.loads(frozen_path.read_text())
    if old.sha256(args.previous_abstention / 'development-scores.jsonl') != frozen['development_scores_sha256']:
        raise ValueError('Development data no longer match the frozen policy')
    policy = frozen['policy']
    baseline = frozen['previous_policy']
    manifest = {'frozen_policy_sha256': old.sha256(frozen_path), 'script_sha256': old.sha256(Path(__file__)),
                'rerank_endpoint': args.rerank_url,
                'frozen_candidate_pool_sha256': {name: old.sha256(args.previous_results / f'{name}-cases.csv')
                                                  for name in old.DATASETS},
                'prior_replay_scores_sha256': old.sha256(args.previous_abstention / 'heldout-scores.jsonl')}
    manifest_path = args.output_dir / 'replay-manifest.json'
    if manifest_path.is_file() and json.loads(manifest_path.read_text()) != manifest:
        raise ValueError('Replay resume inputs do not match the manifest')
    old.write_json(manifest_path, manifest)
    previous_replay = {old.item_key(row): row for row in old.read_rows(args.previous_abstention / 'heldout-scores.jsonl')}
    path = args.output_dir / 'heldout-scores.jsonl'
    done = {old.item_key(row) for row in old.read_rows(path)}
    with old.local_reranker(args.rerank_url) as client:
        if old.reranker_metadata(client, args.rerank_url) != frozen['model_metadata']:
            raise ValueError('Reranker runtime differs from frozen development metadata')
        for index, row in enumerate(old.heldout_rows(args), 1):
            key = old.item_key(row)
            if key in done:
                continue
            earlier = previous_replay[key]
            if any(earlier[field] != row[field] for field in ('candidate_ids', 'positive_ids', 'cosine_scores')):
                raise ValueError(f'Mismatched frozen candidate pool for {key}')
            shortlist = candidates(row, policy)
            scores, elapsed = (old.rerank(client, args.rerank_url, row['query_topic'],
                                           [row['candidate_topics'][doc] for doc in shortlist]) if shortlist else ([], 0.))
            stored = {key: value for key, value in row.items() if key not in ('query_topic', 'candidate_topics')}
            stored['relevance_scores'] = dict(zip(shortlist, scores, strict=True))
            stored['rerank_ms'] = elapsed
            stored['previous_relevance_scores'] = earlier['relevance_scores']
            old.append_rows(path, [stored])
            if index % 100 == 0:
                print(f'wide rerank: {index}/1384 frozen cases', flush=True)
    rows = old.read_rows(path)
    if len(rows) != 1384 or len({old.item_key(row) for row in rows}) != 1384:
        raise ValueError('Expected 1,384 unique frozen cases')
    results = {}
    for name, expected in EXPECTED.items():
        group = [row for row in rows if row['dataset'] == name]
        fresh = metrics(group, policy)
        if (fresh['positive_cases'], fresh['control_cases']) != expected:
            raise ValueError(f'Unexpected positive/control counts for {name}')
        previous = metrics([{**row, 'relevance_scores': row['previous_relevance_scores']} for row in group], baseline)
        # A latency failure is counted separately from an explicit rejection.
        on_time = [row for row in group if row['rerank_ms'] <= args.rerank_budget and row['dense_ms'] + row['rerank_ms'] <= 1300]
        scores_diff = [abs(score - row['previous_relevance_scores'][doc]) for row in group
                       for doc, score in row['relevance_scores'].items() if doc in row['previous_relevance_scores']]
        causes = Counter()
        for row in group:
            positives = set(row['positive_ids'])
            if not positives or positives & set(displayed(row, policy)):
                continue
            eligible = positives & row['relevance_scores'].keys()
            causes['positive_missing_from_shortlist' if not eligible else 'positive_rejected_or_below_display_top3'] += 1
        results[name] = {'before': previous, 'after': fresh, 'new_miss_causes': dict(causes),
                         'reranker_ms_when_called': old.previous.score_distribution([row['rerank_ms'] for row in group if row['relevance_scores']]),
                         'combined_local_stages_ms': old.previous.score_distribution([row['dense_ms'] + row['rerank_ms'] for row in group]),
                         'reranker_budget_ms': args.rerank_budget,
                         'above_reranker_budget': sum(row['rerank_ms'] > args.rerank_budget for row in group),
                         'above_1300ms_combined': sum(row['dense_ms'] + row['rerank_ms'] > 1300 for row in group),
                         'unavailable_if_using_budgets': len(group) - len(on_time),
                         'overlapping_qwen_score_pairs': len(scores_diff),
                         'max_absolute_qwen_score_change': max(scores_diff, default=None)}
    report = {'frozen': manifest, 'policy': policy, 'comparison': results,
              'method': 'Frozen prior SciFact test and MIRACL zh dev candidates/order/EmbeddingGemma cosine. Each new production-style shortlist was scored by the local Qwen model. Old policy uses the earlier scores. Deadline estimate combines sequential model timings from separate runs, excluding browser/route overhead. SciFact no-hit is an unlabeled proxy; MIRACL no-hit uses only explicitly judged negatives.'}
    old.write_json(args.output_dir / 'heldout-summary.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=('freeze', 'replay'))
    parser.add_argument('--output-dir', type=Path, default=old.ROOT / 'evaluation-results' / 'memory-wide-rerank')
    parser.add_argument('--previous-abstention', type=Path, default=old.ROOT / 'evaluation-results' / 'memory-abstention')
    parser.add_argument('--previous-results', type=Path, default=old.ROOT / 'evaluation-results' / 'memory')
    parser.add_argument('--cache', type=Path, default=Path('/tmp/lockin-memory-benchmark-data'))
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--rerank-url', default='http://127.0.0.1:8004/v1/rerank')
    parser.add_argument('--rerank-budget', type=float, default=800.)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    {'freeze': freeze, 'replay': replay}[args.stage](args)


if __name__ == '__main__':
    main()
