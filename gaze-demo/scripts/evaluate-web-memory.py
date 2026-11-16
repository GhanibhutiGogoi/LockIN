#!/usr/bin/env python3
"""Replay BEIR SciFact test and MIRACL zh dev through the Web recall function.

Start the local server with gaze-demo/scripts/start-embeddinggemma.sh, then run
  gaze-demo/.venv/bin/python gaze-demo/scripts/evaluate-web-memory.py --download
The flag downloads public sources (~735 MB). Use --pilot 8 for a small run.
No application database is opened. Caches and reports use separate locations.
"""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import csv
from dataclasses import dataclass
import gzip
import hashlib
import heapq
import io
import json
import math
from pathlib import Path
import platform
import random
import re
import statistics
import subprocess
import sys
import time
import unicodedata
import zipfile

import httpx

BACKEND = Path(__file__).resolve().parents[1] / 'backend'
sys.path.insert(0, str(BACKEND))

from lockin.semantic_memory import configured_web_embedder, topic_text
from lockin.web_memory import (
    MAX_RECALL_CANDIDATES,
    MAX_RELATED_MEMORIES,
    MIN_TOPIC_SIMILARITY,
    RetrievalQuery,
    Topic,
    recall_related_baseline as recall_related,
)

SEED = 20261113
SCIFACT = 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip'
SCIFACT_SHA = '536e14446a0ba56ed1398ab1055f39fe852686ecad24a6306c80c490fa8e0165'
MIRACL = 'https://huggingface.co/datasets/miracl/miracl/resolve/5be20db9509754dadad47689368639fcec739c00/miracl-v1.0-zh'
MIRACL_CORPUS = 'https://huggingface.co/datasets/miracl/miracl-corpus/resolve/d921ec7e349ce0d28daf30b2da9da5ee698bef0d/miracl-corpus-v1.0-zh'
MIRACL_CORPUS_SHAS = (
    'b036ba6a927a4598b314de55a1de200d2a619b28b4327f49e97ec4233d324827',
    'd6db9e242bdebeac76f586c0ec9a6301a9ec4a52c64c71949945ba5983467506',
    '29f1b1e3bec59770367be71d1698a7afaf7efb8006d168d40a2815025c8d1b43',
    '9cfc76c7f9ec9edc12d351913ba0f33a96d496a7449b46a6488f77668acf178d',
    'd47cef57928c3452d95cc8499dea37ce6e589808a9315ab2cf9809a23fe349b5',
    '17e1d4bf36d3992ccf5c519522ed1dcf896cb72772907e973bfcf1b2dd993e28',
    '4b3cdc7aeefc01ca4c2f55ba16ac80d773393068b78d4f971fc3c25c6fb9a859',
    'e7541af8c2fb7a96cff271e06047f0b4f00372b205735fabeed6217f9a7bb334',
    'f456671170b8286ede8f81feb9d365750af5027465399f63445a441fc96c41a7',
    '6c8193e14aafd93fb1ee57eac4f1171a44a0c975ebdefd6e9df1903c1b2fd7ca',
)
MIRACL_SOURCES = {
    'miracl-zh-dev-topics.tsv': (
        f'{MIRACL}/topics/topics.miracl-v1.0-zh-dev.tsv',
        '5b284a9aabf08bb2d1c88ed7ea276025c9d23846457c5350dc8d391b5e0d0a13',
    ),
    'miracl-zh-dev-qrels.tsv': (
        f'{MIRACL}/qrels/qrels.miracl-v1.0-zh-dev.tsv',
        '5546474d3dc8139014e6571e9f4041848bb0a314ca6d2d4bac708174d71c59eb',
    ),
}
HAN = r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]'
ZH_RUNS = re.compile(rf'({HAN}+)|((?:(?!{HAN})[^\W_])+)')
LATIN_WORDS = re.compile(r'[^\W_]+')


