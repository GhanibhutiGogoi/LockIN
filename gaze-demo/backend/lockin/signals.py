"""Heuristic temporal gate, independent of storage and model providers."""
from .schemas import Observation


def evidence(o: Observation):
    if not (o.gaze.valid and o.gaze.calibrated and o.gaze.on_screen is True):
        return 'unknown', ['gaze_unavailable_or_out_of_scope']
    if o.screen.confidence < .75 or o.screen.task_related is None:
        return 'unknown', ['screen_uncertain']
    if o.screen.task_related:
        return 'on-task', ['task_related']
    if o.screen.kind == 'entertainment' and o.activity >= .08:
        return 'off-task', ['entertainment','task_unrelated','visual_activity','gaze_on_screen']
    return 'unknown', ['insufficient_joint_evidence']


def advance_gate(state: dict, o: Observation, dwell_ms=8000, max_gap_ms=4000):
    t = o.t_ms
    previous = state.get('last_t', -1)
    if t <= previous:
        return {'accepted':False,'trigger':False,'kind':'unknown','reasons':['duplicate_or_stale'],'dwell_ms':0}
    kind, reasons = evidence(o)
    if previous < 0 or t-previous > max_gap_ms or state.get('source') != o.source:
        state['since'] = None
        state['latched'] = False
    state.update(last_t=t, source=o.source)
    if kind == 'on-task' and o.screen.context.strip():
        state['study_context'] = o.screen.context
    if kind != 'off-task':
        state.update(since=None, latched=False)
    elif state.get('since') is None:
        state['since'] = t
    dwell = t-state['since'] if state.get('since') is not None else 0
    trigger = kind == 'off-task' and dwell >= dwell_ms and not state.get('latched',False)
    if trigger:
        state['latched'] = True
    return {'accepted':True,'trigger':trigger,'kind':kind,'reasons':reasons,'dwell_ms':dwell}
