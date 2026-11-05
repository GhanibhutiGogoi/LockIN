"""Small reproducible benchmark; no random-frame splits and no invented labels."""
import hashlib
import json
import math
import random
from .features import SCHEMA,EXTRACTOR,NAMES,WINDOW_MS
from .model import finite_vector


def validate_dataset(rows,manifest):
    expected={'version':1,'feature_schema':SCHEMA,'extractor':EXTRACTOR,'window_ms':WINDOW_MS,'label_kind':'self_report'}
    if any(manifest.get(k)!=v for k,v in expected.items()):raise ValueError('incompatible feature/extractor/label manifest')
    if manifest.get('source_kind') not in ['real_self_report','synthetic_test']:raise ValueError('real self-report provenance required')
    if not manifest.get('license') or not manifest.get('source_url'):raise ValueError('source URL and license required')
    if not rows:raise ValueError('no labelled training windows available')
    intervals={}
    for r in rows:
        if not isinstance(r.get('subject'),str) or not r['subject'] or not isinstance(r.get('session'),str) or not r['session']:raise ValueError('subject and session identity required')
        if type(r.get('label')) is not int or r['label'] not in [0,1]:raise ValueError('explicit binary self-report label required; unknown is not negative')
        if not finite_vector(r.get('vector'),104) or any(not 0<=v<=1 for v in r['vector']):raise ValueError('incompatible feature vector')
        start,end=r.get('start_ms'),r.get('end_ms')
        if not all(isinstance(v,(int,float)) and math.isfinite(v) for v in [start,end]) or start<0 or end-start!=WINDOW_MS:raise ValueError('label-aligned 20-second window required')
        key=(r['subject'],r['session']);windows=intervals.setdefault(key,[])
        if any(start==s and end==e for s,e in windows):raise ValueError('duplicate training interval')
        windows.append((start,end))
    if len({r['subject'] for r in rows})<6:raise ValueError('at least six participants required even for an exploratory split')
    return rows


def export_estimator(estimator,scaler,manifest):
    a={'version':1,'feature_schema':SCHEMA,'extractor':EXTRACTOR,'feature_names':NAMES,'window_ms':WINDOW_MS,
        'source_kind':manifest['source_kind'],'runtime_eligible':False,'validation':{'eligible':False},
        'mean':scaler.mean_.tolist(),'scale':scaler.scale_.tolist(),'model_id':'pending',
        'provenance':{'source_url':manifest['source_url'],'license':manifest['license']}}
    if hasattr(estimator,'coef_'):
        a.update(kind='logistic',coef=estimator.coef_[0].tolist(),intercept=float(estimator.intercept_[0]))
    else:
        trees=[]
        for member in estimator.estimators_:
            t=member.tree_
            p=[float(v[0][1]/sum(v[0])) for v in t.value]
            trees.append({'feature':t.feature.tolist(),'left':t.children_left.tolist(),'right':t.children_right.tolist(),
                'threshold':t.threshold.tolist(),'probability':p})
        a.update(kind='forest',trees=trees)
    return a


def train(rows,manifest,seed=42):
    import numpy as np
    from sklearn.preprocessing import StandardScaler
    from sklearn.linear_model import LogisticRegression
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.dummy import DummyClassifier
    from sklearn.metrics import f1_score,balanced_accuracy_score,confusion_matrix
    validate_dataset(rows,manifest)
    subjects=sorted({r['subject'] for r in rows});random.Random(seed).shuffle(subjects)
    n=len(subjects);train_end=int(n*.6);val_end=train_end+max(1,int(n*.2))
    groups={'train':subjects[:train_end],'validation':subjects[train_end:val_end],'test':subjects[val_end:]}
    splits={key:[r for r in rows if r['subject'] in people] for key,people in groups.items()}
    if any({r['label'] for r in part}!={0,1} for part in splits.values()):raise ValueError('both classes required in every participant split')
    x={k:np.array([r['vector'] for r in part],dtype=float) for k,part in splits.items()}
    y={k:np.array([r['label'] for r in part]) for k,part in splits.items()}
    scaler=StandardScaler().fit(x['train'])
    scaled={k:scaler.transform(v) for k,v in x.items()}
    def metrics(truth,pred):
        return {'macro_f1':float(f1_score(truth,pred,average='macro',labels=[0,1],zero_division=0)),
            'balanced_accuracy':float(balanced_accuracy_score(truth,pred)),
            'confusion_matrix':confusion_matrix(truth,pred,labels=[0,1]).tolist(),'n':len(truth)}
    dummy=DummyClassifier(strategy='most_frequent').fit(scaled['train'],y['train'])
    baseline=metrics(y['validation'],dummy.predict(scaled['validation']))
    candidates={'logistic':LogisticRegression(C=1,class_weight='balanced',max_iter=1000,random_state=seed),
        'forest':RandomForestClassifier(n_estimators=64,max_depth=4,min_samples_leaf=3,class_weight='balanced',random_state=seed,n_jobs=1)}
    validation={}
    for name,estimator in candidates.items():
        estimator.fit(scaled['train'],y['train'])
        validation[name]=metrics(y['validation'],estimator.predict(scaled['validation']))
    selected=max(candidates,key=lambda name:(validation[name]['macro_f1'],validation[name]['balanced_accuracy'],name=='logistic'))
    # Selection is frozen above. Test labels never influence fitting or selection.
    chosen=candidates[selected]
    test_pred=chosen.predict(scaled['test']);test=metrics(y['test'],test_pred)
    source_real=manifest['source_kind']=='real_self_report'
    eligible=bool(source_real and n>=12 and validation[selected]['balanced_accuracy']>=.60 and validation[selected]['macro_f1']>=baseline['macro_f1']+.05)
    artifact=export_estimator(chosen,scaler,manifest)
    artifact.update(runtime_eligible=eligible,validation={'eligible':eligible,**validation[selected]})
    artifact['model_id']=hashlib.sha256(json.dumps(artifact,sort_keys=True,allow_nan=False).encode()).hexdigest()[:16]
    per_subject={}
    for subject in groups['test']:
        indices=[i for i,r in enumerate(splits['test']) if r['subject']==subject]
        per_subject[subject]=metrics(y['test'][indices],test_pred[indices])
    report={'status':'trained_experimental' if source_real else 'synthetic_software_test_only',
        'source_kind':manifest['source_kind'],'seed':seed,'participant_count':n,'split_subjects':groups,
        'validation_dummy':baseline,'validation_candidates':validation,'selected_candidate':selected,
        'held_out_test':test,'test_dummy':metrics(y['test'],dummy.predict(scaled['test'])),
        'per_test_subject':per_subject,'runtime_eligible':eligible,
        'gate_predeclared':{'min_participants':12,'validation_balanced_accuracy':.60,'macro_f1_above_dummy':.05},
        'feature_schema':SCHEMA,'feature_coverage':'Input contains prevalidated 20s windows; no runtime coverage claim.',
        'project_user_validation':False,'causal_relief_effect_validation':False,
        'limitations':['Public-label benchmark only; not a diagnostic measure.','Runtime 0.75/0.35 thresholds are engineering defaults, not calibrated stress probabilities.']}
    return artifact,report
