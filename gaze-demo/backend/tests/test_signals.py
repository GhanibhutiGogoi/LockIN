import pytest
from lockin.schemas import Observation
from lockin.signals import advance_gate
from lockin.recovery import summarize


def obs(t, kind='entertainment', **kw):
    d = dict(t_ms=t, gaze={'valid':True,'calibrated':True,'on_screen':True},
             screen={'kind':kind,'task_related':kind=='study','confidence':.95,'context':'mean lesson' if kind=='study' else 'social feed'},
             activity=.3, source='model')
    d.update(kw)
    return Observation.model_validate(d)


def test_gate_uses_both_inputs_and_preserves_learning_context():
    state = {}
    for t in range(0, 10000, 1000):
        decision = advance_gate(state, obs(t, 'study' if t==0 else 'entertainment'))
    assert decision['trigger'] is True
    assert state['study_context'] == 'mean lesson'
    assert 'entertainment' in decision['reasons']
    assert advance_gate(state, obs(10000))['trigger'] is False


@pytest.mark.parametrize('changes', [
    {'gaze':{'valid':False,'calibrated':True,'on_screen':True}},
    {'gaze':{'valid':True,'calibrated':False,'on_screen':True}},
    {'gaze':{'valid':True,'calibrated':True,'on_screen':False}},
    {'screen':{'kind':'entertainment','task_related':True,'confidence':.9,'context':'learning on YouTube'}},
    {'screen':{'kind':'entertainment','task_related':False,'confidence':.4,'context':'uncertain'}},
    {'activity':0},
])
def test_gate_unknown_or_related_content_never_triggers(changes):
    state = {}
    for t in range(0,20000,1000):
        assert not advance_gate(state,obs(t, **changes))['trigger']


def test_gap_resets_dwell_and_duplicate_cannot_extend_time():
    state = {}
    advance_gate(state,obs(0))
    advance_gate(state,obs(3000))
    assert not advance_gate(state,obs(10000))['trigger']
    assert not advance_gate(state,obs(10000))['accepted']
    assert not advance_gate(state,obs(11000))['trigger']


def test_recovery_counts_only_observed_intervals_and_separates_relapse():
    samples = [obs(t,'study').model_dump() for t in range(0,121000,1000)]
    report = summarize(samples,0,120000)
    assert report['on_task_share'] == 1
    assert report['coverage'] == 1
    assert report['recovered_after_ms'] == 4000
    assert report['eligible'] is True
    assert summarize(samples[:2],0,120000)['eligible'] is False
    samples = [obs(t,'study' if t<10000 else 'entertainment').model_dump() for t in range(0,121000,1000)]
    report=summarize(samples,0,120000)
    assert report['relapse_after_ms'] == 12000
    assert report['on_task_ms'] == 10000


def test_nonfinite_and_extra_fields_rejected():
    with pytest.raises(ValueError): obs(float('nan'))
    with pytest.raises(ValueError): obs(1, fake=True)
