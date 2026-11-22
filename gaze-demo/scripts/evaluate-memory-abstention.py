#!/usr/bin/env python3
"""Fit a local Web memory abstention policy on official train splits, then replay frozen pools.

Start EmbeddingGemma and Qwen3-Reranker locally. Run the development-dense, development-rerank,
freeze, and heldout stages in that order. Each completed stage preserves its own artifact.
"""

import argparse
from collections import defaultdict
import csv
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import random
import statistics
import sys
import time
import unicodedata
from urllib.parse import urlsplit
import zipfile

import httpx

previous_path = Path(__file__).with_name('evaluate-web-memory.py')
previous_spec = importlib.util.spec_from_file_location('lockin_memory_benchmark', previous_path)
previous = importlib.util.module_from_spec(previous_spec)
sys.modules[previous_spec.name] = previous
previous_spec.loader.exec_module(previous)

from lockin.semantic_memory import configured_web_embedder, topic_text

ROOT = previous.BACKEND.parents[1]
DATASETS = ('scifact-test', 'miracl-zh-dev')
SEED = 2026111302
DEVELOPMENT_QUERIES_PER_DATASET = 150
TOP_K = (6, 8, 12)
LIMITS = {'scifact-test': .15, 'miracl-zh-dev': .10}
KNOWN_MODELS = {
    'dense': {'model': 'EmbeddingGemma 2 Q8_0', 'gguf_revision': '6ea3e3a309d12a4779cfda98b8c19800d2d5da71',
              'gguf_sha256': '2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135'},
    'reranker': {'model': 'Qwen3-Reranker-0.6B Q8_0', 'gguf_revision': 'a02f48bb4f057028298c21fa033da2b30d7742d5',
                 'gguf_sha256': '22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48'},
    'llama_cpp_release': 'b12110',
}
DENSE_THRESHOLDS = tuple(i / 100 for i in range(55, 101))
RERANK_THRESHOLDS = tuple(sorted({*(i / 100 for i in range(0, 101)),
                                  *(i / 1000 for i in range(991, 1000)), .9995, .9999}))
COSINE_FLOORS = (None, .65, .70, .75, .80)
MIRACL_TRAIN = {
    'miracl-zh-train-topics.tsv': (
        f'{previous.MIRACL}/topics/topics.miracl-v1.0-zh-train.tsv',
        '29b48dce378550889a87f27f81cba2ed5cae345052dd63d576e6ec7d7e933aeb',
    ),
    'miracl-zh-train-qrels.tsv': (
        f'{previous.MIRACL}/qrels/qrels.miracl-v1.0-zh-train.tsv',
        '0ad7a35722803798058be9e4a8690b74b255591539f51827d49a1849a8585ee9',
    ),
}


def write_json(path, value):
    partial = path.with_suffix('.part')
    partial.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    partial.replace(path)


def append_rows(path, rows):
    with path.open('a', encoding='utf-8') as stream:
        stream.writelines(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n' for row in rows)


def read_rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()] if path.is_file() else []


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def normalize(text):
    return ''.join(char for char in unicodedata.normalize('NFKC', text).casefold() if char.isalnum())


def read_scifact_train(cache, download):
    heldout = previous.load_scifact(cache, download)
    archive = previous.data_file(cache, 'scifact.zip', previous.SCIFACT, download, previous.SCIFACT_SHA)
    with zipfile.ZipFile(archive) as source:
        queries = {row['_id']: row['text'] for row in map(json.loads, source.open('scifact/queries.jsonl'))}
        qrels = defaultdict(dict)
        with source.open('scifact/qrels/train.tsv') as stream:
            for row in csv.DictReader(io.TextIOWrapper(stream, encoding='utf-8'), delimiter='\t'):
                qrels[row['query-id']][row['corpus-id']] = int(row['score'])
    if len(qrels) != 809:
        raise ValueError(f'Unexpected BEIR SciFact train query count: {len(qrels)}')
    return {qid: queries[qid] for qid in qrels}, qrels, heldout


def read_miracl_train(cache, download):
    heldout = previous.load_miracl(cache, download)
    topics, assessments = [previous.data_file(cache, name, url, download, sha)
                           for name, (url, sha) in MIRACL_TRAIN.items()]
    queries = dict(line.split('\t', 1) for line in topics.read_text(encoding='utf-8').splitlines())
    qrels = defaultdict(dict)
    for line in assessments.read_text(encoding='utf-8').splitlines():
        qid, _, docid, label = line.split()
        qrels[qid][docid] = int(label)
    if len(queries) != 1312 or sum(map(len, qrels.values())) != 13113 or qrels.keys() != queries.keys():
        raise ValueError('Unexpected MIRACL zh train split counts')
    return queries, qrels, heldout


