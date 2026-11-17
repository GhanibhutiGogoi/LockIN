/** FER+ Model Zoo contract: face crop, unscaled grayscale, NCHW 1x1x64x64. */
export function faceTensor(rgba:Uint8ClampedArray,width:number,height:number,landmarks:readonly {x:number;y:number}[]):Float32Array|null {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||rgba.length!==width*height*4||landmarks.length<2)return null;
  if(landmarks.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
  const xs=landmarks.map(p=>p.x*width),ys=landmarks.map(p=>p.y*height);
  const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  if(Math.min(right-left,bottom-top)<40)return null;
  const size=Math.max(right-left,bottom-top)*1.05,cx=(left+right)/2,cy=(top+bottom)/2;
  const x0=cx-size/2,y0=cy-size/2;
  // No padding/stretching for tiny or clipped faces; those frames are unknown.
  if(size<70||x0<0||y0<0||x0+size>width||y0+size>height)return null;
  const values=new Float32Array(4096);
  const gray=(x:number,y:number)=>{const k=(y*width+x)*4;return .299*rgba[k]+.587*rgba[k+1]+.114*rgba[k+2];};
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const sx=x0+(x+.5)*size/64-.5,sy=y0+(y+.5)*size/64-.5;
    const ax=Math.max(0,Math.floor(sx)),ay=Math.max(0,Math.floor(sy));
    const bx=Math.min(width-1,ax+1),by=Math.min(height-1,ay+1),dx=sx-ax,dy=sy-ay;
    values[y*64+x]=(1-dy)*((1-dx)*gray(ax,ay)+dx*gray(bx,ay))+dy*((1-dx)*gray(ax,by)+dx*gray(bx,by));
  }
  return values;
}

export function expressionProbabilities(logits:ArrayLike<number>):number[]|null {
  const a=Array.from(logits);if(a.length!==8||a.some(v=>!Number.isFinite(v)))return null;
  const peak=Math.max(...a),exp=a.map(v=>Math.exp(v-peak)),sum=exp.reduce((x,y)=>x+y,0);
  if(!Number.isFinite(sum)||sum<=0)return null;
  return exp.map(v=>v/sum);
}
