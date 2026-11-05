import pytest
from lockin.store import Store
from lockin.stress.service import StressService
from lockin.stress.schemas import StartStress,FeatureFrame,ReplayState,Feedback,EventAction,SelfReport


@pytest.fixture
def env(tmp_path):
    store=Store(tmp_path/'stress.db');a,_=store.create_user('A');b,_=store.create_user('B')
    return StressService(store),a['id'],b['id']


def trigger(service,user,sid):
    result=None
    for t in range(0,11000,1000):result=service.replay(user,sid,ReplayState(t_ms=t,state='possible_tension'))
    return result


def test_replay_trigger_has_provenance_and_cooldown(env):
    service,a,b=env;s=service.start(a,StartStress(mode='replay'))
    result=trigger(service,a,s['id']);e=result['event']
    assert e['source']=='synthetic_replay' and e['trigger_at_ms']==10000
    assert e['model_score'] is None
    assert result['session']['cooldown_until']==190000
    assert service.replay(a,s['id'],ReplayState(t_ms=10000,state='possible_tension'))['accepted'] is False
    assert service.replay(a,s['id'],ReplayState(t_ms=11000,state='possible_tension'))['event'] is None


def test_invalid_or_missing_state_resets_continuous_dwell(env):
    service,a,b=env;s=service.start(a,StartStress(mode='replay'))
    for t in range(0,8000,1000):service.replay(a,s['id'],ReplayState(t_ms=t,state='possible_tension'))
    service.replay(a,s['id'],ReplayState(t_ms=8000,state='unknown'))
    assert service.replay(a,s['id'],ReplayState(t_ms=9000,state='possible_tension'))['event'] is None
    # A long gap also cannot extend pending dwell.
    assert service.replay(a,s['id'],ReplayState(t_ms=30000,state='possible_tension'))['event'] is None


def test_feedback_is_user_scoped_tentative_retractable_and_replay_isolated(env):
    service,a,b=env;s=service.start(a,StartStress(mode='replay'));e=trigger(service,a,s['id'])['event']
    with pytest.raises(KeyError):service.feedback(b,e['id'],Feedback(helpful=True))
    with pytest.raises(ValueError):service.feedback(a,e['id'],Feedback(helpful=True))
    service.action(a,e['id'],EventAction(kind='shown',t_ms=10000))
    for _ in range(2):service.feedback(a,e['id'],Feedback(helpful=True,before=7,after=4))
    memories=service.bank(a)['memories']
    active=[m for m in memories if m['active']]
    assert len(active)==1 and active[0]['count']==1
    assert active[0]['namespace']=='replay_sandbox'
    assert service.bank(b)['memories']==[]
    assert service.preferences(a,real=True)==[]
    service.correct(a,e['id'],True)
    assert not [m for m in service.bank(a)['memories'] if m['active']]


def test_competing_learning_video_suppresses_relief(env):
    service,a,b=env
    with service.store.transaction(a) as tx:tx.put('session','attention',{'id':'attention','phase':'quiz'})
    s=service.start(a,StartStress(mode='replay'))
    assert trigger(service,a,s['id'])['event'] is None
    assert service.get(a,s['id'])['last_prediction']['reason']=='learning_intervention_active'


def test_learning_video_started_after_offer_prevents_late_animation_display(env):
    service,a,b=env;s=service.start(a,StartStress(mode='replay'));e=trigger(service,a,s['id'])['event']
    with service.store.transaction(a) as tx:tx.put('session','attention',{'id':'attention','phase':'video'})
    shown=service.action(a,e['id'],EventAction(kind='shown',t_ms=10000))
    assert shown['phase']=='suppressed'
    with pytest.raises(ValueError):service.feedback(a,e['id'],Feedback(helpful=True))


