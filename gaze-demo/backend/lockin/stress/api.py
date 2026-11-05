"""Auth-scoped stress routes share the application's existing origin boundary."""
from pathlib import Path
from .expression import status as expression_status,assets_present
from fastapi import APIRouter,Depends
from .features import SCHEMA,NAMES,EXTRACTOR
from .schemas import StartStress,FeatureFrame,ReplayState,Feedback,EventAction,Exclusion,SelfReport


def register(app,service,user):
    router=APIRouter(prefix='/v1/stress',tags=['experimental tension'])

    @router.get('/status')
    def status(id=Depends(user)):
        assets=Path(__file__).resolve().parents[3]/'public'
        expression=expression_status()
        expression['assets_available']=assets_present(assets)
        return {'model':service.model.status(),'expression_model':expression,'feature_schema':SCHEMA,'feature_names':NAMES,'extractor':EXTRACTOR,
            'window_ms':20000,'minimum_coverage':.8,'baseline_ms':30000,'dwell_ms':10000,'cooldown_ms':180000,
            'note':'Possible tension only. No pressure diagnosis or calibrated percentage. Replay does not use a trained model.'}

    @router.post('/sessions')
    def start(req:StartStress,id=Depends(user)):return service.start(id,req)

    @router.get('/sessions/{sid}')
    def session(sid:str,id=Depends(user)):return service.get(id,sid)

    @router.post('/sessions/{sid}/frames')
    def frame(sid:str,req:FeatureFrame,id=Depends(user)):return service.observe(id,sid,req)

    @router.post('/sessions/{sid}/replay')
    def replay(sid:str,req:ReplayState,id=Depends(user)):return service.replay(id,sid,req)

    @router.post('/sessions/{sid}/end')
    def end(sid:str,id=Depends(user)):return service.end(id,sid)

    @router.post('/sessions/{sid}/labels')
    def label(sid:str,req:SelfReport,id=Depends(user)):return service.label(id,sid,req)

    @router.post('/events/{eid}/action')
    def action(eid:str,req:EventAction,id=Depends(user)):return service.action(id,eid,req)

    @router.post('/events/{eid}/feedback')
    def feedback(eid:str,req:Feedback,id=Depends(user)):return service.feedback(id,eid,req)

    @router.post('/events/{eid}/correction')
    def correction(eid:str,req:Exclusion,id=Depends(user)):return service.correct(id,eid,req.excluded)

    @router.get('/bank')
    def bank(id=Depends(user)):return service.bank(id)

    app.include_router(router)
