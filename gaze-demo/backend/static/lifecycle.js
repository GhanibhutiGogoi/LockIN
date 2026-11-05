/** Resource ownership survives asynchronous permission pickers and session changes. */
export class CaptureLease {
  constructor(){this.generation=0;this.pending=false;this.active=null;}
  async acquire(getStream,isCurrent){
    if(this.pending||this.active)throw Error('屏幕共享已启动或正在等待授权，请先结束当前共享。');
    const generation=++this.generation;this.pending=true;let stream;
    try{
      stream=await getStream();
      if(generation!==this.generation||!isCurrent()){stream.getTracks().forEach(t=>t.stop());return null;}
      this.active=stream;return stream;
    }catch(e){if(stream&&stream!==this.active)stream.getTracks().forEach(t=>t.stop());throw e;}
    finally{if(generation===this.generation)this.pending=false;}
  }
  owns(stream){return this.active===stream;}
  stop(){this.generation++;this.pending=false;const stream=this.active;this.active=null;stream?.getTracks().forEach(t=>t.stop());}
}

/** One request at a time; slow requests do not lose an entire timer tick. */
export class CaptureLoop {
  constructor(task,{intervalMs=3000,now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout}={}){
    this.task=task;this.intervalMs=intervalMs;this.now=now;this.schedule=schedule;this.cancel=cancel;this.generation=0;this.timer=null;
  }
  start(){this.stop();void this.run(this.generation);}
  async run(generation){
    const started=this.now();
    try{await this.task();}
    finally{
      if(generation===this.generation)this.timer=this.schedule(()=>{void this.run(generation);},Math.max(0,this.intervalMs-(this.now()-started)));
    }
  }
  stop(){this.generation++;this.cancel(this.timer);this.timer=null;}
}

export function restorePlayback(video,episode,isCurrent){
  const restore=()=>{if(isCurrent()&&Number.isFinite(episode.position_s)&&episode.position_s>0)video.currentTime=episode.position_s;};
  if(video.readyState>=1)restore();else video.addEventListener('loadedmetadata',restore,{once:true});
}

/** Synthetic time advances with replay controls; media keeps real playback time. */
export function timelineNow(mode,phase,replayTime,clockStart,wallNow){
  if(mode!=='replay')return Math.max(0,wallNow-clockStart);
  return replayTime+(['video','quiz'].includes(phase)?Math.max(0,wallNow-clockStart):0);
}

export function restoredReplayTime(session,episode){
  return Math.max(0,session.last_t,episode?.last_media_t||0,episode?.returned_at||0);
}

export function resetUserInspection(document){
  const empty={session:'尚未开始',phase:'未开始',input:'暂无输入。',gate:'等待输入。',episode:'暂无干预。',retrieved:'[]',prompt:'尚未生成。',summary:'尚未评估。',update:'尚无更新。',trace:'[]',bank:'[]',evaluation:'尚无标注评估。'};
  for(const [id,value] of Object.entries(empty))document.getElementById(id).textContent=value;
  for(const id of ['goal','context']){const field=document.getElementById(id);field.value=field.defaultValue;}
  document.getElementById('answer').value='';document.getElementById('video-section').hidden=true;
}
