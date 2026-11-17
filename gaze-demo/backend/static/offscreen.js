/** Source-timestamp off-screen rule, independent of UI and model inference. */
import {ATTENTION_TIMING} from './attention-policy.js';
export class OffscreenMonitor {
  constructor(){this.events=[];this.count=0;this.transitions=[];this.maxAwayMs=0;this.loggedState=null;this.lastReset=null;this.reset();}
  clear(){this.events=[];this.count=0;this.transitions=[];this.maxAwayMs=0;this.loggedState=null;this.reset();this.lastReset=null;}
  reset(){this.lastAt=null;this.latched=false;this.invalidate();}
  clearAway(reason,t=this.lastAt){if(this.awayMs>0)this.lastReset={reason,captured_at_ms:t,away_ms:this.awayMs};this.awayMs=0;}
  invalidate(reason='invalidated'){this.previous=null;this.clearAway(reason);this.returnMs=0;this.unknownSince=null;this.state='unknown';}
  observe({t,valid,calibrated,outside},now=t){
    if(!Number.isFinite(t)||!Number.isFinite(now)||t>now){this.invalidate('invalid_timestamp');return this.snapshot(now);}
    if(this.lastAt!==null&&t<=this.lastAt)return this.snapshot(now);
    const gap=this.lastAt===null?0:t-this.lastAt;
    if(gap>=ATTENTION_TIMING.staleFrameMs)this.invalidate('frame_gap');
    this.lastAt=t;
    if(now-t>=ATTENTION_TIMING.staleFrameMs||!calibrated){this.invalidate(!calibrated?'uncalibrated':'stale_frame');return this.snapshot(now);}
    if(!valid||typeof outside!=='boolean'){
      if(this.unknownSince===null)this.unknownSince=t;
      if(t-this.unknownSince>ATTENTION_TIMING.unknownGraceMs)this.clearAway('unknown_timeout',t);
      this.previous=null;this.returnMs=0;this.state='unknown';return this.snapshot(now);
    }
    if(this.unknownSince!==null&&t-this.unknownSince>ATTENTION_TIMING.unknownGraceMs)this.clearAway('unknown_timeout',t);
    this.unknownSince=null;
    const elapsed=this.previous===outside?gap:0;
    this.previous=outside;
    if(outside){
      this.awayMs+=elapsed;this.returnMs=0;
      if(this.awayMs>=ATTENTION_TIMING.lapseMs&&!this.latched){
        this.latched=true;this.count++;
        this.events.push({id:this.count,reason:'continuous_offscreen_30s',duration_ms:this.awayMs,captured_at_ms:t});
        if(this.events.length>50)this.events.shift();
      }
      this.state=this.latched?'away':'candidate';
    }else{
      this.returnMs+=elapsed;
      if(this.returnMs>=ATTENTION_TIMING.screenReturnMs){this.clearAway('stable_screen_return',t);this.latched=false;}
      this.state=this.latched||this.awayMs>0?'recovering':'screen';
    }
    return this.snapshot(now);
  }
  snapshot(now){
    if(this.lastAt!==null&&Number.isFinite(now)&&(now<this.lastAt||now-this.lastAt>=ATTENTION_TIMING.staleFrameMs))this.invalidate('stale_frame');
    this.maxAwayMs=Math.max(this.maxAwayMs,this.awayMs);
    if(this.lastAt!==null&&this.loggedState!==this.state){
      this.transitions.push({state:this.state,captured_at_ms:this.lastAt,away_ms:this.awayMs});
      if(this.transitions.length>50)this.transitions.shift();
      this.loggedState=this.state;
    }
    return {state:this.state,away_ms:this.awayMs,max_away_ms:this.maxAwayMs,threshold_ms:ATTENTION_TIMING.lapseMs,return_ms:this.returnMs,return_threshold_ms:ATTENTION_TIMING.screenReturnMs,last_reset:this.lastReset?{...this.lastReset}:null,count:this.count,events:this.events.map(e=>({...e})),transitions:this.transitions.map(t=>({...t}))};
  }
}
