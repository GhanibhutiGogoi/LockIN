#!/usr/bin/env python3
"""Freeze a score-agreement gate on train data, then compare saved local rerank output."""

import argparse
import importlib.util
import json
import math
from pathlib import Path
import sys

import numpy as np

source = Path(__file__).with_name('evaluate-memory-wide-rerank.py')
spec = importlib.util.spec_from_file_location('memory_wide_rerank', source)
wide = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = wide
spec.loader.exec_module(wide)
old = wide.old
THRESHOLDS = np.arange(-2, 13.01, .05).round(2)
COSINE_WEIGHTS = (0, 5, 10, 15, 20, 25, 30, 40, 60, 80, 100)
GAP_WEIGHTS = (0, .15, .3, .6)
EPSILON = 1e-6
CENTER = .75
GAP_CAP = 5


def logit(value):
    value = min(1 - EPSILON, max(EPSILON, value))
    return math.log(value / (1 - value))


def display(row, policy):
    dense = row['cosine_scores']
    relevance = row['relevance_scores']
    shortlist = wide.candidates(row, policy)
    ranked = sorted(shortlist, key=lambda doc: (relevance[doc], dense[doc]), reverse=True)
    logits = {doc: logit(relevance[doc]) for doc in ranked}
    gap = min(GAP_CAP, logits[ranked[0]] - logits[ranked[1]]) if len(ranked) >= 2 else 0
    scores = {doc: logits[doc] + policy['cosine_weight'] * (dense[doc] - CENTER) + policy['gap_weight'] * gap for doc in ranked}
    if policy['rank_by'] == 'weighted':
        ranked.sort(key=scores.get, reverse=True)
    return [doc for doc in ranked if scores[doc] >= policy['minimum_weighted_score']][:3]


def optimize(rows):
    grouped = {name: [row for row in rows if row['dataset'] == name] for name in old.DATASETS}
    controls = {name: np.array([not row['positive_ids'] for row in group]) for name, group in grouped.items()}
    best = None
    for k in wide.CAPS:
        for floor in wide.FLOORS:
            inputs = {}
            for name, group in grouped.items():
                relevance, dense, positive = wide.grid_arrays(group, k, floor)
                bounded = np.clip(relevance, EPSILON, 1 - EPSILON)
                logits = np.log(bounded / (1 - bounded))
                gap = np.where(relevance[:, 1] >= 0, np.clip(logits[:, 0] - logits[:, 1], 0, GAP_CAP), 0)
                inputs[name] = relevance >= 0, dense, positive, logits, gap
            for cosine_weight in COSINE_WEIGHTS:
                for gap_weight in GAP_WEIGHTS:
                    for rank_by in ('qwen', 'weighted'):
                        counts = {}
                        for name, (real, dense, positive, logits, gap) in inputs.items():
                            control = controls[name]
                            scores = np.where(real, logits + cosine_weight * (dense - CENTER) + gap_weight * gap[:, None], -np.inf)
                            if rank_by == 'weighted':
                                order = np.argsort(-scores, axis=1, kind='stable')
                                scores = np.take_along_axis(scores, order, axis=1)
                                positive = np.take_along_axis(positive, order, axis=1)
                            accepted = scores[None, :, :] >= THRESHOLDS[:, None, None]
                            eligible = accepted & (accepted.cumsum(axis=2) <= 3)
                            hits = (eligible[:, ~control, :] & positive[None, ~control, :]).any(axis=2).sum(axis=1)
                            false = accepted[:, control, :].any(axis=2).sum(axis=1)
                            counts[name] = hits, false
                        en, en_false = counts['scifact-test']
                        zh, zh_false = counts['miracl-zh-dev']
                        feasible = (en_false <= wide.LIMITS['scifact-test'] * controls['scifact-test'].sum()) & (
                            zh_false <= wide.LIMITS['miracl-zh-dev'] * controls['miracl-zh-dev'].sum())
                        for index in np.flatnonzero(feasible):
                            key = (zh[index], en[index], -zh_false[index], -en_false[index], -k, floor,
                                   -gap_weight, -cosine_weight, rank_by == 'qwen')
                            if best is None or key > best[0]:
                                best = key, {'candidate_limit': k, 'minimum_cosine': floor,
                                             'minimum_weighted_score': float(THRESHOLDS[index]), 'cosine_weight': cosine_weight,
                                             'gap_weight': gap_weight, 'rank_by': rank_by}
    if best is None:
        raise ValueError('No feasible weighted candidate')
    return best[1], tuple(int(item) for item in best[0][:4])


