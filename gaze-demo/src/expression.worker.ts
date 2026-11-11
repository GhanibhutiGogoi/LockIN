import {expressionProbabilities} from './core/expression-input';

// Dedicated classical worker; official UMD runtime and WASM are served locally.
let session:any=null;
let ort:any=null;
let busy=false;
const MODEL='ferplus-8-a2a2ba6a';
const HASH='a2a2ba6a335a3b29c21acb6272f962bd3d47f84952aaffa03b60986e04efa61c';
self.onmessage=async({data})=>{
  try{
    if(data.type==='init'){
      self.importScripts('/tracker/ort/ort.wasm.min.js');
      ort=(self as any).ort;
      ort.env.wasm.numThreads=1;
      ort.env.wasm.wasmPaths='/tracker/ort/';
      const response=await fetch('/tracker/models/emotion-ferplus-8.onnx');
      if(!response.ok)throw Error('找不到 FER+ 权重，请先运行模型下载脚本。');
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength!==35040571)throw Error('FER+ 权重大小不符。');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      if(hash!==HASH)throw Error('FER+ 权重校验失败。');
      session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm']});
      self.postMessage({type:'ready',model_id:MODEL});
    }else if(data.type==='infer'){
      if(!session||busy){self.postMessage({type:'unavailable',capturedAt:data.capturedAt});return;}
      busy=true;
      const values=new Float32Array(data.buffer);
      if(values.length!==4096||values.some(v=>!Number.isFinite(v)||v<0||v>255))throw Error('无效面部输入。');
      const started=performance.now();
      const outputs=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',values,[1,1,64,64])});
      const probabilities=expressionProbabilities(outputs[session.outputNames[0]].data);
      if(!probabilities)throw Error('FER+ 输出无效。');
      self.postMessage({type:'expression',capturedAt:data.capturedAt,model_id:MODEL,probabilities,ms:performance.now()-started});
      busy=false;
    }
  }catch(error){busy=false;self.postMessage({type:'error',message:error instanceof Error?error.message:String(error),capturedAt:data.capturedAt});}
};
