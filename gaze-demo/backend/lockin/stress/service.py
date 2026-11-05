"""Per-user experimental relief lifecycle, with separate replay memories."""
from datetime import datetime,timezone
from ..store import uid,now
from .features import aggregate,MAX_GAP_MS,SCHEMA,EXTRACTOR
from .model import StressModel

ANIMATIONS=['cat_yawn','dog_stretch']


class StressService:
    def __init__(self,store,model=None):self.store=store;self.model=model or StressModel()

    @staticmethod
    def require(tx,kind,id):
        value=tx.get(kind,id)
        if value is None:raise KeyError('resource not found')
        return value

    @staticmethod
    def check_time(s,t):
        if s['mode']=='live':
            elapsed=(datetime.now(timezone.utc)-datetime.fromisoformat(s['created_at'])).total_seconds()*1000
            if t>elapsed+2000 or elapsed-t>2000:raise ValueError('stale or future facial capture')

    def start(self,user,request):
        s={'id':uid(),'mode':request.mode,'created_at':now(),'phase':'active','last_t':-1,'window':[],
            'since':None,'cooldown_until':0,'event_ids':[],'last_prediction':{'state':'unknown','reason':'waiting_for_input'},
            'baseline':None,'baseline_start':None,'baseline_samples':[],'labelled_windows':[]}
        with self.store.transaction(user) as tx:
            if any(v['phase']=='active' for v in tx.list('stress_session')):raise ValueError('end the existing stress session first')
            tx.put('stress_session',s['id'],s)
        return s

    def get(self,user,sid):
        with self.store.transaction(user) as tx:return self.require(tx,'stress_session',sid)

    def preferences(self,user,real=True):
        with self.store.transaction(user) as tx:return self._preferences(tx,'real' if real else 'replay_sandbox')

    @staticmethod
    def _preferences(tx,namespace):
        return [m for m in tx.list('stress_memory') if m['namespace']==namespace and m['active']]

    def _advance(self,tx,s,t,prediction,window=None):
        previous=s['last_t']
        if t<=previous:return {'accepted':False,'session':s,'event':None,'prediction':s['last_prediction']}
        self.check_time(s,t)
        if s['phase']!='active':raise ValueError('stress session ended')
        if previous<0 or t-previous>MAX_GAP_MS:s['since']=None
        if any(v['phase'] in ['video','quiz'] for v in tx.list('session')):
            prediction={'state':'unknown','score':None,'reason':'learning_intervention_active','experimental':True}
        if prediction['state']!='possible_tension':s['since']=None
        elif s['since'] is None:s['since']=t
        event=None
        if s['since'] is not None and t-s['since']>=10000 and t>=s['cooldown_until']:
            namespace='real' if s['mode']=='live' else 'replay_sandbox'
            memories=self._preferences(tx,namespace)
            choice=max(memories,key=lambda m:(m['helpful_count']+1)/(m['count']+2))['animation'] if memories else ANIMATIONS[len(s['event_ids'])%2]
            emitted=max(t,(datetime.now(timezone.utc)-datetime.fromisoformat(s['created_at'])).total_seconds()*1000) if s['mode']=='live' else t
            event={'id':uid(),'session_id':s['id'],'source':'derived_camera_features' if s['mode']=='live' else 'synthetic_replay',
                'namespace':namespace,'trigger_at_ms':t,'emitted_at_ms':emitted,'animation':choice,'phase':'offered',
                'model':self.model.status(),'model_score':prediction.get('score'),'feature_window':window,
                'baseline':s['baseline'],'reason':'continuous_possible_tension_10s' if s['mode']=='live' else 'scripted_replay_10s',
                'retrieved_memories':memories,'feedback':None,'excluded':False,'actions':[]}
            tx.put('stress_event',event['id'],event)
            s['event_ids'].append(event['id']);s['cooldown_until']=t+180000;s['since']=None
        s['last_t']=t;s['last_prediction']=prediction
        tx.put('stress_session',s['id'],s)
        return {'accepted':True,'session':s,'event':event,'prediction':prediction,'window':window}

    def observe(self,user,sid,frame):
        with self.store.transaction(user) as tx:
            s=self.require(tx,'stress_session',sid)
            if s['mode']!='live':raise ValueError('camera features require live mode')
            self.check_time(s,frame.t_ms)
            if s['phase']!='active':raise ValueError('stress session ended')
            if frame.t_ms<=s['last_t']:return {'accepted':False,'session':s,'event':None,'prediction':s['last_prediction']}
            row=frame.model_dump();s['window']=[v for v in s['window'] if v['t_ms']>=frame.t_ms-21000]+[row]
            s['window']=s['window'][-250:]
            window=aggregate(s['window'],frame.t_ms)
            if s['baseline'] is None:
                if s['baseline_start'] is None:s['baseline_start']=frame.t_ms
                s['baseline_samples']=(s['baseline_samples']+[row])[-250:]
                elapsed=frame.t_ms-s['baseline_start']
                baseline=aggregate(s['baseline_samples'],frame.t_ms,window_ms=30000)
                if elapsed>=30000 and baseline['vector'] is not None:
                    s['baseline']={'mean':baseline['vector'][:52],'coverage':baseline['coverage'],
                        'end_ms':frame.t_ms,'used_as_model_input':False,'label':'observed facial baseline; not a verified relaxed state'}
                    s['baseline_samples']=[]
            prediction=self.model.predict(window['vector']) if window['vector'] is not None else {'state':'unknown','score':None,'reason':'insufficient_fresh_coverage','experimental':True}
            if s['baseline'] is None:prediction={'state':'unknown','score':None,'reason':'baseline_pending','experimental':True}
            return self._advance(tx,s,frame.t_ms,prediction,window)

    def replay(self,user,sid,request):
        with self.store.transaction(user) as tx:
            s=self.require(tx,'stress_session',sid)
            if s['mode']!='replay':raise ValueError('synthetic override is forbidden in a live session')
            return self._advance(tx,s,request.t_ms,{'state':request.state,'score':None,'reason':'synthetic_debug_override','experimental':True})

    def label(self,user,sid,request):
        with self.store.transaction(user) as tx:
            s=self.require(tx,'stress_session',sid)
            if s['mode']!='live' or s['phase']!='active':raise ValueError('self-report labels require an active camera session')
            self.check_time(s,s['last_t'])
            window=aggregate(s['window'],max(0,s['last_t']))
            if window['vector'] is None:raise ValueError('fresh valid facial window required before labelling')
            label=0 if request.rating<=3 else 1 if request.rating>=7 else None
            row={'subject':user,'session':sid,'start_ms':window['window_end_ms']-20000,'end_ms':window['window_end_ms'],
                'label':label,'rating':request.rating,'label_rule':'0..3 low; 7..10 high; 4..6 unknown/excluded',
                'vector':window['vector'],'feature_schema':SCHEMA,'extractor':EXTRACTOR,
                'source_kind':'project_user_self_report','label_kind':'self_report',
                'consent':'user explicitly submitted this retrospective 20-second self-report'}
            if row['start_ms']<0:raise ValueError('complete 20-second window required')
            rows=[r for r in s['labelled_windows'] if r['end_ms']!=row['end_ms']]
            if len(rows)>=180:raise ValueError('session label limit reached; export and start another session')
            s['labelled_windows']=rows+[row];tx.put('stress_session',sid,s);return row

    def action(self,user,eid,request):
        with self.store.transaction(user) as tx:
            e=self.require(tx,'stress_event',eid);s=self.require(tx,'stress_session',e['session_id'])
            if s['phase']!='active':raise ValueError('stress session ended')
            self.check_time(s,request.t_ms)
            if request.t_ms<e['emitted_at_ms'] or (e['actions'] and request.t_ms<e['actions'][-1]['t_ms']):raise ValueError('stale relief action')
            if request.kind=='shown' and any(v['phase'] in ['video','quiz'] for v in tx.list('session')):
                e['phase']='suppressed';e['suppressed_reason']='learning_intervention_active'
                tx.put('stress_event',eid,e);return e
            if request.kind=='shown' and e['phase'] not in ['offered','shown']:raise ValueError('relief already dismissed')
            if not e['actions'] or e['actions'][-1]['kind']!=request.kind:e['actions'].append(request.model_dump())
            if len(e['actions'])>20:raise ValueError('too many relief actions')
            e['phase']='shown' if request.kind=='shown' else 'dismissed'
            tx.put('stress_event',eid,e);return e

    def feedback(self,user,eid,request):
        with self.store.transaction(user) as tx:
            e=self.require(tx,'stress_event',eid)
            if not any(a['kind']=='shown' for a in e['actions']):raise ValueError('show the animation before reporting its effect')
            e['feedback']={**request.model_dump(),'basis':'explicit_user_feedback','ratings_retrospective':True,
                'causal_stress_reduction_proven':False}
            tx.put('stress_event',eid,e);self._refresh(tx);return e

    def correct(self,user,eid,excluded):
        with self.store.transaction(user) as tx:
            e=self.require(tx,'stress_event',eid);e['excluded']=excluded;tx.put('stress_event',eid,e);self._refresh(tx);return e

    def _refresh(self,tx):
        events=tx.list('stress_event')
        for namespace in ['real','replay_sandbox']:
            for animation in ANIMATIONS:
                rows=[e for e in events if e['namespace']==namespace and e['animation']==animation and e['feedback'] is not None and not e['excluded']]
                helpful=sum(e['feedback']['helpful'] for e in rows)
                m={'id':namespace+':'+animation,'namespace':namespace,'animation':animation,'active':bool(rows),
                    'count':len(rows),'helpful_count':helpful,'evidence_ids':[e['id'] for e in rows],
                    'confidence':'tentative','basis':'explicit_user_feedback','inferred_from_smile':False}
                tx.put('stress_memory',m['id'],m)

    def end(self,user,sid):
        with self.store.transaction(user) as tx:
            s=self.require(tx,'stress_session',sid);s['phase']='ended';s['since']=None;s['window']=[];s['baseline_samples']=[]
            tx.put('stress_session',sid,s);return s

    def bank(self,user):
        with self.store.transaction(user) as tx:
            return {'sessions':tx.list('stress_session'),'events':tx.list('stress_event'),'memories':tx.list('stress_memory')}
