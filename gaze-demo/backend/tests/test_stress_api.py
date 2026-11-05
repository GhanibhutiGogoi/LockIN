from fastapi.testclient import TestClient
from lockin.app import create_app


def test_stress_routes_are_scoped_and_replay_lifecycle_is_inspectable(tmp_path):
    with TestClient(create_app(tmp_path/'api.db')) as c:
        def user(name):return {'Authorization':'Bearer '+c.post('/v1/users',json={'name':name}).json()['token']}
        a=user('A');b=user('B')
        assert c.get('/v1/stress/status').status_code==401
        status=c.get('/v1/stress/status',headers=a)
        assert status.status_code==200
        assert status.json()['model']['available'] is False
        assert len(status.json()['feature_names'])==52
        assert c.get('/stress-debug').status_code==200
        s=c.post('/v1/stress/sessions',headers=a,json={'mode':'replay'}).json();sid=s['id']
        assert c.get('/v1/stress/sessions/'+sid,headers=b).status_code==404
        for t in range(0,11000,1000):
            r=c.post('/v1/stress/sessions/'+sid+'/replay',headers=a,json={'t_ms':t,'state':'possible_tension'})
            assert r.status_code==200
        event=r.json()['event'];eid=event['id']
        assert c.post('/v1/stress/events/'+eid+'/action',headers=a,json={'t_ms':10000,'kind':'shown'}).status_code==200
        assert c.post('/v1/stress/events/'+eid+'/feedback',headers=a,json={'helpful':True}).status_code==200
        bank=c.get('/v1/stress/bank',headers=a).json()
        assert any(m['active'] for m in bank['memories'])
        assert c.get('/v1/stress/bank',headers=b).json()['events']==[]
        assert c.post('/v1/stress/events/'+eid+'/correction',headers=a,json={'excluded':True}).status_code==200
        assert not any(m['active'] for m in c.get('/v1/stress/bank',headers=a).json()['memories'])
        assert c.post('/v1/stress/sessions/'+sid+'/end',headers=a,json={}).status_code==200


def test_client_cannot_supply_model_score_or_send_cross_origin_requests(tmp_path):
    with TestClient(create_app(tmp_path/'api.db')) as c:
        a={'Authorization':'Bearer '+c.post('/v1/users',json={'name':'A'}).json()['token']}
        sid=c.post('/v1/stress/sessions',headers=a,json={'mode':'live'}).json()['id']
        base='/v1/stress/sessions/'+sid
        assert c.post(base+'/frames',headers=a,json={'t_ms':0,'valid':True,'values':[.2]*52,'score':1}).status_code==422
        assert c.post(base+'/replay',headers=a,json={'t_ms':0,'state':'possible_tension'}).status_code==400
        assert c.post(base+'/frames',headers={**a,'Origin':'https://bad.example'},json={'t_ms':0,'valid':False}).status_code==403
