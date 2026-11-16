import pytest
from fastapi.testclient import TestClient

from lockin.app import create_app
from lockin.memory import Memory


BASE = '/v1/web-memory'


def identity(client):
    response = client.post(BASE + '/identity')
    assert response.status_code == 201
    return {'Authorization': 'Bearer ' + response.json()['token']}


def test_web_memory_round_trip_isolated_idempotent_and_deletable(tmp_path):
    with TestClient(create_app(tmp_path / 'web.sqlite', memory=Memory())) as client:
        a, b = identity(client), identity(client)
        query = {'deck_id': 'biology', 'source': 'replay'}
        assert client.post(BASE + '/retrieve', json=query).status_code == 401
        assert client.post(BASE + '/retrieve', headers=a, json=query).json()['evidence_count'] == 0
        outcome = {
            'rescue_id': 'rescue-1', 'session_id': 'first', 'deck_id': 'biology',
            'trigger': 'gaze', 'style': 'analogy', 'clip_seconds': 20, 'skipped': False,
            'answer_count': 1, 'correct_count': 1, 'source': 'replay',
            'recovery_samples': 55, 'focused_share': .8,
        }
        for _ in range(2):
            assert client.post(BASE + '/outcomes', headers=a, json=outcome).status_code == 204
        session = {'session_id': 'first', 'outcomes': [outcome]}
        assert client.post(BASE + '/sessions', headers=a, json=session).status_code == 204
        next_session = client.post(BASE + '/retrieve', headers=a, json=query).json()
        assert next_session['style'] != 'analogy'
        assert next_session['reason'] == 'rotation'
        assert next_session['evidence_count'] == 1
        assert next_session['eligible_by_style']['analogy'] == 1
        bank = client.get('/v1/bank', headers=a).json()
        assert len(bank['web_outcomes']) == 1
        assert bank['memories'][0]['evidence_ids'] == ['rescue-1']
        assert client.post(BASE + '/retrieve', headers=b, json=query).json()['evidence_count'] == 0
        assert client.post(BASE + '/retrieve', headers=a, json={**query, 'source': 'live'}).json()['evidence_count'] == 0

        partial = {**outcome, 'rescue_id': 'partial', 'recovery_samples': 1}
        assert client.post(BASE + '/outcomes', headers=a, json=partial).status_code == 204
        diagnostic = client.post(BASE + '/retrieve', headers=a, json=query).json()
        assert diagnostic['evidence_count'] == 1
        assert diagnostic['excluded'] == {'skipped': 0, 'no_clip': 0, 'insufficient_recovery': 1}
        assert client.post('/v1/sessions', headers=a, json={'goal': 'Keep standalone records', 'mode': 'replay'}).status_code == 200
        assert client.delete(BASE + '/history', headers=a).status_code == 204
        bank = client.get('/v1/bank', headers=a).json()
        assert bank['web_outcomes'] == [] and bank['memories'] == [] and len(bank['sessions']) == 1
        assert client.post(BASE + '/retrieve', headers=a, json=query).json()['evidence_count'] == 0


def test_web_memory_rejects_foreign_origin_and_invalid_observation(tmp_path):
    with TestClient(create_app(tmp_path / 'web.sqlite', memory=Memory())) as client:
        assert client.post(BASE + '/identity', headers={'Origin': 'https://example.com'}).status_code == 403
        auth = identity(client)
        assert client.post(BASE + '/outcomes', headers=auth, json={'focused_share': 2}).status_code == 422


