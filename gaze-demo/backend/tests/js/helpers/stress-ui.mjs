import fs from 'node:fs';
import vm from 'node:vm';
import * as contract from '../../../static/stress-contract.js';

// Execute the production UI controller with deterministic browser/network boundaries.
// Only imports and automatic page boot are replaced; handlers/function bodies are real.
const source=fs.readFileSync(new URL('../../../static/stress.js',import.meta.url),'utf8');
if(!source.includes('const requestedUser='))throw Error('UI bootstrap boundary changed');
const controller=source.replace(/^import .*;\n/gm,'').split('const requestedUser=')[0]+`
 globalThis.testUI={upload,present,render,stopInputs,gaze,learningBus,
 initialize(s){identity={user:{id:'test-user'},token:'test-only'};session=s;
 config={feature_names:[],feature_schema:'test',expression_model:{assets_available:true}};
 captureOrigin=0;lastCapture=99950;lastValidAt=99950;},
 state(){return {session,event,lastCapture,lastValidAt};}};
`;
export const high=(t=100000)=>({valid:true,values:Array(52).fill(.2),expression:{model_id:'ferplus-8-a2a2ba6a',probabilities:[0,0,0,1,0,0,0,0]},capturedAt:t});
export const offer={id:'test-event',animation:'cat_yawn',phase:'offered'};
export const flush=()=>new Promise(r=>setImmediate(r));

export function uiHarness({mode='live'}={}){
  let now=100000;const wall=Date.now()-now,nodes=new Map(),requests=[];
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:true,value:'',textContent:'',innerHTML:'',classList:{toggle(){}},replaceChildren(){this.innerHTML='';}});
    return nodes.get(id);
  };
  class TestDate extends Date {static now(){return wall+now;}}
  class CameraBoundary {
    constructor(){this.live=true;this.queue=[];this.latest=high(99950);}
    cameraLive(){return this.live;}
    expressionSamples(){return this.queue.splice(0);}
    expressionSample(){return this.latest||{valid:false,values:null,expression:null,capturedAt:null};}
    facialSample(){return this.expressionSample();}
    async start(){this.live=true;}
    stop(){this.live=false;this.queue=[];this.latest=null;}
    invalidateExpression(){this.latest=null;this.queue.push({valid:false,values:null,expression:null,capturedAt:now});}
  }
  const s={id:'test-session',mode,inference:'expression_proxy',phase:'active',created_at:new Date(wall).toISOString(),
    last_t:99950,last_prediction:{state:'possible_tension',reason:'negative_expression_proxy'},baseline:{coverage:1}};
  const context={...contract,GazeCapture:CameraBoundary,CaptureLoop:class{start(){}stop(){}},
    petMarkup:()=>'<svg></svg>',document:{getElementById:node,querySelector:()=>node('link')},
    localStorage:{getItem:()=>null},performance:{now:()=>now},Date:TestDate,JSON,AbortController,
    Option:class{},BroadcastChannel:class{close(){}},window:{addEventListener(){}},
    setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
    fetch:async(path,options)=>{
      const data=options.body?JSON.parse(options.body):null;
      return await new Promise(resolve=>{
        const request={path,data,done:false,respond(body){this.done=true;resolve({ok:true,json:async()=>body});}};
        requests.push(request);
        if(path.endsWith('/frames')&&!data.valid)request.respond({accepted:true,session:{...s,last_t:data.t_ms,last_prediction:{state:'unknown',reason:'expression_input_missing'}},prediction:{state:'unknown',reason:'expression_input_missing'},event:null});
      });
    }};
  vm.createContext(context);vm.runInContext(controller,context);context.testUI.initialize(s);
  return {h:context.testUI,node,requests,s,setNow:t=>{now=t;},
    input(sample){context.testUI.gaze.latest=sample?.valid?sample:null;context.testUI.gaze.queue.push(sample);},
    replyFrame(request,sample,{event=null,state='possible_tension'}={}){
      const prediction={state,reason:state==='possible_tension'?'negative_expression_proxy':'no_negative_expression_cue'};
      request.respond({accepted:true,session:{...s,last_t:sample.capturedAt,last_prediction:prediction},prediction,event});
    },
    shown(){return requests.filter(r=>r.data?.kind==='shown');},
    resolveShown(){for(const r of requests.filter(r=>!r.done&&r.data?.kind==='shown'))r.respond({...offer,phase:'shown'});}
  };
}
