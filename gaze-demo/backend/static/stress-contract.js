/** Canonical naming avoids accidental OpenFace/MediaPipe feature substitution. */
export function orderedScores(pairs,names){
  if(!Array.isArray(names)||names.length!==52||new Set(names).size!==52||!Array.isArray(pairs)||pairs.length!==52)return null;
  const values=new Map();
  for(const pair of pairs){
    if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||values.has(pair[0])||!Number.isFinite(pair[1])||pair[1]<0||pair[1]>1)return null;
    values.set(pair[0],pair[1]);
  }
  return names.every(name=>values.has(name))?names.map(name=>values.get(name)):null;
}

export function describePrediction(prediction,mode){
  const state=prediction?.state||'unknown',reason=prediction?.reason;
  if(mode!=='replay'&&reason==='negative_expression_proxy')return {title:'观察到明显负面表情',explanation:'FER+ 识别到较明显的负面表情；持续出现时可尝试放松动画。这是表情提示，不是压力测量。'};
  if(mode!=='replay'&&reason==='no_negative_expression_cue')return {title:'未见明显负面表情',explanation:'目前以自然或愉快表情为主；这不能说明没有压力，也不能证明已经放松。'};
  const title={possible_tension:'可能有些紧绷',no_clear_tension:'未见明显紧绷信号',unknown:'暂时无法判断'}[state]||'暂时无法判断';
  if(mode==='replay')return {title,explanation:'这是预设状态的合成回放，没有使用压力模型，也不代表真人状态。'};
  const reasons={expression_input_missing:'表情模型尚未就绪、没有清晰人脸或输入已过期，自动提示暂停。',ambiguous_expression:'预训练模型对表情的判断不明确，继续观察。',baseline_pending:'正在收集约 30 秒自然表情基线。',insufficient_fresh_coverage:'面部数据不足或已中断，等待连续的新画面。',
    model_not_trained:'尚无已训练且兼容的压力模型；当前只能检查面部特征。',model_missing_or_invalid:'尚无可用压力模型；当前只能检查面部特征。',
    incompatible_model:'模型与特征不兼容或尚未通过验证，自动提示已停用。',learning_intervention_active:'学习视频或答题正在进行，放松提示已暂停。',
    ambiguous_score:'模型输出不明确，继续观察。',experimental_classifier:'实验模型的行为估计，需要和你的感受对照。',waiting_for_input:'等待摄像头输入。',camera_not_started:'摄像头尚未启动，历史判断不会当作当前状态。',camera_input_expired:'没有新鲜的摄像头输入，历史判断已失效。',upload_failed:'无法取得本机后端的最新判断，已暂停显示旧状态。'};
  return {title,explanation:reasons[reason]||'这是实验性的紧绷估计，不是压力诊断。'};
}

export function currentPrediction(prediction,{mode,cameraLive=false,lastValidAt=-Infinity,now=performance.now()}){
  if(mode==='live'&&(!cameraLive||!Number.isFinite(lastValidAt)||now-lastValidAt>=1200||now<lastValidAt))return {state:'unknown',score:null,reason:cameraLive?'camera_input_expired':'camera_not_started'};
  return prediction;
}

export function suppressRelief(status,networkOk){return !networkOk||status?.learning_intervention_active===true;}

export function feedbackBody(helpful,before,after){
  if(before.trim()===''&&after.trim()==='')return {helpful};
  const a=Number(before),b=Number(after);
  if(before.trim()===''||after.trim()===''||!Number.isInteger(a)||!Number.isInteger(b)||a<0||a>10||b<0||b>10)throw Error('请同时填写 0–10 的前后评分，或将两项都留空。');
  return {helpful,before:a,after:b};
}


export function modelNote(config,session){
  if(session?.mode==='replay')return '合成回放没有运行表情或压力模型，只用于检查动画与记忆流程。';
  if(!config)return '正在读取预训练模型资源状态。';
  if(!session||session.inference==='expression_proxy')return config.expression_model?.assets_available?
    'FER+ 预训练资源已安装，启动摄像头后在浏览器本机运行。表情不等于压力。':
    '表情模型资源尚未安装，自动提示暂停。请先运行模型下载脚本并构建。';
  return config.model?.available?'已加载实验压力模型；尚未在本项目用户上验证。':'没有已训练且兼容的压力模型，压力分类保持停用。新会话可使用预训练表情提示。';
}
