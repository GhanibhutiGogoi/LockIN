import {GazeCapture} from './gaze.js';
import {CaptureLoop} from './lifecycle.js';
import {describePrediction} from './stress-contract.js';
import {petMarkup} from './stress-pets.js';

const $=id=>document.getElementById(id);
const show=(id,value)=>{$(id).textContent=typeof value==='string'?value:JSON.stringify(value,null,2);};
const notice=(message,error=false)=>{show('notice',message);$('notice').classList.toggle('error',error);};
let users=JSON.parse(localStorage.getItem('lockin-debug-users-v1')||'[]');
let identity=null,session=null,event=null,config=null,generation=0,replayTime=0,replaying=false,lastCapture=-1,captureOrigin=0,petTimer=null;
const gaze=new GazeCapture($('camera'),message=>{
  if(message.startsWith('gaze '))return;
  notice(message.includes('校准')?'面部特征模型已加载，开始收集自然表情基线。':message);
});
const captures=new CaptureLoop(upload,{intervalMs:500});
const active=()=>session?.phase==='active';
const time=()=>session?.mode==='replay'?replayTime:Math.max(0,Date.now()-Date.parse(session.created_at));

async function api(path,body){
  const owner=identity?.user.id;
  const response=await fetch('/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(identity?{Authorization:'Bearer '+identity.token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(owner&&identity?.user.id!==owner)throw Error('用户已切换，旧请求已忽略。');
  if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail));
  return data;
}
const safe=fn=>async(...args)=>{try{await fn(...args);}catch(error){notice(error.message,true);}};
function locks(){
  for(const id of ['users','name','create','mode'])$(id).disabled=active();
  $('start').disabled=!identity||active();$('end').disabled=!active();
  $('camera-start').disabled=!active();$('camera-stop').disabled=!active();
  $('live-controls').hidden=!active()||session.mode!=='live';$('replay-controls').hidden=!active()||session.mode!=='replay';
  $('label-controls').hidden=!active()||session.mode!=='live';
}
function refreshUsers(){
  $('users').replaceChildren(new Option('请选择用户',''),...users.map(u=>new Option(u.user.name,u.user.id)));
  $('users').value=identity?.user.id||'';
}
function hidePet(){clearTimeout(petTimer);petTimer=null;$('relief').hidden=true;$('pet').replaceChildren();}
function stopInputs(){captures.stop();gaze.stop();lastCapture=-1;}
async function bank(){if(identity)show('bank',await api('/stress/bank'));}
function render(prediction=session?.last_prediction){
  locks();const text=describePrediction(prediction,session?.mode);
  show('state',text.title);show('explanation',text.explanation);
  show('source',session?`${session.mode==='replay'?'合成回放 · 非模型推断':'摄像头面部特征 · 实验性估计'}${active()?'':' · 已结束'}`:'尚未开始');
  show('model-note',config?.model.available?'已加载实验模型；尚未在本项目用户上验证。':'没有已训练且兼容的压力模型。摄像头可用于检查面部输入，自动紧绷判断保持停用。');
  if(prediction?.reason==='learning_intervention_active'){hidePet();}
}
async function selectUser(id){
  generation++;stopInputs();hidePet();identity=users.find(u=>u.user.id===id)||null;session=null;event=null;config=null;
  $('feedback').hidden=true;for(const id of ['features','event','bank','config'])show(id,'暂无记录');
  refreshUsers();locks();if(!identity){render();return;}
  config=await api('/stress/status');show('config',config);
  const data=await api('/stress/bank');show('bank',data);
  session=data.sessions.filter(s=>s.phase==='active').at(-1)||null;
  if(session){
    replayTime=Math.max(0,session.last_t);captureOrigin=performance.now()-time();$('mode').value=session.mode;
    notice('已恢复这个用户的未结束会话。摄像头仍需手动启动。');
  }else notice('用户之间的记录独立。请选择输入方式并开始。');
  render();
}

