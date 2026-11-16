"""One causal aggregation contract shared by offline training and live inference."""
import math

SCHEMA='mediapipe-blendshapes-mean-std-20s-v1'
EXTRACTOR='mediapipe-face-landmarker-0.10.18'
NAMES=['_neutral','browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight',
    'cheekPuff','cheekSquintLeft','cheekSquintRight','eyeBlinkLeft','eyeBlinkRight',
    'eyeLookDownLeft','eyeLookDownRight','eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight',
    'eyeLookUpLeft','eyeLookUpRight','eyeSquintLeft','eyeSquintRight','eyeWideLeft','eyeWideRight',
    'jawForward','jawLeft','jawOpen','jawRight','mouthClose','mouthDimpleLeft','mouthDimpleRight',
    'mouthFrownLeft','mouthFrownRight','mouthFunnel','mouthLeft','mouthLowerDownLeft','mouthLowerDownRight',
    'mouthPressLeft','mouthPressRight','mouthPucker','mouthRight','mouthRollLower','mouthRollUpper',
    'mouthShrugLower','mouthShrugUpper','mouthSmileLeft','mouthSmileRight','mouthStretchLeft','mouthStretchRight',
    'mouthUpperUpLeft','mouthUpperUpRight','noseSneerLeft','noseSneerRight']
WINDOW_MS=20000
MAX_GAP_MS=1500
MIN_COVERAGE=.8


def validate_values(values):
    if not isinstance(values,(list,tuple)) or len(values)!=52:raise ValueError('52 ordered blendshape scores required')
    if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=1 for v in values):
        raise ValueError('blendshape scores must be finite and in [0,1]')
    return list(values)


def aggregate(samples,now_ms,window_ms=WINDOW_MS):
    if not math.isfinite(now_ms) or now_ms<0:raise ValueError('invalid window timestamp')
    # Duplicate timestamps do not add time; future frames never enter a causal window.
    unique={}
    for row in samples:
        t=row['t_ms']
        if not math.isfinite(t) or t<0:raise ValueError('invalid frame timestamp')
        if t<=now_ms:unique.setdefault(t,row)
    rows=sorted(unique.values(),key=lambda r:r['t_ms'])
    start=now_ms-window_ms
    total=0.;sums=[0.]*52;squares=[0.]*52
    for left,right in zip(rows,rows[1:]):
        gap=right['t_ms']-left['t_ms']
        dt=max(0,min(right['t_ms'],now_ms)-max(left['t_ms'],start))
        if not dt or gap>MAX_GAP_MS or not left['valid']:continue
        values=validate_values(left['values'])
        total+=dt
        for i,v in enumerate(values):sums[i]+=v*dt;squares[i]+=v*v*dt
    coverage=total/window_ms
    fresh=bool(rows and rows[-1]['valid'] and 0<=now_ms-rows[-1]['t_ms']<1200)
    vector=None
    if coverage>=MIN_COVERAGE and fresh:
        means=[v/total for v in sums]
        vector=means+[math.sqrt(max(0,squares[i]/total-v*v)) for i,v in enumerate(means)]
    return {'feature_schema':SCHEMA,'window_start_ms':max(0,start),'window_end_ms':now_ms,
        'coverage':coverage,'valid_ms':total,'fresh':fresh,'vector':vector}
