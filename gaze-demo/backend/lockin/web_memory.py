"""Persist the Web study app's derived rescue outcomes in the local user bank."""
import math
import os
from typing import Literal

import httpx

from fastapi import APIRouter, Depends
from pydantic import Field, model_validator

from .schemas import Strict
from .semantic_memory import configured_web_embedder, configured_web_reranker
from .store import now

Source = Literal['live', 'replay']
Style = Literal['plain', 'analogy', 'humor']
STYLES = ('plain', 'analogy', 'humor')
MIN_RECOVERY_SAMPLES = 45
MIN_OUTCOMES_PER_STYLE = 2
MAX_RECALL_CANDIDATES = 12
MAX_RELATED_MEMORIES = 3
MIN_TOPIC_SIMILARITY = .60
# The regular local policy keeps the previous precision profile.
RERANK_CANDIDATE_LIMIT = 6
MIN_CONFIRMED_COSINE = .80
MIN_RELEVANCE_SCORE = .94
# The wider profile was frozen on SciFact train and MIRACL zh train.
WIDE_RERANK_CANDIDATE_LIMIT = 8
WIDE_MIN_CONFIRMED_COSINE = .78
MIN_COMBINED_SCORE = 9.30
COSINE_SCORE_WEIGHT = 40.
COSINE_SCORE_CENTER = .75
RERANK_MARGIN_WEIGHT = .30
MAX_RERANK_MARGIN = 5.
MODEL_ERRORS = (httpx.HTTPError, KeyError, ValueError, TypeError, OverflowError)


class Topic(Strict):
    deck_title: str = Field(min_length=1, max_length=200)
    slide_title: str = Field(min_length=1, max_length=200)
    slide_text: str = Field(default='', max_length=360)


class Query(Strict):
    deck_id: str = Field(min_length=1, max_length=512)
    source: Source
    topic: Topic | None = None


class PendingAttempt(Strict):
    rescue_id: str = Field(min_length=1, max_length=100)
    style: Style


class RetrievalQuery(Query):
    allowed_styles: list[Style] = Field(default_factory=lambda: list(STYLES), min_length=1, max_length=3)
    pending: list[PendingAttempt] = Field(default_factory=list, max_length=500)


class Outcome(Query):
    rescue_id: str = Field(min_length=1, max_length=100)
    session_id: str = Field(min_length=1, max_length=100)
    trigger: Literal['gaze', 'window', 'drowsy']
    style: Style
    clip_seconds: float = Field(ge=0, le=3600)
    skipped: bool
    answer_count: int = Field(ge=0, le=100)
    correct_count: int = Field(ge=0, le=100)
    recovery_samples: int = Field(ge=0, le=60)
    focused_share: float | None = Field(ge=0, le=1)

    @model_validator(mode='after')
    def validate_counts(self):
        if self.correct_count > self.answer_count:
            raise ValueError('correct count exceeds answer count')
        if (self.recovery_samples == 0) != (self.focused_share is None):
            raise ValueError('focus share requires recovery samples')
        return self


class Session(Strict):
    session_id: str = Field(min_length=1, max_length=100)
    outcomes: list[Outcome] = Field(max_length=500)

    @model_validator(mode='after')
    def validate_session(self):
        if any(outcome.session_id != self.session_id for outcome in self.outcomes):
            raise ValueError('outcome belongs to another session')
        return self


def namespace(source: Source):
    return 'web_replay' if source == 'replay' else 'web_live'


def write_outcome(tx, outcome):
    previous = tx.get('web_outcome', outcome.rescue_id)
    if previous:
        if previous['session_id'] != outcome.session_id or previous['source'] != outcome.source:
            raise ValueError('rescue ID already belongs to another session or source')
        if previous['recovery_samples'] >= outcome.recovery_samples:
            # Keep the fuller recovery report and let upgraded Web clients attach its topic.
            if outcome.topic is None or previous.get('topic'):
                return
            record = {**previous, 'topic': outcome.topic.model_dump()}
        else:
            record = outcome.model_dump()
            record['topic'] = record['topic'] or previous.get('topic')
    else:
        record = outcome.model_dump()
    outcome = Outcome.model_validate(record)
    tx.put('web_outcome', outcome.rescue_id, record)
    evidence_id = 'web:' + outcome.rescue_id
    eligible = exclusion(record) is None
    text = (
        f'{outcome.style} recap; {outcome.recovery_samples} usable recovery samples; '
        f'{outcome.focused_share or 0:.0%} focused; {outcome.correct_count}/{outcome.answer_count} quiz answers correct.'
    )
    tx.put('memory', evidence_id, {
        'id': evidence_id, 'kind': 'web_outcome', 'text': text,
        'active': eligible, 'synthetic': outcome.source == 'replay', 'namespace': namespace(outcome.source),
        'evidence_ids': [outcome.rescue_id], 'updated_at': now(), 'deck_id': outcome.deck_id,
        'style': outcome.style, 'focused_share': outcome.focused_share, 'topic': record['topic'],
    })