@dataclass
class Dataset:
    name: str
    language: str
    queries: dict
    qrels: dict
    documents: dict
    sources: dict


def data_file(cache, name, url, download, sha=None):
    path = cache / name
    if not path.is_file() and download:
        cache.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(path.suffix + '.part')
        subprocess.run(['curl', '-fLsS', '--retry', '2', '--max-time', '300', url, '-o', str(partial)], check=True)
        partial.replace(path)
    if not path.is_file():
        raise FileNotFoundError(f'Missing {path}. Use --download or fetch {url}')
    if sha:
        with path.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != sha:
                raise ValueError(f'Source checksum mismatch: {path}')
    return path


def excerpt(text, maximum):
    return re.sub(r'==(.+?)==', r'\1', text).strip()[:maximum]


def document_topic(title, text, slide_title):
    return Topic(deck_title=excerpt(title, 200) or 'Untitled deck',
                 slide_title=slide_title, slide_text=excerpt(text, 360)).model_dump()


def load_scifact(cache, download):
    archive = data_file(cache, 'scifact.zip', SCIFACT, download, SCIFACT_SHA)
    with zipfile.ZipFile(archive) as source:
        queries = {row['_id']: row['text'] for row in map(json.loads, source.open('scifact/queries.jsonl'))}
        documents = {row['_id']: document_topic(row['title'], row['text'], 'Abstract')
                     for row in map(json.loads, source.open('scifact/corpus.jsonl'))}
        qrels = defaultdict(dict)
        with source.open('scifact/qrels/test.tsv') as stream:
            for row in csv.DictReader(io.TextIOWrapper(stream, encoding='utf-8'), delimiter='\t'):
                qrels[row['query-id']][row['corpus-id']] = int(row['score'])
    if len(qrels) != 300 or sum(map(len, qrels.values())) != 339 or len(documents) != 5183:
        raise ValueError('Unexpected BEIR SciFact test/corpus counts')
    return Dataset('scifact-test', 'en', {qid: queries[qid] for qid in qrels}, qrels, documents,
                   {'archive': {'url': SCIFACT, 'sha256': SCIFACT_SHA}})


def load_miracl(cache, download):
    sources = {name: {'url': url, 'sha256': sha} for name, (url, sha) in MIRACL_SOURCES.items()}
    topics, assessments = [data_file(cache, name, url, download, sha)
                           for name, (url, sha) in MIRACL_SOURCES.items()]
    queries = dict(line.split('\t', 1) for line in topics.read_text(encoding='utf-8').splitlines())
    qrels = defaultdict(dict)
    for line in assessments.read_text(encoding='utf-8').splitlines():
        qid, _, docid, label = line.split()
        qrels[qid][docid] = int(label)
    if len(queries) != 393 or queries.keys() != qrels.keys() or sum(map(len, qrels.values())) != 3928:
        raise ValueError('Unexpected MIRACL zh dev split counts')
    wanted = {docid.encode(): docid for judgements in qrels.values() for docid in judgements}
    documents = {}
    reduced = cache / 'miracl-zh-dev-documents-d921ec7.json'
    if reduced.is_file():
        documents = json.loads(reduced.read_text(encoding='utf-8'))
    else:
        names = [f'docs-{shard}.jsonl.gz' for shard in range(len(MIRACL_CORPUS_SHAS))]
        with ThreadPoolExecutor(max_workers=4) as pool:
            paths = list(pool.map(lambda name, sha: data_file(
                cache, name, f'{MIRACL_CORPUS}/{name}?download=true', download, sha), names, MIRACL_CORPUS_SHAS))
        for path in paths:
            with gzip.open(path, 'rb') as rows:
                for row in rows:
                    # The official JSONL begins each row with its ASCII docid. Parse only judged rows.
                    docid = wanted.get(row.split(b'"', 4)[3])
                    if docid is not None:
                        parsed = json.loads(row)
                        if parsed['docid'] != docid:
                            raise ValueError(f'Unexpected MIRACL document ID in {path.name}')
                        documents[docid] = document_topic(parsed['title'], parsed['text'], '段落')
            print(f'MIRACL zh: extracted {len(documents)}/{len(wanted)} judged passages through {path.name}',
                  file=sys.stderr, flush=True)
        if documents.keys() == set(wanted.values()):
            reduced.write_text(json.dumps(documents, ensure_ascii=False), encoding='utf-8')
    if documents.keys() != set(wanted.values()):
        raise ValueError(f'MIRACL corpus missing {len(set(wanted.values()) - documents.keys())} judged passages')
    sources['passages'] = {'url': MIRACL_CORPUS, 'shards': len(MIRACL_CORPUS_SHAS),
                           'shard_sha256_in_numeric_order': MIRACL_CORPUS_SHAS,
                           'unique_judged_passages': len(documents)}
    return Dataset('miracl-zh-dev', 'zh', queries, qrels, documents, sources)


