import {GazeCapture} from './gaze.js';
import {CaptureLease,CaptureLoop,restorePlayback,timelineNow,restoredReplayTime,resetUserInspection} from './lifecycle.js';
const $=id=>document.getElementById(id);
const show=(id,value)=>{$(id).textContent=typeof value==='string'?value:JSON.stringify(value,null,2);};
const notice=(text,error=false)=>{show('notice',text);$('notice').classList.toggle('error',error);};
let users=JSON.parse(localStorage.getItem('lockin-debug-users-v1')||'[]');
let identity=null,session=null,episode=null,clockStart=0,replayTime=0,replaying=false,sharing=null,capturing=false;
let mediaQueue=Promise.resolve(),lastProgress=-1,renderedEpisode=null,closing=false,sessionGeneration=0;
const localFiles=new Map();
const captureLease=new CaptureLease();
const captureLoop=new CaptureLoop(capture);
const gaze=new GazeCapture($('camera'),text=>show('gaze-status',text));
const video=$('intervention');

async function api(path,body,method){
  const owner=identity?.user.id;
  const r=await fetch('/v1'+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',...(identity?{Authorization:'Bearer '+identity.token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw Error(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail));
  if(owner&&identity?.user.id!==owner)throw Error('用户已切换，请重试。');
  return data;
}
const safe=fn=>async(...args)=>{try{await fn(...args);}catch(e){notice(e.message,true);}};
const t=()=>timelineNow(session?.mode,session?.phase,replayTime,clockStart,Date.now());
function refreshUsers(){const selected=identity?.user.id;$('users').replaceChildren(new Option('请选择用户',''),...users.map(u=>new Option(u.user.name,u.user.id)));$('users').value=selected||'';}
function updateLocks(){const active=!!session&&session.phase!=='ended';$('users').disabled=active;$('create').disabled=active;$('start').disabled=!identity||active;$('end').disabled=!active;$('goal').disabled=active;$('context').disabled=active;$('mode').disabled=active;$('register-video').disabled=!identity||active;$('camera-start').disabled=!active||session?.mode!=='live';$('calibrate').disabled=!active||session?.mode!=='live';$('share').disabled=!active||session?.mode!=='live';$('replay-controls').hidden=session?.mode==='live';$('live-controls').open=session?.mode==='live';}
async function bank(){if(!identity)return;show('bank',await api('/bank'));}
async function selectUser(id){
  sessionGeneration++;stopInputs();resetUserInspection(document);identity=users.find(u=>u.user.id===id)||null;session=null;episode=null;renderedEpisode=null;video.removeAttribute('src');video.load();$('video-section').hidden=true;refreshUsers();updateLocks();
  if(!identity){show('provider','请选择用户。');return;}
  const status=await api('/status');show('provider',status);await bank();
  const data=await api('/bank');
  const pending=data.sessions.filter(s=>s.phase!=='ended').at(-1);
  if(pending){
    session=pending;replayTime=session.mode==='replay'?Math.max(0,session.last_t):0;
    if(session.current_episode){episode=await api('/episodes/'+session.current_episode);replayTime=restoredReplayTime(session,episode);}
    clockStart=session.mode==='replay'?Date.now():Date.parse(session.created_at);
    $('goal').value=session.goal;$('context').value=session.study_context;$('mode').value=session.mode;render();
    notice('恢复了当前用户的未结束会话。可继续检查，或先结束它。');
  }else notice('已切换用户，各用户记忆相互独立。');
}
function render(){
  show('session',session?`${session.mode==='replay'?'合成回放':'真实输入'} · ${session.id}`:'尚未开始');show('phase',session?.phase||'未开始');updateLocks();
  if(session)show('gate',session.decisions.at(-1)||'等待有效联合输入。');
  if(!episode)return;
  show('episode',`干预 ${episode.id} · ${episode.phase} · 输入来源 ${episode.input_source}`);
  show('retrieved',episode.retrieved_memories);show('prompt',episode.prompt);show('summary',episode.summary||'需要看完视频、作答，再观察返回学习后的 120 秒。');show('update',episode.memory_update||'尚无更新。');show('trace',episode.trace);
  $('video-section').hidden=false;show('video-title',`${episode.video.title} · 实际风格 ${episode.video.style}${episode.video.matched?'':' · 此视频仅作流程占位，未匹配目标'}`);
  if(renderedEpisode!==episode.id){
    renderedEpisode=episode.id;lastProgress=-1;
    const source=episode.video.url||localFiles.get(episode.video.id);
    if(source){video.src=source;video.load();const eid=episode.id;restorePlayback(video,episode,()=>renderedEpisode===eid&&episode?.id===eid);}
    else notice('当前本地视频文件不在此浏览器会话，请结束本次并重新登记文件。',true);
  }
  $('quiz').hidden=episode.phase!=='quiz';show('question',episode.video.question);
  show('recovery-note',episode.phase==='recovery'?'请返回原来的学习材料。恢复窗口共 120 秒；回放模式可用上方按钮加速输入。':'视频结束后需作答，才能进入返回学习评估。');
}
async function apply(result){session=result.session; if(result.episode)episode=result.episode;render();if(episode?.memory_update)await bank();}
async function replay(kind,seconds){
  if(!session||session.mode!=='replay')throw Error('请先开始回放会话。');
  if(replaying)throw Error('回放仍在进行。');
  if(['video','quiz'].includes(session.phase))throw Error('请先完成本地视频和回顾题。');
  replaying=true;const generation=sessionGeneration,sid=session.id;
  try{
    let time=Math.max(0,Math.ceil(t()/1000)*1000,session.last_t+1000);
    for(let i=0;i<=seconds;i++,time+=1000){
      if(generation!==sessionGeneration||session?.id!==sid||session.phase==='ended')return;
      const input={t_ms:time,source:'replay',activity:.3,gaze:{valid:true,calibrated:true,on_screen:true},screen:{kind,task_related:kind==='study',confidence:.95,context:kind==='study'?$('context').value:'synthetic short-video feed'}};
      show('input',input);const result=await api('/sessions/'+sid+'/observations',input);if(generation!==sessionGeneration)return;await apply(result);
      if(session.phase==='video')break;
    }
    replayTime=session.last_t;clockStart=Date.now();notice('回放已提交；这些是合成数据，不代表实测准确率。');
  }finally{replaying=false;}
}

$('create').onclick=safe(async()=>{const name=$('name').value.trim();if(!name)throw Error('请输入用户名称。');const u=await api('/users',{name});users.push(u);localStorage.setItem('lockin-debug-users-v1',JSON.stringify(users));await selectUser(u.user.id);});
$('users').onchange=safe(()=>selectUser($('users').value));
$('start').onclick=safe(async()=>{
  if(!identity)throw Error('先创建或选择用户。');
  sessionGeneration++;session=await api('/sessions',{goal:$('goal').value,study_context:$('context').value,mode:$('mode').value,style:$('style').value});
  episode=null;renderedEpisode=null;clockStart=session.mode==='live'?Date.parse(session.created_at):Date.now();replayTime=0;render();notice('会话已开始，可以分别检查输入、门控和 harness。');
});
$('end').onclick=safe(async()=>{
  if(!session)return;sessionGeneration++;closing=true;stopInputs();video.pause();await mediaQueue;
  try{session=await api('/sessions/'+session.id+'/end',{});if(episode)episode=await api('/episodes/'+episode.id);render();await bank();notice('会话已结束；未完成的评估按中止记录。');}finally{closing=false;}
});
$('study').onclick=safe(()=>replay('study',1));$('entertainment').onclick=safe(()=>replay('entertainment',9));
$('recover').onclick=safe(async()=>{if(session?.phase!=='recovery')throw Error('请先播放完视频并作答。');await replay('study',120);});

function enqueueMedia(kind){
  if(!episode||episode.phase!=='video'||closing)return;
  const eid=episode.id,owner=identity.user.id,body={event_id:crypto.randomUUID(),kind,t_ms:t(),position_s:video.currentTime};
  mediaQueue=mediaQueue.then(async()=>{
    if(identity?.user.id!==owner)return;
    episode=await api('/episodes/'+eid+'/media',body);
    session=await api('/sessions/'+episode.session_id);render();
  }).catch(e=>{video.pause();notice('播放事件未保存：'+e.message,true);});
}
video.addEventListener('play',()=>enqueueMedia('play'));
video.addEventListener('pause',()=>{if(!video.ended)enqueueMedia('pause');});
video.addEventListener('timeupdate',()=>{if(video.seeking||video.ended||video.paused)return;const current=Math.floor(video.currentTime);if(current!==lastProgress){lastProgress=current;enqueueMedia('progress');}});
video.addEventListener('ended',()=>enqueueMedia('ended'));
video.addEventListener('seeking',()=>{if(episode?.phase==='video'&&video.currentTime>(episode.position_s||0)+1){video.pause();video.currentTime=episode.position_s||0;notice('调试流程需要连续播放；请勿跳过视频。',true);}});
video.addEventListener('ratechange',()=>{if(video.playbackRate!==1)video.playbackRate=1;});
$('quiz').onsubmit=safe(async event=>{event.preventDefault();await mediaQueue;if(!episode)throw Error('暂无干预');const answeredAt=t();episode=await api('/episodes/'+episode.id+'/answer',{t_ms:answeredAt,answer:$('answer').value});if(session.mode==='replay'){replayTime=answeredAt;clockStart=Date.now();}session=await api('/sessions/'+session.id);$('answer').value='';render();notice('答案已记录，开始观察返回学习后的 120 秒。');});
async function correction(false_alarm){if(!episode)throw Error('暂无干预。');episode=await api('/episodes/'+episode.id+'/correction',{false_alarm,note:'debug reviewer correction'});render();await bank();notice(false_alarm?'误报已标记，相关推断已重算撤回。':'记录已恢复，推断已重算。');}
$('false-alarm').onclick=safe(()=>correction(true));$('restore').onclick=safe(()=>correction(false));
$('annotate').onclick=safe(async()=>{if(!session)throw Error('先开始会话。');await api('/sessions/'+session.id+'/annotations',{start_ms:Number($('label-start').value)*1000,end_ms:Number($('label-end').value)*1000,label:$('label-kind').value});show('evaluation',await api('/sessions/'+session.id+'/evaluation'));await bank();});
$('export').onclick=safe(async()=>{const data=await api('/bank');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`lockin-${data.user_id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('register-video').onclick=safe(async()=>{
  const file=$('local-video').files[0];if(!file)throw Error('请选择本地视频。');const url=URL.createObjectURL(file),probe=document.createElement('video');probe.preload='metadata';probe.src=url;
  try{await new Promise((resolve,reject)=>{probe.onloadedmetadata=resolve;probe.onerror=()=>reject(Error('无法读取视频'));});
    const v=await api('/videos',{title:file.name,goal:$('goal').value,style:$('style').value,duration_s:probe.duration,question:'请回顾视频讲解的关键内容。'});
    localFiles.set(v.id,url);await bank();notice('已登记当前用户的本地视频。');
  }catch(e){URL.revokeObjectURL(url);throw e;}
});
$('camera-start').onclick=safe(()=>gaze.start());$('calibrate').onclick=safe(()=>gaze.calibrate());$('cancel-cal').onclick=()=>gaze.cancel();
const frameCanvas=document.createElement('canvas'),frameCtx=frameCanvas.getContext('2d',{willReadFrequently:true});frameCanvas.width=960;frameCanvas.height=540;
const small=document.createElement('canvas');small.width=64;small.height=36;const smallCtx=small.getContext('2d',{willReadFrequently:true});let previousPixels=null;
async function capture(){
  if(!sharing||capturing||!session||session.mode!=='live')return;
  capturing=true;const sid=session.id,owner=identity.user.id,generation=sessionGeneration,stream=sharing;
  try{
    if(!$('consent').checked)throw Error('需要屏幕模型上传同意；已暂停发送。');
    const shared=$('shared');if(shared.readyState<2)return;
    const captured=t(),g=gaze.sample();
    frameCtx.drawImage(shared,0,0,960,540);smallCtx.drawImage(shared,0,0,64,36);const px=smallCtx.getImageData(0,0,64,36).data;
    let diff=0;if(previousPixels)for(let i=0;i<px.length;i+=4)diff+=Math.abs(px[i]-previousPixels[i])+Math.abs(px[i+1]-previousPixels[i+1])+Math.abs(px[i+2]-previousPixels[i+2]);
    const activity=previousPixels?Math.min(1,diff/(64*36*3*255)):0;previousPixels=new Uint8ClampedArray(px);
    const result=await api('/sessions/'+sid+'/frames',{t_ms:captured,gaze:g,activity,image:frameCanvas.toDataURL('image/jpeg',.65),consent:true});
    if(identity?.user.id!==owner||session?.id!==sid||closing||session.phase==='ended'||sessionGeneration!==generation||!captureLease.owns(stream))return;
    show('input',{gaze:g,activity,screen:result.screen,provider:result.provider});await apply(result);
    if(result.provider.last_error)notice('屏幕模型未产生有效结果：'+result.provider.last_error,true);
  }catch(e){notice(e.message,true);}finally{capturing=false;}
}
$('share').onclick=safe(async()=>{
  if(!session||session.mode!=='live')throw Error('请先开始真实输入会话。');
  if(!$('consent').checked)throw Error('请先同意屏幕模型上传。');
  if(!gaze.sample().calibrated)throw Error('请先完成并通过 gaze 校准。');
  const sid=session.id,owner=identity.user.id,generation=sessionGeneration;
  const isCurrent=()=>session?.id===sid&&identity?.user.id===owner&&sessionGeneration===generation&&session.phase!=='ended'&&!closing;
  const stream=await captureLease.acquire(()=>navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'monitor'},audio:false}),isCurrent);
  if(!stream)return;
  const track=stream.getVideoTracks()[0];
  if(track.getSettings().displaySurface!=='monitor'){captureLease.stop();throw Error('当前单屏方案需要共享整块屏幕。');}
  sharing=stream;$('shared').srcObject=stream;
  try{await $('shared').play();}catch(e){stopSharing();throw e;}
  if(!isCurrent()||!captureLease.owns(stream)){stream.getTracks().forEach(t=>t.stop());return;}
  track.onended=()=>{if(captureLease.owns(stream)){stopSharing();notice('屏幕共享已结束，后续输入为未知。');}};
  captureLoop.start();
});
function stopSharing(){captureLoop.stop();captureLease.stop();sharing=null;$('shared').srcObject=null;previousPixels=null;}
function stopInputs(){stopSharing();gaze.stop();}
window.addEventListener('beforeunload',()=>{stopInputs();for(const url of localFiles.values())URL.revokeObjectURL(url);});
refreshUsers();updateLocks();if(users.length)await safe(()=>selectUser(users[0].user.id))();else show('provider','先创建本地用户，再读取模块状态。');