def development_subset(queries, judgments, heldout):
    heldout_questions = {normalize(question) for question in heldout.queries.values()}
    heldout_positive = {docid for labels in heldout.qrels.values() for docid, score in labels.items() if score > 0}
    qids = sorted(queries)
    random.Random(f'{SEED}:{heldout.name}').shuffle(qids)
    selected = {}
    seen = set()
    removals = dict.fromkeys(('normalized_heldout_query', 'heldout_positive_document',
                              'no_positive_or_judged_negative', 'duplicate_train_query'), 0)
    removed_negative_doc_pairs = 0
    eligible = 0
    for qid in qids:
        key = normalize(queries[qid])
        labels = judgments[qid]
        if key in heldout_questions or qid in heldout.queries:
            removals['normalized_heldout_query'] += 1
            continue
        if any(docid in heldout_positive and label > 0 for docid, label in labels.items()):
            removals['heldout_positive_document'] += 1
            continue
        allowed = {docid: label for docid, label in labels.items() if docid not in heldout_positive}
        if not any(label > 0 for label in allowed.values()) or (heldout.language == 'zh' and 0 not in allowed.values()):
            removals['no_positive_or_judged_negative'] += 1
            continue
        if key in seen:
            removals['duplicate_train_query'] += 1
            continue
        seen.add(key)
        eligible += 1
        if len(selected) < DEVELOPMENT_QUERIES_PER_DATASET:
            selected[qid] = allowed
            removed_negative_doc_pairs += len(labels) - len(allowed)
    if len(selected) != DEVELOPMENT_QUERIES_PER_DATASET:
        raise ValueError(f'Insufficient development queries in {heldout.name}: {len(selected)}')
    info = {'heldout_dataset': heldout.name, 'train_query_count': len(queries), 'exclusions': removals,
            'eligible_train_queries': eligible, 'selected_query_ids': sorted(selected),
            'heldout_positive_documents_excluded': len(heldout_positive),
            'selected_judged_negative_pairs_removed_due_to_doc_overlap': removed_negative_doc_pairs}
    return selected, heldout_positive, info


def read_miracl_passages(cache, download, wanted):
    documents = {}
    keys = {docid.encode(): docid for docid in wanted}
    for shard, expected in enumerate(previous.MIRACL_CORPUS_SHAS):
        name = f'docs-{shard}.jsonl.gz'
        path = previous.data_file(cache, name, f'{previous.MIRACL_CORPUS}/{name}?download=true', download, expected)
        with previous.gzip.open(path, 'rb') as stream:
            for line in stream:
                docid = keys.get(line.split(b'"', 4)[3])
                if docid is not None:
                    row = json.loads(line)
                    if row['docid'] != docid:
                        raise ValueError(f'Mismatched MIRACL docid {docid}')
                    documents[docid] = previous.document_topic(row['title'], row['text'], '段落')
    if documents.keys() != wanted:
        raise ValueError(f'Missing {len(wanted - documents.keys())} MIRACL train passages')
    return documents


def load_dev(cache, download):
    groups = []
    for load in (read_scifact_train, read_miracl_train):
        queries, judgments, heldout = load(cache, download)
        selected, heldout_positive, info = development_subset(queries, judgments, heldout)
        if heldout.language == 'zh':
            wanted = {docid for labels in selected.values() for docid in labels}
            documents = read_miracl_passages(cache, download, wanted)
        else:
            documents = {docid: topic for docid, topic in heldout.documents.items() if docid not in heldout_positive}
        dataset = previous.Dataset(heldout.name.replace('test', 'train').replace('dev', 'train'), heldout.language,
                                   {qid: queries[qid] for qid in selected}, selected, documents, heldout.sources)
        groups.append((dataset, info))
    return groups


def item_key(row):
    return row['dataset'], row['qid'], row['scenario']


