"""Pretrained facial expression evidence; explicitly NOT a stress classifier."""
MODEL_ID='ferplus-8-a2a2ba6a'
LABELS=['neutral','happiness','surprise','sadness','anger','disgust','fear','contempt']


def status():
    return {'model_id':MODEL_ID,'pretrained':True,'target':'facial_expression_not_stress',
        'labels':LABELS,'runs_in':'browser_wasm','pressure_validated':False}


def predict(evidence,valid):
    base={'score':None,'experimental':True,'model':status()}
    if not valid or evidence is None:
        return {**base,'state':'unknown','reason':'expression_input_missing'}
    p=evidence.probabilities
    negative=sum(p[3:]);top=max(range(8),key=p.__getitem__)
    # An engineering cue for offering relief, not an emotion-to-pressure score.
    high=negative>=.75 and top>=3 and p[top]>=.45
    low=p[0]+p[1]>=.75
    return {**base,'state':'possible_tension' if high else 'no_clear_tension' if low else 'unknown',
        'reason':'negative_expression_proxy' if high else 'no_negative_expression_cue' if low else 'ambiguous_expression',
        'expression_score':negative,'top_expression':LABELS[top],'probabilities':p}


def assets_present(root):
    return all((root/p).is_file() for p in ['models/emotion-ferplus-8.onnx','expression-worker.js','gaze-worker.js',
        'ort/ort.wasm.min.js','ort/ort-wasm-simd-threaded.mjs','ort/ort-wasm-simd-threaded.wasm'])
