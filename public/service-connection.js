// Probe the local service, independently of internet access and remote repository requests.
export class ServiceConnection {
  constructor({request=(...args)=>fetch(...args),onChange=()=>{},intervalMs=3000,timeoutMs=2000,activityGapMs=1000,now=Date.now,isVisible=()=>true}={}){
    Object.assign(this,{request,onChange,intervalMs,timeoutMs,activityGapMs,now,isVisible});
    this.connected=null;this.pending=null;this.controller=null;this.timer=null;this.lastAttempt=-Infinity;this.epoch=0;this.stopped=false;
  }
  start(){
    if(this.timer!==null)return;
    this.stopped=false;this.check(true);
    this.timer=setInterval(()=>{if(this.isVisible())this.check(true);},this.intervalMs);
  }
  stop(){
    this.stopped=true;this.epoch++;clearInterval(this.timer);this.timer=null;this.controller?.abort();this.controller=null;this.pending=null;
  }
  check(force=false){
    if(this.stopped)return Promise.resolve(this.connected);
    if(this.pending)return this.pending;
    if(!force&&this.now()-this.lastAttempt<this.activityGapMs)return Promise.resolve(this.connected);
    this.lastAttempt=this.now();const epoch=this.epoch,controller=new AbortController();this.controller=controller;
    let timeout,operation;
    const probe=Promise.resolve().then(async()=>{
      const response=await this.request('/api/health',{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('Local service unavailable');
      const body=await response.json();if(body.app!=='puuka-jlpt-dojo')throw new Error('Unexpected local service');
      return true;
    });
    const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('Local service timed out'));},this.timeoutMs);});
    operation=(async()=>{
      let connected;try{await Promise.race([probe,deadline]);connected=true;}catch{connected=false;}
      finally{clearTimeout(timeout);if(this.pending===operation)this.pending=null;if(this.controller===controller)this.controller=null;}
      if(this.stopped||this.epoch!==epoch)return this.connected;
      if(this.connected!==connected){const previous=this.connected;this.connected=connected;this.onChange(connected,previous);}
      return connected;
    })();
    this.pending=operation;return operation;
  }
}
