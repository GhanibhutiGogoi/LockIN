import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedScores,describePrediction} from '../../static/stress-contract.js';
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
