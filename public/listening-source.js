// One in-memory source per page. No browser media request or persistent audio cache.
function decodeAudio(base64) {
  if(typeof base64!=='string'||!base64.length||base64.length%4)throw new Error('音频数据不完整，请选择本机 MP3。');
  const padding=base64.endsWith('==')?2:base64.endsWith('=')?1:0;
  const bytes=new Uint8Array(base64.length/4*3-padding);
  let offset=0;
  // Decode aligned slices to avoid allocating another 40 MB binary string.
  for(let start=0;start<base64.length;start+=32768){
    const slice=atob(base64.slice(start,start+32768));
    for(let i=0;i<slice.length;i++)bytes[offset++]=slice.charCodeAt(i);
  }
  return new Blob([bytes],{type:'audio/mpeg'});
}
export class ListeningSource {
  constructor({endpoint='/api/listening-data',fetchBytes=(...args)=>globalThis.fetch(...args),createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}={}) {
    this.endpoint=endpoint;
    this.fetchBytes=fetchBytes;
    this.createURL=createURL;
    this.revokeURL=revokeURL;
    this.url=null;
    this.loading=null;
    this.generation=0;
  }
  load() {
    if(this.url) return Promise.resolve(this.url);
    if(this.loading) return this.loading;
    const generation=this.generation;
    this.loading=(async()=>{
      try {
        const response=await this.fetchBytes(this.endpoint,{cache:'no-store'});
        if(!response.ok) throw new Error('无法读取音频，请重启本地服务，或选择本机 MP3。');
        if(generation!==this.generation) return this.url;
        const data=await response.json();
        if(generation!==this.generation) return this.url;
        this.url=this.createURL(decodeAudio(data.base64));
        return this.url;
      } catch(error) {
        if(generation!==this.generation&&this.url) return this.url;
        throw error;
      } finally {
        if(generation===this.generation) this.loading=null;
      }
    })();
    return this.loading;
  }
  dispose(){this.generation++;this.loading=null;if(this.url)this.revokeURL(this.url);this.url=null;}
  useFile(file) {
    if(!file||!file.size||!(/\.mp3$/i.test(file.name||'')||file.type==='audio/mpeg')) throw new Error('请选择本套试卷对应的 MP3 文件。');
    const url=this.createURL(new Blob([file],{type:'audio/mpeg'}));
    this.generation++;
    this.loading=null;
    if(this.url) this.revokeURL(this.url);
    this.url=url;
    return url;
  }
}
