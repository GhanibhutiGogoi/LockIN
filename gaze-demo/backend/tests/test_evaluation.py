from lockin.evaluation import evaluate
from lockin.schemas import Observation


def sample(t, valid=True):
    return Observation(t_ms=t, gaze={'valid':valid,'calibrated':True,'on_screen':True},
        screen={'kind':'entertainment','task_related':False,'confidence':1}, activity=.3).model_dump()


# Dropping unknown intervals used to turn 10/120 seconds detected into recall=1.
def test_unknown_time_stays_in_recall_denominator_and_coverage():
    s={'annotations':[{'start_ms':0,'end_ms':120000,'label':'off-task'}],
       'samples':[sample(t, t>=110000) for t in range(0,120001,1000)],'decisions':[]}
    r=evaluate(s)
    assert r['recall'] == 1/12
    assert r['labelled_ms'] == 120000
    assert r['unknown_ms'] == 110000
    assert r['coverage'] == 1/12
    assert r['conditional_frame']['recall'] == 1
    assert r['events']['recall'] == 0


def test_no_observations_does_not_hide_labelled_time():
    r=evaluate({'annotations':[{'start_ms':0,'end_ms':120000,'label':'off-task'}],
                'samples':[],'decisions':[]})
    assert r['labelled_ms'] == r['unknown_ms'] == 120000
    assert r['recall'] == r['coverage'] == 0


def test_annotation_boundaries_are_clipped_and_large_gaps_remain_unknown():
    r=evaluate({'annotations':[{'start_ms':500,'end_ms':2500,'label':'off-task'},
                              {'start_ms':3000,'end_ms':9000,'label':'on-task'}],
                'samples':[sample(0),sample(1000),sample(3000),sample(10000)],'decisions':[]})
    assert r['tp_ms'] == 2000
    assert r['labelled_ms'] == 8000
    assert r['unknown_ms'] == 6000


def test_frame_detection_is_distinct_from_event_triggering_and_latency():
    s={'annotations':[{'start_ms':0,'end_ms':3000,'label':'off-task'},
                      {'start_ms':4000,'end_ms':20000,'label':'off-task'},
                      {'start_ms':20000,'end_ms':22000,'label':'on-task'}],
       'samples':[sample(t) for t in range(0,22001,1000)],
       'decisions':[{'t_ms':12000,'trigger':True},{'t_ms':21000,'trigger':True}]}
    r=evaluate(s)
    assert r['conditional_frame']['recall'] == 1
    assert r['events']['recall'] == .5
    assert r['events']['detected_segments'] == r['events']['missed_segments'] == 1
    assert r['events']['false_alarms'] == 1
    assert r['events']['segments'][1]['latency_ms'] == 8000
    assert r['false_alarms_per_labelled_hour'] == 3600000/21000


def test_event_evaluation_uses_retained_trigger_history():
    s={'annotations':[{'start_ms':0,'end_ms':12000,'label':'off-task'}],
       'samples':[], 'decisions':[], 'trigger_events':[{'t_ms':8000}]}
    assert evaluate(s)['events']['recall'] == 1


def test_live_event_evaluation_uses_emission_time_instead_of_earlier_capture():
    s={'mode':'live','annotations':[{'start_ms':0,'end_ms':14000,'label':'off-task'},
                                   {'start_ms':14000,'end_ms':18000,'label':'on-task'}],
       'samples':[],'decisions':[],
       'trigger_events':[{'t_ms':11700,'emitted_at_ms':15600}]}
    r=evaluate(s)
    assert r['events']['recall']==0
    assert r['events']['false_alarms']==1
    assert r['events']['time_basis']=='emission'
