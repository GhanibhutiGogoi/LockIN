import pytest
from lockin.store import Store
from lockin.harness import Harness
from lockin.schemas import Start, Observation, Media, Answer, Correction


def sample(t, kind='study',source='replay'):
    return Observation(t_ms=t,gaze={'valid':True,'calibrated':True,'on_screen':True},
        screen={'kind':kind,'task_related':kind=='study','confidence':.95,'context':'平均值：2、4、6 的平均值为 4' if kind=='study' else 'short-video feed'},activity=.3,source=source)


@pytest.fixture
def env(tmp_path):
    store=Store(tmp_path/'bank.db'); u,_=store.create_user('A'); v,_=store.create_user('B')
    return store,Harness(store),u['id'],v['id']


def triggered(h,u, mode='replay'):
    s=h.start(u,Start(goal='理解平均值的计算',study_context='original context',mode=mode))
    source='replay' if mode=='replay' else 'model'
    h.observe(u,s['id'],sample(0,source=source))
    for t in range(1000,10000,1000):
        result=h.observe(u,s['id'],sample(t,'entertainment',source))
    return s,result['episode']


def playback(h,u,e):
    for t in range(9000,22000,1000):
        h.media(u,e['id'],Media(event_id=str(t),kind='play' if t==9000 else 'progress',t_ms=t,position_s=(t-9000)/1000))
    return h.media(u,e['id'],Media(event_id='end',kind='ended',t_ms=22000,position_s=12))


def test_harness_trigger_retrieves_only_owner_and_preserves_last_study(env):
    store,h,u,v=env
    with store.transaction(v) as tx:
        tx.put('memory','secret',{'id':'secret','text':'B secret','active':True,'kind':'episode'})
    s,e=triggered(h,u)
    assert e['study_context'].startswith('平均值')
    assert 'short-video feed' not in e['prompt']
    assert 'B secret' not in e['prompt']
    assert e['retrieved_memories'] == []
    assert h.observe(u,s['id'],sample(9000,'entertainment'))['accepted'] is False
    assert len(h.export(u)['episodes']) == 1
    with pytest.raises(KeyError): h.get_session(v,s['id'])
    assert h.export(v)['episodes'] == []


def test_event_metrics_retain_earlier_trigger_after_decision_log_rolls_over(env):
    from lockin.schemas import Annotation
    from lockin.evaluation import evaluate
    store,h,u,v=env;s,e=triggered(h,u)
    playback(h,u,e);h.answer(u,e['id'],Answer(t_ms=23000,answer='4'))
    for t in range(23000,400000,1000):h.observe(u,s['id'],sample(t))
    h.annotate(u,s['id'],Annotation(start_ms=1000,end_ms=10000,label='off-task'))
    saved=h.get_session(u,s['id'])
    assert len(saved['decisions'])==200
    assert not any(d['trigger'] for d in saved['decisions'])
    metrics=evaluate(saved)
    assert metrics['events']['recall']==1
    assert metrics['events']['segments'][0]['latency_ms']==8000
    assert metrics['events']['history_complete'] is True


def test_quiz_gate_seek_rejection_and_replay_does_not_teach_real_preferences(env):
    store,h,u,v=env; s,e=triggered(h,u)
    with pytest.raises(ValueError): h.answer(u,e['id'],Answer(t_ms=10000,answer='4'))
    h.media(u,e['id'],Media(event_id='play',kind='play',t_ms=9000,position_s=0))
    with pytest.raises(ValueError):
        h.media(u,e['id'],Media(event_id='seek',kind='ended',t_ms=10000,position_s=12))
    playback(h,u,e)
    h.answer(u,e['id'],Answer(t_ms=23000,answer='4'))
    for t in range(23000,144000,1000): h.observe(u,s['id'],sample(t))
    ep=h.get_episode(u,e['id'])
    assert ep['summary']['eligible'] is True
    assert ep['phase']=='complete'
    assert ep['memory_update']['inference_eligible'] is False
    assert not [m for m in h.export(u)['memories'] if m['kind']=='hypothesis']
    assert Harness(Store(store.path)).get_episode(u,e['id'])['phase']=='complete'


