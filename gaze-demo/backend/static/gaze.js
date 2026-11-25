/** Adapter for the existing frozen pretrained worker. Raw frames never leave browser. */
import {orderedScores} from './stress-contract.js';
import {OffscreenMonitor} from './offscreen.js';
import {readCalibrationGeometry, coversScreen, changedGeometry} from './calibration-geometry.js';

const CALIBRATION_TARGETS=[[0,0],[-.42,-.4],[0,-.4],[.42,-.4],[.42,0],[.42,.4],[0,.4],[-.42,.4],[-.42,0]];
const VALIDATION_TARGETS=[[-.23,-.19],[.24,.21],[-.18,.24]];
const QUICK_CHECK_MS=8000;
const MAX_VALIDATION_ERROR=.22;
export class GazeCapture {
  constructor(video, status, {expression=false, assetBase, model='blazegaze', onObservation, onCalibrationPoint, manualStages=false}={}) { this.expressionEnabled=expression;this.expressionWorker=null;this.expressionReady=false;this.expressionBusy=false;this.expressionPending=null;this.latestExpression=null;this.lastExpression=0;this.expressionQueue=[]; this.video=video;this.status=status;this.stream=null;this.worker=null;this.ready=false;this.busy=false;this.calibrated=false;this.latest=null;this.lastFrame=0;this.lastFrameId=null;this.presentedFrame=null;this.frameCallback=null;this.hasFrameCallbacks=false;this.canvas=document.createElement('canvas');this.canvas.width=640;this.canvas.height=480;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});this.round=0;
    this.manualStages=manualStages;
    this.calibrationId=0;this.phase='idle';this.validationReport=null;this.calibrationIssue=null;this.invalidatedAt=-Infinity;this.onResize=()=>this.checkViewport();
    this.observedFrame=null;this.lastPollAt=null;this.workerStartedAt=null;this.inferenceStartedAt=null;
    this.captureGeometry=null;
    this.assetBase=assetBase;
    this.model=model;
    this.onObservation=onObservation;
    this.onCalibrationPoint=onCalibrationPoint;
    this.ownsStream=false;
    this.captureRounds=false;
    this.resumedCapture=false;
    this.calibrationKey=null;
    this.resetDiagnosticFrames();
    this.suspended=false;
    this.canRecheck=false;
    this.quickDeadline=null;
    this.offscreen=new OffscreenMonitor();
  }
  cameraLive(){const track=this.stream?.getVideoTracks()[0];return !!track&&track.readyState==='live'&&!track.muted&&!this.video.paused&&!this.video.ended&&this.video.readyState>=2;}
  setAwayThresholdMs(ms){this.offscreen.setThresholdMs(ms);}
  async start(borrowedStream) {
    this.stop();this.offscreen.clear();const round=this.round;
    const ownsStream=!borrowedStream;
    const stream=borrowedStream??await navigator.mediaDevices.getUserMedia({video:{width:640,height:480},audio:false});
    if(round!==this.round){if(ownsStream)stream.getTracks().forEach(t=>t.stop());return;}
    await this.attachStream(stream,ownsStream,round);
    if(round!==this.round)return;
    if(this.expressionEnabled){
      this.expressionWorker=new Worker('/tracker/expression-worker.js');
      this.expressionWorker.onmessage=({data:d})=>{
        if(round!==this.round)return;
        if(d.type==='ready'){this.expressionReady=true;this.status('The pretrained FER+ expression model is ready.');return;}
        this.expressionBusy=false;
        const source=this.expressionPending;this.expressionPending=null;
        if(d.type==='expression'&&source&&d.capturedAt===source.t&&this.cameraLive()&&performance.now()-source.t<1200){
          this.latestExpression={...source,expression:{model_id:d.model_id,probabilities:d.probabilities},ms:d.ms};
          this.queueExpression(this.latestExpression);
        }else{this.invalidateExpression();if(d.type==='error'){this.expressionReady=false;this.status('Expression model unavailable: '+d.message);}}
      };
      this.expressionWorker.onerror=()=>{this.expressionReady=false;this.expressionBusy=false;this.invalidateExpression();this.status('The expression model failed to load. Automatic prompts remain disabled.');};
      this.expressionWorker.postMessage({type:'init'});
    }
    const worker=new Worker((this.assetBase??'/tracker')+'/gaze-worker.js');
    this.worker=worker;
    worker.onmessage=({data:d})=>{
      if(this.worker!==worker||!this.stream)return;
      if(d.captureRound!==undefined&&d.captureRound!==this.round)return;
      const frameReply=d.type==='result'||d.type==='idle'||(d.type==='error'&&d.operation==='frame');
      if(this.resumedCapture&&frameReply&&d.captureRound!==this.round)return;
      if(d.type==='ready'){
        if(['worker_error','camera_geometry_changed'].includes(this.calibrationIssue))return;
        if(d.protocolVersion!==5){this.fail('Gaze worker version mismatch. Run npm run build in gaze-demo, then npm run gaze:assets in web, and refresh the page.');return;}
        if(this.model==='eyetheia'&&d.model!=='eyetheia'){this.fail('EyeTheia worker version mismatch. Run npm run build in gaze-demo and update the web model assets.');return;}
        this.ready=true;this.captureRounds=d.captureRounds===true;this.workerStartedAt=null;this.status('The pretrained gaze model is ready. Please calibrate.');
      }
      if(['result','idle','error'].includes(d.type)){this.busy=false;this.inferenceStartedAt=null;}
      this.checkViewport();
      if(d.type==='result'&&this.ready&&this.cameraLive()&&d.capturedAt>this.invalidatedAt&&d.capturedAt<=performance.now()){
        this.latest={t:d.capturedAt,face:d.face,open:d.eyesOpen,gaze:d.gaze,blendshapes:d.blendshapes,ms:d.ms,outside:d.outside,calibrationId:d.calibrationId,attentionValid:d.attentionValid,attentionReason:d.attentionReason,diagnostic:d.diagnostic};
        if(this.phase!=='idle'){
          const bucket=!d.face?'noFace':!d.eyesOpen?'eyesUnavailable':
            !Array.isArray(d.gaze)||d.gaze.length!==2||!d.gaze.every(Number.isFinite)?'noGaze':'usable';
          this.diagnosticFrames[bucket]++;
        }
        const sample=this.sample();
        if(!this.ready)return;
        const offscreen=this.offscreen.observe({t:d.capturedAt,valid:sample.valid,calibrated:sample.calibrated,outside:sample.on_screen===null?null:!sample.on_screen},performance.now());
        this.onObservation?.({sample,offscreen,capturedAt:d.capturedAt,diagnostic:d.diagnostic?{...d.diagnostic,timing:{...d.diagnostic.timing,lapseMs:offscreen.threshold_ms},phase:this.phase,awayMs:offscreen.away_ms,returnMs:offscreen.return_ms,lastReset:offscreen.last_reset}:undefined});
        if(this.expressionEnabled&&this.expressionReady&&!this.expressionBusy&&d.expressionInput&&performance.now()-this.lastExpression>=400&&performance.now()-d.capturedAt<1200){
          this.expressionBusy=true;this.lastExpression=performance.now();this.expressionPending={...this.latest};
          const values=d.expressionInput;
          this.expressionWorker.postMessage({type:'infer',capturedAt:d.capturedAt,buffer:values.buffer},[values.buffer]);
        }
        if(this.expressionEnabled&&!d.expressionInput)this.invalidateExpression(d.capturedAt);
        if(!this.point)this.status(`gaze ${d.gaze?.map(x=>x.toFixed(2)).join(', ')??'Unavailable'} · ${this.calibrated?'Calibration validated':'Not calibrated'}`);
      }
      if(d.type==='pointProgress'&&this.matchesPoint(d))this.showPoint(d.count);
      if(d.type==='pointDone')this.next(d);
      if(d.type==='fitted'&&this.phase==='fitting'&&d.calibrationId===this.calibrationId){clearTimeout(this.timeout);this.fitDiagnostics=d.fitDiagnostics??null;this.validation=true;this.phase='validation';this.index=0;this.beginStage();}
      if(d.type==='error'&&(d.calibrationId===undefined||d.calibrationId===this.calibrationId)){
        if(d.operation==='fit'){
          this.fitDiagnostics=d.fitDiagnostics??null;
          this.cancel();this.calibrated=false;this.calibrationIssue='fit_failed';
          this.status('Calibration data has insufficient variation or fitting failed. Keep your posture steady and follow each point with your eyes, then retry.');
        }else this.fail(d.message);
      }
    };
    worker.onerror=()=>{if(this.worker===worker)this.fail('The gaze model failed. Stop and restart tracking.');};
    this.workerStartedAt=performance.now();
    worker.postMessage({type:'init',baseUrl:this.assetBase??location.origin+'/tracker',expression:this.expressionEnabled,model:this.model});
    this.runFrames(round);
  }

  async attachStream(stream,ownsStream,round){
    this.stream=stream;this.ownsStream=ownsStream;
    this.trackListeners=new AbortController();
    for(const kind of ['mute','ended'])stream.getVideoTracks()[0]?.addEventListener?.(kind,()=>{if(round===this.round)this.interrupt();},{signal:this.trackListeners.signal});
    this.video.srcObject=stream;await this.video.play();
    if(round===this.round)globalThis.addEventListener?.('resize',this.onResize);
  }

  runFrames(round){
    this.lastPollAt=performance.now();
    this.hasFrameCallbacks=typeof this.video.requestVideoFrameCallback==='function';
    if(this.hasFrameCallbacks){
      const presented=(_now,metadata)=>{
        if(round!==this.round)return;
        if(Number.isFinite(metadata.presentedFrames)&&metadata.presentedFrames>0)this.presentedFrame={id:metadata.presentedFrames,at:performance.now()};
        this.frameCallback=this.video.requestVideoFrameCallback(presented);
      };
      this.frameCallback=this.video.requestVideoFrameCallback(presented);
    }
    const loop=()=>{if(round!==this.round)return;const t=performance.now();
      if(!this.cameraLive()){this.interrupt();return;}
      if(!this.ensureFrameGeometry())return;
      if((this.workerStartedAt!==null&&t-this.workerStartedAt>45000)||(this.inferenceStartedAt!==null&&t-this.inferenceStartedAt>30000)){
        this.fail('The gaze model is not responding. Stop and restart tracking. If the problem persists, share the model diagnostics.');return;
      }
      const pollGap=this.lastPollAt===null?Infinity:t-this.lastPollAt;this.lastPollAt=t;
      // Presentation callbacks can stop in an occluded/background tab while the
      // camera still decodes frames. Poll a real decoded-frame counter even when
      // requestVideoFrameCallback exists; never substitute video.currentTime.
      const count=this.video.webkitDecodedFrameCount??this.video.getVideoPlaybackQuality?.().totalVideoFrames;
      // Observe counter changes even while loading/busy. Their first observation,
      // not the eventual inference submission, bounds fallback frame freshness.
      if(Number.isFinite(count)&&count>0&&(!this.observedFrame||count>this.observedFrame.id))this.observedFrame={id:count,at:t,fresh:pollGap>=0&&pollGap<1200};
      const frame=Number.isFinite(count)&&count>0
        ? (this.observedFrame?.fresh?this.observedFrame:null)
        : this.presentedFrame;
      if(!this.ready||this.busy||t-this.lastFrame<100||!frame||(this.lastFrameId!==null&&frame.id<=this.lastFrameId)||t-frame.at>=1200)return;
      const {width,height}=this.canvas;
      this.lastFrame=t;this.lastFrameId=frame.id;this.busy=true;this.inferenceStartedAt=t;this.ctx.drawImage(this.video,0,0,width,height);const image=this.ctx.getImageData(0,0,width,height);
      this.worker.postMessage({type:'frame',timestamp:frame.at,captureRound:round,width,height,buffer:image.data.buffer},[image.data.buffer]);};this.raf=setInterval(loop,100);
  }

  resetDiagnosticFrames(){
    this.diagnosticFrames={usable:0,noFace:0,eyesUnavailable:0,noGaze:0};
    this.pointDiagnostics=[];
  }

  calibrationDiagnostics(){
    const camera=this.captureGeometry;
    const report=this.validationReport;
    return {
      issue:this.calibrationIssue,
      frames:{...this.diagnosticFrames},
      camera:camera?[camera.source_width,camera.source_height]:null,
      method:'median-7-affine-v1',
      fit:this.fitDiagnostics??null,
      points:[...this.pointDiagnostics],
      validation:report?{
        passed:report.passed,meanErrorPx:report.meanErrorPx,maxErrorPx:report.maxErrorPx,
        maxNormalizedError:report.maxNormalizedError,threshold:report.threshold,
        pointErrorsPx:report.points.map(point=>point.errorPx),
      }:null,
    };
  }

  geometryKey(){
    const deviceId=this.stream?.getVideoTracks()[0]?.getSettings?.().deviceId;
    const {videoWidth,videoHeight}=this.video;
    if(!deviceId||!videoWidth||!videoHeight)return null;
    const g=readCalibrationGeometry();
    return JSON.stringify([deviceId,videoWidth,videoHeight,...(this.calibrationSpace==='screen'
      ? [g.screenWidth,g.screenHeight,g.pixelRatio,g.screenLeft,g.screenTop]
      : [g.width,g.height,g.pixelRatio])]);
  }

  suspend(){
    if(this.expressionEnabled||!this.captureRounds||!this.ready||!this.calibrated||
       !this.calibrationKey||this.calibrationKey!==this.geometryKey()||this.phase!=='idle')return false;
    this.round++;
    this.detachStream();
    this.calibrated=false;
    this.offscreen.clear();
    this.suspended=true;
    return true;
  }

  async resume(stream){
    if(!this.suspended||!this.ready||!stream)return false;
    const round=this.round;
    this.suspended=false;
    try{
      await this.attachStream(stream,false,round);
    }catch(error){
      if(round===this.round)this.detachStream();
      throw error;
    }
    if(round!==this.round)return false;
    if(!this.cameraLive()||this.geometryKey()!==this.calibrationKey){
      this.detachStream();
      return false;
    }
    this.resumedCapture=true;
    this.canRecheck=true;
    this.runFrames(round);
    return true;
  }

  revalidate(){
    if(!this.canRecheck||!this.ready||!this.cameraLive())return false;
    // Validation dots must occupy the original physical calibration area.
    if(this.calibrationGeometry&&changedGeometry(this.calibrationGeometry,readCalibrationGeometry()).length)return false;
    this.canRecheck=false;
    this.quickDeadline=performance.now()+QUICK_CHECK_MS;
    this.calibrationIssue=null;
    this.validationReport=null;
    this.validation=true;
    this.phase='validation';
    this.index=0;
    this.errors=[];
    this.validationPoints=[];
    this.beginStage();
    return true;
  }

  detachStream(){
    globalThis.removeEventListener?.('resize',this.onResize);
    clearInterval(this.raf);
    if(this.frameCallback!==null)this.video.cancelVideoFrameCallback?.(this.frameCallback);
    this.frameCallback=null;
    this.presentedFrame=null;
    this.hasFrameCallbacks=false;
    this.trackListeners?.abort();
    this.trackListeners=null;
    if(this.ownsStream)this.stream?.getTracks().forEach(t=>t.stop());
    this.stream=null;
    this.ownsStream=false;
    this.video.srcObject=null;
    this.invalidatedAt=performance.now();
    this.observedFrame=null;
    this.lastPollAt=null;
    this.inferenceStartedAt=null;
    this.latest=null;
    this.busy=false;
    this.lastFrame=0;
    this.lastFrameId=null;
  }

  ensureFrameGeometry(){
    if(this.calibrationIssue==='camera_geometry_changed')return false;
    const w=this.video.videoWidth,h=this.video.videoHeight;
    if(!Number.isInteger(w)||!Number.isInteger(h)||w<=0||h<=0)return false;
    if(this.captureGeometry&&(this.captureGeometry.source_width!==w||this.captureGeometry.source_height!==h)){
      // WebEyeTrack caches perspective parameters for its first input shape.
      // A different source geometry requires a fresh worker, not the old affine map.
      this.fail('Camera frame dimensions changed. Stop and restart the camera, then recalibrate.','camera_geometry_changed');return false;
    }
    if(!this.captureGeometry){
      this.canvas.width=640;this.canvas.height=Math.max(1,Math.round(640*h/w));
      this.captureGeometry={source_width:w,source_height:h,input_width:this.canvas.width,input_height:this.canvas.height,resize:'preserve_aspect_ratio'};
    }
    return true;
  }
  cameraInfo(){return this.captureGeometry?{...this.captureGeometry,observed_width:this.video.videoWidth,observed_height:this.video.videoHeight}:null;}
  interrupt(){this.latest=null;this.invalidatedAt=performance.now();this.offscreen.invalidate();this.invalidateExpression();if(this.phase!=='idle'){this.cancel();this.calibrationIssue='camera_interrupted';this.status('Camera interrupted. Calibration was cancelled. Restore the camera feed and retry.');}}
  fail(message,issue='worker_error'){this.ready=false;this.interrupt();this.cancel();this.ready=false;this.busy=false;this.workerStartedAt=null;this.inferenceStartedAt=null;this.worker?.terminate();this.calibrated=false;this.calibrationIssue=issue;this.status(message);}
  checkViewport(){
    if(this.calibrationGeometry){
      const current=readCalibrationGeometry();
      const space=this.calibrated&&this.phase==='idle'?this.calibrationSpace:'viewport';
      if(changedGeometry(this.calibrationGeometry,current,space).length&&(this.calibrated||this.phase!=='idle')){
        this.cancel();this.calibrated=false;this.validationReport=null;this.calibrationIssue='viewport_changed';
        this.status(space==='screen'?'Display or scale changed. Please recalibrate.':'Calibration area changed. Please recalibrate.');
      }
      return;
    }
    if(this.size&&(this.calibrated||this.phase!=='idle')&&(this.size[0]!==innerWidth||this.size[1]!==innerHeight||(this.pixelRatio!==undefined&&this.pixelRatio!==(globalThis.devicePixelRatio??1)))){
      this.cancel();this.calibrated=false;this.validationReport=null;this.calibrationIssue='viewport_changed';this.status('Window size changed. Please recalibrate.');
    }
  }
  calibrate({screen=false}={}) {if(!this.ready||!this.cameraLive())throw Error('Start the camera and wait for the model to load first.');this.cancel();this.calibrated=false;this.validationReport=null;this.calibrationIssue=null;this.fitDiagnostics=null;this.pointDiagnostics=[];this.validation=false;this.phase='points';this.index=0;this.errors=[];this.validationPoints=[];this.size=[innerWidth,innerHeight];this.pixelRatio=globalThis.devicePixelRatio??1;this.calibrationGeometry=readCalibrationGeometry();this.calibrationSpace=screen&&coversScreen(this.calibrationGeometry)?'screen':'viewport';this.worker.postMessage({type:'reset',calibrationId:this.calibrationId});this.beginStage();}
  beginStage(){
    if(!this.manualStages){this.place();return;}
    this.phase='awaiting-start';
    this.point=null;
    this.onCalibrationPoint?.({x:.5,y:.5,index:1,total:this.targetCount(),validation:this.validation,count:0,recheck:this.quickDeadline!==null,awaitingStart:true});
  }
  startCalibrationStage(){
    if(this.phase!=='awaiting-start'||!this.ready||!this.cameraLive())return;
    if(this.quickDeadline!==null)this.quickDeadline=performance.now()+QUICK_CHECK_MS;
    this.phase=this.validation?'validation':'points';
    this.place();
  }
  place(){
    const targets=this.validation?VALIDATION_TARGETS:CALIBRATION_TARGETS;
    this.point=targets[this.index];this.showPoint();
    const startedAt=performance.now();
    this.worker.postMessage({type:'point',point:{index:this.index,x:this.point[0],y:this.point[1],validation:this.validation,calibrationId:this.calibrationId,captureRound:this.round,startedAt}});
    const remaining=this.quickDeadline===null?15000:Math.max(0,this.quickDeadline-startedAt);
    this.timeout=setTimeout(()=>this.pointTimeout(),remaining);
  }
  pointTimeout(){
    this.cancel();
    this.calibrationIssue='timeout';
    this.status('Calibration sampling timed out. Adjust the lighting and retry.');
  }
  showPoint(count=0){
    const target=this.point?{x:this.point[0]+.5,y:this.point[1]+.5,index:this.index+1,total:this.targetCount(),validation:this.validation,count}:null;
    if(target&&this.quickDeadline!==null)target.recheck=true;
    if(this.onCalibrationPoint){this.onCalibrationPoint(target);return;}
    const overlay=document.getElementById('calibration');
    if(!overlay)return;
    overlay.hidden=!target&&this.phase!=='fitting';
    if(this.phase==='fitting'){document.getElementById('cal-status').textContent='Fitting the personal calibration mapping…';return;}
    if(!target)return;
    const dot=document.getElementById('target');
    dot.style.left=target.x*100+'%';dot.style.top=target.y*100+'%';
    document.getElementById('cal-status').textContent=count
      ?`Point ${target.index} / ${target.total} · ${count}/7`
      :`${target.validation?'Independent validation':'Personal calibration'}: ${target.index} / ${target.total}`;
  }
  targetCount(){return this.validation?(this.quickDeadline===null?VALIDATION_TARGETS.length:2):CALIBRATION_TARGETS.length;}
  matchesPoint(d){return (!this.resumedCapture||d.captureRound===this.round)&&!!this.point&&['points','validation'].includes(this.phase)&&d.calibrationId===this.calibrationId&&d.index===this.index&&d.validation===this.validation;}
  next(d){
    if(!this.matchesPoint(d))return;
    if(this.quickDeadline!==null&&performance.now()>=this.quickDeadline){this.pointTimeout();return;}
    clearTimeout(this.timeout);
    if(this.validation){
      if(!Array.isArray(d.predicted)||d.predicted.length!==2||!d.predicted.every(Number.isFinite)){this.cancel();this.calibrationIssue='invalid_validation';this.status('The validation point has no valid coordinates. Please recalibrate.');return;}
      const dx=d.predicted[0]-this.point[0],dy=d.predicted[1]-this.point[1];
      this.errors.push(Math.hypot(dx,dy));
      this.validationPoints.push({target:[...this.point],predicted:d.predicted,errorPx:Math.hypot(dx*this.size[0],dy*this.size[1])});
    }
    if(d.diagnostics)this.pointDiagnostics.push({
      ...d.diagnostics,index:this.index+1,mode:this.validation?(this.quickDeadline===null?'validation':'quick-check'):'calibration',
      target:[...this.point],
      errorNormalized:this.validation?Math.hypot(d.predicted[0]-this.point[0],d.predicted[1]-this.point[1]):null,
      errorPx:this.validation?Math.hypot((d.predicted[0]-this.point[0])*this.size[0],(d.predicted[1]-this.point[1])*this.size[1]):null,
    });
    this.index++;
    if(this.index<this.targetCount()){this.place();return;}
    if(!this.validation){this.point=null;this.phase='fitting';this.worker.postMessage({type:'fit',calibrationId:this.calibrationId});this.showPoint();this.timeout=setTimeout(()=>{this.cancel();this.calibrationIssue='fit_timeout';this.status('Calibration fitting timed out. Please restart the camera.');},15000);return;}
    const count=this.targetCount();
    this.calibrated=this.errors.length===count&&this.errors.every(x=>Number.isFinite(x)&&x<MAX_VALIDATION_ERROR);
    this.calibrationIssue=this.calibrated?null:'validation_failed';
    this.calibrationKey=this.calibrated?this.geometryKey():null;
    this.latest=null;
    this.invalidatedAt=performance.now();
    this.quickDeadline=null;
    this.point=null;
    this.phase='idle';
    this.showPoint();
    this.validationReport={passed:this.calibrated,points:this.validationPoints,meanErrorPx:this.validationPoints.reduce((s,p)=>s+p.errorPx,0)/count,maxErrorPx:Math.max(...this.validationPoints.map(p=>p.errorPx)),viewport:[...this.size],maxNormalizedError:Math.max(...this.errors),threshold:MAX_VALIDATION_ERROR,camera:this.cameraInfo()};
    this.status(`Independent validation errors ${this.errors.map(x=>x.toFixed(2)).join(', ')} · ${this.calibrated?'Passed':'Error too high. Please recalibrate.'}`);
  }
  sample(){this.checkViewport();if(!this.cameraLive()||!this.ensureFrameGeometry())this.latest=null;const l=this.latest;const age=l?performance.now()-l.t:Infinity;
    const coordinates=!!l&&l.open&&Array.isArray(l.gaze)&&l.gaze.length===2&&l.gaze.every(Number.isFinite);
    const independent=!!l&&l.attentionValid===true&&l.outside===true&&['head_away','eyes_closed'].includes(l.attentionReason);
    const valid=this.ready&&!!l&&age>=0&&age<1200&&l.face&&(coordinates||independent)&&this.phase==='idle';
    const calibrated=this.calibrated;
    const membership=valid&&calibrated&&l.calibrationId===this.calibrationId&&typeof l.outside==='boolean'?!l.outside:null;
    return {valid:!!valid,calibrated:!!calibrated,on_screen:membership,x:valid&&coordinates?l.gaze[0]:null,y:valid&&coordinates?l.gaze[1]:null,eyes_open:!!l?.open,reason:l?.attentionReason??null};}
  diagnostics(){
    const sample=this.sample(),l=this.latest,age=l?performance.now()-l.t:Infinity;
    const reason=!this.stream?'stopped':!this.cameraLive()?'camera_unavailable':this.calibrationIssue==='camera_geometry_changed'?'camera_changed':this.calibrationIssue==='worker_error'?'worker_error':!this.ready?'loading':this.phase!=='idle'?'calibrating':!l||age<0||age>=1200?'waiting_for_frame':!l.face?'no_face':sample.valid&&sample.on_screen===false&&['head_away','eyes_closed'].includes(l.attentionReason)?l.attentionReason:!l.open?'eyes_unavailable':!sample.valid?'no_gaze':!sample.calibrated?'uncalibrated':'tracking';
    if(!this.cameraLive()||!this.ready||!this.calibrated||this.phase!=='idle')this.offscreen.invalidate();
    return {...sample,reason,phase:this.phase,report:this.validationReport,issue:this.calibrationIssue,ageMs:Number.isFinite(age)?age:null,inferenceMs:l?.ms??null,camera:this.cameraInfo(),offscreen:this.offscreen.snapshot(performance.now())};
  }
  facialSample(names){
    if(!this.cameraLive())this.latest=null;
    const l=this.latest,age=l?performance.now()-l.t:Infinity;
    const values=l&&l.face&&age>=0&&age<1200?orderedScores(l.blendshapes,names):null;
    return {valid:values!==null,values,capturedAt:values?l.t:null};
  }
  queueExpression(sample){
    if(this.expressionQueue.length>=64){this.expressionQueue=[{t:performance.now(),face:false,expression:null}];this.latestExpression=null;this.expressionPending=null;return;}
    if(!sample.face&&this.expressionQueue.at(-1)?.face===false)this.expressionQueue[this.expressionQueue.length-1]=sample;
    else this.expressionQueue.push(sample);
  }
  invalidateExpression(at=performance.now()){
    this.latestExpression=null;this.expressionPending=null;
    if(this.expressionEnabled)this.queueExpression({t:at,face:false,expression:null});
  }
  expressionSamples(names){
    if(!this.cameraLive())this.invalidateExpression();
    const now=performance.now(),queue=this.expressionQueue.splice(0);
    // Never let a stalled connection replay an old chronology as current evidence.
    if(queue.some(l=>now-l.t>=1200||l.t>now))return [{valid:false,values:null,expression:null,capturedAt:now}];
    return queue.map(l=>{
      const values=l.face?orderedScores(l.blendshapes,names):null;
      return {valid:values!==null,values,expression:values?l.expression:null,capturedAt:l.t};
    });
  }
  expressionSample(names){
    if(!this.cameraLive())this.invalidateExpression();
    const l=this.latestExpression,age=l?performance.now()-l.t:Infinity;
    const values=l?.face&&age>=0&&age<1200?orderedScores(l.blendshapes,names):null;
    return {valid:values!==null,values,capturedAt:values?l.t:null,expression:values?l.expression:null};
  }
  cancel(){clearTimeout(this.timeout);this.quickDeadline=null;this.canRecheck=false;this.offscreen.reset();this.calibrationId++;this.phase='idle';this.point=null;this.worker?.postMessage({type:'cancelPoint'});this.showPoint();}
  stop(){
    this.round++;
    this.expressionWorker?.terminate();
    this.expressionWorker=null;
    this.expressionReady=false;
    this.expressionBusy=false;
    this.expressionPending=null;
    this.latestExpression=null;
    this.lastExpression=0;
    this.expressionQueue=[];
    this.detachStream();
    this.cancel();
    this.worker?.terminate();
    this.worker=null;
    this.ready=false;
    this.calibrated=false;
    this.validationReport=null;
    this.calibrationIssue=null;
    this.invalidatedAt=-Infinity;
    this.captureGeometry=null;
    this.workerStartedAt=null;
    this.fitDiagnostics=null;
    this.calibrationKey=null;
    this.captureRounds=false;
    this.calibrationGeometry=null;
    this.calibrationSpace='viewport';
    this.resumedCapture=false;
    this.suspended=false;
  }
}