def evaluate(group, policy, choose):
    decisions = [(row, choose(row, policy)) for row in group]
    positive = [(row, ids) for row, ids in decisions if row['positive_ids']]
    controls = [ids for row, ids in decisions if not row['positive_ids']]
    score = [old.previous.ranking_metrics(ids, set(row['positive_ids'])) for row, ids in positive]
    widths = [len(wide.candidates(row, policy)) for row in group]
    hits = sum(row['hit_at_3'] for row in score)
    returns = sum(bool(ids) for ids in controls)
    return {'positive_hits': hits, 'positive_cases': len(positive), 'hit_at_3': hits / len(positive),
            'recall_at_3': sum(row['recall_at_3'] for row in score) / len(positive),
            'ndcg_at_3': sum(row['ndcg_at_3'] for row in score) / len(positive),
            'control_returns': returns, 'control_cases': len(controls), 'control_return_rate': returns / len(controls),
            'rerank_called': sum(width > 0 for width in widths), 'rerank_call_rate': sum(width > 0 for width in widths) / len(group),
            'rerank_shortlist_mean': sum(widths) / len(group), 'rerank_shortlist_p95': old.previous.p95(widths)}


def freeze(args):
    path = args.output_dir / 'weighted-policy.json'
    if path.exists():
        raise FileExistsError(f'Policy already frozen at {path}')
    dev_file = args.previous_abstention / 'development-scores.jsonl'
    reference_path = args.output_dir / 'frozen-policy.json'
    reference = json.loads(reference_path.read_text())
    if old.sha256(dev_file) != reference['development_scores_sha256']:
        raise ValueError('Development scores do not match prior frozen policy')
    rows = old.read_rows(dev_file)
    if len(rows) != 600 or len({old.item_key(row) for row in rows}) != 600:
        raise ValueError('Expected 600 unique development rows')
    policy, counts = optimize(rows)
    result = {name: evaluate([row for row in rows if row['dataset'] == name], policy, display) for name in old.DATASETS}
    zh, en = result['miracl-zh-dev'], result['scifact-test']
    if counts != (zh['positive_hits'], en['positive_hits'], -zh['control_returns'], -en['control_returns']):
        raise ValueError('Search counts differ from explicit decision replay')
    for name, metrics in result.items():
        if metrics['control_return_rate'] > wide.LIMITS[name]:
            raise ValueError(f'Development policy violates control constraint: {name}')
    report = {'policy': policy, 'development': result, 'development_scores_sha256': old.sha256(dev_file),
              'source_sha256': old.sha256(Path(__file__)), 'reference_policy_sha256': old.sha256(reference_path),
              'parameters': {'epsilon': EPSILON, 'cosine_center': CENTER, 'gap_cap': GAP_CAP, 'singleton_gap': 0},
              'search': {'candidate_limits': wide.CAPS, 'cosine_floors': wide.FLOORS, 'cosine_weights': COSINE_WEIGHTS,
                         'gap_weights': GAP_WEIGHTS, 'rank_by': ['qwen', 'weighted'], 'weighted_thresholds': THRESHOLDS.tolist()},
              'control_caps': wide.LIMITS,
              'method': 'Development-only train score search. Maximize Chinese Hit@3, then English Hit@3, then lower control return rates. Prefer smaller K, higher cosine floor, smaller weights and Qwen ordering on ties. No newly replayed evaluation outcomes are read by freeze.'}
    old.write_json(path, report)
    print(json.dumps(report, indent=2), flush=True)


