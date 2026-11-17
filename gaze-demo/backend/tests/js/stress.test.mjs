import test from 'node:test';
import assert from 'node:assert/strict';
import * as contract from '../../static/stress-contract.js';
const {orderedScores,describePrediction}=contract;
import {petMarkup} from '../../static/stress-pets.js';

test('face coefficients are ordered by the explicit model contract not returned array order',()=>{
  const names=Array.from({length:52},(_,i)=>'b'+i);
  const pairs=names.map((name,i)=>[name,i/100]).reverse();
  assert.deepEqual(orderedScores(pairs,names),Array.from({length:52},(_,i)=>i/100));
  assert.equal(orderedScores(pairs.slice(1),names),null);
  assert.equal(orderedScores([...pairs.slice(1),pairs[1]],names),null);
  const bad=pairs.map(([name,value])=>[name,value]);bad[0][1]=NaN;
  assert.equal(orderedScores(bad,names),null);
});

test('synthetic replay and missing model never masquerade as measured pressure',()=>{
  assert.match(describePrediction({state:'possible_tension',reason:'synthetic_debug_override'},'replay').explanation,/合成/);
  assert.match(describePrediction({state:'unknown',reason:'model_not_trained'},'live').explanation,/模型/);
  assert.match(describePrediction({state:'unknown',reason:'incompatible_model'},'live').explanation,/兼容/);
});

test('only bundled known pet markup is rendered, never arbitrary HTML from an event',()=>{
  assert.match(petMarkup('cat_yawn'),/<svg/);assert.match(petMarkup('dog_stretch'),/<svg/);
  assert.equal(petMarkup('<img src=x onerror=alert(1)>'),'');
});

test('restoring or losing camera input cannot display a historical high state',()=>{
  assert.equal(typeof contract.currentPrediction,'function');
  const high={state:'possible_tension',score:.9};
  assert.equal(contract.currentPrediction(high,{mode:'live',cameraLive:false,lastValidAt:1000,now:1100}).state,'unknown');
  assert.equal(contract.currentPrediction(high,{mode:'live',cameraLive:true,lastValidAt:1000,now:2300}).state,'unknown');
  assert.equal(contract.currentPrediction(high,{mode:'live',cameraLive:true,lastValidAt:1000,now:1100}).state,'possible_tension');
  assert.equal(contract.currentPrediction(high,{mode:'replay'}).state,'possible_tension');
});

test('animation feedback preserves optional paired retrospective ratings',()=>{
  assert.equal(typeof contract.feedbackBody,'function');
  assert.deepEqual(contract.feedbackBody(true,'',''),{helpful:true});
  assert.deepEqual(contract.feedbackBody(true,'7','3'),{helpful:true,before:7,after:3});
  assert.throws(()=>contract.feedbackBody(true,'7',''));
  assert.throws(()=>contract.feedbackBody(true,'12','3'));
});

test('competing intervention or lost status connection hides a visible animal',()=>{
  assert.equal(typeof contract.suppressRelief,'function');
  assert.equal(contract.suppressRelief({learning_intervention_active:true},true),true);
  assert.equal(contract.suppressRelief({learning_intervention_active:false},false),true);
  assert.equal(contract.suppressRelief({learning_intervention_active:false},true),false);
});

test('pretrained expression cues never claim measured pressure or psychological recovery',()=>{
  const high=describePrediction({state:'possible_tension',reason:'negative_expression_proxy'},'live');
  assert.equal(high.title,'观察到明显负面表情');
  assert.match(high.explanation,/不是压力/);
  const low=describePrediction({state:'no_clear_tension',reason:'no_negative_expression_cue'},'live');
  assert.equal(low.title,'未见明显负面表情');
  assert.match(low.explanation,/不能/);
});

test('model note distinguishes idle pretrained assets, replay and missing runtime',()=>{
  assert.equal(typeof contract.modelNote,'function');
  const config={expression_model:{assets_available:true},model:{available:false}};
  assert.match(contract.modelNote(config,null),/FER\+/);
  assert.match(contract.modelNote(config,{mode:'replay',inference:'expression_proxy'}),/合成/);
  assert.match(contract.modelNote({...config,expression_model:{assets_available:false}},null),/尚未安装/);
});