def test_automatic_inference_and_retraction(env):
    store,h,u,v=env
    # Inject a complete observed episode at the persistence boundary to avoid a real 143-second wait.
    with store.transaction(u) as tx:
        tx.put('episode','observed',{'id':'observed','goal':'统计学习','phase':'complete','input_source':'model','mode':'live','false_alarm':False,'return_sources':['model'],
            'video':{'style':'humor','matched':True},'summary':{'eligible':True,'coverage':1,'on_task_share':.9,'recovered_after_ms':4000},'created_at':'2026-01-01','memory_update':None})
    h.refresh_memories(u)
    memories=h.export(u)['memories']
    hypothesis=next(m for m in memories if m['kind']=='hypothesis')
    assert hypothesis['count']==1
    assert hypothesis['evidence_ids']==['observed']
    assert hypothesis['confidence']=='tentative'
    h.correct(u,'observed',Correction(false_alarm=True,note='false positive'))
    assert not [m for m in h.export(u)['memories'] if m['kind']=='hypothesis' and m['active']]


def test_abort_and_unknown_coverage_do_not_teach(env):
    store,h,u,v=env; s,e=triggered(h,u)
    h.media(u,e['id'],Media(event_id='abort',kind='abort',t_ms=10000))
    ep=h.get_episode(u,e['id'])
    assert ep['phase']=='aborted'
    assert ep['summary']['eligible'] is False
    assert ep['memory_update']['inference_eligible'] is False


def test_manual_return_samples_cannot_create_automatic_preference(env):
    store,h,u,v=env
    with store.transaction(u) as tx:
        tx.put('episode','mixed',{'id':'mixed','goal':'统计学习','phase':'complete','input_source':'model','mode':'live','false_alarm':False,
            'return_sources':['manual'],'video':{'style':'humor','matched':True},'summary':{'eligible':True,'coverage':1,'on_task_share':.9},'memory_update':None})
    h.refresh_memories(u)
    assert not [m for m in h.export(u)['memories'] if m['kind']=='hypothesis' and m['active']]


def test_out_of_order_media_does_not_credit_unobserved_time(env):
    store,h,u,v=env;s,e=triggered(h,u)
    h.media(u,e['id'],Media(event_id='play',kind='play',t_ms=9000))
    with pytest.raises(ValueError):h.media(u,e['id'],Media(event_id='past',kind='progress',t_ms=8000,position_s=1))
    h.media(u,e['id'],Media(event_id='gap',kind='progress',t_ms=29000,position_s=12))
    with pytest.raises(ValueError):h.media(u,e['id'],Media(event_id='end-gap',kind='ended',t_ms=30000,position_s=12))


def test_correction_updates_visible_memory_status(env):
    store,h,u,v=env;s,e=triggered(h,u);h.media(u,e['id'],Media(event_id='abort',kind='abort',t_ms=10000))
    h.correct(u,e['id'],Correction(false_alarm=True))
    ep=h.get_episode(u,e['id'])
    assert ep['memory_update']['inference_eligible'] is False
    assert ep['trace'][-1]['step']=='correction'


def test_full_automatic_lifecycle_teaches_next_prompt_without_confirmation(env):
    from datetime import datetime,timedelta,timezone
    store,h,u,v=env
    s=h.start(u,Start(goal='理解平均值的计算',mode='live'))
    with store.transaction(u) as tx:
        doc=tx.get('session',s['id']);doc['created_at']=(datetime.now(timezone.utc)-timedelta(seconds=250)).isoformat();tx.put('session',s['id'],doc)
    h.observe(u,s['id'],sample(0,'study','model'))
    for t in range(1000,10000,1000):result=h.observe(u,s['id'],sample(t,'entertainment','model'))
    e=result['episode'];playback(h,u,e);h.answer(u,e['id'],Answer(t_ms=23000,answer='4'))
    for t in range(23000,144000,1000):h.observe(u,s['id'],sample(t,'study','model'))
    ep=h.get_episode(u,e['id'])
    assert ep['memory_update']['inference_eligible'] is True
    assert ep['summary']['coverage']==1
    hypothesis=next(m for m in h.export(u)['memories'] if m['kind']=='hypothesis' and m['active'])
    assert hypothesis['count']==1 and hypothesis['mean_on_task_share']==1
    h.observe(u,s['id'],sample(180000,'study','model'))
    for t in range(181000,190000,1000):result=h.observe(u,s['id'],sample(t,'entertainment','model'))
    assert any(m['id']=='style:plain' for m in result['episode']['retrieved_memories'])
    assert e['id'] in result['episode']['prompt']
    assert h.export(v)['memories']==[]