def lexical_tokens(text, language):
    text = unicodedata.normalize('NFKC', text).casefold()
    if language != 'zh':
        return LATIN_WORDS.findall(text)
    result = []
    for han, word in ZH_RUNS.findall(text):
        if han:
            result.extend(han)
            result.extend(han[i:i + 2] for i in range(len(han) - 1))
        else:
            result.append(word)
    return result


class BM25:
    """Okapi BM25 with positive IDF, k1=1.2, b=.75, and binary query term frequency."""

    def __init__(self, documents, language):
        self.language = language
        self.docids = list(documents)
        self.postings = defaultdict(list)
        lengths = {}
        for docid, topic in documents.items():
            terms = Counter(lexical_tokens(topic_text(topic), language))
            lengths[docid] = sum(terms.values())
            for term, frequency in terms.items():
                self.postings[term].append((docid, frequency))
        mean_length = statistics.fmean(lengths.values()) or 1
        self.norm = {docid: 1.2 * (.25 + .75 * length / mean_length) for docid, length in lengths.items()}

    def scores(self, query):
        result = defaultdict(float)
        for term in sorted(set(lexical_tokens(query, self.language))):
            matches = self.postings.get(term, ())
            idf = math.log1p((len(self.docids) - len(matches) + .5) / (len(matches) + .5))
            for docid, frequency in matches:
                result[docid] += idf * frequency * 2.2 / (frequency + self.norm[docid])
        return result


class ObservedEmbedder:
    """Capture pre-threshold scores while leaving ranking, failures, and filtering to production."""

    def __init__(self, actual):
        self.actual = actual
        self.topics = []
        self.values = []
        self.calls = 0
        self.elapsed_ms = None

    def scores(self, query, documents):
        self.calls += 1
        self.topics = documents
        started = time.perf_counter()
        try:
            self.values = self.actual.scores(query, documents)
            return self.values
        finally:
            self.elapsed_ms = (time.perf_counter() - started) * 1000


def ranking_metrics(ranking, relevant):
    if not relevant:
        return {}
    k = MAX_RELATED_MEMORIES
    first = next((index for index, docid in enumerate(ranking, 1) if docid in relevant), None)
    top = ranking[:k]
    hits = len(relevant.intersection(top))
    dcg = sum(1 / math.log2(index + 2) for index, docid in enumerate(top) if docid in relevant)
    ideal = sum(1 / math.log2(index + 2) for index in range(min(k, len(relevant))))
    return {'hit_at_1': int(bool(ranking) and ranking[0] in relevant), 'hit_at_3': int(hits > 0),
            'recall_at_3': hits / len(relevant), 'mrr': 1 / first if first else 0,
            'mrr_at_3': 1 / first if first and first <= k else 0, 'ndcg_at_3': dcg / ideal}


