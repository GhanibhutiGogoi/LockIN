/** Source-timestamp off-screen rule, independent of UI and model inference. */
export class OffscreenMonitor {
  constructor(){this.events=[];this.count=0;this.transitions=[];this.maxAwayMs=0;this.loggedState=null;this.reset();}
  clear(){this.events=[];this.count=0;this.transitions=[];this.maxAwayMs=0;this.loggedState=null;this.reset();}
  reset(){this.lastAt=null;this.latched=false;this.invalidate();}
  invalidate(){this.previous=null;this.awayMs=0;this.returnMs=0;this.unknownSince=null;this.state='unknown';}
  observe({t,valid,calibrated,outside},now=t){
    if(!Number.isFinite(t)||!Number.isFinite(now)||t>now){this.invalidate();return this.snapshot(now);}
    if(this.lastAt!==null&&t<=this.lastAt)return this.snapshot(now);
    const gap=this.lastAt===null?0:t-this.lastAt;
    if(gap>=1200)this.invalidate();
    this.lastAt=t;
    if(now-t>=1200||!calibrated){this.invalidate();return this.snapshot(now);}
    if(!valid||typeof outside!=='boolean'){
      if(this.unknownSince===null)this.unknownSince=t;
      if(t-this.unknownSince>800)this.awayMs=0;
      this.previous=null;this.returnMs=0;this.state='unknown';return this.snapshot(now);
    }
    if(this.unknownSince!==null&&t-this.unknownSince>800)this.awayMs=0;
    this.unknownSince=null;
    const elapsed=this.previous===outside?gap:0;
    this.previous=outside;
    if(outside){
      this.awayMs+=elapsed;this.returnMs=0;
      if(this.awayMs>=30000&&!this.latched){
        this.latched=true;this.count++;
        this.events.push({id:this.count,reason:'continuous_offscreen_30s',duration_ms:this.awayMs,captured_at_ms:t});
        if(this.events.length>50)this.events.shift();
      }
      this.state=this.latched?'away':'candidate';
    }else{
      this.awayMs=0;this.returnMs+=elapsed;
      if(this.returnMs>=1000)this.latched=false;
      this.state=this.latched?'recovering':'screen';
    }
    return this.snapshot(now);
  }
  snapshot(now){
    if(this.lastAt!==null&&Number.isFinite(now)&&(now<this.lastAt||now-this.lastAt>=1200))this.invalidate();
    this.maxAwayMs=Math.max(this.maxAwayMs,this.awayMs);
    if(this.lastAt!==null&&this.loggedState!==this.state){
      this.transitions.push({state:this.state,captured_at_ms:this.lastAt,away_ms:this.awayMs});
      if(this.transitions.length>50)this.transitions.shift();
      this.loggedState=this.state;
    }
    return {state:this.state,away_ms:this.awayMs,max_away_ms:this.maxAwayMs,threshold_ms:30000,return_ms:this.returnMs,count:this.count,events:this.events.map(e=>({...e})),transitions:this.transitions.map(t=>({...t}))};
  }
}