def test_concurrent_duplicate_trigger_cannot_create_multiple_episodes(env):
    from concurrent.futures import ThreadPoolExecutor
    store,h,u,v=env;s=h.start(u,Start(goal='test',mode='replay'))
    for t in range(0,8000,1000):h.observe(u,s['id'],sample(t,'entertainment'))
    with ThreadPoolExecutor(max_workers=3) as pool:
        results=list(pool.map(lambda _:h.observe(u,s['id'],sample(8000,'entertainment')),range(3)))
    assert sum(bool(r['accepted']) for r in results)==1
    assert len(h.export(u)['episodes'])==1


def test_end_is_atomic_against_trigger_at_transaction_boundary(env):
    from contextlib import contextmanager
    store,h,u,v=env;s=h.start(u,Start(goal='test',mode='replay'))
    for t in range(0,8000,1000):h.observe(u,s['id'],sample(t,'entertainment'))
    original=store.transaction;armed=True
    @contextmanager
    def interleaved(user):
        nonlocal armed
        with original(user) as tx:yield tx
        if armed:
            armed=False
            try:h.observe(u,s['id'],sample(8000,'entertainment'))
            except ValueError:pass  # An atomic end must reject this later observation.
    store.transaction=interleaved
    h.end(u,s['id'])
    data=h.export(u)
    assert data['sessions'][0]['phase']=='ended'
    assert not [e for e in data['episodes'] if e['phase'] in ['video','quiz','recovery']]


def test_media_cannot_reactivate_ended_session(env):
    store,h,u,v=env;s,e=triggered(h,u)
    with store.transaction(u) as tx:
        doc=tx.get('session',s['id']);doc['phase']='ended';tx.put('session',s['id'],doc)
    with pytest.raises(ValueError):h.media(u,e['id'],Media(event_id='late',kind='play',t_ms=10000))
    assert h.get_session(u,s['id'])['phase']=='ended'


def test_recent_local_video_replaces_unavailable_older_entry(env):
    store,h,u,v=env
    with store.transaction(u) as tx:
        for id in ['old-file','new-file']:
            tx.put('video',id,{'id':id,'title':id,'goal':'理解平均值的计算','style':'plain','duration_s':12,'question':'recall','url':None,'source':'local'})
    _,e=triggered(h,u)
    assert e['video']['id']=='new-file'


def test_study_context_updates_during_cooldown(env):
    store,h,u,v=env
    s=h.start(u,Start(goal='test',study_context='old chapter',mode='replay'))
    with store.transaction(u) as tx:
        doc=tx.get('session',s['id']);doc['cooldown_until']=30000;tx.put('session',s['id'],doc)
    o=sample(20000);o.screen.context='new chapter: median and outliers';h.observe(u,s['id'],o)
    for t in range(30000,39000,1000):result=h.observe(u,s['id'],sample(t,'entertainment'))
    assert result['episode']['study_context']=='new chapter: median and outliers'


def test_restore_false_alarm_recomputes_visible_eligibility(env):
    store,h,u,v=env
    with store.transaction(u) as tx:
        tx.put('episode','observed',{'id':'observed','goal':'math','mode':'live','input_source':'model','return_sources':['model'],'false_alarm':False,
         'video':{'style':'plain','matched':True},'summary':{'eligible':True,'on_task_share':1},'memory_update':{'inference_eligible':True},'trace':[]})
    h.correct(u,'observed',Correction(false_alarm=True));h.correct(u,'observed',Correction(false_alarm=False))
    assert h.get_episode(u,'observed')['memory_update']['inference_eligible'] is True


def test_replay_has_own_demo_memories_but_never_affects_real_bank(env):
    store,h,u,v=env;s,e=triggered(h,u);playback(h,u,e);h.answer(u,e['id'],Answer(t_ms=23000,answer='4'))
    for t in range(23000,144000,1000):h.observe(u,s['id'],sample(t))
    with store.transaction(u) as tx:
        real,_=h.memory.retrieve(tx,'理解平均值的计算')
        demo,_=h.memory.retrieve(tx,'理解平均值的计算',sandbox=True)
    assert real==[]
    assert any(m['kind']=='demo_hypothesis' and m['synthetic'] for m in demo)
    h.observe(u,s['id'],sample(180000))
    for t in range(181000,190000,1000):result=h.observe(u,s['id'],sample(t,'entertainment'))
    assert any(m['kind']=='demo_hypothesis' for m in result['episode']['retrieved_memories'])
    assert result['episode']['memory_namespace']=='replay_sandbox'
    assert not [m for m in h.export(v)['memories']]