def test_live_model_requires_baseline_fresh_window_and_continuous_high_state(env,monkeypatch):
    import importlib,math
    from datetime import datetime,timedelta
    from lockin.stress.features import SCHEMA,EXTRACTOR,NAMES
    from lockin.stress.model import StressModel
    module=importlib.import_module('lockin.stress.service');service,a,b=env
    # Constant-score numeric fixture; not a real stress model, kept only in tempDB.
    service.model=StressModel({'version':1,'feature_schema':SCHEMA,'extractor':EXTRACTOR,'feature_names':NAMES,
        'window_ms':20000,'source_kind':'real_self_report','runtime_eligible':True,'validation':{'eligible':True},
        'model_id':'unit-only','kind':'logistic','mean':[0.]*104,'scale':[1.]*104,'coef':[0.]*104,'intercept':math.log(4)})
    s=service.start(a,StartStress(mode='live'));base=datetime.fromisoformat(s['created_at']);clock=[base]
    class Clock(datetime):
        @classmethod
        def now(cls,tz):return clock[0]
    monkeypatch.setattr(module,'datetime',Clock)
    for t in range(0,40000,500):
        clock[0]=base+timedelta(milliseconds=t)
        r=service.observe(a,s['id'],FeatureFrame(t_ms=t,valid=True,values=[.2]*52))
        assert r['event'] is None
    # Invalid input immediately resets high-state dwell, not just coverage.
    clock[0]=base+timedelta(milliseconds=40000)
    assert service.observe(a,s['id'],FeatureFrame(t_ms=40000,valid=False))['prediction']['state']=='unknown'
    for t in range(40500,51000,500):
        clock[0]=base+timedelta(milliseconds=t)
        r=service.observe(a,s['id'],FeatureFrame(t_ms=t,valid=True,values=[.2]*52))
    assert r['event']['trigger_at_ms']==50500
    assert r['event']['source']=='derived_camera_features'
    assert r['event']['feature_window']['coverage']==.975


def test_live_cannot_accept_replay_and_missing_model_remains_unknown(env):
    service,a,b=env;s=service.start(a,StartStress(mode='live'))
    with pytest.raises(ValueError):trigger(service,a,s['id'])
    result=service.observe(a,s['id'],FeatureFrame(t_ms=0,valid=True,values=[.2]*52))
    assert result['prediction']['state']=='unknown'
    assert result['event'] is None
    service.end(a,s['id'])
    with pytest.raises(ValueError):service.observe(a,s['id'],FeatureFrame(t_ms=1,valid=False))


def test_finite_features_and_server_timestamp_guard(env):
    service,a,b=env;s=service.start(a,StartStress(mode='live'))
    with pytest.raises(ValueError):service.observe(a,s['id'],FeatureFrame(t_ms=50000,valid=True,values=[.2]*52))
    with pytest.raises(ValueError):FeatureFrame(t_ms=0,valid=True,values=[.2]*51)
    with pytest.raises(ValueError):FeatureFrame(t_ms=0,valid=True,values=[float('nan')]*52)


def test_live_self_report_is_bound_to_fresh_window_and_never_imputed_from_a_smile(env,monkeypatch):
    import importlib
    from datetime import datetime,timedelta,timezone
    module=importlib.import_module('lockin.stress.service')
    service,a,b=env;s=service.start(a,StartStress(mode='live'))
    clock=[datetime.fromisoformat(s['created_at'])]
    class Clock(datetime):
        @classmethod
        def now(cls,tz):return clock[0]
    monkeypatch.setattr(module,'datetime',Clock)
    with pytest.raises(ValueError):service.label(a,s['id'],SelfReport(rating=8))
    for t in range(0,30500,500):
        clock[0]=datetime.fromisoformat(s['created_at'])+timedelta(milliseconds=t)
        service.observe(a,s['id'],FeatureFrame(t_ms=t,valid=True,values=[.2]*52))
    row=service.label(a,s['id'],SelfReport(rating=8))
    assert row['label']==1 and row['rating']==8
    assert row['source_kind']=='project_user_self_report'
    assert len(row['vector'])==104
    assert row['end_ms']==30000 and row['start_ms']==10000
    assert service.get(a,s['id'])['baseline']['used_as_model_input'] is False
    with pytest.raises(KeyError):service.label(b,s['id'],SelfReport(rating=8))
    # A second rating for the same window replaces the earlier annotation.
    ambiguous=service.label(a,s['id'],SelfReport(rating=5))
    assert ambiguous['label'] is None
    assert len(service.get(a,s['id'])['labelled_windows'])==1
    clock[0]+=timedelta(seconds=5)
    with pytest.raises(ValueError):service.label(a,s['id'],SelfReport(rating=8))
