"""Local-only API. Main Vite UI is intentionally unchanged."""
from pathlib import Path
import os
import time
from datetime import datetime,timezone
from fastapi import FastAPI,Depends,HTTPException,Request
from fastapi.responses import FileResponse,JSONResponse,RedirectResponse
from fastapi.security import HTTPBearer,HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .store import Store,uid
from .harness import Harness,SAMPLE
from .schemas import Screen,NewUser,Start,Observation,Media,Answer,Correction,Annotation,Frame,Strict
from pydantic import Field
from typing import Literal
from .providers import configured_memory,configured_screen
from .evaluation import evaluate

ROOT=Path(__file__).resolve().parents[2]


class Video(Strict):
    title:str=Field(min_length=1,max_length=200)
    goal:str=Field(min_length=1,max_length=2000)
    style:Literal['plain','analogy','humor']='plain'
    duration_s:float=Field(gt=0,le=600)
    question:str=Field(min_length=1,max_length=2000)


def create_app(db_path=None,screen_provider=None,memory=None):
    app=FastAPI(title='LockIN attention harness',version='0.2.0')
    app.add_middleware(TrustedHostMiddleware,allowed_hosts=['127.0.0.1','localhost','testserver'])
    store=Store(db_path or os.getenv('LOCKIN_DB',ROOT/'backend/data/lockin.db'))
    h=Harness(store,memory or configured_memory());provider=screen_provider or configured_screen()
    app.state.harness=h
    bearer=HTTPBearer(auto_error=False)

    def user(auth:HTTPAuthorizationCredentials|None=Depends(bearer)):
        id=store.authenticate(auth.credentials) if auth else None
        if not id:raise HTTPException(401,'valid local user token required')
        return id

    @app.exception_handler(KeyError)
    async def missing(req,exc):return JSONResponse({'detail':'resource not found'},status_code=404)

    @app.exception_handler(ValueError)
    async def bad(req,exc):return JSONResponse({'detail':str(exc)},status_code=400)

    @app.middleware('http')
    async def boundary(req:Request,call_next):
        # No cross-origin writes, including drive-by requests to a loopback server.
        origin=req.headers.get('origin')
        if origin and origin not in ['http://127.0.0.1:8000','http://localhost:8000','http://testserver']:
            return JSONResponse({'detail':'same origin required'},403)
        response=await call_next(req)
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        return response

    @app.get('/')
    def home():return RedirectResponse('/debug')

    @app.get('/debug')
    def debug():return FileResponse(ROOT/'backend/static/index.html')

    @app.post('/v1/users')
    def new_user(req:NewUser):
        u,token=store.create_user(req.name.strip())
        return {'user':u,'token':token}

    @app.get('/v1/status')
    def status(id=Depends(user)):
        return {'screen':provider.status(),'memory':{'retrieval':'multilingual-e5-small' if h.memory.embedder else 'lexical_fallback',
            'prompt':'grounded_template_v1','storage':'sqlite','per_user':True},
            'gaze':{'model':'WebEyeTrack / pretrained BlazeGaze','runs_in':'browser','requires_calibration':True},
            'gate':{'type':'temporal_joint_rules','dwell_ms':8000,'validated_accuracy':False}}

    @app.post('/v1/sessions')
    def start(req:Start,id=Depends(user)):return h.start(id,req)

    @app.get('/v1/sessions/{sid}')
    def session(sid:str,id=Depends(user)):return h.get_session(id,sid)

    @app.post('/v1/sessions/{sid}/observations')
    def observe(sid:str,req:Observation,id=Depends(user)):
        s=h.get_session(id,sid)
        if s['mode']=='live' and req.source=='model':raise ValueError('model observations require the frames endpoint')
        return h.observe(id,sid,req)

    @app.post('/v1/sessions/{sid}/frames')
    def frame(sid:str,req:Frame,id=Depends(user)):
        s=h.get_session(id,sid)
        if s['phase']=='ended':raise ValueError('session ended; screen upload refused')
        if s['mode']!='live':raise ValueError('real frames require a live session')
        if not req.consent:raise ValueError('explicit screen-provider consent required')
        provider.validate_image(req.image)
        h.check_time(s,req.t_ms)
        elapsed=(datetime.now(timezone.utc)-datetime.fromisoformat(s['created_at'])).total_seconds()*1000
        if elapsed-req.t_ms>4000 or req.t_ms<=s['last_t']:raise ValueError('stale screen capture')
        started=time.monotonic()
        screen=provider.classify(req.image,s['goal'])
        elapsed_after=(datetime.now(timezone.utc)-datetime.fromisoformat(s['created_at'])).total_seconds()*1000
        # Age is measured from capture, including arrival delay AND inference.
        if elapsed_after-req.t_ms>4000 or time.monotonic()-started>4:
            screen=Screen()
            provider.last_error='stale_model_result'
        result=h.observe(id,sid,Observation(t_ms=req.t_ms,gaze=req.gaze,activity=req.activity,screen=screen,source='model'))
        result['screen']=screen.model_dump();result['provider']=provider.status()
        return result

    @app.post('/v1/sessions/{sid}/end')
    def end(sid:str,id=Depends(user)):return h.end(id,sid)

    @app.post('/v1/sessions/{sid}/annotations')
    def annotation(sid:str,req:Annotation,id=Depends(user)):return h.annotate(id,sid,req)

    @app.get('/v1/sessions/{sid}/evaluation')
    def evaluation(sid:str,id=Depends(user)):return evaluate(h.get_session(id,sid))

    @app.get('/v1/episodes/{eid}')
    def episode(eid:str,id=Depends(user)):return h.get_episode(id,eid)

    @app.post('/v1/episodes/{eid}/media')
    def media(eid:str,req:Media,id=Depends(user)):return h.media(id,eid,req)

    @app.post('/v1/episodes/{eid}/answer')
    def answer(eid:str,req:Answer,id=Depends(user)):return h.answer(id,eid,req)

    @app.post('/v1/episodes/{eid}/correction')
    def correct(eid:str,req:Correction,id=Depends(user)):return h.correct(id,eid,req)

    @app.get('/v1/bank')
    def bank(id=Depends(user)):return h.export(id)

    @app.get('/v1/videos')
    def videos(id=Depends(user)):
        with store.transaction(id) as tx:return [SAMPLE]+tx.list('video')

    @app.post('/v1/videos')
    def video(req:Video,id=Depends(user)):
        v={'id':uid(),**req.model_dump(),'source':'local','url':None}
        with store.transaction(id) as tx:tx.put('video',v['id'],v)
        return v

    app.mount('/debug-static',StaticFiles(directory=ROOT/'backend/static'),name='debug-static')
    app.mount('/tracker',StaticFiles(directory=ROOT/'public'),name='tracker')

    @app.get('/media/sample-recap.mp4')
    def sample():return FileResponse(ROOT/'public/sample-recap.mp4',media_type='video/mp4')

    return app


app=create_app()