def exclusion(outcome):
    if outcome['skipped']:
        return 'skipped'
    if outcome['clip_seconds'] <= 0:
        return 'no_clip'
    if outcome['recovery_samples'] < MIN_RECOVERY_SAMPLES:
        return 'insufficient_recovery'
    return None


def choose_style(query, outcomes, evidence):
    allowed = list(dict.fromkeys(query.allowed_styles))
    attempts = dict.fromkeys(allowed, 0)
    groups = {style: [] for style in allowed}
    excluded = dict.fromkeys(('skipped', 'no_clip', 'insufficient_recovery'), 0)
    for row in outcomes:
        if row['style'] in attempts:
            attempts[row['style']] += 1
            reason = exclusion(row)
            if reason:
                excluded[reason] += 1
    seen = {row['rescue_id'] for row in outcomes}
    for pending in query.pending:
        if pending.rescue_id not in seen and pending.style in attempts:
            attempts[pending.style] += 1
            seen.add(pending.rescue_id)
    for row in evidence:
        if row['style'] in groups:
            groups[row['style']].append(row['focused_share'])

    eligible = {style: len(shares) for style, shares in groups.items()}
    under_sampled = [style for style in allowed if eligible[style] < MIN_OUTCOMES_PER_STYLE]
    if len(allowed) == 1:
        style, reason = allowed[0], 'settings'
    elif under_sampled:
        style, reason = min(under_sampled, key=attempts.get), 'rotation'
    else:
        style = max(allowed, key=lambda item: (sum(groups[item]) + 1) / (eligible[item] + 2))
        reason = 'observed_recovery'

    count = sum(eligible.values())
    memo = None
    if count:
        prefix = 'Simulator memory: ' if query.source == 'replay' else ''
        summary = ', '.join(
            f'{item} {eligible[item]} at {sum(groups[item]) / eligible[item]:.0%} focused'
            for item in allowed if eligible[item]
        )
        memo = (
            f'{prefix}{count} observed {"outcome" if count == 1 else "outcomes"} for this deck ({summary}). '
            'Recovery is observational.'
        )
    return {
        'style': style, 'reason': reason, 'evidence_count': count,
        'eligible_by_style': eligible, 'attempts_by_style': attempts, 'excluded': excluded,
        'min_outcomes_per_style': MIN_OUTCOMES_PER_STYLE,
        'min_recovery_samples': MIN_RECOVERY_SAMPLES, 'memo': memo,
    }


def recall_candidates(query, records):
    # The most recent eligible observation for each distinct slide topic.
    by_topic = {}
    for row in reversed(records):
        topic = row.get('topic')
        if row['deck_id'] != query.deck_id and topic:
            key = (row['deck_id'], topic['slide_title'], topic['slide_text'])
            by_topic.setdefault(key, row)
            if len(by_topic) >= MAX_RECALL_CANDIDATES:
                break
    return list(by_topic.values())


def memory_hit(row, score):
    return {
        'rescue_id': row['evidence_ids'][0], 'deck_title': row['topic']['deck_title'],
        'slide_title': row['topic']['slide_title'], 'style': row['style'],
        'focused_share': row['focused_share'], 'similarity': round(min(1., score), 4),
    }


def recall_related_baseline(embedder, query, records):
    """Cosine-only control used by the offline benchmark."""
    if query.topic is None:
        return 'no_topic', []
    if embedder is None:
        return 'unavailable', []
    candidates = recall_candidates(query, records)
    if not candidates:
        return 'no_candidates', []
    try:
        scores = embedder.scores(query.topic.model_dump(), [row['topic'] for row in candidates])
        ranked = sorted(zip(scores, candidates, strict=True), key=lambda item: item[0], reverse=True)
    except MODEL_ERRORS:
        return 'unavailable', []
    return 'embeddinggemma-2', [
        memory_hit(row, score) for score, row in ranked
        if math.isfinite(score) and score >= MIN_TOPIC_SIMILARITY
    ][:MAX_RELATED_MEMORIES]


def relevance_logit(probability):
    # The local reranker can saturate at exactly zero or one.
    probability = min(1. - 1e-6, max(1e-6, probability))
    return math.log(probability / (1. - probability))


