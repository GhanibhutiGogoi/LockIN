#!/usr/bin/env python3
"""Explicit live-model QA with synthetic screens and isolated replay state.

Cloud calls: three self-made images only. No webcam, desktop capture or real bank.
Run manually: .venv/bin/python scripts/verify-demo.py
"""
import base64
import json
from pathlib import Path
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from fastapi.testclient import TestClient
from lockin.app import create_app
from lockin.providers import configured_screen,configured_memory


def run():
    goal='Understand how to calculate the arithmetic mean'
    checks=[]
    fixtures=[('study',ROOT/'backend/tests/fixtures/study-screen.png',True),
        ('entertainment',ROOT/'backend/tests/fixtures/entertainment-screen.png',False),
        ('related_video',ROOT/'backend/tests/fixtures/related-video-screen.png',True)]
    def classify(item):
        label,path,related=item;p=configured_screen();start=time.monotonic()
        data='data:image/png;base64,'+base64.b64encode(path.read_bytes()).decode()
        screen=p.classify(data,goal)
        assert p.last_error is None,(label,p.last_error)
        assert screen.task_related is related and screen.confidence>=.75,(label,screen.model_dump())
        if not related:assert screen.kind=='entertainment'
        return label,screen.model_dump(),round(time.monotonic()-start,2)
    with ThreadPoolExecutor(max_workers=3) as pool:predictions=list(pool.map(classify,fixtures))
    screens={label:value for label,value,_ in predictions}
    for label,value,seconds in predictions:checks.append({'check':'live_vision_'+label,'pass':True,'seconds':seconds,'result':value})
    with tempfile.TemporaryDirectory(prefix='lockin-synthetic-qa-') as temp,TestClient(create_app(Path(temp)/'qa.db',memory=configured_memory())) as c:
        def user(name):
            r=c.post('/v1/users',json={'name':name});r.raise_for_status();return {'Authorization':'Bearer '+r.json()['token']}
        a=user('synthetic A');b=user('synthetic B')
        def post(path,body):
            r=c.post(path,headers=a,json=body);assert r.status_code==200,(path,r.status_code,r.text);return r.json()
        s=post('/v1/sessions',{'goal':'理解平均值的计算','mode':'replay','study_context':'initial study context'});sid=s['id'];base='/v1/sessions/'+sid
        def observe(t,screen,gaze=True):
            return post(base+'/observations',{'t_ms':t,'screen':screen,'source':'replay','activity':.3,
              'gaze':{'valid':gaze,'calibrated':gaze,'on_screen':True if gaze else None}})
        observe(0,screens['study'])
        for t in range(1000,10000,1000):
            r=observe(t,screens['related_video']);assert r['episode'] is None
        checks.append({'check':'related_learning_video_does_not_trigger','pass':True})
        for t in range(10000,14000,1000):
            r=observe(t,screens['entertainment'],False);assert r['episode'] is None
        checks.append({'check':'invalid_gaze_does_not_trigger','pass':True})
        for t in range(14000,23000,1000):r=observe(t,screens['entertainment'])
        ep=r['episode'];assert ep and ep['trigger']['dwell_ms']==8000
        assert ep['study_context']==screens['related_video']['context']
        eid=ep['id'];episode_path='/v1/episodes/'+eid
        checks.append({'check':'joint_gate_triggers_after_sustained_entertainment','pass':True})
        early=c.post(episode_path+'/answer',headers=a,json={'t_ms':23000,'answer':'4'});assert early.status_code==400
        for i in range(13):post(episode_path+'/media',{'event_id':'qa-'+str(i),'kind':'play' if i==0 else 'progress','t_ms':23000+i*1000,'position_s':i})
        post(episode_path+'/media',{'event_id':'qa-end','kind':'ended','t_ms':36000,'position_s':12})
        post(episode_path+'/answer',{'t_ms':37000,'answer':'4'})
        checks.append({'check':'video_progress_and_quiz_gate_simulated_events','pass':True})
        for t in range(37000,158000,1000):r=observe(t,screens['study'])
        completed=c.get(episode_path,headers=a).json()
        assert completed['phase']=='complete' and completed['summary']['coverage']==1
        assert completed['summary']['recovered_after_ms']==4000
        assert completed['memory_update']['inference_eligible'] is False
        checks.append({'check':'recovery_window_and_synthetic_source_exclusion','pass':True,'summary':completed['summary']})
        observe(190000,screens['study'])
        for t in range(191000,200000,1000):r=observe(t,screens['entertainment'])
        assert any(m['id']=='demo-style:plain' for m in r['episode']['retrieved_memories'])
        assert eid in r['episode']['prompt']
        assert r['episode']['retrieval_method']=='multilingual-e5-small'
        checks.append({'check':'next_trigger_retrieves_updated_memory_with_actual_e5','pass':True})
        assert c.get(episode_path,headers=b).status_code==404
        assert c.get('/v1/bank',headers=b).json()['memories']==[]
        checks.append({'check':'user_bank_isolation','pass':True})
        post(episode_path+'/correction',{'false_alarm':True,'note':'synthetic QA correction'})
        bank=c.get('/v1/bank',headers=a).json()
        assert not [m for m in bank['memories'] if m['kind']=='demo_hypothesis' and m['active']]
        checks.append({'check':'false_alarm_retracts_inferred_memory','pass':True})
        post(base+'/end',{})
        final=c.get('/v1/episodes/'+r['episode']['id'],headers=a).json()
        assert final['phase']=='aborted' and final['summary']['eligible'] is False
        checks.append({'check':'abort_is_not_recovery_success','pass':True})
    report={'test_type':'actual NVIDIA + actual local E5 + simulated gaze/media + temporary SQLite',
        'camera_used':False,'user_screen_used':False,'real_bank_modified':False,'checks':checks}
    (ROOT/'docs/superpowers/plans/2026-11-05-independent-demo-test.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':run()
