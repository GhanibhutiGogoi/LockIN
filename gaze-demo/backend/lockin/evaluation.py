"""Human-labelled time coverage and actual trigger events, reported separately."""
from .schemas import Observation
from .signals import evidence


def ratio(numerator, denominator):
    return numerator/denominator if denominator else None


def evaluate(session):
    annotations=sorted((a for a in session['annotations'] if a['label'] in ['on-task','off-task']),key=lambda a:a['start_ms'])
    labelled=sum(a['end_ms']-a['start_ms'] for a in annotations)
    off_labelled=sum(a['end_ms']-a['start_ms'] for a in annotations if a['label']=='off-task')
    tp=fp=fn=tn=0
    for left,right in zip(session['samples'],session['samples'][1:]):
        dt=right['t_ms']-left['t_ms']
        if dt<=0 or dt>4000:continue
        pred,_=evidence(Observation.model_validate(left))
        if pred=='unknown':continue
        for a in annotations:
            overlap=max(0,min(right['t_ms'],a['end_ms'])-max(left['t_ms'],a['start_ms']))
            if a['label']=='off-task':
                if pred=='off-task':tp+=overlap
                else:fn+=overlap
            elif pred=='off-task':fp+=overlap
            else:tn+=overlap
    valid=tp+fp+fn+tn
    unknown_off=max(0,off_labelled-tp-fn)

    # Contiguous off-task annotations describe one distraction segment.
    segments=[]
    for a in annotations:
        if a['label']!='off-task':continue
        if segments and segments[-1]['end_ms']==a['start_ms']:segments[-1]['end_ms']=a['end_ms']
        else:segments.append({'start_ms':a['start_ms'],'end_ms':a['end_ms']})
    triggers=session.get('trigger_events',[d for d in session['decisions'] if d['trigger']])
    def event_time(d):return d.get('emitted_at_ms',d['t_ms'])
    time_basis='replay_time' if session.get('mode')=='replay' else 'emission'
    if any('emitted_at_ms' not in d for d in triggers):
        time_basis='mixed_emission_and_legacy_capture' if any('emitted_at_ms' in d for d in triggers) else 'capture_time_legacy'
    matched=unlabelled=false_alarms=0
    for d in triggers:
        truth=next((a['label'] for a in annotations if a['start_ms']<=event_time(d)<a['end_ms']),None)
        if truth=='on-task':false_alarms+=1
        elif truth=='off-task':matched+=1
        else:unlabelled+=1
    for segment in segments:
        times=[event_time(d) for d in triggers if segment['start_ms']<=event_time(d)<segment['end_ms']]
        segment['detected_at_ms']=min(times) if times else None
        segment['latency_ms']=min(times)-segment['start_ms'] if times else None
        segment['shorter_than_dwell']=segment['end_ms']-segment['start_ms']<8000
    detected=sum(s['detected_at_ms'] is not None for s in segments)
    return {
        # Overall recall counts abstention/missing data as undetected labelled time.
        'precision':ratio(tp,tp+fp),'recall':ratio(tp,off_labelled),
        'labelled_ms':labelled,'labelled_valid_ms':valid,'unknown_ms':max(0,labelled-valid),
        'coverage':ratio(valid,labelled),'unknown_off_task_ms':unknown_off,
        'tp_ms':tp,'fp_ms':fp,'fn_ms':fn+unknown_off,'tn_ms':tn,
        'conditional_frame':{'precision':ratio(tp,tp+fp),'recall':ratio(tp,tp+fn),
            'tp_ms':tp,'fp_ms':fp,'fn_ms':fn,'tn_ms':tn,
            'scope':'Only intervals with valid joint evidence; interpret with coverage.'},
        'events':{'recall':ratio(detected,len(segments)),'precision':ratio(matched,matched+false_alarms),
            'detected_segments':detected,'missed_segments':len(segments)-detected,
            'false_alarms':false_alarms,'unlabelled_triggers':unlabelled,'segments':segments,
            'time_basis':time_basis,'client_display_time_measured':False,
            'history_complete':session.get('trigger_history_complete',len(session['decisions'])<200)},
        'false_alarms_per_labelled_hour':ratio(false_alarms,labelled/3600000),
        'trace_truncated':session.get('trace_truncated',False),
        'note':'Descriptive human-label comparison. Overall recall includes unknown/missing time as undetected; conditional_frame excludes it. Events use actual triggers, including short labelled segments. Replay is not real-world validation.'}