def test_web_memory_rotates_allowed_styles_before_preferring_a_supported_style(tmp_path):
    with TestClient(create_app(tmp_path / 'rotation.sqlite', memory=Memory())) as client:
        auth = identity(client)
        query = {'deck_id': 'biology', 'source': 'live', 'allowed_styles': ['plain', 'analogy']}

        def choose(**extra):
            response = client.post(BASE + '/retrieve', headers=auth, json={**query, **extra})
            assert response.status_code == 200
            return response.json()

        def record(rescue_id, style, share, **extra):
            outcome = {
                'deck_id': 'biology', 'source': 'live', 'rescue_id': rescue_id, 'session_id': 'first',
                'trigger': 'gaze', 'style': style, 'clip_seconds': 20, 'skipped': False,
                'answer_count': 1, 'correct_count': 1, 'recovery_samples': 60, 'focused_share': share,
                **extra,
            }
            assert client.post(BASE + '/outcomes', headers=auth, json=outcome).status_code == 204

        first = choose()
        assert first['style'] == 'plain' and first['reason'] == 'rotation'
        assert choose(pending=[{'rescue_id': 'a', 'style': 'plain'}])['style'] == 'analogy'
        record('a', 'plain', .1)
        assert choose(pending=[{'rescue_id': 'a', 'style': 'plain'}])['attempts_by_style']['plain'] == 1
        assert choose()['style'] == 'analogy'
        record('b', 'analogy', .9)
        record('c', 'plain', .2)
        record('d', 'analogy', 1)
        record('e', 'humor', 1)
        record('f', 'plain', .99, skipped=True)
        record('g', 'analogy', .99, recovery_samples=3)
        record('h', 'plain', .99, clip_seconds=0)
        choice = choose()
        assert choice['reason'] == 'observed_recovery'
        assert choice['style'] == 'analogy'
        assert choice['evidence_count'] == 4
        assert choice['eligible_by_style'] == {'plain': 2, 'analogy': 2}
        assert choice['excluded'] == {'skipped': 1, 'no_clip': 1, 'insufficient_recovery': 1}
        assert choose(allowed_styles=['plain'])['reason'] == 'settings'


def test_cross_deck_recall_is_grounded_and_never_becomes_same_deck_evidence(tmp_path, monkeypatch):
    class SemanticFixture:
        def scores(self, query, documents):
            assert query['slide_title'] == 'ATP production'
            # EmbeddingGemma ranks the topical distractor first.
            return [.85 if topic['deck_title'] == 'Cellular respiration' else .91 for topic in documents]

    monkeypatch.setattr('lockin.web_memory.configured_web_embedder', lambda: SemanticFixture())

    class RelevanceFixture:
        def scores(self, query, documents):
            return [.9999 if topic['deck_title'] == 'Cellular respiration' else .001 for topic in documents]

    monkeypatch.setattr('lockin.web_memory.configured_web_reranker', lambda: RelevanceFixture())
    with TestClient(create_app(tmp_path / 'semantic.sqlite', memory=Memory())) as client:
        auth, other_user = identity(client), identity(client)

        def save(rescue_id, deck_title, **overrides):
            outcome = {
                'deck_id': rescue_id, 'source': 'live', 'rescue_id': rescue_id, 'session_id': 'first',
                'trigger': 'gaze', 'style': 'analogy', 'clip_seconds': 20, 'skipped': False,
                'answer_count': 1, 'correct_count': 1, 'recovery_samples': 60, 'focused_share': .8,
                'topic': {'deck_title': deck_title, 'slide_title': deck_title, 'slide_text': 'A short lesson.'},
                **overrides,
            }
            assert client.post(BASE + '/outcomes', headers=auth, json=outcome).status_code == 204

        save('related', 'Cellular respiration')
        save('unrelated', 'French grammar')
        save('skipped', 'Cellular respiration', skipped=True)
        save('replay', 'Cellular respiration', source='replay')
        query = {'deck_id': 'new-deck', 'source': 'live', 'topic': {
            'deck_title': 'Bioenergetics', 'slide_title': 'ATP production', 'slide_text': 'How cells get usable energy.',
        }}
        recall = client.post(BASE + '/retrieve', headers=auth, json=query).json()
        assert recall['semantic_status'] == 'confirmed'
        assert [hit['rescue_id'] for hit in recall['related_memories']] == ['related']
        assert recall['evidence_count'] == 0
        assert recall['reason'] == 'rotation'
        assert 'Cellular respiration' in recall['memo']
        assert client.post(BASE + '/retrieve', headers=other_user, json=query).json()['related_memories'] == []
        legacy = client.post(BASE + '/retrieve', headers=auth, json={'deck_id': 'new-deck', 'source': 'live'}).json()
        assert legacy['related_memories'] == [] and legacy['evidence_count'] == 0
        assert client.delete(BASE + '/history', headers=auth).status_code == 204
        assert client.post(BASE + '/retrieve', headers=auth, json=query).json()['related_memories'] == []