def fixtures(dataset, qid, query, corpus_ranker):
    judged = dataset.qrels[qid]
    positive = {docid for docid, relevance in judged.items() if relevance > 0}
    rng = random.Random(f'{SEED}:{dataset.name}:{qid}')
    if corpus_ranker:
        scores = corpus_ranker.scores(query)
        eligible = sorted(dataset.documents.keys() - judged.keys())
        hard = heapq.nsmallest(8, eligible, key=lambda docid: (-scores[docid], docid))
        easy = rng.sample(sorted(set(eligible) - set(hard)), MAX_RECALL_CANDIDATES - len(hard))
        negative = hard + easy
        for scenario, good in [('positive_present', sorted(positive)), ('labels_absent', [])]:
            candidates = good + negative[:MAX_RECALL_CANDIDATES - len(good)]
            rng.shuffle(candidates)
            yield scenario, candidates, set(good), set(hard).intersection(candidates)
    else:
        negative = sorted(docid for docid, relevance in judged.items() if relevance == 0)
        for scenario, good in [('positive_present', sorted(positive)), ('judged_no_hit', [])]:
            candidates = good + negative
            if candidates:
                rng.shuffle(candidates)
                yield scenario, candidates, set(good), set(negative)


def record(docid, topic):
    return {'deck_id': f'past-{docid}', 'topic': topic, 'style': 'plain', 'focused_share': .8,
            'evidence_ids': [docid]}


def query_for(dataset, qid):
    content = excerpt(dataset.queries[qid], 560)
    deck_title = 'Current deck' if dataset.language == 'en' else '当前课件'
    return RetrievalQuery(deck_id=f'current-{qid}', source='replay',
                          topic=Topic(deck_title=deck_title, slide_title=content[:200], slide_text=content[200:]))


def run_case(embedder, dataset, qid, query, scenario, candidates, positive, hard):
    topics = {docid: dataset.documents[docid] for docid in candidates}
    observed = ObservedEmbedder(embedder)
    # Candidate order is most recent first; production traverses storage insertion order backwards.
    records = [record(docid, topics[docid]) for docid in reversed(candidates)]
    status, related = recall_related(observed, query, records)
    if observed.calls != 1 or observed.topics != list(topics.values()):
        raise RuntimeError(f'Production candidate pool mismatch for {qid}')
    dense_scores = dict(zip(candidates, observed.values, strict=True)) if status == 'embeddinggemma-2' else {}
    dense_rank = sorted(dense_scores, key=dense_scores.get, reverse=True)
    dense_show = [hit['rescue_id'] for hit in related]
    expected = [docid for docid in dense_rank if dense_scores[docid] >= MIN_TOPIC_SIMILARITY][:MAX_RELATED_MEMORIES]
    if dense_show != expected:
        raise RuntimeError(f'Production threshold/ranking mismatch for {qid}')

    start = time.perf_counter()
    lexical_index = BM25(topics, dataset.language)
    lexical_scores = lexical_index.scores(topic_text(query.topic.model_dump()))
    lexical_rank = sorted(candidates, key=lambda docid: lexical_scores.get(docid, 0), reverse=True)
    lexical_show = [docid for docid in lexical_rank if lexical_scores.get(docid, 0) > 0][:MAX_RELATED_MEMORIES]
    lexical_ms = (time.perf_counter() - start) * 1000
    rankings = {'embeddinggemma_rank': dense_rank, 'embeddinggemma_web': dense_show,
                'bm25_rank': lexical_rank, 'bm25_nonzero': lexical_show, 'recency': candidates}
    out = {
        'qid': qid, 'scenario': scenario, 'candidate_ids_newest_first': candidates,
        'positive_ids': sorted(positive), 'hard_distractor_ids': sorted(hard),
        'candidate_count': len(candidates), 'status': status, 'embedding_ms': observed.elapsed_ms,
        'bm25_ms': lexical_ms, 'embedding_top_score': max(dense_scores.values(), default=None),
        'embedding_scores': dense_scores,
        'bm25_scores': {docid: lexical_scores.get(docid, 0) for docid in candidates},
    }
    for name, ranking in rankings.items():
        out[f'{name}_ids'] = ranking
        out[f'{name}_shown'] = len(ranking[:MAX_RELATED_MEMORIES])
        for metric, value in ranking_metrics(ranking, positive).items():
            out[f'{name}_{metric}'] = value
    return out


