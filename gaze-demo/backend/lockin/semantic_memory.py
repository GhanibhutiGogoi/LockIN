"""Local model clients for cross-deck Web memory retrieval."""
import math
import os
from urllib.parse import urlsplit

import httpx


def topic_text(topic):
    return f"{topic['deck_title']} · {topic['slide_title']}\n{topic['slide_text']}"


def require_loopback(url, path):
    parsed = urlsplit(url)
    if (parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1')
            or parsed.username is not None or parsed.password is not None or parsed.path != path
            or parsed.query or parsed.fragment):
        raise ValueError(f'Memory model requires a loopback {path} URL')


class EmbeddingGemma:
    def __init__(self, url, transport=None):
        require_loopback(url, '/v1/embeddings')
        self.url = url
        self.transport = transport

    def scores(self, query, documents):
        inputs = [f'task: search result | query: {topic_text(query)}']
        inputs.extend(f"title: {topic['deck_title']} | text: {topic['slide_title']}\n{topic['slide_text']}"
                      for topic in documents)
        with httpx.Client(timeout=.95, trust_env=False, transport=self.transport) as client:
            response = client.post(self.url, json={'model': 'embeddinggemma-2', 'input': inputs})
            response.raise_for_status()
            payload = response.json()
        if not isinstance(payload, dict) or payload.get('model') != 'embeddinggemma-2':
            raise ValueError('Unexpected embedding model')
        rows = sorted(payload['data'], key=lambda row: row['index'])
        if [row['index'] for row in rows] != list(range(len(inputs))):
            raise ValueError('Embedding response indices did not match the input batch')
        vectors = []
        for row in rows:
            vector = row['embedding']
            if len(vector) != 768 or not all(math.isfinite(x) for x in vector):
                raise ValueError('Invalid EmbeddingGemma 2 vector')
            norm = math.sqrt(sum(x * x for x in vector))
            if not math.isfinite(norm) or norm <= 0:
                raise ValueError('Invalid EmbeddingGemma 2 vector norm')
            vectors.append([x / norm for x in vector])
        return [sum(a * b for a, b in zip(vectors[0], vector, strict=True)) for vector in vectors[1:]]


def configured_web_embedder():
    url = os.getenv('LOCKIN_EMBEDDINGGEMMA_URL', 'http://127.0.0.1:8003/v1/embeddings')
    return EmbeddingGemma(url) if url else None


class MemoryReranker:
    def __init__(self, url, transport=None):
        require_loopback(url, '/v1/rerank')
        self.url = url
        self.transport = transport

    def scores(self, query, documents):
        with httpx.Client(timeout=1., trust_env=False, transport=self.transport) as client:
            response = client.post(self.url, json={
                'model': 'lockin-reranker',
                'query': topic_text(query),
                'documents': [topic_text(topic) for topic in documents],
                'top_n': len(documents),
            })
            response.raise_for_status()
            payload = response.json()
        if not isinstance(payload, dict) or payload.get('model') != 'lockin-reranker':
            raise ValueError('Unexpected reranker model')
        rows = payload.get('results')
        if not isinstance(rows, list) or any(
            not isinstance(row, dict) or type(row.get('index')) is not int for row in rows
        ):
            raise ValueError('Invalid reranker result rows')
        rows = sorted(rows, key=lambda row: row['index'])
        if [row['index'] for row in rows] != list(range(len(documents))):
            raise ValueError('Reranker response indices did not match the input batch')
        scores = [row['relevance_score'] for row in rows]
        if any(type(score) not in (int, float) or not 0 <= score <= 1 for score in scores):
            raise ValueError('Invalid reranker score')
        return scores


def configured_web_reranker():
    url = os.getenv('LOCKIN_MEMORY_RERANKER_URL', 'http://127.0.0.1:8004/v1/rerank')
    return MemoryReranker(url) if url else None
