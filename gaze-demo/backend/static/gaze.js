/** Adapter for the existing frozen pretrained worker. Raw frames never leave browser. */
import {orderedScores} from './stress-contract.js';
export class GazeCapture {
  constructor(video, status, {expression=false}={}) { this.expressionEnabled=expression;this.expressionWorker=null;this.expressionReady=false;this.expressionBusy=false;this.expressionPending=null;this.latestExpression=null;this.lastExpression=0;this.expressionQueue=[]; this.video=video;this.status=status;this.stream=null;this.worker=null;this.ready=false;this.busy=false;this.calibrated=false;this.latest=null;this.lastFrame=0;this.lastFrameId=null;this.presentedFrame=null;this.frameCallback=null;this.hasFrameCallbacks=false;this.canvas=document.createElement('canvas');this.canvas.width=640;this.canvas.height=480;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});this.round=0; }
  cameraLive(){const track=this.stream?.getVideoTracks()[0];return !!track&&track.readyState==='live'&&!track.muted&&!this.video.paused&&!this.video.ended&&this.video.readyState>=2;}
  async start() {
    this.stop();const round=this.round;
    const stream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480},audio:false});
    if(round!==this.round){stream.getTracks().forEach(t=>t.stop());return;}
    this.stream=stream;
    for(const kind of ['mute','ended'])stream.getVideoTracks()[0]?.addEventListener?.(kind,()=>{if(round===this.round)this.invalidateExpression();});
    this.video.srcObject=stream;await this.video.play();
    if(round!==this.round){stream.getTracks().forEach(t=>t.stop());return;}
    if(this.expressionEnabled){
      this.expressionWorker=new Worker('/tracker/expression-worker.js');
      this.expressionWorker.onmessage=({data:d})=>{
        if(round!==this.round)return;
        if(d.type==='ready'){this.expressionReady=true;this.status('FER+ 预训练表情模型已就绪。');return;}
        this.expressionBusy=false;
        const source=this.expressionPending;this.expressionPending=null;
        if(d.type==='expression'&&source&&d.capturedAt===source.t&&this.cameraLive()&&performance.now()-source.t<1200){
          this.latestExpression={...source,expression:{model_id:d.model_id,probabilities:d.probabilities},ms:d.ms};
          this.queueExpression(this.latestExpression);
        }else{this.invalidateExpression();if(d.type==='error'){this.expressionReady=false;this.status('表情模型不可用：'+d.message);}}
      };
      this.expressionWorker.onerror=()=>{this.expressionReady=false;this.expressionBusy=false;this.invalidateExpression();this.status('表情模型加载失败，自动提示保持停用。');};
      this.expressionWorker.postMessage({type:'init'});
    }
    this.hasFrameCallbacks=typeof this.video.requestVideoFrameCallback==='function';
    if(this.hasFrameCallbacks){
      const presented=(_now,metadata)=>{
        if(round!==this.round)return;
        if(Number.isFinite(metadata.presentedFrames)&&metadata.presentedFrames>0)this.presentedFrame={id:metadata.presentedFrames,at:performance.now()};
        this.frameCallback=this.video.requestVideoFrameCallback(presented);
      };
      this.frameCallback=this.video.requestVideoFrameCallback(presented);
    }
    this.worker=new Worker('/tracker/gaze-worker.js');
    this.worker.onmessage=({data:d})=>{
      if(round!==this.round)return;
      if(d.type==='ready'){this.ready=true;this.status('预训练 gaze 已就绪，请校准。');}
      if(['result','idle','error'].includes(d.type))this.busy=false;
      if(d.type==='result'&&this.cameraLive()){
        this.latest={t:d.capturedAt,face:d.face,open:d.eyesOpen,gaze:d.gaze,blendshapes:d.blendshapes};
        if(this.expressionEnabled&&this.expressionReady&&!this.expressionBusy&&d.expressionInput&&performance.now()-this.lastExpression>=400&&performance.now()-d.capturedAt<1200){
          this.expressionBusy=true;this.lastExpression=performance.now();this.expressionPending={...this.latest};
          const values=d.expressionInput;
          this.expressionWorker.postMessage({type:'infer',capturedAt:d.capturedAt,buffer:values.buffer},[values.buffer]);
        }
        if(this.expressionEnabled&&!d.expressionInput)this.invalidateExpression(d.capturedAt);
        if(!this.point)this.status(`gaze ${d.gaze?.map(x=>x.toFixed(2)).join(', ')??'不可用'} · ${this.calibrated?'已通过校准验证':'未校准'}`);
      }
      if(d.type==='pointProgress')document.getElementById('cal-status').textContent=`点 ${this.index+1} / ${this.validation?3:9} · ${d.count}/7`;
      if(d.type==='pointDone')this.next(d);
      if(d.type==='fitted'){this.validation=true;this.index=0;this.place();}
      if(d.type==='error'){this.invalidateExpression();this.cancel();this.status(d.message);}
    };
    this.worker.postMessage({type:'init',baseUrl:location.origin+'/tracker',expression:this.expressionEnabled});
    const loop=()=>{if(round!==this.round)return;const t=performance.now();
      if(!this.cameraLive()){this.latest=null;this.invalidateExpression();return;}
      const count=this.hasFrameCallbacks?null:this.video.getVideoPlaybackQuality?.().totalVideoFrames;
      const frame=this.hasFrameCallbacks?this.presentedFrame:(Number.isFinite(count)&&count>0?{id:count,at:t}:null);
      if(!this.ready||this.busy||t-this.lastFrame<100||!frame||(this.lastFrameId!==null&&frame.id<=this.lastFrameId)||t-frame.at>=1200)return;
      this.lastFrame=t;this.lastFrameId=frame.id;this.busy=true;this.ctx.drawImage(this.video,0,0,640,480);const image=this.ctx.getImageData(0,0,640,480);
      this.worker.postMessage({type:'frame',timestamp:frame.at,width:640,height:480,buffer:image.data.buffer},[image.data.buffer]);};this.raf=setInterval(loop,100);
  }
  calibrate() {if(!this.ready)throw Error('请先启动摄像头并等待模型加载。');this.cancel();this.calibrated=false;this.validation=false;this.index=0;this.errors=[];this.worker.postMessage({type:'reset'});this.place();}
  place(){
    const targets=this.validation?[[-.23,-.19],[.24,.21],[0,0]]:[[0,0],[-.42,-.4],[0,-.4],[.42,-.4],[.42,0],[.42,.4],[0,.4],[-.42,.4],[-.42,0]];
    this.point=targets[this.index];this.size=[innerWidth,innerHeight];document.getElementById('calibration').hidden=false;
    const dot=document.getElementById('target');dot.style.left=(this.point[0]+.5)*100+'%';dot.style.top=(this.point[1]+.5)*100+'%';
    document.getElementById('cal-status').textContent=`${this.validation?'独立验证':'个人校准'}：${this.index+1} / ${targets.length}`;
    this.worker.postMessage({type:'point',point:{index:this.index,x:this.point[0],y:this.point[1],validation:this.validation}});
    this.timeout=setTimeout(()=>{this.cancel();this.status('校准采样超时，请调整光线后重试。');},15000);
  }
  next(d){
    clearTimeout(this.timeout);
    if(this.validation)this.errors.push(Math.hypot(d.predicted[0]-d.target[0],d.predicted[1]-d.target[1]));
    this.index++;
    if(this.index<(this.validation?3:9)){this.place();return;}
    if(!this.validation){this.point=null;this.worker.postMessage({type:'fit'});document.getElementById('cal-status').textContent='拟合个人校准映射…';return;}
    this.calibrated=this.errors.every(x=>Number.isFinite(x)&&x<.22);this.point=null;document.getElementById('calibration').hidden=true;
    this.status(`独立验证误差 ${this.errors.map(x=>x.toFixed(2)).join(', ')} · ${this.calibrated?'通过':'误差偏大，请重新校准'}`);
  }
  sample(){if(!this.cameraLive())this.latest=null;const l=this.latest;const age=l?performance.now()-l.t:Infinity;const valid=!!l&&age>=0&&age<1200&&l.face&&l.open&&l.gaze?.every(Number.isFinite)&&!this.point;
    const calibrated=this.calibrated&&this.size?.[0]===innerWidth&&this.size?.[1]===innerHeight;
    return {valid:!!valid,calibrated:!!calibrated,on_screen:valid?l.gaze.every(x=>Math.abs(x)<=.5):null,x:valid?l.gaze[0]:null,y:valid?l.gaze[1]:null};}
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
  cancel(){clearTimeout(this.timeout);this.point=null;this.worker?.postMessage({type:'cancelPoint'});const overlay=document.getElementById('calibration');if(overlay)overlay.hidden=true;}
  stop(){this.round++;this.expressionWorker?.terminate();this.expressionWorker=null;this.expressionReady=false;this.expressionBusy=false;this.expressionPending=null;this.latestExpression=null;this.lastExpression=0;this.expressionQueue=[];clearInterval(this.raf);if(this.frameCallback!==null)this.video.cancelVideoFrameCallback?.(this.frameCallback);this.frameCallback=null;this.presentedFrame=null;this.hasFrameCallbacks=false;this.cancel();this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;this.worker?.terminate();this.worker=null;this.ready=false;this.calibrated=false;this.latest=null;this.busy=false;this.lastFrame=0;this.lastFrameId=null;}
}
