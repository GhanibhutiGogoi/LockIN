import pytest
from lockin.stress.schemas import FeatureFrame,StartStress
from lockin.stress.service import StressService
from lockin.store import Store

MODEL='ferplus-8-a2a2ba6a'

def frame(t,scores=None):
    return FeatureFrame(t_ms=t,valid=True,values=[.2]*52,
        expression={'model_id':MODEL,'probabilities':scores or [.02,.01,.01,.8,.05,.03,.05,.03]})


def test_expression_contract_rejects_bad_probability_evidence():
    with pytest.raises(ValueError):frame(0,[.1]*8)
    with pytest.raises(ValueError):frame(0,[float('nan')]+[0.]*7)
    with pytest.raises(ValueError):FeatureFrame(t_ms=0,valid=False,expression={'model_id':MODEL,'probabilities':[1.]+[0.]*7})


def test_pretrained_expression_triggers_with_honest_provenance_and_unknown_resets(tmp_path,monkeypatch):
    import importlib
    from datetime import datetime,timedelta
    module=importlib.import_module('lockin.stress.service')
    store=Store(tmp_path/'test.db');a,_=store.create_user('A');service=StressService(store)
    s=service.start(a['id'],StartStress(mode='live',inference='expression_proxy'))
    base=datetime.fromisoformat(s['created_at']);clock=[base]
    class Clock(datetime):
        @classmethod
        def now(cls,tz):return clock[0]
    monkeypatch.setattr(module,'datetime',Clock)
    for t in range(0,40500,500):
        clock[0]=base+timedelta(milliseconds=t)
        r=service.observe(a['id'],s['id'],frame(t))
    e=r['event'];assert e is not None
    assert e['source']=='pretrained_expression_proxy'
    assert e['model']['model_id']==MODEL
    assert e['model_score'] is None
    assert e['expression_score']>.9
    assert e['reason']=='continuous_negative_expression_10s'
    assert e['model']['target']=='facial_expression_not_stress'
    clock[0]=base+timedelta(milliseconds=40500)
    r=service.observe(a['id'],s['id'],FeatureFrame(t_ms=40500,valid=True,values=[.2]*52))
    assert r['prediction']['state']=='unknown'
    assert r['session']['since'] is None


def test_expression_probabilities_cannot_enable_the_stress_classifier(tmp_path):
    store=Store(tmp_path/'test.db');a,_=store.create_user('A');service=StressService(store)
    s=service.start(a['id'],StartStress(mode='live'))
    r=service.observe(a['id'],s['id'],frame(0))
    assert s['inference']=='stress_model'
    assert r['prediction']['state']=='unknown'

@pytest.mark.parametrize('scores,state',[
    ([.9,.03,.02,.01,.01,.01,.01,.01],'no_clear_tension'),
    ([.01,.01,.94,.01,.01,.01,.005,.005],'unknown'),
    ([.02,.01,.01,.8,.05,.03,.05,.03],'possible_tension'),
    ([.02,.01,.01,.2,.2,.2,.18,.18],'unknown'),
])
def test_expression_abstention_is_not_a_pressure_percentage(scores,state):
    from lockin.stress.expression import predict
    result=predict(frame(0,scores).expression,True)
    assert result['state']==state
    assert result['score'] is None
    assert result['model']['pressure_validated'] is False


def test_expression_model_identity_cannot_be_substituted():
    with pytest.raises(ValueError):
        FeatureFrame(t_ms=0,valid=True,values=[.2]*52,expression={'model_id':'fake-stress','probabilities':[1.]+[0.]*7})


def test_missing_runtime_cannot_be_reported_as_ready(tmp_path):
    from lockin.stress import expression
    assert hasattr(expression,'assets_present')
    for name in ['models/emotion-ferplus-8.onnx','ort/ort.wasm.min.js']:
        p=tmp_path/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'fixture')
    assert expression.assets_present(tmp_path) is False
    for name in ['expression-worker.js','gaze-worker.js','ort/ort-wasm-simd-threaded.mjs','ort/ort-wasm-simd-threaded.wasm']:
        p=tmp_path/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'fixture')
    assert expression.assets_present(tmp_path) is True