def report(args):
    path = args.output_dir / 'weighted-policy.json'
    frozen = json.loads(path.read_text())
    if frozen['source_sha256'] != old.sha256(Path(__file__)) or frozen['reference_policy_sha256'] != old.sha256(args.output_dir / 'frozen-policy.json'):
        raise ValueError('Source or reference policy changed since freeze')
    policy = frozen['policy']
    replay_path = args.output_dir / 'heldout-scores.jsonl'
    rows = old.read_rows(replay_path)
    if len(rows) != 1384 or len({old.item_key(row) for row in rows}) != 1384:
        raise ValueError('Complete the frozen 1,384-case replay before comparison')
    reference = json.loads((args.output_dir / 'heldout-summary.json').read_text())
    if any(list(row['relevance_scores']) != wide.candidates(row, policy) for row in rows):
        raise ValueError('Frozen score gate needs a different shortlist; rerun the matching model requests')
    results = {}
    for name, group in reference['comparison'].items():
        subset = [row for row in rows if row['dataset'] == name]
        counts = evaluate(subset, policy, display)
        if (counts['positive_cases'], counts['control_cases']) != wide.EXPECTED[name]:
            raise ValueError('Mismatched evaluated fixture counts')
        misses = {'outside_shortlist': 0, 'below_weighted_gate_or_display_rank': 0}
        for row in subset:
            relevant = set(row['positive_ids'])
            if relevant and not relevant.intersection(display(row, policy)):
                key = 'below_weighted_gate_or_display_rank' if relevant.intersection(row['relevance_scores']) else 'outside_shortlist'
                misses[key] += 1
        unavailable = [row for row in subset if row['dense_ms'] > 950 or row['rerank_ms'] > 1000 or row['dense_ms'] + row['rerank_ms'] > 2000]
        lost_hits = sum(bool(set(row['positive_ids']).intersection(display(row, policy))) for row in unavailable)
        unavailable_controls = sum(not row['positive_ids'] for row in unavailable)
        results[name] = {'before': group['before'], 'two_band_comparator': group['after'], 'weighted_after': counts,
                         'positive_miss_causes': misses, 'reranker_ms_when_called': group['reranker_ms_when_called'],
                         'combined_local_stages_ms': group['combined_local_stages_ms'],
                         'overlapping_qwen_score_pairs': group['overlapping_qwen_score_pairs'],
                         'max_absolute_qwen_score_change': group['max_absolute_qwen_score_change'],
                         'unavailable_under_budgets': len(unavailable), 'unavailable_controls': unavailable_controls,
                         'hits_lost_if_unavailable': lost_hits}
    output = {'policy_sha256': old.sha256(path), 'replay_scores_sha256': old.sha256(replay_path),
              'policy': policy, 'comparison': results,
              'budgets_ms': {'embedding': 950, 'reranker': 1000, 'web_fetch': 2000, 'web_engine': 2200},
              'scope': 'Previously evaluated SciFact test/MIRACL zh dev used as a frozen comparison. All selected cosine shortlists were reranked on the local model; timings add prior dense adapter and current Qwen measurements, without browser overhead.'}
    old.write_json(args.output_dir / 'weighted-summary.json', output)
    print(json.dumps(output, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=('freeze', 'report'))
    parser.add_argument('--output-dir', type=Path, default=old.ROOT / 'evaluation-results' / 'memory-wide-rerank')
    parser.add_argument('--previous-abstention', type=Path, default=old.ROOT / 'evaluation-results' / 'memory-abstention')
    args = parser.parse_args()
    {'freeze': freeze, 'report': report}[args.stage](args)


if __name__ == '__main__':
    main()
