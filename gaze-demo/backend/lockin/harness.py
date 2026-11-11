"""Persistent, transactional intervention lifecycle; media provider stays local."""
from datetime import datetime, timezone
from .store import uid,now
from .schemas import Start,Observation,Media,Answer,Correction
from .signals import advance_gate,evidence
from .recovery import summarize
from .memory import Memory,generation_prompt,inference_eligible

SAMPLE={'id':'sample-mean','title':'平均值示例','goal':'理解平均值的计算','style':'plain','duration_s':12,
        'url':'/media/sample-recap.mp4','question':'2、4、6 的平均值是多少？','source':'local'}


class Harness:
    def __init__(self,store,memory=None):
        self.store=store; self.memory=memory or Memory()

    @staticmethod
    def require(tx,kind,id):
        doc=tx.get(kind,id)
        if doc is None: raise KeyError('resource not found')
        return doc

    def start(self,user,request:Start):
        s={'id':uid(),**request.model_dump(),'created_at':now(),'phase':'study','last_t':-1,'gate':{'study_context':request.study_context},
           'current_episode':None,'cooldown_until':0,'samples':[],'trace_truncated':False,'decisions':[],
           'trigger_events':[],'trigger_history_complete':True,'annotations':[],'episode_ids':[]}
        with self.store.transaction(user) as tx:
            # One active live session per local user prevents accidental competing capture tabs.
            if request.mode=='live' and any(x['phase'] not in ['ended'] and x['mode']=='live' for x in tx.list('session')):
                raise ValueError('end the active live session first')
            tx.put('session',s['id'],s)
        return s

    def get_session(self,user,id):
        with self.store.transaction(user) as tx:return self.require(tx,'session',id)

    def get_episode(self,user,id):
        with self.store.transaction(user) as tx:return self.require(tx,'episode',id)

    @staticmethod
    def check_time(s,t):
        if s['mode']=='live':
            elapsed=(datetime.now(timezone.utc)-datetime.fromisoformat(s['created_at'])).total_seconds()*1000
            if t>elapsed+2000: raise ValueError('future timestamp')
        if t>14400000: raise ValueError('session exceeds four hours')

    def observe(self,user,id,o:Observation):
        with self.store.transaction(user) as tx:
            s=self.require(tx,'session',id)
            if s['phase']=='ended': raise ValueError('session ended')
            self.check_time(s,o.t_ms)
            if s['mode']=='live' and o.source=='replay': raise ValueError('replay input in live session')
            if o.t_ms<=s['last_t']:return {'accepted':False,'session':s,'episode':None}
            s['last_t']=o.t_ms
            if len(s['samples'])<20000:s['samples'].append(o.model_dump())
            else:s['trace_truncated']=True
            episode=None
            if s['phase'] in ['study','recovery'] and evidence(o)[0]=='on-task' and o.screen.context.strip():
                s['gate']['study_context']=o.screen.context
            if s['phase']=='study' and o.t_ms>=s['cooldown_until']:
                d=advance_gate(s['gate'],o)
                if 'trigger_events' not in s:
                    s['trigger_events']=[{'t_ms':x['t_ms']} for x in s['decisions'] if x['trigger']]
                    s['trigger_history_complete']=len(s['decisions'])<200
                s['decisions']=(s['decisions']+[{'t_ms':o.t_ms,**d}])[-200:]
                if d['trigger']:
                    memories,method=self.memory.retrieve(tx,s['goal']+' '+s['gate'].get('study_context',''),sandbox=s['mode']=='replay')
                    style=s['style']
                    hypotheses=[m for m in memories if m['kind'] in ['hypothesis','demo_hypothesis']]
                    if hypotheses:style=max(hypotheses,key=lambda x:(x['mean_on_task_share']*x['count']+1)/(x['count']+2))['style']
                    candidates=[SAMPLE]+tx.list('video')
                    matching=[v for v in candidates if v['goal'].strip().lower()==s['goal'].strip().lower()]
                    video=dict(sorted(reversed(matching),key=lambda v:v['style']!=style)[0] if matching else SAMPLE)
                    video['matched']=bool(matching)
                    video['requested_style']=style
                    episode={'id':uid(),'session_id':id,'created_at':now(),'goal':s['goal'],'study_context':s['gate'].get('study_context',s['study_context']),
                        'mode':s['mode'],'input_source':o.source,'trigger_at':o.t_ms,'trigger':d,'phase':'video','video':video,
                        'retrieved_memories':memories,'retrieval_method':method,'prompt':generation_prompt(s['goal'],s['gate'].get('study_context',''),memories,style,sandbox=s['mode']=='replay'),
                        'memory_namespace':'replay_sandbox' if s['mode']=='replay' else 'real','prompt_method':'grounded_template_v1','false_alarm':False,'media_events':[],'watch_valid_ms':0,'watch_on_screen_ms':0,
                        'played_ms':0,'position_s':0,'last_media_t':o.t_ms,'playing':False,'returned_at':None,'answer':None,
                        'summary':None,'memory_update':None,'return_sources':[],'trace':[{'step':'trigger','t_ms':o.t_ms,'reasons':d['reasons']},{'step':'retrieve','ids':[m['id'] for m in memories]},{'step':'prompt','method':'grounded_template_v1'}]}
                    emitted=max(o.t_ms,(datetime.now(timezone.utc)-datetime.fromisoformat(s['created_at'])).total_seconds()*1000) if s['mode']=='live' else o.t_ms
                    episode['trigger_emitted_at_ms']=emitted
                    s['trigger_events'].append({'t_ms':o.t_ms,'emitted_at_ms':emitted})
                    s.update(phase='video',current_episode=episode['id']);s['episode_ids'].append(episode['id'])
                    tx.put('episode',episode['id'],episode)
            elif s['current_episode']:
                episode=self.require(tx,'episode',s['current_episode'])
                previous=episode.get('last_observation')
                if s['phase']=='video' and previous and episode['playing']:
                    dt=o.t_ms-previous['t_ms']
                    g=previous['gaze']
                    if 0<dt<=4000 and g['valid'] and g['calibrated']:
                        episode['watch_valid_ms']+=dt
                        if g['on_screen'] is True:episode['watch_on_screen_ms']+=dt
                episode['last_observation']=o.model_dump()
                if s['phase']=='recovery' and o.source not in episode['return_sources']:
                    episode['return_sources'].append(o.source)
                if s['phase']=='recovery' and o.t_ms>=episode['returned_at']+120000:
                    episode['summary']=summarize(s['samples'],episode['returned_at'],o.t_ms)
                    episode['phase']='complete'
                    self.finish(tx,s,episode,o.t_ms)
                tx.put('episode',episode['id'],episode)
            tx.put('session',id,s)
            return {'accepted':True,'session':s,'episode':episode}

    def finish(self,tx,s,e,t):
        summary=e['summary']
        summary['video_on_screen_share']=e['watch_on_screen_ms']/e['watch_valid_ms'] if e['watch_valid_ms'] else None
        e['trace'].append({'step':'evaluate','summary':summary})
        tx.put('episode',e['id'],e)
        updates=self.memory.refresh(tx)
        ok=inference_eligible(e)
        e['memory_update']={'inference_eligible':bool(ok),'hypothesis_ids':[m['id'] for m in updates if not m['synthetic']],
            'sandbox_hypothesis_ids':[m['id'] for m in updates if m['synthetic']] if e['mode']=='replay' else [],
            'reason':'observed_association' if ok else 'synthetic_censored_false_alarm_or_unmatched'}
        e['trace'].append({'step':'memory_update',**e['memory_update']})
        s.update(phase='study',current_episode=None,cooldown_until=t+30000,gate={'study_context':s['gate'].get('study_context','')})

    def media(self,user,id,event:Media):
        with self.store.transaction(user) as tx:
            e=self.require(tx,'episode',id);s=self.require(tx,'session',e['session_id'])
            if any(x['event_id']==event.event_id for x in e['media_events']):return e
            if s['phase']=='ended' or s['current_episode']!=id:raise ValueError('session or episode is not active')
            self.check_time(s,event.t_ms)
            if event.t_ms<e['last_media_t']:raise ValueError('stale media event')
            if e['phase'] not in ['video','quiz','recovery']:raise ValueError('episode already ended')
            if event.kind=='abort':
                e['phase']='aborted';e['summary']=summarize(s['samples'],e['returned_at'] or event.t_ms,event.t_ms)
                e['summary']['eligible']=False;e['summary']['censored_reason']='aborted'
                self.finish(tx,s,e,event.t_ms)
                s['phase']='ended'
            else:
                if e['phase']!='video':raise ValueError('video is not active')
                dt=event.t_ms-e['last_media_t']
                delta=event.position_s-e['position_s']
                if delta<-.1 or delta*1000>dt+750:raise ValueError('seek or impossible progress')
                # Credit only time-bounded, continuous progress while playing.
                if e['playing'] and 0<=dt<=5000:e['played_ms']+=min(dt,max(0,delta*1000))
                if event.kind=='ended':
                    if event.position_s<e['video']['duration_s']-.5 or e['played_ms']<e['video']['duration_s']*900:
                        raise ValueError('video not fully watched')
                    e['phase']='quiz';s['phase']='quiz';e['playing']=False
                else:e['playing']=event.kind in ['play','progress']
                e['position_s']=event.position_s
            e['last_media_t']=event.t_ms
            e['media_events'].append(event.model_dump())
            e['trace'].append({'step':'media','kind':event.kind,'t_ms':event.t_ms})
            tx.put('episode',id,e);tx.put('session',s['id'],s)
            return e

    def answer(self,user,id,a:Answer):
        if not a.answer.strip():raise ValueError('answer must not be blank')
        with self.store.transaction(user) as tx:
            e=self.require(tx,'episode',id);s=self.require(tx,'session',e['session_id'])
            if s['phase']=='ended' or s['current_episode']!=id:raise ValueError('session or episode is not active')
            self.check_time(s,a.t_ms)
            if e['phase']!='quiz' or a.t_ms<max(e['last_media_t'],s['last_t']):raise ValueError('quiz is not ready or stale answer')
            e.update(phase='recovery',answer=a.answer,returned_at=a.t_ms)
            e['trace'].append({'step':'quiz_answered','t_ms':a.t_ms});s['phase']='recovery'
            tx.put('episode',id,e);tx.put('session',s['id'],s)
            return e

    def refresh_memories(self,user):
        with self.store.transaction(user) as tx:return self.memory.refresh(tx)

    def correct(self,user,id,c:Correction):
        with self.store.transaction(user) as tx:
            e=self.require(tx,'episode',id);e['false_alarm']=c.false_alarm;e['correction']=c.model_dump()
            e.setdefault('trace',[]).append({'step':'correction',**c.model_dump()})
            if e.get('memory_update'):
                ok=inference_eligible(e)
                e['memory_update']['inference_eligible']=ok
                e['memory_update']['reason']='observed_association' if ok else ('false_alarm' if c.false_alarm else 'synthetic_censored_or_unmatched')
            tx.put('episode',id,e);self.memory.refresh(tx)
            return e

    def export(self,user):
        with self.store.transaction(user) as tx:
            return {'schema_version':1,'user_id':user,**{k:tx.list(v) for k,v in [('sessions','session'),('episodes','episode'),('memories','memory'),('videos','video')]}}

    def end(self,user,id):
        # The lock covers reading the active episode, aborting and ending the session.
        with self.store.transaction(user) as tx:
            s=self.require(tx,'session',id)
            if s['phase']=='ended':return s
            if s['current_episode']:
                e=self.require(tx,'episode',s['current_episode'])
                t=max(0,s['last_t'],e['last_media_t'],e.get('returned_at') or 0)
                e['phase']='aborted';e['playing']=False
                returned=e['returned_at'] if e['returned_at'] is not None else t
                e['summary']=summarize(s['samples'],returned,t)
                e['summary'].update(eligible=False,censored_reason='session_ended')
                e['trace'].append({'step':'session_ended','t_ms':t})
                self.finish(tx,s,e,t)
                tx.put('episode',e['id'],e)
            s['phase']='ended';s['current_episode']=None
            tx.put('session',id,s)
            return s

    def annotate(self,user,id,a):
        if a.end_ms<=a.start_ms:raise ValueError('annotation end must exceed start')
        with self.store.transaction(user) as tx:
            s=self.require(tx,'session',id)
            if any(a.start_ms<x['end_ms'] and a.end_ms>x['start_ms'] for x in s['annotations']):
                raise ValueError('overlapping annotations are ambiguous')
            s['annotations'].append(a.model_dump());tx.put('session',id,s)
            return s['annotations']