def recency_probe(dataset, cases):
    """Show that production's candidate cutoff can exclude an old labeled-positive topic."""
    sample = next(row for row in cases if row['scenario'] == 'positive_present')
    positive = sample['positive_ids'][0]
    qid = sample['qid']
    excluded = set(dataset.qrels[qid])
    negative = sorted(dataset.documents.keys() - excluded)[:MAX_RECALL_CANDIDATES]
    if len(negative) < MAX_RECALL_CANDIDATES:
        raise RuntimeError('Recency probe needs additional distinct corpus topics')
    sample_ids = [positive, *negative]
    records = [record(docid, dataset.documents[docid]) for docid in sample_ids]
    query = query_for(dataset, qid)
    outside = ObservedEmbedder(configured_web_embedder())
    inside = ObservedEmbedder(configured_web_embedder())
    outside_status, outside_hits = recall_related(outside, query, records)
    inside_status, inside_hits = recall_related(inside, query, records[1:] + records[:1])
    if outside.calls != 1 or inside.calls != 1 or len(outside.topics) != MAX_RECALL_CANDIDATES:
        raise RuntimeError('Recency cutoff probe was not exercised')
    positive_topic = records[0]['topic']
    return {'qid': qid, 'positive_docid': positive, 'total_history_topics': len(records),
            'older_than_window': {'scored': positive_topic in outside.topics, 'status': outside_status,
                                  'returned_ids': [row['rescue_id'] for row in outside_hits]},
            'made_most_recent': {'scored': positive_topic in inside.topics, 'status': inside_status,
                                 'returned_ids': [row['rescue_id'] for row in inside_hits]},
            'distractors': 'Other corpus topics, not judged for this query; same history in both runs'}


def p95(values):
    return sorted(values)[math.ceil(.95 * len(values)) - 1] if values else None


def runtime_metadata(embedder):
    model_url = embedder.url.removesuffix('/embeddings') + '/models'
    try:
        with httpx.Client(timeout=2, trust_env=False) as client:
            response = client.get(model_url)
            response.raise_for_status()
        model = next(row for row in response.json()['data'] if row['id'] == 'embeddinggemma-2')
        return {'server_owner': model.get('owned_by'), 'metadata': model.get('meta', {})}
    except (httpx.HTTPError, KeyError, StopIteration, ValueError, TypeError):
        return {'metadata': 'Model endpoint did not expose runtime details'}


def score_distribution(values):
    if not values:
        return None
    return {'n': len(values), 'min': min(values), 'median': statistics.median(values),
            'p95': p95(values), 'max': max(values)}