def collect_dense(args):
    out = args.output_dir / 'development-dense.jsonl'
    if out.exists():
        raise FileExistsError(f'Use a fresh output directory for a new development split: {out}')
    groups = load_dev(args.cache, args.download)
    write_json(args.output_dir / 'development-split.json', {
        'seed': SEED, 'sample_size_per_dataset': DEVELOPMENT_QUERIES_PER_DATASET,
        'normalized_overlap': 'NFKC, casefold, alphanumeric-only; no exact question ID or normalized query overlap',
        'document_overlap': 'No held-out labeled-positive docid appears in development candidates. Train positive overlap excludes the whole query. Train negative overlap drops that pair.',
        'dataset_sources': {'scifact_archive_sha256': previous.SCIFACT_SHA,
                            'miracl_train': MIRACL_TRAIN, 'miracl_corpus': previous.MIRACL_CORPUS,
                            'miracl_corpus_sha256': previous.MIRACL_CORPUS_SHAS},
        'development': [info for _, info in groups],
    })
    embedder = configured_web_embedder()
    if embedder is None:
        raise RuntimeError('EmbeddingGemma service required for development-dense')
    for dataset, info in groups:
        corpus_ranker = previous.BM25(dataset.documents, dataset.language) if dataset.language == 'en' else None
        for idx, qid in enumerate(sorted(dataset.queries), 1):
            query = previous.query_for(dataset, qid).topic.model_dump()
            rows = []
            for scenario, ids, positive, _ in previous.fixtures(dataset, qid, dataset.queries[qid], corpus_ranker):
                docs = [dataset.documents[docid] for docid in ids]
                started = time.perf_counter()
                scores = embedder.scores(query, docs)
                rows.append({'dataset': info['heldout_dataset'], 'qid': qid, 'scenario': scenario,
                             'candidate_ids': ids, 'positive_ids': sorted(positive),
                             'cosine_scores': dict(zip(ids, scores, strict=True)),
                             'dense_ms': (time.perf_counter() - started) * 1000,
                             'query_topic': query, 'candidate_topics': dict(zip(ids, docs, strict=True))})
            append_rows(out, rows)
            if idx % 25 == 0:
                print(f'{dataset.name}: scored {idx}/{len(dataset.queries)} train queries', flush=True)


def local_reranker(url):
    parts = urlsplit(url)
    if (parts.scheme != 'http' or parts.hostname not in {'127.0.0.1', 'localhost', '::1'}
            or parts.username or parts.password or parts.path != '/v1/rerank' or parts.query or parts.fragment):
        raise ValueError('A loopback http /v1/rerank URL is required')
    return httpx.Client(timeout=30, trust_env=False)


def reranker_metadata(client, url):
    response = client.get(url.removesuffix('/rerank') + '/models')
    response.raise_for_status()
    model = next(row for row in response.json()['data'] if row['id'] == 'lockin-reranker')
    return {'id': model['id'], 'owned_by': model.get('owned_by'), 'meta': model.get('meta')}


def rerank(client, url, query, documents):
    started = time.perf_counter()
    response = client.post(url, json={'model': 'lockin-reranker', 'query': topic_text(query),
                                      'documents': [topic_text(topic) for topic in documents], 'top_n': len(documents)})
    response.raise_for_status()
    payload = response.json()
    rows = sorted(payload['results'], key=lambda row: row['index'])
    if payload.get('model') != 'lockin-reranker' or [row['index'] for row in rows] != list(range(len(documents))):
        raise ValueError('Unexpected reranker model or result indices')
    scores = [row['relevance_score'] for row in rows]
    if any(type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1 for score in scores):
        raise ValueError('Reranker returned an invalid probability')
    return scores, (time.perf_counter() - started) * 1000


def collect_development_rerank(args):
    dense_path = args.output_dir / 'development-dense.jsonl'
    out = args.output_dir / 'development-scores.jsonl'
    done = {item_key(row) for row in read_rows(out)}
    expected = 4 * DEVELOPMENT_QUERIES_PER_DATASET
    pending = defaultdict(list)
    last_progress = time.monotonic()
    with local_reranker(args.rerank_url) as client:
        while len(done) < expected:
            content = dense_path.read_text(encoding='utf-8') if dense_path.is_file() else ''
            # A concurrent writer may still be writing the trailing JSONL row.
            raw = [json.loads(line) for line in content.split('\n')[:-1]]
            if len(raw) > expected or len({item_key(row) for row in raw}) != len(raw):
                raise RuntimeError('Unexpected or duplicate development-dense rows')
            if len(raw) < expected and not args.follow_dense:
                raise RuntimeError('Complete development-dense or use --follow-dense')
            pending.clear()
            for row in raw:
                pending[row['dataset'], row['qid']].append(row)
            for rows in pending.values():
                if len(rows) != 2 or all(item_key(row) in done for row in rows):
                    continue
                documents = {docid: topic for row in rows for docid, topic in row['candidate_topics'].items()}
                scores, elapsed = rerank(client, args.rerank_url, rows[0]['query_topic'], list(documents.values()))
                combined = dict(zip(documents, scores, strict=True))
                append_rows(out, [{**{key: value for key, value in row.items() if key not in ('query_topic', 'candidate_topics')},
                                   'relevance_scores': {docid: combined[docid] for docid in row['candidate_ids']},
                                   'rerank_batch_ms': elapsed, 'rerank_batch_documents': len(documents)}
                                  for row in rows if item_key(row) not in done])
                done.update(item_key(row) for row in rows)
                last_progress = time.monotonic()
                if len(done) % 50 == 0:
                    print(f'development reranker: {len(done) // 2}/{expected // 2} train queries', flush=True)
            if time.monotonic() - last_progress > 120:
                raise TimeoutError('Development-dense has made no progress for two minutes')
            if len(done) < expected:
                time.sleep(1)


