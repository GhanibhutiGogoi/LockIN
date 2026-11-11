import test from 'node:test';
import assert from 'node:assert/strict';
import * as input from './expression-input.ts';

test('FER+ receives unscaled 64x64 grayscale pixels, not 0..1 RGB or background',()=>{
  const width=200,height=200,pixels=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<pixels.length;i+=4){pixels[i]=100;pixels[i+1]=50;pixels[i+2]=0;pixels[i+3]=255;}
  const landmarks=[{x:.25,y:.25},{x:.75,y:.75}];
  const result=input.faceTensor(pixels,width,height,landmarks);
  assert.equal(result?.length,4096);
  assert.ok(Math.abs(result![0]-59.25)<.001);
  assert.equal(input.faceTensor(pixels,width,height,[{x:NaN,y:0}]),null);
  assert.equal(input.faceTensor(pixels,width,height,[{x:.49,y:.49},{x:.51,y:.51}]),null);
  assert.equal(input.faceTensor(pixels,width,height,[{x:-.2,y:.25},{x:.3,y:.75}]),null);
});

test('FER+ logits use stable eight-class softmax in the published order',()=>{
  const p=input.expressionProbabilities([1000,999,998,997,996,995,994,993]);
  assert.equal(p?.length,8);assert.ok(Math.abs(p!.reduce((a,b)=>a+b,0)-1)<1e-6);
  assert.ok(p![0]>p![1]);assert.equal(input.expressionProbabilities([NaN,...Array(7).fill(0)]),null);
  assert.equal(input.expressionProbabilities([1]),null);
});

test('a collapsed minor axis is not a usable facial crop',()=>{
  const pixels=new Uint8ClampedArray(200*200*4);
  assert.equal(input.faceTensor(pixels,200,200,[{x:.499,y:.25},{x:.501,y:.75}]),null);
});
