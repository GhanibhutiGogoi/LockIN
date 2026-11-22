import copy
import math
import pytest
from lockin.stress.features import SCHEMA, NAMES, aggregate, validate_values
from lockin.stress.model import StressModel


def frame(t, value=.2, valid=True):
    return {'t_ms':t,'valid':valid,'values':[value]*52 if valid else None}


def artifact():
    return {'version':1,'feature_schema':SCHEMA,'feature_names':NAMES,
        'extractor':'mediapipe-face-landmarker-0.10.18','window_ms':20000,
        'source_kind':'real_self_report','runtime_eligible':True,
        'validation':{'eligible':True},'model_id':'test-coefficients',
        'kind':'logistic','mean':[0.]*104,'scale':[1.]*104,
        'coef':[1.]*104,'intercept':0.}


def test_window_is_causal_and_uses_coverage_not_frame_count():
    rows=[frame(t) for t in range(0,20500,500)]+[frame(30000,.9)]
    result=aggregate(rows,20000)
    assert result['coverage']==1
    assert result['vector'][:52]==pytest.approx([.2]*52)
    assert result['vector'][52:]==pytest.approx([0.]*52,abs=1e-8)
    assert aggregate(rows[:3],20000)['vector'] is None


def test_duplicate_frames_and_missing_intervals_cannot_create_coverage():
    assert aggregate([frame(0)]*100,20000)['coverage']==0
    assert aggregate([frame(0),frame(20000)],20000)['vector'] is None
    rows=[frame(t,valid=t<2000) for t in range(0,20500,500)]
    assert aggregate(rows,20000)['coverage']==.1


@pytest.mark.parametrize('bad',[[.1]*51,[.1]*53,[math.nan]*52,[-.1]*52,[1.1]*52])
def test_nonfinite_wrong_shape_and_out_of_range_features_rejected(bad):
    with pytest.raises(ValueError):validate_values(bad)


def test_missing_or_incompatible_model_is_explicitly_unknown():
    assert StressModel().predict([.2]*104)['state']=='unknown'
    wrong=artifact();wrong['feature_schema']='openface-au-v1'
    assert StressModel(wrong).predict([.2]*104)['reason']=='incompatible_model'
    wrong=artifact();wrong['source_kind']='synthetic'
    assert StressModel(wrong).predict([.2]*104)['state']=='unknown'


def test_portable_logistic_model_predicts_without_loading_executable_weights():
    a=artifact();a.update(coef=[0.]*104,intercept=math.log(4))
    model=StressModel(a)
    r=model.predict([.2]*104)
    assert r['score']==pytest.approx(.8)
    assert r['state']=='possible_tension'
    assert r['experimental'] is True
    for key,value in [('coef',[0.]),('scale',[0.]*104),('intercept',math.inf)]:
        broken=copy.deepcopy(a);broken[key]=value
        assert StressModel(broken).predict([.2]*104)['state']=='unknown'


def test_unknown_model_kind_or_unvalidated_artifact_is_not_enabled():
    for change in [{'kind':'pickle'},{'validation':{'eligible':False}},{'runtime_eligible':False}]:
        a=artifact();a.update(change)
        assert StressModel(a).predict([.2]*104)['state']=='unknown'


def test_unrepresentable_artifact_and_overflow_math_fail_closed(tmp_path):
    import json
    a=artifact();a['mean'][0]=10**400
    file=tmp_path/'bad.json';file.write_text(json.dumps(a))
    assert StressModel.load(file).predict([.2]*104)['state']=='unknown'
    a=artifact();a.update(scale=[1e-320]*104,coef=[0.]*104,intercept=0.)
    assert StressModel(a).predict([.2]*104)['state']=='unknown'
    a=artifact();a.update(coef=[1e308]*104,intercept=0.)
    assert StressModel(a).predict([1.]*104)['state']=='unknown'


def test_portable_forest_uses_same_float32_split_input_as_sklearn():
    a=artifact();a.update(kind='forest',trees=[{'feature':[0,-2,-2],'left':[1,-1,-1],
        'right':[2,-1,-1],'threshold':[.5,-2.,-2.],'probability':[.5,0.,1.]}])
    # 0.50000001 rounds to exactly .5 for sklearn's float32 tree input.
    assert StressModel(a).predict([.50000001]+[0.]*103)['score']==0.
