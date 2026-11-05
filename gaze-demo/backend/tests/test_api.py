import json
import httpx
import pytest
from fastapi.testclient import TestClient
from lockin.app import create_app
from lockin.providers import ScreenProvider


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path/'api.db')) as c:yield c


def identity(c,name):
    r=c.post('/v1/users',json={'name':name});assert r.status_code==200
    return {'Authorization':'Bearer '+r.json()['token']}


def test_api_scope_demo_and_validation(client):
    c=client;a=identity(c,'A');b=identity(c,'B')
    assert c.get('/v1/bank').status_code==401
    s=c.post('/v1/sessions',headers=a,json={'goal':'平均值','mode':'replay'}).json()
    assert c.get('/v1/sessions/'+s['id'],headers=b).status_code==404
    assert c.get('/v1/bank',headers=b).json()['sessions']==[]
    assert c.post('/v1/sessions/'+s['id']+'/observations',headers=a,json={'t_ms':-1}).status_code==422
    assert c.get('/debug').status_code==200
    assert c.get('/v1/status',headers=a).json()['screen']['configured'] in [True,False]
    assert c.get('/v1/bank',headers=a).json()['user_id'] != c.get('/v1/bank',headers=b).json()['user_id']


def test_frame_requires_consent_and_live_session(client):
    c=client;a=identity(c,'A')
    s=c.post('/v1/sessions',headers=a,json={'goal':'math','mode':'live'}).json()
    payload={'t_ms':0,'image':'data:image/png;base64,aGk=','gaze':{},'activity':.2}
    assert c.post('/v1/sessions/'+s['id']+'/frames',headers=a,json=payload).status_code==400
    assert c.post('/v1/sessions/'+s['id']+'/observations',headers=a,json={'t_ms':0,'source':'model'}).status_code==400
    assert c.post('/v1/sessions/'+s['id']+'/end',headers=a,json={}).status_code==200
    assert c.post('/v1/sessions',headers=a,json={'goal':'math','mode':'live'}).status_code==200


def test_annotations_export_and_metrics(client):
    c=client;a=identity(c,'A')
    s=c.post('/v1/sessions',headers=a,json={'goal':'test','mode':'replay'}).json();base='/v1/sessions/'+s['id']
    for t in range(0,10000,1000):
        c.post(base+'/observations',headers=a,json={'t_ms':t,'gaze':{'valid':True,'calibrated':True,'on_screen':True},
          'screen':{'kind':'entertainment','task_related':False,'confidence':1},'activity':.3,'source':'replay'})
    assert c.post(base+'/annotations',headers=a,json={'start_ms':0,'end_ms':9000,'label':'off-task'}).status_code==200
    assert c.get(base+'/evaluation',headers=a).json()['recall']==1
    assert c.post(base+'/annotations',headers=a,json={'start_ms':100,'end_ms':50,'label':'off-task'}).status_code==400
    assert c.get('/v1/bank',headers=a).json()['sessions'][0]['annotations'][0]['label']=='off-task'


def test_screen_provider_contract_and_malformed_response():
    def response(request):
        body=json.loads(request.content)
        assert body['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/')
        assert body['model']=='test-vlm'
        return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps({'kind':'study','task_related':True,'confidence':.9,'context':'mean formula'})}}]})
    p=ScreenProvider('http://model/v1','secret','test-vlm',transport=httpx.MockTransport(response))
    assert p.classify('data:image/png;base64,aGk=','learn mean').kind=='study'
    def broken(request):return httpx.Response(200,json={'choices':[{'message':{'content':'{"confidence":900}'}}]})
    p=ScreenProvider('http://model/v1','secret','test-vlm',transport=httpx.MockTransport(broken))
    assert p.classify('data:image/png;base64,aGk=','math').kind=='unknown'
    assert p.status()['last_error']=='invalid_model_response'


