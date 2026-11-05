"""All arrays here are artificial unit fixtures, never evidence of stress accuracy."""
import copy
import pytest
from lockin.stress.training import train, validate_dataset, export_estimator
from lockin.stress.features import SCHEMA,EXTRACTOR,NAMES
from lockin.stress.model import StressModel


def dataset():
    rows=[]
    for person in range(15):
        for sample in range(8):
            label=sample%2
            rows.append({'subject':f'p{person:02}','session':'unit','start_ms':sample*20000,
                'end_ms':(sample+1)*20000,'label':label,'vector':[.15+.5*label+person*.001]*52+[.01]*52})
    manifest={'version':1,'feature_schema':SCHEMA,'extractor':EXTRACTOR,'window_ms':20000,
        'source_kind':'synthetic_test','license':'unit-only','label_kind':'self_report',
        'source_url':'https://example.invalid/unit-fixture'}
    return rows,manifest


def test_training_is_subject_disjoint_and_fixture_cannot_be_enabled():
    rows,m=dataset();artifact,report=train(rows,m)
    splits=report['split_subjects'];a,b,c=map(set,[splits['train'],splits['validation'],splits['test']])
    assert not a&b and not a&c and not b&c
    assert len(a|b|c)==15
    assert artifact['runtime_eligible'] is False
    assert report['source_kind']=='synthetic_test'
    assert StressModel(artifact).predict([.5]*104)['state']=='unknown'
    # Only training rows determine scaling, including the final exported artifact.
    train_values=[r['vector'][0] for r in rows if r['subject'] in a]
    assert artifact['mean'][0]==pytest.approx(sum(train_values)/len(train_values))


@pytest.mark.parametrize('mutation',[
    lambda rows,m:m.update(label_kind='emotion_mapping'),
    lambda rows,m:m.update(feature_schema='openface-au-v1'),
    lambda rows,m:rows[0].update(label=None),
    lambda rows,m:rows[0].update(vector=[.1]*80),
    lambda rows,m:rows[0].update(end_ms=1),
])
def test_incompatible_or_unlabelled_training_data_is_rejected(mutation):
    rows,m=dataset();mutation(rows,m)
    with pytest.raises(ValueError):validate_dataset(rows,m)


def test_portable_forest_and_logistic_predictions_match_sklearn():
    import numpy as np
    from sklearn.preprocessing import StandardScaler
    from sklearn.linear_model import LogisticRegression
    from sklearn.ensemble import RandomForestClassifier
    rows,m=dataset();x=np.array([r['vector'] for r in rows]);y=np.array([r['label'] for r in rows])
    scaler=StandardScaler().fit(x);scaled=scaler.transform(x)
    for estimator in [LogisticRegression(),RandomForestClassifier(n_estimators=8,max_depth=3,random_state=42)]:
        estimator.fit(scaled,y)
        a=export_estimator(estimator,scaler,m)
        # A contract fixture exercises runtime math, not real validation claims.
        a.update(source_kind='real_self_report',runtime_eligible=True,validation={'eligible':True})
        model=StressModel(a)
        assert model.reason is None
        expected=estimator.predict_proba(scaled)[:,1]
        assert [model.predict(row.tolist())['score'] for row in x]==pytest.approx(expected)


def test_held_out_rows_do_not_affect_candidate_selection_or_scaling():
    rows,m=dataset();a,r=train(rows,m);test_subjects=set(r['split_subjects']['test'])
    changed=copy.deepcopy(rows)
    for row in changed:
        if row['subject'] in test_subjects:row['vector']=[.5]*104;row['label']=1-row['label']
    b,s=train(changed,m)
    assert a['coef']==b['coef'] if a['kind']=='logistic' else a['trees']==b['trees']
    assert a['mean']==b['mean']
    assert r['selected_candidate']==s['selected_candidate']