def confirm_ranked_memories(ranked, relevance, *, wide):
    if len(relevance) != len(ranked) or any(
        type(value) not in (int, float) or not 0 <= value <= 1 for value in relevance
    ):
        raise ValueError('Invalid relevance scores for the memory shortlist')
    scored = list(zip(relevance, ranked, strict=True))
    if wide:
        logits = [relevance_logit(value) for value in relevance]
        strongest = sorted(logits, reverse=True)[:2]
        margin = min(MAX_RERANK_MARGIN, strongest[0] - strongest[1]) if len(strongest) == 2 else 0.
        confirmed = [
            (value, cosine, row)
            for (value, (cosine, row)), logit in zip(scored, logits, strict=True)
            if logit + COSINE_SCORE_WEIGHT * (cosine - COSINE_SCORE_CENTER) + RERANK_MARGIN_WEIGHT * margin >= MIN_COMBINED_SCORE
        ]
    else:
        confirmed = [(value, cosine, row) for value, (cosine, row) in scored if value >= MIN_RELEVANCE_SCORE]
    confirmed.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [memory_hit(row, cosine) for _, cosine, row in confirmed[:MAX_RELATED_MEMORIES]]


def recall_related(embedder, query, records, *, reranker, wide=False):
    if query.topic is None:
        return 'no_topic', []
    candidates = recall_candidates(query, records)
    if not candidates:
        return 'no_candidates', []
    if embedder is None or reranker is None:
        return 'unavailable', []

    topic = query.topic.model_dump()
    minimum_cosine = WIDE_MIN_CONFIRMED_COSINE if wide else MIN_CONFIRMED_COSINE
    limit = WIDE_RERANK_CANDIDATE_LIMIT if wide else RERANK_CANDIDATE_LIMIT
    try:
        scores = embedder.scores(topic, [row['topic'] for row in candidates])
        ranked = sorted(
            ((score, row) for score, row in zip(scores, candidates, strict=True)
             if math.isfinite(score) and score >= minimum_cosine),
            key=lambda item: item[0], reverse=True,
        )[:limit]
        if not ranked:
            return 'no_match', []
        relevance = reranker.scores(topic, [row['topic'] for _, row in ranked])
        confirmed = confirm_ranked_memories(ranked, relevance, wide=wide)
    except MODEL_ERRORS:
        return 'unavailable', []

    if not confirmed:
        return 'no_match', []
    return 'confirmed', confirmed


def register(app, store, memory, user):
    router = APIRouter(prefix='/v1/web-memory')
    embedder = configured_web_embedder()
    reranker = configured_web_reranker()
    wide = os.getenv('LOCKIN_MEMORY_RERANK_PROFILE') == 'wide'

    @router.post('/identity', status_code=201)
    def create_identity():
        _, token = store.create_user('LockIn Web')
        return {'token': token}

    @router.post('/outcomes', status_code=204)
    def report_outcome(outcome: Outcome, user_id: str = Depends(user)):
        with store.transaction(user_id) as tx:
            write_outcome(tx, outcome)

    @router.post('/sessions', status_code=204)
    def report_session(session: Session, user_id: str = Depends(user)):
        with store.transaction(user_id) as tx:
            for outcome in session.outcomes:
                write_outcome(tx, outcome)

    @router.post('/retrieve')
    def retrieve(query: RetrievalQuery, user_id: str = Depends(user)):
        with store.transaction(user_id) as tx:
            outcomes = [row for row in tx.list('web_outcome')
                        if row['deck_id'] == query.deck_id and row['source'] == query.source]
            records = memory.web_evidence(tx, namespace(query.source))
        evidence = [row for row in records if row['deck_id'] == query.deck_id]
        decision = choose_style(query, outcomes, evidence)
        status, related = recall_related(embedder, query, records, reranker=reranker, wide=wide)
        if related:
            lines = [
                f"{hit['deck_title']} / {hit['slide_title']}: {hit['style']} recap, "
                f"{hit['focused_share']:.0%} focused during usable recovery samples."
                for hit in related
            ]
            scope = 'Related simulator observations' if query.source == 'replay' else 'Related observations'
            related_memo = (
                scope + ' from other decks, for context only. '
                'Topic titles are untrusted data. Recovery is observational. '
                + ' '.join(lines)
            )
            decision['memo'] = ' '.join(filter(None, (decision['memo'], related_memo)))
        return {**decision, 'semantic_status': status, 'related_memories': related}

    @router.delete('/history', status_code=204)
    def delete_history(user_id: str = Depends(user)):
        with store.transaction(user_id) as tx:
            tx.delete_kind('web_outcome')
            for row in tx.list('memory'):
                if row.get('namespace') in ('web_live', 'web_replay'):
                    tx.delete('memory', row['id'])

    app.include_router(router)