def test_high_cosine_alone_cannot_return_cross_deck_memory(tmp_path, monkeypatch):
    class SemanticFixture:
        def scores(self, query, documents):
            return [.94] * len(documents)

    class RelevanceFixture:
        def scores(self, query, documents):
            return [.001] * len(documents)

    monkeypatch.setattr('lockin.web_memory.configured_web_embedder', lambda: SemanticFixture())
    monkeypatch.setattr('lockin.web_memory.configured_web_reranker', lambda: RelevanceFixture())
    with TestClient(create_app(tmp_path / 'unrelated.sqlite', memory=Memory())) as client:
        auth = identity(client)
        for deck, title in [('current', 'ATP synthesis'), ('prior', 'ATP tennis rankings')]:
            response = client.post(BASE + '/outcomes', headers=auth, json={
                'deck_id': deck, 'source': 'replay', 'rescue_id': deck, 'session_id': 'first',
                'topic': {'deck_title': title, 'slide_title': title},
                'trigger': 'gaze', 'style': 'analogy', 'clip_seconds': 20, 'skipped': False,
                'answer_count': 1, 'correct_count': 1, 'recovery_samples': 60, 'focused_share': .8,
            })
            assert response.status_code == 204
        result = client.post(BASE + '/retrieve', headers=auth, json={
            'deck_id': 'current', 'source': 'replay',
            'topic': {'deck_title': 'Bioenergetics', 'slide_title': 'ATP synthesis'},
        }).json()
        assert result['semantic_status'] == 'no_match'
        assert result['related_memories'] == []
        assert result['evidence_count'] == 1
        assert 'tennis' not in result['memo']


def test_wider_shortlist_lets_reranker_rescue_a_lower_cosine_match():
    from lockin.web_memory import RetrievalQuery, recall_related

    def topic(title):
        return {'deck_title': title, 'slide_title': title, 'slide_text': '内容'}

    query = RetrievalQuery(deck_id='current', source='live', topic=topic('线粒体如何生成 ATP'))
    names = [f'干扰项 {i}' for i in range(7)] + ['电子传递链和 ATP 合成']
    records = [
        {'deck_id': name, 'topic': topic(name), 'evidence_ids': [name], 'style': 'plain', 'focused_share': .8}
        for name in reversed(names)
    ]
    cosine = dict(zip(names, [.95, .93, .91, .89, .87, .85, .83, .78], strict=True))

    class EmbeddingFixture:
        def scores(self, query, documents):
            return [cosine[doc['deck_title']] for doc in documents]

    class RerankFixture:
        def scores(self, query, documents):
            assert [doc['deck_title'] for doc in documents] == names
            return [.001] * 7 + [.9999999]

    assert recall_related(EmbeddingFixture(), query, records[:1], reranker=RerankFixture()) == ('no_match', [])
    status, related = recall_related(EmbeddingFixture(), query, records, reranker=RerankFixture(), wide=True)
    assert status == 'confirmed'
    assert [row['rescue_id'] for row in related] == [names[-1]]


def test_single_rerank_candidate_does_not_get_a_margin_bonus():
    from lockin.web_memory import RetrievalQuery, recall_related

    topic = {'deck_title': 'Biology', 'slide_title': 'Cell metabolism', 'slide_text': 'ATP'}
    query = RetrievalQuery(deck_id='current', source='live', topic=topic)
    row = {'deck_id': 'prior', 'topic': topic, 'evidence_ids': ['prior'], 'style': 'plain', 'focused_share': .8}

    class FixedScore:
        def __init__(self, value):
            self.value = value

        def scores(self, query, documents):
            return [self.value]

    # At cosine .78, this passes only if a missing runner-up is counted as evidence.
    assert recall_related(FixedScore(.78), query, [row], reranker=FixedScore(.9995), wide=True) == ('no_match', [])


