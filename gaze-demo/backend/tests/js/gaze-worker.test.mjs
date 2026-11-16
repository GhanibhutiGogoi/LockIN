import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {fitEnvelope,outsideEvidence} from '../../../src/rules.ts';

// Run the actual worker protocol; only device/model inference is replaced here.
// Real pretrained inference is checked separately in the browser.
const source=(await readFile(new URL('../../../src/gaze.worker.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const {code}=await transform(source,{loader:'ts',format:'iife'});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function worker({fitError=false, model}={}){
  let time=0,release,block=false,feature=[0,0,0,0,0,0];const sent=[],calls=[];
  const result={facialLandmarks:[{}],headVector:[0,0],gazeState:'open',normPog:[.1,.2],eyePatch:{},faceOrigin3D:[0,0,0]};
  class Tracker {
    loaded=true;
    async initialize(){}
    resetCalibration(){calls.push('reset');}
    resetFilter(){calls.push('target');}
    async adapt(){calls.push('fit-start');if(fitError)throw Error('Matrix is rank deficient');if(block)await new Promise(r=>release=r);calls.push('fit-end');}
    async step(){calls.push('frame-start');if(block)await new Promise(r=>release=r);calls.push('frame-end');return result;}
  }
  class EyeTheiaTracker extends Tracker {
    async initialize(){calls.push('eyetheia-initialize');}
    async step(){return {...await super.step(),rawGaze:[.6,.7]};}
    fit(predictions,targets){calls.push(['eyetheia-fit',predictions.length,targets.length]);}
  }
  const self={postMessage:m=>sent.push(m)};
  vm.runInNewContext(code,{self,WebEyeTrack:Tracker,EyeTheiaTracker,tf:{setBackend:async()=>{},ready:async()=>{},getBackend:()=> 'cpu'},
    performance:{now:()=>time},ImageData:class {},Uint8ClampedArray,featuresFrom:()=>feature,fitEnvelope,outsideEvidence,quantile:xs=>xs[0],faceTensor:()=>null});
  const send=m=>self.onmessage({data:m});send({type:'init',baseUrl:'/tracker',model});await turn();
  return {sent,calls,send,features(f){feature=f;},block(){block=true;},release(){block=false;release();},time(t){time=t;}};
}
const target=(id=1)=>({type:'point',point:{index:0,x:.2,y:.3,validation:false,calibrationId:id,startedAt:1000}});
const frame=t=>({type:'frame',timestamp:t,width:1,height:1,buffer:new ArrayBuffer(4)});

test('a target transition waits for in-flight inference instead of resetting its filter mid-frame',async()=>{
  const w=await worker();w.block();w.send(frame(1000));await turn();
  w.send(target());await turn();
  assert.deepEqual(w.calls,['frame-start']);
  w.release();await turn();assert.deepEqual(w.calls,['frame-start','frame-end','target']);
});

test('slow inference cannot count a frame captured before the target settling interval',async()=>{
  const w=await worker();w.time(1000);w.send(target());await turn();
  w.time(2000);w.send(frame(1100));await turn();
  assert.equal(w.sent.filter(m=>m.type==='pointProgress').length,0);
  w.time(2200);w.send(frame(2100));await turn();
  const progress=w.sent.find(m=>m.type==='pointProgress');
  assert.equal(progress?.calibrationId,1);assert.equal(progress?.index,0);assert.equal(progress?.count,1);
});

test('reset cannot dispose support tensors during an asynchronous personal fit',async()=>{
  const w=await worker();
  for(let i=0;i<9;i++){
    w.time(i*3000);w.send({type:'point',point:{...target().point,index:i,startedAt:i*3000}});await turn();
    for(let j=0;j<7;j++){const t=i*3000+800+j*120;w.time(t);w.send(frame(t));await turn();}
  }
  assert.equal(w.sent.filter(m=>m.type==='pointDone').length,9);
  w.block();w.send({type:'fit',calibrationId:1});await turn();
  w.send({type:'reset',calibrationId:2});await turn();
  assert.equal(w.calls.at(-1),'fit-start');
  w.release();await turn();assert.deepEqual(w.calls.slice(-3),['fit-start','fit-end','reset']);
  assert.equal(w.sent.find(m=>m.type==='fitted')?.calibrationId,1);
});

test('fit exceptions identify the calibration operation so clients can retry without restarting inference',async()=>{
  const w=await worker({fitError:true});
  for(let i=0;i<9;i++){
    w.time(i*3000);w.send({type:'point',point:{...target().point,index:i,startedAt:i*3000}});await turn();
    for(let j=0;j<7;j++){const t=i*3000+800+j*120;w.time(t);w.send(frame(t));await turn();}
  }
  w.send({type:'fit',calibrationId:1});await turn();
  const error=w.sent.find(m=>m.type==='error');assert.equal(error?.operation,'fit');assert.equal(error?.calibrationId,1);
});

test('screen membership follows calibrated eye/head evidence even when gaze coordinates remain inside the screen',async()=>{
  const w=await worker();
  w.time(100);w.send(frame(100));await turn();assert.equal(w.sent.filter(m=>m.type==='result').at(-1).outside,null);
  w.send({type:'reset',calibrationId:9});await turn();
  for(let i=0;i<9;i++){
    w.time(i*3000);w.send({type:'point',point:{...target(9).point,index:i,startedAt:i*3000}});await turn();
    for(let j=0;j<7;j++){const t=i*3000+800+j*120;w.time(t);w.send(frame(t));await turn();}
  }
  w.send({type:'fit',calibrationId:9});await turn();
  w.time(30000);w.send(frame(30000));await turn();
  assert.equal(w.sent.filter(m=>m.type==='result').at(-1).outside,false);
  w.features([.6,0,0,0,0,0]);w.time(30200);w.send(frame(30200));await turn();
  const result=w.sent.filter(m=>m.type==='result').at(-1);
  assert.equal(result.outside,true);assert.equal(result.calibrationId,9);
  assert.deepEqual(Array.from(result.gaze),[.1,.2]);
  w.send({type:'reset',calibrationId:10});await turn();
  w.time(30400);w.send(frame(30400));await turn();assert.equal(w.sent.filter(m=>m.type==='result').at(-1).outside,null);
});


test('the worker replies with the source capture round on results and target progress',async()=>{
  const w=await worker();
  assert.equal(w.sent.find(m=>m.type==='ready')?.captureRounds,true);
  w.time(1000);
  w.send({type:'point',point:{...target().point,captureRound:8}});
  await turn();
  w.time(2000);
  w.send({...frame(2000),captureRound:7});
  await turn();
  assert.equal(w.sent.find(m=>m.type==='result')?.captureRound,7);
  assert.equal(w.sent.filter(m=>m.type==='pointProgress').length,0);
  w.time(2200);
  w.send({...frame(2200),captureRound:8});
  await turn();
  assert.equal(w.sent.find(m=>m.type==='pointProgress')?.captureRound,8);
});


test('EyeTheia selection fits screen coordinates from pretrained predictions with the shared worker protocol',async()=>{
  const w=await worker({model:'eyetheia'});
  assert.ok(w.calls.includes('eyetheia-initialize'));
  assert.equal(w.sent.find(m=>m.type==='ready')?.model,'eyetheia');
  w.send({type:'reset',calibrationId:11});await turn();
  for(let i=0;i<9;i++){
    w.time(i*3000);w.send({type:'point',point:{...target(11).point,index:i,startedAt:i*3000}});await turn();
    for(let j=0;j<7;j++){const t=i*3000+800+j*120;w.time(t);w.send(frame(t));await turn();}
  }
  w.send({type:'fit',calibrationId:11});await turn();
  assert.deepEqual(w.calls.at(-1),['eyetheia-fit',9,9]);
  assert.equal(w.sent.find(m=>m.type==='fitted')?.calibrationId,11);
  w.send({type:'resetFilter'});await turn();
  assert.equal(w.calls.at(-1),'target');
  assert.ok(w.sent.some(m=>m.type==='filterReset'));
});