def display(row, config):
    dense = row['cosine_scores']
    ranked = sorted(dense, key=dense.get, reverse=True)
    if config['mode'] == 'dense':
        return [docid for docid in ranked if dense[docid] >= config['minimum_cosine']][:3]
    floor = config['minimum_cosine']
    relevance = row['relevance_scores']
    top = ranked[:config['candidate_limit']]
    return sorted((docid for docid in top if (floor is None or dense[docid] >= floor)
                   and relevance[docid] >= config['minimum_relevance']),
                  key=lambda docid: (relevance[docid], dense[docid]), reverse=True)[:3]


def summarize(rows, config):
    groups = defaultdict(list)
    for row in rows:
        groups[row['dataset']].append(row)
    return {dataset: summarize_dataset(rows, config) for dataset, rows in groups.items()}


def summarize_dataset(rows, config):
    shown = [(row, display(row, config)) for row in rows]
    positives = [(row, ids) for row, ids in shown if row['positive_ids']]
    controls = [(row, ids) for row, ids in shown if not row['positive_ids']]
    count = sum(bool(set(row['positive_ids']).intersection(ids)) for row, ids in positives)
    returned_controls = sum(bool(ids) for _, ids in controls)
    metric_rows = [previous.ranking_metrics(ids, set(row['positive_ids'])) for row, ids in positives]
    all_shown = sum(len(ids) for _, ids in shown)
    positives_shown = sum(len(set(row['positive_ids']).intersection(ids)) for row, ids in positives)
    return {'positive_hits': count, 'positive_cases': len(positives), 'hit_at_3': count / len(positives),
            'recall_at_3': statistics.fmean(metrics['recall_at_3'] for metrics in metric_rows),
            'ndcg_at_3': statistics.fmean(metrics['ndcg_at_3'] for metrics in metric_rows),
            'control_returns': returned_controls, 'control_cases': len(controls),
            'control_return_rate': returned_controls / len(controls),
            'returned_passages': all_shown, 'labeled_positive_passages': positives_shown}


def evaluate_grid(rows, mode):
    # Precompute the best relevant and distractor outcomes of a thresholded ordered list.
    # The top-three hit remains possible exactly when the unthresholded eligible top three
    # contain a relevant result above threshold. Higher thresholds cannot promote lower rows.
    if mode == 'dense':
        grid = [(None, None, DENSE_THRESHOLDS)]
    else:
        grid = [(limit, floor, RERANK_THRESHOLDS) for limit in TOP_K for floor in COSINE_FLOORS]
    results = []
    for limit, floor, thresholds in grid:
        cases = defaultdict(lambda: ([], []))
        for row in rows:
            dense = row['cosine_scores']
            order = sorted(dense, key=dense.get, reverse=True)
            scores = dense
            if mode == 'rerank':
                scores = row['relevance_scores']
                order = sorted((docid for docid in order[:limit] if floor is None or dense[docid] >= floor),
                               key=lambda docid: (scores[docid], dense[docid]), reverse=True)
            positive, controls = cases[row['dataset']]
            if row['positive_ids']:
                positive.append(max((scores[docid] for docid in order[:3] if docid in row['positive_ids']), default=-1.))
            else:
                controls.append(scores[order[0]] if order else -1.)
        for threshold in thresholds:
            metrics = {dataset: (sum(score >= threshold for score in positive) / len(positive),
                                 sum(score >= threshold for score in controls) / len(controls))
                       for dataset, (positive, controls) in cases.items()}
            config = {'mode': mode, 'minimum_cosine': threshold} if mode == 'dense' else {
                'mode': mode, 'candidate_limit': limit, 'minimum_relevance': threshold, 'minimum_cosine': floor}
            results.append((config, metrics))
    return results