def test_live_rejects_stale_frames_without_upload(client):
    import base64
    from datetime import datetime,timedelta,timezone
    c=client;a=identity(c,'A')
    s=c.post('/v1/sessions',headers=a,json={'goal':'math','mode':'live'}).json()
    h=c.app.state.harness
    with h.store.transaction(c.get('/v1/bank',headers=a).json()['user_id']) as tx:
        doc=tx.get('session',s['id']);doc['created_at']=(datetime.now(timezone.utc)-timedelta(seconds=60)).isoformat();tx.put('session',s['id'],doc)
    payload={'t_ms':0,'image':'data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode(),'gaze':{},'activity':.2,'consent':True}
    assert c.post('/v1/sessions/'+s['id']+'/frames',headers=a,json=payload).status_code==400


@pytest.mark.parametrize('entry_age,inference_ms,expected',[(3900,3900,'unknown'),(0,3900,'entertainment'),(0,4100,'unknown')])
def test_total_capture_age_is_rechecked_after_inference(tmp_path,monkeypatch,entry_age,inference_ms,expected):
    from datetime import datetime,timedelta,timezone
    import importlib
    from lockin.schemas import Screen
    module=importlib.import_module('lockin.app')
    clock=[datetime.now(timezone.utc)]
    class Clock(datetime):
        @classmethod
        def now(cls,tz):return clock[0]
    class Provider:
        last_error=None
        validate_image=staticmethod(ScreenProvider.validate_image)
        def status(self):return {'last_error':self.last_error}
        def classify(self,image,goal):
            clock[0]+=timedelta(milliseconds=inference_ms)
            return Screen(kind='entertainment',task_related=False,confidence=.99)
    monkeypatch.setattr(module,'datetime',Clock)
    with TestClient(create_app(tmp_path/'freshness.db',screen_provider=Provider())) as c:
        a=identity(c,'A');s=c.post('/v1/sessions',headers=a,json={'goal':'math','mode':'live'}).json()
        # Only the request clock advances; the real harness still validates its timestamps.
        clock[0]=datetime.fromisoformat(s['created_at'])+timedelta(milliseconds=entry_age)
        image='data:image/png;base64,iVBORw0KGgpmaXh0dXJl'
        r=c.post('/v1/sessions/'+s['id']+'/frames',headers=a,json={'t_ms':0,'consent':True,
            'image':image,'gaze':{'valid':True,'calibrated':True,'on_screen':True},'activity':.3})
        assert r.status_code==200,r.text
        assert r.json()['screen']['kind']==expected
        stored=c.get('/v1/sessions/'+s['id'],headers=a).json()['samples'][0]
        assert stored['screen']['kind']==expected
        if expected=='unknown':assert r.json()['provider']['last_error']=='stale_model_result'


def test_cross_origin_cannot_create_users(client):
    assert client.post('/v1/users',headers={'Origin':'https://untrusted.example'},json={'name':'bad'}).status_code==403


def test_live_3_9_second_requests_trigger_and_record_actual_emission_time(tmp_path,monkeypatch):
    import importlib
    from datetime import datetime,timedelta,timezone
    from lockin.schemas import Screen
    clock=[datetime.now(timezone.utc)]
    class Clock(datetime):
        @classmethod
        def now(cls,tz):return clock[0]
    class Provider:
        last_error=None
        validate_image=staticmethod(ScreenProvider.validate_image)
        def status(self):return {'last_error':self.last_error}
        def classify(self,image,goal):
            clock[0]+=timedelta(milliseconds=3900)
            return Screen(kind='entertainment',task_related=False,confidence=.99)
    for name in ['lockin.app','lockin.harness']:monkeypatch.setattr(importlib.import_module(name),'datetime',Clock)
    with TestClient(create_app(tmp_path/'cadence.db',screen_provider=Provider())) as c:
        a=identity(c,'A');s=c.post('/v1/sessions',headers=a,json={'goal':'math','mode':'live'}).json()
        clock[0]=datetime.fromisoformat(s['created_at']);base='/v1/sessions/'+s['id']
        for captured in [0,3900,7800,11700]:
            r=c.post(base+'/frames',headers=a,json={'t_ms':captured,'consent':True,
                'image':'data:image/png;base64,iVBORw0KGgpmaXh0dXJl',
                'gaze':{'valid':True,'calibrated':True,'on_screen':True},'activity':.3})
            assert r.status_code==200,r.text
        assert r.json()['episode'] is not None
        trigger=r.json()['session']['trigger_events'][0]
        assert trigger['t_ms']==11700
        assert trigger['emitted_at_ms']==15600
        c.post(base+'/annotations',headers=a,json={'start_ms':0,'end_ms':13000,'label':'off-task'})
        c.post(base+'/annotations',headers=a,json={'start_ms':13000,'end_ms':18000,'label':'on-task'})
        metrics=c.get(base+'/evaluation',headers=a).json()
        assert metrics['events']['recall']==0
        assert metrics['events']['false_alarms']==1


def test_ended_session_is_rejected_before_screen_provider_upload(tmp_path):
    import base64
    from lockin.schemas import Screen
    class UploadSpy:
        calls=0
        validate_image=staticmethod(ScreenProvider.validate_image)
        def status(self):return {'configured':True}
        def classify(self,image,goal):self.calls+=1;return Screen()
    provider=UploadSpy()
    with TestClient(create_app(tmp_path/'upload.db',screen_provider=provider)) as c:
        a=identity(c,'A');s=c.post('/v1/sessions',headers=a,json={'goal':'math','mode':'live'}).json()
        c.post('/v1/sessions/'+s['id']+'/end',headers=a,json={})
        data={'t_ms':0,'consent':True,'image':'data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode(),'gaze':{},'activity':.2}
        assert c.post('/v1/sessions/'+s['id']+'/frames',headers=a,json=data).status_code==400
        assert provider.calls==0


@pytest.mark.parametrize('model,option',[
 ('nvidia/nemotron-3.5-super-vl-120b-a12b',{'chat_template_kwargs':{'enable_thinking':False}}),
 ('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',{'reasoning_budget':0}),
])
def test_nvidia_screen_adapter_disables_reasoning_for_low_latency_json(model,option):
    def respond(request):
        body=json.loads(request.content)
        for key,value in option.items():assert body.get(key)==value
        return httpx.Response(200,json={'choices':[{'message':{'content':'{"kind":"study","task_related":true,"confidence":0.95,"context":"Mean formula"}'}}]})
    p=ScreenProvider('https://integrate.api.nvidia.com/v1','nvapi-fixture',model,transport=httpx.MockTransport(respond))
    assert p.classify('data:image/png;base64,aGk=','learn mean').kind=='study'