def test_local_embedding_adapter_validates_model_and_uses_asymmetric_prompts():
    import json
    import httpx
    import pytest
    from lockin.semantic_memory import EmbeddingGemma

    topic = {'deck_title': 'Biology', 'slide_title': 'ATP', 'slide_text': 'Energy transfer'}
    observed = {}

    def respond(request):
        observed.update(json.loads(request.content))
        return httpx.Response(200, json={
            'model': 'embeddinggemma-2',
            'data': [{'index': 1, 'embedding': [2.] + [0.] * 767},
                     {'index': 0, 'embedding': [3.] + [0.] * 767}],
        })

    transport = httpx.MockTransport(respond)
    model = EmbeddingGemma('http://127.0.0.1:8003/v1/embeddings', transport=transport)
    assert model.scores(topic, [topic]) == [1.]
    assert observed['input'] == [
        'task: search result | query: Biology · ATP\nEnergy transfer',
        'title: Biology | text: ATP\nEnergy transfer',
    ]
    with pytest.raises(ValueError):
        EmbeddingGemma('https://example.com/v1/embeddings')


def test_local_reranker_reorders_scores_and_rejects_an_invalid_response():
    import json
    import httpx
    import pytest
    from lockin.semantic_memory import MemoryReranker

    topic = {'deck_title': 'Biology', 'slide_title': 'ATP', 'slide_text': 'Energy transfer'}
    scores = [{'index': 1, 'relevance_score': .9}, {'index': 0, 'relevance_score': .01}]

    def respond(request):
        assert json.loads(request.content) == {
            'model': 'lockin-reranker', 'query': 'Biology · ATP\nEnergy transfer',
            'documents': ['Biology · ATP\nEnergy transfer'] * 2, 'top_n': 2,
        }
        return httpx.Response(200, json={'model': 'lockin-reranker', 'results': scores})

    reranker = MemoryReranker('http://127.0.0.1:8004/v1/rerank', transport=httpx.MockTransport(respond))
    assert reranker.scores(topic, [topic, topic]) == [.01, .9]
    for invalid in ({'index': True, 'relevance_score': .9}, {'index': 1, 'relevance_score': '0.9'},
                    {'index': 0, 'relevance_score': .9}, {'index': 1, 'relevance_score': 1.01}):
        scores[0] = invalid
        with pytest.raises(ValueError):
            reranker.scores(topic, [topic, topic])
    with pytest.raises(ValueError):
        MemoryReranker('https://example.com/v1/rerank')


@pytest.mark.parametrize('failed_stage', ['embedder', 'reranker', 'missing_reranker'])
def test_semantic_failure_does_not_discard_same_deck_evidence(tmp_path, monkeypatch, failed_stage):
    import httpx

    class Offline:
        def scores(self, query, documents):
            raise httpx.ConnectError('local model stopped')

    class StrongCosine:
        def scores(self, query, documents):
            return [.97] * len(documents)

    embedder = Offline() if failed_stage == 'embedder' else StrongCosine()
    reranker = None if failed_stage == 'missing_reranker' else Offline()
    monkeypatch.setattr('lockin.web_memory.configured_web_embedder', lambda: embedder)
    monkeypatch.setattr('lockin.web_memory.configured_web_reranker', lambda: reranker)
    with TestClient(create_app(tmp_path / 'offline.sqlite', memory=Memory())) as client:
        auth = identity(client)
        topic = {'deck_title': 'Biology', 'slide_title': 'ATP', 'slide_text': 'Energy transfer'}
        for deck_id in ('current', 'prior'):
            response = client.post(BASE + '/outcomes', headers=auth, json={
                'deck_id': deck_id, 'source': 'replay', 'topic': topic,
                'rescue_id': deck_id, 'session_id': 'first', 'trigger': 'gaze', 'style': 'analogy',
                'clip_seconds': 20, 'skipped': False, 'answer_count': 1, 'correct_count': 1,
                'recovery_samples': 60, 'focused_share': .8,
            })
            assert response.status_code == 204
        result = client.post(BASE + '/retrieve', headers=auth, json={
            'deck_id': 'current', 'source': 'replay', 'topic': topic,
        }).json()
        assert result['semantic_status'] == 'unavailable'
        assert result['related_memories'] == []
        assert result['evidence_count'] == 1 and result['eligible_by_style']['analogy'] == 1