def select(results):
    eligible = [(config, metrics) for config, metrics in results
                if all(metrics[dataset][1] <= LIMITS[dataset] for dataset in DATASETS)]
    if not eligible:
        return None, 0
    def key(item):
        config, metrics = item
        rates = [metrics[dataset] for dataset in DATASETS]
        return (statistics.fmean(rate[0] for rate in rates), min(rate[0] for rate in rates),
                -statistics.fmean(rate[1] for rate in rates), -config.get('candidate_limit', 0),
                config.get('minimum_relevance', 0), config.get('minimum_cosine') or 0)
    return max(eligible, key=key)[0], len(eligible)


def freeze(args):
    out = args.output_dir / 'frozen-policy.json'
    if out.exists():
        raise FileExistsError(f'Refusing to overwrite frozen policy: {out}')
    source = args.output_dir / 'development-scores.jsonl'
    rows = read_rows(source)
    if len(rows) != 4 * DEVELOPMENT_QUERIES_PER_DATASET or len({item_key(row) for row in rows}) != len(rows):
        raise RuntimeError('Complete development-rerank before policy freeze')
    baseline = {'mode': 'dense', 'minimum_cosine': .60}
    dense, eligible_dense = select(evaluate_grid(rows, 'dense'))
    cross_encoder, eligible_rerank = select(evaluate_grid(rows, 'rerank'))
    if dense is None or cross_encoder is None:
        raise RuntimeError('No configuration met development control limits')
    choices = {'baseline': baseline, 'dense_calibrated': dense, 'rerank_calibrated': cross_encoder}
    with local_reranker(args.rerank_url) as client:
        metadata = reranker_metadata(client, args.rerank_url)
    report = {'selection': {'target_control_return_rate': LIMITS, 'objective': 'Maximize macro Hit@3 subject to both development caps',
                            'tie_break': 'Worst-language Hit@3, lower macro control return, smaller rerank cap, stricter thresholds',
                            'grid': {'dense_threshold': DENSE_THRESHOLDS, 'rerank_threshold': RERANK_THRESHOLDS,
                                     'cosine_floor': COSINE_FLOORS, 'rerank_candidate_limit': TOP_K},
                            'eligible_dense_policies': eligible_dense, 'eligible_reranker_policies': eligible_rerank},
              'development_source_sha256': sha256(source),
              'development_split_sha256': sha256(args.output_dir / 'development-split.json'),
              'script_sha256': sha256(Path(__file__)),
              'default_runtime_pins': KNOWN_MODELS,
              'rerank_model_alias': 'lockin-reranker', 'rerank_endpoint': args.rerank_url,
              'reranker_model_metadata': metadata,
              'policies': choices,
              'development_results': {name: summarize(rows, policy) for name, policy in choices.items()},
              'development_reranker_batch_ms': previous.score_distribution(
                  [row['rerank_batch_ms'] for row in rows if row['positive_ids']]),
              'development_only': True,
              'method': 'Official train split only for scoring and selection. Held-out official judgments used only to exclude normalized query matches and known held-out positive document IDs before scoring. Each query has a positive-present and a control fixture. Reranker scores the union once per query (usually 10 to 14 documents); no held-out score file is read in this stage.'}
    write_json(out, report)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


def heldout_rows(args):
    for loader in (previous.load_scifact, previous.load_miracl):
        dataset = loader(args.cache, args.download)
        path = args.previous_results / f'{dataset.name}-cases.csv'
        count = 0
        with path.open(newline='', encoding='utf-8') as stream:
            for frozen in csv.DictReader(stream):
                qid = frozen['qid']
                if frozen['status'] != 'embeddinggemma-2' or qid not in dataset.queries:
                    raise ValueError(f'Unexpected held-out fixture {qid}')
                ids = json.loads(frozen['candidate_ids_newest_first'])
                positive = json.loads(frozen['positive_ids'])
                scores = json.loads(frozen['embedding_scores'])
                if list(scores) != ids or not set(positive) <= set(ids):
                    raise ValueError(f'Invalid held-out fixture {qid}')
                yield {'dataset': dataset.name, 'qid': qid, 'scenario': frozen['scenario'],
                       'candidate_ids': ids, 'positive_ids': positive, 'cosine_scores': scores,
                       'dense_ms': float(frozen['embedding_ms']),
                       'query_topic': previous.query_for(dataset, qid).topic.model_dump(),
                       'candidate_topics': {docid: dataset.documents[docid] for docid in ids}}
                count += 1
        expected = {'scifact-test': 600, 'miracl-zh-dev': 784}[dataset.name]
        if count != expected:
            raise ValueError(f'{dataset.name}: expected {expected} frozen fixtures, got {count}')


