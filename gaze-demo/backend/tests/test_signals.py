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


def away(t,**kw):
    return obs(t,gaze={'valid':True,'calibrated':True,'on_screen':False},screen={},activity=0,**kw)


def test_offscreen_is_an_independent_thirty_second_rule_not_an_eight_second_screen_rule():
    state={}
    for t in range(0,30000,1000):
        assert not advance_gate(state,away(t))['trigger']
    d=advance_gate(state,away(30000))
    assert d['trigger'] is True
    assert d['reasons']==['gaze_offscreen']
    assert d['dwell_ms']==30000
    assert not advance_gate(state,away(31000))['trigger']


def test_offscreen_and_entertainment_dwell_cannot_be_mixed():
    state={}
    for t in range(0,8000,1000):advance_gate(state,obs(t))
    for t in range(8000,38000,1000):assert not advance_gate(state,away(t))['trigger']
    assert advance_gate(state,away(38000))['trigger'] is True


def test_offscreen_unknown_never_proves_recovery_or_rearms_an_existing_event():
    state={}
    for t in range(0,31000,1000):advance_gate(state,away(t))
    advance_gate(state,obs(31000,gaze={}))
    for t in range(32000,70000,1000):assert not advance_gate(state,away(t))['trigger']
    advance_gate(state,obs(70000,'study'))
    for t in range(71000,101000,1000):assert not advance_gate(state,away(t))['trigger']
    assert advance_gate(state,away(101000))['trigger'] is True


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


def test_recovery_offscreen_relapse_respects_the_thirty_second_threshold():
    short=[(away(t) if 10000<=t<39000 else obs(t,'study')).model_dump() for t in range(0,121000,1000)]
    assert summarize(short,0,120000)['relapse_after_ms'] is None
    long=[(away(t) if 10000<=t<41000 else obs(t,'study')).model_dump() for t in range(0,121000,1000)]
    assert summarize(long,0,120000)['relapse_after_ms']==40000


def test_nonfinite_and_extra_fields_rejected():
    with pytest.raises(ValueError): obs(float('nan'))
    with pytest.raises(ValueError): obs(1, fake=True)