def threshold_diagnostics(cases):
    matched = [row for row in cases if row['scenario'] == 'positive_present']
    no_hit = [row for row in cases if row['scenario'] != 'positive_present']
    successful = [row for row in matched if row['status'] == 'embeddinggemma-2']
    losses = Counter()
    relevant_max, distractor_max = [], []
    for row in successful:
        known = set(row['positive_ids'])
        relevant_max.append(max(row['embedding_scores'][docid] for docid in known))
        other = set(row['embedding_scores']) - known
        if other:
            distractor_max.append(max(row['embedding_scores'][docid] for docid in other))
        if row['embeddinggemma_web_hit_at_3']:
            losses['shown_in_web_top3'] += 1
        elif row['embeddinggemma_rank_hit_at_3']:
            losses['raw_top3_removed_by_threshold'] += 1
        else:
            losses['relevant_below_raw_top3'] += 1
    sweep = []
    for threshold in sorted({MIN_TOPIC_SIMILARITY, .65, .70, .75, .80, .85, .90}):
        positive_hits = sum(any(docid in row['positive_ids'] and row['embedding_scores'][docid] >= threshold
                                for docid in row['embeddinggemma_rank_ids'][:MAX_RELATED_MEMORIES])
                            for row in matched)
        no_hit_returns = sum(row['embedding_top_score'] is not None and row['embedding_top_score'] >= threshold
                             for row in no_hit)
        sweep.append({'threshold': threshold, 'positive_hits_at_3': positive_hits,
                      'positive_cases': len(matched), 'no_hit_cases_returned': no_hit_returns,
                      'no_hit_cases': len(no_hit)})
    return {
        'positive_case_counts': {field: losses[field] for field in
                                 ('shown_in_web_top3', 'raw_top3_removed_by_threshold', 'relevant_below_raw_top3')}
                                | {'embedding_unavailable': len(matched) - len(successful)},
        'positive_case_web_display_counts': {
            'all_displayed_passages': sum(row['embeddinggemma_web_shown'] for row in successful),
            'labeled_positive_passages': sum(len(set(row['positive_ids']) & set(row['embeddinggemma_web_ids']))
                                             for row in successful),
        },
        'max_scores': {
            'known_positive_in_positive_present': score_distribution(relevant_max),
            'distractor_in_positive_present': score_distribution(distractor_max),
            'any_candidate_in_no_hit': score_distribution(
                [row['embedding_top_score'] for row in no_hit if row['embedding_top_score'] is not None]),
        },
        'descriptive_threshold_sweep': sweep,
        'note': 'Score-only diagnostic on the same evaluation splits, not a threshold selection or independent calibration. SciFact distractors may be unlabeled relevant documents.',
    }


def summarize(cases):
    groups = defaultdict(list)
    for row in cases:
        groups[row['scenario']].append(row)
    out = {}
    for scenario, rows in groups.items():
        available = [row for row in rows if row['status'] == 'embeddinggemma-2']
        score_fields = [field for field in rows[0] if field.endswith(
            ('_hit_at_1', '_hit_at_3', '_recall_at_3', '_mrr', '_mrr_at_3', '_ndcg_at_3'))]
        metrics = {field: statistics.fmean(row[field] for row in rows) for field in score_fields}
        coverage = {name: statistics.fmean(row[f'{name}_shown'] > 0 for row in rows)
                    for name in ('embeddinggemma_web', 'bm25_nonzero', 'recency')}
        out[scenario] = {
            'cases': len(rows), 'candidate_count_distribution': dict(Counter(row['candidate_count'] for row in rows)),
            'embedding_successes': len(available), 'embedding_unavailable': len(rows) - len(available),
            'embedding_median_ms': statistics.median(row['embedding_ms'] for row in rows),
            'embedding_p95_ms': p95([row['embedding_ms'] for row in rows]),
            'bm25_median_ms': statistics.median(row['bm25_ms'] for row in rows),
            'bm25_p95_ms': p95([row['bm25_ms'] for row in rows]),
            'ranking_metrics': metrics, 'returns_at_least_one_rate': coverage,
        }
    return out