def replay_heldout(args):
    frozen_path = args.output_dir / 'frozen-policy.json'
    frozen = json.loads(frozen_path.read_text(encoding='utf-8'))
    if frozen['development_source_sha256'] != sha256(args.output_dir / 'development-scores.jsonl'):
        raise ValueError('Frozen policy development score digest mismatch')
    policy = frozen['policies']['rerank_calibrated']
    limit = policy['candidate_limit']
    out = args.output_dir / 'heldout-scores.jsonl'
    inputs = {dataset: sha256(args.previous_results / f'{dataset}-cases.csv') for dataset in DATASETS}
    manifest = {'frozen_policy_sha256': sha256(frozen_path), 'sources_sha256': inputs,
                'rerank_endpoint': args.rerank_url, 'script_sha256': sha256(Path(__file__))}
    manifest_path = args.output_dir / 'heldout-replay-manifest.json'
    if manifest_path.is_file() and json.loads(manifest_path.read_text()) != manifest:
        raise ValueError('Held-out replay already uses a different policy, source or endpoint')
    write_json(manifest_path, manifest)
    done = {item_key(row) for row in read_rows(out)}
    with local_reranker(args.rerank_url) as client:
        if reranker_metadata(client, args.rerank_url) != frozen['reranker_model_metadata']:
            raise ValueError('Local reranker metadata no longer matches frozen calibration')
        for index, row in enumerate(heldout_rows(args), 1):
            if item_key(row) in done:
                continue
            ranked = sorted(row['cosine_scores'], key=row['cosine_scores'].get, reverse=True)[:limit]
            topics = [row['candidate_topics'][docid] for docid in ranked]
            scores, elapsed = rerank(client, args.rerank_url, row['query_topic'], topics)
            append_rows(out, [{**{key: value for key, value in row.items() if key not in ('query_topic', 'candidate_topics')},
                               'relevance_scores': dict(zip(ranked, scores, strict=True)), 'rerank_ms': elapsed}])
            if index % 100 == 0:
                print(f'held-out reranker: {index}/1384 cases', flush=True)
    rows = read_rows(out)
    if len(rows) != 1384 or len({item_key(row) for row in rows}) != len(rows):
        raise ValueError('Held-out score file does not contain 1384 unique cases')
    report = {'replay': manifest, 'policies': frozen['policies'],
              'heldout_results': {name: summarize(rows, config) for name, config in frozen['policies'].items()},
              'latency': {dataset: {
                  'dense_adapter_previous_run_ms': previous.score_distribution(
                      [row['dense_ms'] for row in rows if row['dataset'] == dataset]),
                  'rerank_actual_top_k_current_run_ms': previous.score_distribution(
                      [row['rerank_ms'] for row in rows if row['dataset'] == dataset]),
                  'rerank_requests_above_800ms': sum(row['rerank_ms'] > 800 for row in rows if row['dataset'] == dataset),
                  } for dataset in DATASETS},
              'method': 'Fixed existing candidate order and cosine scores. Reranker receives the frozen cosine shortlist for each fixture. SciFact no-hit control uses unlabeled candidates and is a proxy. MIRACL control candidates have explicit zero labels.'}
    write_json(args.output_dir / 'heldout-summary.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=('development-dense', 'development-rerank', 'freeze', 'heldout'))
    parser.add_argument('--cache', type=Path, default=Path('/tmp/lockin-memory-benchmark-data'))
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'evaluation-results' / 'memory-abstention')
    parser.add_argument('--previous-results', type=Path, default=ROOT / 'evaluation-results' / 'memory')
    parser.add_argument('--rerank-url', default='http://127.0.0.1:8004/v1/rerank')
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--follow-dense', action='store_true', help='Rerank complete queries as the dense stage writes them')
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    stages = {'development-dense': collect_dense, 'development-rerank': collect_development_rerank,
              'freeze': freeze, 'heldout': replay_heldout}
    stages[args.stage](args)


if __name__ == '__main__':
    main()