async function present(next){
  event=next;show('event',event);$('feedback').hidden=true;
  if(!active())return;
  const markup=petMarkup(event.animation);if(!markup)throw Error('未知动画，已跳过显示。');
  const owner=identity.user.id,sid=session.id,eid=event.id,round=generation;
  const displayed=await api('/stress/events/'+eid+'/action',{kind:'shown',t_ms:time()});
  if(round!==generation||identity?.user.id!==owner||session?.id!==sid||!active())return;
  event=displayed;show('event',event);if(displayed.phase!=='shown')return;
  hidePet();$('pet').innerHTML=markup;$('relief').hidden=false;$('feedback').hidden=false;
  petTimer=setTimeout(()=>{if(round===generation&&event?.id===eid)void safe(dismiss)();},8000);
}
async function dismiss(){
  hidePet();if(event&&active()){
    event=await api('/stress/events/'+event.id+'/action',{kind:'dismiss',t_ms:time()});show('event',event);
  }
}
async function apply(result){
  session=result.session;render(result.prediction);
  if(result.window)show('features',{feature_schema:result.window.feature_schema,
    window_end_ms:result.window.window_end_ms,coverage:result.window.coverage,
    first_eight_means:result.window.vector?.slice(0,8)||null,
    baseline:session.baseline?{coverage:session.baseline.coverage,used_as_model_input:false}:'尚在采集或数据不足'});
  if(result.event)await present(result.event);
}
async function upload(){
  if(!active()||session.mode!=='live'||!config)return;
  const sid=session.id,round=generation;
  const sample=gaze.facialSample(config.feature_names);
  let captured=sample.valid?sample.capturedAt-captureOrigin:time();
  if(sample.valid&&captured<=lastCapture)return;
  captured=Math.max(0,captured);
  const data={t_ms:captured,valid:sample.valid,values:sample.values,feature_schema:config.feature_schema};
  try{
    const result=await api('/stress/sessions/'+sid+'/frames',data);
    if(round!==generation||session?.id!==sid||!active())return;
    lastCapture=captured;await apply(result);
  }catch(error){if(round===generation)notice(error.message,true);}
}
async function replay(state,seconds){
  if(!active()||session.mode!=='replay')throw Error('请先开始合成回放会话。');
  if(replaying)throw Error('上一段回放还在进行。');
  replaying=true;const round=generation,sid=session.id;
  try{
    let stamp=Math.max(0,session.last_t+1000);
    for(let i=0;i<=seconds;i++,stamp+=1000){
      if(round!==generation||!active()||session.id!==sid)return;
      replayTime=stamp;
      const result=await api('/stress/sessions/'+sid+'/replay',{t_ms:stamp,state});
      if(round!==generation)return;
      await apply(result);
    }
    notice('合成回放完成；事件与记忆均带回放标记，不代表模型准确率。');
  }finally{replaying=false;}
}

$('create').onclick=safe(async()=>{
  const name=$('name').value.trim();if(!name)throw Error('请输入用户名称。');
  const created=await api('/users',{name});users.push(created);
  localStorage.setItem('lockin-debug-users-v1',JSON.stringify(users));await selectUser(created.user.id);
});
$('users').onchange=safe(()=>selectUser($('users').value));
$('start').onclick=safe(async()=>{
  generation++;stopInputs();hidePet();event=null;$('feedback').hidden=true;show('event','暂无事件');show('features','等待新输入');
  session=await api('/stress/sessions',{mode:$('mode').value});replayTime=0;captureOrigin=performance.now()-time();lastCapture=-1;
  render();notice(session.mode==='live'?'会话已开始。点击启动摄像头后才会采集。':'合成会话已开始，可以检查触发、动画和记忆。');
});
$('end').onclick=safe(async()=>{
  generation++;stopInputs();hidePet();if(session)session=await api('/stress/sessions/'+session.id+'/end',{});
  $('feedback').hidden=true;render({state:'unknown',reason:'waiting_for_input'});await bank();notice('会话已结束，摄像头已停止。');
});
$('camera-start').onclick=safe(async()=>{
  if(!active()||session.mode!=='live')throw Error('请先开始摄像头会话。');
  const round=generation;await gaze.start();if(round!==generation||!active()){gaze.stop();return;}
  captureOrigin=performance.now()-time();lastCapture=-1;captures.start();
  notice('摄像头已启动。面部特征留在本机；没有可用压力模型时只检查输入。');
});
$('camera-stop').onclick=safe(async()=>{stopInputs();render({state:'unknown',reason:'insufficient_fresh_coverage'});if(active()&&session.mode==='live')await upload();notice('摄像头已停止，后续输入按无法判断处理。');});
$('replay-high').onclick=safe(()=>replay('possible_tension',12));
$('replay-low').onclick=safe(()=>replay('no_clear_tension',3));
$('replay-unknown').onclick=safe(()=>replay('unknown',1));
$('self-rating').oninput=()=>show('rating-value',$('self-rating').value);
$('label-window').onclick=safe(async()=>{
  if(!active()||session.mode!=='live')throw Error('请先开始摄像头会话。');
  const row=await api('/stress/sessions/'+session.id+'/labels',{rating:Number($('self-rating').value)});
  await bank();notice(row.label===null?'评分已保存为不明确，后续训练会排除这条标签。':'自评与对应的面部特征窗口已保存到你自己的记录。');
});
$('dismiss').onclick=safe(dismiss);
async function feedback(helpful){
  if(!event)throw Error('暂无动画事件。');
  event=await api('/stress/events/'+event.id+'/feedback',{helpful});show('event',event);await bank();
  notice('明确反馈已记录，动画偏好会保留来源和样本数。');
}
$('helpful').onclick=safe(()=>feedback(true));$('unhelpful').onclick=safe(()=>feedback(false));
$('exclude').onclick=safe(async()=>{
  if(!event)throw Error('暂无事件。');event=await api('/stress/events/'+event.id+'/correction',{excluded:true});
  hidePet();show('event',event);await bank();notice('已排除此事件，相关偏好已重算撤回。');
});
$('export').onclick=safe(async()=>{
  if(!identity)throw Error('请先选择用户。');const data=await api('/stress/bank');
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='lockin-relief-'+identity.user.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
window.addEventListener('beforeunload',()=>{generation++;stopInputs();hidePet();});
refreshUsers();locks();if(users.length)await safe(()=>selectUser(users[0].user.id))();else render();
