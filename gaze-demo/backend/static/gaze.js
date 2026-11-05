/** Adapter for the existing frozen pretrained worker. Raw frames never leave browser. */
import {orderedScores} from './stress-contract.js';
export class GazeCapture {
  constructor(video, status) { this.video=video;this.status=status;this.stream=null;this.worker=null;this.ready=false;this.busy=false;this.calibrated=false;this.latest=null;this.lastFrame=0;this.lastFrameId=null;this.presentedFrame=null;this.frameCallback=null;this.hasFrameCallbacks=false;this.canvas=document.createElement('canvas');this.canvas.width=640;this.canvas.height=480;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});this.round=0; }
  cameraLive(){const track=this.stream?.getVideoTracks()[0];return !!track&&track.readyState==='live'&&!track.muted&&!this.video.paused&&!this.video.ended&&this.video.readyState>=2;}
  async start() {
    this.stop();const round=this.round;
    const stream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480},audio:false});
    if(round!==this.round){stream.getTracks().forEach(t=>t.stop());return;}
    this.stream=stream;this.video.srcObject=stream;await this.video.play();
    if(round!==this.round){stream.getTracks().forEach(t=>t.stop());return;}
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
        if(!this.point)this.status(`gaze ${d.gaze?.map(x=>x.toFixed(2)).join(', ')??'不可用'} · ${this.calibrated?'已通过校准验证':'未校准'}`);
      }
      if(d.type==='pointProgress')document.getElementById('cal-status').textContent=`点 ${this.index+1} / ${this.validation?3:9} · ${d.count}/7`;
      if(d.type==='pointDone')this.next(d);
      if(d.type==='fitted'){this.validation=true;this.index=0;this.place();}
      if(d.type==='error'){this.cancel();this.status(d.message);}
    };
    this.worker.postMessage({type:'init',baseUrl:location.origin+'/tracker'});
    const loop=()=>{if(round!==this.round)return;const t=performance.now();
      if(!this.cameraLive()){this.latest=null;return;}
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
  cancel(){clearTimeout(this.timeout);this.point=null;this.worker?.postMessage({type:'cancelPoint'});const overlay=document.getElementById('calibration');if(overlay)overlay.hidden=true;}
  stop(){this.round++;clearInterval(this.raf);if(this.frameCallback!==null)this.video.cancelVideoFrameCallback?.(this.frameCallback);this.frameCallback=null;this.presentedFrame=null;this.hasFrameCallbacks=false;this.cancel();this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;this.worker?.terminate();this.worker=null;this.ready=false;this.calibrated=false;this.latest=null;this.busy=false;this.lastFrame=0;this.lastFrameId=null;}
}
