function waitForMetadata(audio,signal) {
  if(audio.readyState>=1)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);audio.removeEventListener('loadedmetadata',loaded);audio.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);};
    const loaded=()=>{cleanup();resolve();};
    const failed=()=>{cleanup();reject(new Error('音频未能就绪，请选择本机 MP3 后重试。'));};
    const aborted=()=>{cleanup();reject(new DOMException('已取消定位','AbortError'));};
    const timer=setTimeout(failed,15000);
    audio.addEventListener('loadedmetadata',loaded,{once:true});
    audio.addEventListener('error',failed,{once:true});
    signal.addEventListener('abort',aborted,{once:true});
    if(signal.aborted)aborted();
  });
}

export function audioTimestamp(seconds) {
  const whole=Math.floor(seconds);
  return `${String(Math.floor(whole/60)).padStart(2,'0')}:${String(whole%60).padStart(2,'0')}`;
}

// A navigation or a newer click must cancel an older, still-loading jump.
export class QuestionAudioPlayer {
  constructor(audio,loadAudio){this.audio=audio;this.loadAudio=loadAudio;this.version=0;this.request=null;}
  cancel(){this.version++;this.request?.abort();this.request=null;}
  async play(start){
    if(!Number.isFinite(start)||start<0)throw new Error('本题的音频时间无效。');
    this.cancel();
    const version=this.version;
    this.request=new AbortController();
    const signal=this.request.signal;
    this.audio.pause();
    try{
      const ready=await this.loadAudio();
      if(signal.aborted||version!==this.version)return false;
      if(!ready)throw new Error('请先载入音频，或点击“选择本机音频”。');
      await waitForMetadata(this.audio,signal);
      if(signal.aborted||version!==this.version)return false;
      this.audio.currentTime=Math.min(start,Number.isFinite(this.audio.duration)?this.audio.duration:start);
      await this.audio.play();
      return true;
    }catch(error){if(error.name==='AbortError')return false;throw error;}
  }
}
