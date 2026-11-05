"""Time-weighted observed return-to-task, not a causal video-effect score."""
from .schemas import Observation
from .signals import evidence


def summarize(samples, returned_at, end_at, window_ms=120000):
    limit = returned_at + window_ms
    end = min(end_at,limit)
    on = off = valid = 0
    since = relapse = None
    recovered = relapsed = None
    ordered = sorted((o for o in samples if returned_at <= o['t_ms'] <= end), key=lambda x:x['t_ms'])
    for i, raw in enumerate(ordered[:-1]):
        o = Observation.model_validate(raw)
        next_t = ordered[i+1]['t_ms']
        dt = next_t-o.t_ms
        kind, _ = evidence(o)
        if dt <= 0: continue
        if dt > 4000 or kind == 'unknown':
            since = relapse = None
            continue
        valid += dt
        if kind == 'on-task':
            on += dt
            since = o.t_ms if since is None else since
            relapse = None
            if recovered is None and next_t-since >= 4000:
                recovered = since+4000-returned_at
        else:
            off += dt
            since = None
            if recovered is not None:
                relapse = o.t_ms if relapse is None else relapse
                if relapsed is None and next_t-relapse >= 2000:
                    relapsed = relapse+2000-returned_at
    elapsed=max(0,end-returned_at)
    coverage=valid/window_ms
    return {'window_ms':window_ms,'observation_ms':elapsed,'valid_ms':valid,'on_task_ms':on,'off_task_ms':off,
            'unknown_ms':max(0,elapsed-valid),'coverage':coverage,
            'on_task_share':on/valid if valid else None,'recovered_after_ms':recovered,'relapse_after_ms':relapsed,
            'eligible':end_at>=limit and coverage>=.6 and valid>=30000}