def evaluate(dataset, args):
    embedder = configured_web_embedder()
    if embedder is None:
        raise RuntimeError('Start the local embedding service and set LOCKIN_EMBEDDINGGEMMA_URL')
    corpus_ranker = BM25(dataset.documents, dataset.language) if dataset.name == 'scifact-test' else None
    qids = sorted(dataset.queries)
    if args.pilot:
        qids = sorted(random.Random(SEED).sample(qids, min(args.pilot, len(qids))))
    cases = []
    started = time.perf_counter()
    for index, qid in enumerate(qids, 1):
        query = query_for(dataset, qid)
        for scenario, candidates, positive, hard in fixtures(dataset, qid, dataset.queries[qid], corpus_ranker):
            cases.append(run_case(embedder, dataset, qid, query, scenario, candidates, positive, hard))
        if index == len(qids) or index % 25 == 0:
            print(f'{dataset.name}: {index}/{len(qids)} queries after {time.perf_counter() - started:.1f} seconds',
                  file=sys.stderr, flush=True)
    report = {
        'dataset': dataset.name, 'sources': dataset.sources, 'seed': SEED, 'pilot': args.pilot,
        'queries_evaluated': len(qids), 'official_query_count': len(dataset.queries),
        'elapsed_seconds': time.perf_counter() - started,
        'production': {'backend_function': 'lockin.web_memory.recall_related',
                       'model': 'embeddinggemma-2', 'endpoint': embedder.url,
                       'candidate_limit': MAX_RECALL_CANDIDATES, 'top_k': MAX_RELATED_MEMORIES,
                       'threshold': MIN_TOPIC_SIMILARITY, 'title_limit': 200, 'slide_text_limit': 360,
                       'response_dimensions': 768, 'runtime': runtime_metadata(embedder),
                       'platform': platform.platform(), 'python': platform.python_version(),
                       'backend_sha256': {name: hashlib.sha256((BACKEND / 'lockin' / name).read_bytes()).hexdigest()
                                          for name in ('semantic_memory.py', 'web_memory.py')}},
        'methodology': {
            'topics': 'Dataset query in current slide title (overflow in slide text); corpus title as past deck title; corpus excerpt as past slide body. Each document has a unique past deck ID.',
            'candidates': ('All official relevant docs when present; up to eight corpus-BM25 non-qrel hard distractors plus seeded random non-qrel distractors, up to 12 total. SciFact distractors are unjudged, and mining via BM25 makes this a lexical-hard candidate set.'
                           if corpus_ranker else 'All judged passages per query (up to ten); no-hit pools remove positives and retain only judged negatives. Two queries have no judged negative and yield no no-hit fixture.'),
            'baselines': 'Shared candidate pools with seeded insertion order. Recency always displays the first three. Candidate-local Okapi BM25 uses NFKC/casefold and word tokens (English) or Han character unigrams and adjacent bigrams (Chinese), ties broken by recency. BM25 display uses nonzero overlap, not a calibrated abstention threshold.',
            'metrics': 'Rank metrics evaluate positive-present fixtures; display variants score the filtered list. For controls, returns-at-least-one is a false-hit proxy on SciFact and a judged false-hit rate on MIRACL. Unavailable model responses count as empty output; inspect embedding_unavailable to distinguish outages.',
            'scope': 'Candidate reranking under Web retrieval caps on public dataset proxies. Candidate generation is fixed for each query, and the evaluation measures ranking and display behavior.',
        },
        'scenarios': summarize(cases), 'recency_probe': recency_probe(dataset, cases),
        'threshold_diagnostics': threshold_diagnostics(cases),
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    prefix = f'{dataset.name}{"-pilot" if args.pilot else ""}'
    (args.output_dir / f'{prefix}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    fields = list(dict.fromkeys(field for row in cases for field in row))
    with (args.output_dir / f'{prefix}-cases.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in cases:
            writer.writerow({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v for k, v in row.items()})
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    if not any(row['status'] == 'embeddinggemma-2' for row in cases):
        raise RuntimeError('The actual model returned no successful benchmark cases')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', choices=('scifact', 'miracl-zh', 'all'), default='all')
    parser.add_argument('--cache', type=Path, default=Path('/tmp/lockin-memory-benchmark-data'))
    parser.add_argument('--output-dir', type=Path,
                        default=BACKEND.parents[1] / 'evaluation-results' / 'memory')
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--pilot', type=int, help='Deterministic sample size per dataset')
    args = parser.parse_args()
    if args.pilot is not None and args.pilot <= 0:
        parser.error('--pilot must be positive')
    if args.dataset in ('all', 'scifact'):
        evaluate(load_scifact(args.cache, args.download), args)
    if args.dataset in ('all', 'miracl-zh'):
        evaluate(load_miracl(args.cache, args.download), args)


if __name__ == '__main__':
    main()
