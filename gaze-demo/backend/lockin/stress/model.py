"""Portable numeric inference only: never unpickle a downloaded model."""
import json
import math
from pathlib import Path
from .features import SCHEMA,EXTRACTOR,NAMES,WINDOW_MS


def finite_vector(values,n):
    return isinstance(values,list) and len(values)==n and all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) for v in values)


class StressModel:
    def __init__(self,artifact=None):
        self.artifact=artifact;self.reason='model_not_trained'
        if artifact is not None:
            self.reason=None if self.compatible(artifact) else 'incompatible_model'

    @classmethod
    def load(cls,path):
        try:
            p=Path(path)
            if p.stat().st_size>2_000_000:raise ValueError('artifact too large')
            return cls(json.loads(p.read_text()))
        except (OSError,ValueError,TypeError):
            model=cls();model.reason='model_missing_or_invalid';return model

    @staticmethod
    def compatible(a):
        if not isinstance(a,dict):return False
        if any(a.get(k)!=v for k,v in {'version':1,'feature_schema':SCHEMA,'extractor':EXTRACTOR,
            'feature_names':NAMES,'window_ms':WINDOW_MS,'source_kind':'real_self_report','runtime_eligible':True}.items()):return False
        if not isinstance(a.get('validation'),dict) or a['validation'].get('eligible') is not True:return False
        if not isinstance(a.get('model_id'),str) or not a['model_id']:return False
        if not finite_vector(a.get('mean'),104) or not finite_vector(a.get('scale'),104) or min(a['scale'])<=0:return False
        if a.get('kind')=='logistic':
            return finite_vector(a.get('coef'),104) and isinstance(a.get('intercept'),(int,float)) and math.isfinite(a['intercept'])
        if a.get('kind')=='forest':
            trees=a.get('trees')
            if not isinstance(trees,list) or not 1<=len(trees)<=128:return False
            for tree in trees:
                if not isinstance(tree,dict):return False
                n=len(tree.get('feature',[]))
                if not 1<=n<=4096 or not all(isinstance(tree.get(k),list) and len(tree[k])==n for k in ['left','right','threshold','probability']):return False
                if not finite_vector(tree['threshold'],n) or not finite_vector(tree['probability'],n):return False
                if any(not 0<=p<=1 for p in tree['probability']):return False
                for i,f in enumerate(tree['feature']):
                    if not isinstance(f,int):return False
                    if f>=0:
                        if f>=104 or any(not isinstance(tree[k][i],int) or not i<tree[k][i]<n for k in ['left','right']):return False
                    elif f!=-2:return False
            return True
        return False

    def status(self):
        a=self.artifact if isinstance(self.artifact,dict) else {}
        return {'available':self.reason is None,'reason':self.reason,'model_id':a.get('model_id'),
            'feature_schema':SCHEMA,'experimental':True,'validated_on_project_users':False}

    def predict(self,vector):
        if self.reason:return {'state':'unknown','score':None,'reason':self.reason,'experimental':True}
        if not finite_vector(vector,104) or any(not 0<=v<=1 for v in vector):
            return {'state':'unknown','score':None,'reason':'invalid_features','experimental':True}
        a=self.artifact;x=[(v-m)/s for v,m,s in zip(vector,a['mean'],a['scale'])]
        if a['kind']=='logistic':
            z=max(-700,min(700,a['intercept']+sum(w*v for w,v in zip(a['coef'],x))))
            score=1/(1+math.exp(-z))
        else:
            probabilities=[]
            for tree in a['trees']:
                node=0
                while tree['feature'][node]>=0:
                    node=tree['left'][node] if x[tree['feature'][node]]<=tree['threshold'][node] else tree['right'][node]
                probabilities.append(tree['probability'][node])
            score=sum(probabilities)/len(probabilities)
        state='possible_tension' if score>=.75 else 'no_clear_tension' if score<=.35 else 'unknown'
        return {'state':state,'score':score,'reason':'experimental_classifier' if state!='unknown' else 'ambiguous_score','experimental':True}
