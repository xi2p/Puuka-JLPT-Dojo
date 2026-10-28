const fs=require('node:fs/promises'),path=require('node:path'),{createReadStream}=require('node:fs'),{createHash}=require('node:crypto');
const {createStore,discover}=require('../exam-store.js');
const REPOSITORY='https://git.zju.edu.cn/3240104224/puuka-jlpt-dojo-lib';
const API='https://git.zju.edu.cn/api/v4/projects/3240104224%2Fpuuka-jlpt-dojo-lib/repository';
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/,SHA=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/;
const MAX_FILE=256*1024*1024,MAX_BANK=512*1024*1024;
const fileAllowed=p=>typeof p==='string'&&p.length<240&&p.split('/').every(x=>x&&!x.startsWith('.')&&!/[\\\x00-\x1f:<>"|?*]/.test(x)&&!/[. ]$/.test(x))&&(/^(manifest|exam|cues)\.json$/.test(p)||/^assets\/.+\.(mp3|png|jpg|jpeg|svg|webp)$/i.test(p));
const digest=value=>createHash('sha256').update(value).digest('hex');
const revision=files=>digest(JSON.stringify(files.map(f=>[f.path,f.size,f.sha256])));
async function sha256(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
async function safe(root,relative){
 const target=path.resolve(root,relative),rel=path.relative(root,target);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('题库路径超出目录');
 for(let p=root,parts=['',...rel.split(path.sep)];parts.length;){p=path.join(p,parts.shift());try{if((await fs.lstat(p)).isSymbolicLink())throw Error('题库路径包含链接');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return target;
}
function validateCatalog(input){
 if(input?.schemaVersion!==1||!Array.isArray(input.exams)||input.exams.length>1000)throw Error('远端题库目录格式无效');const ids=new Set();
 for(const e of input.exams){
  if(typeof e.id!=='string'||!ID.test(e.id)||ids.has(e.id)||!['N1','N2','N3','N4','N5'].includes(e.level)||!Number.isInteger(e.year)||e.year<1980||e.year>2200||![7,12].includes(e.month)||typeof e.title!=='string'||e.title.length>300||!Array.isArray(e.files)||e.files.length<2||e.files.length>100||!SHA.test(e.revision))throw Error('远端试卷目录无效');ids.add(e.id);
  for(const k of ['referenceMinutes','readingCount','listeningCount','questionCount','scoredCount','readingGroups','listeningGroups'])if(!Number.isInteger(e[k])||e[k]<0||e[k]>10000)throw Error('远端试卷题量无效');
  if(e.questionCount!==e.readingCount+e.listeningCount||e.scoredCount>e.questionCount||e.listeningOmitted!==(e.listeningCount===0))throw Error('远端试卷收录范围无效');
  const names=new Set();let bytes=0;
  for(const f of e.files){if(!fileAllowed(f.path)||names.has(f.path.toLowerCase())||!Number.isSafeInteger(f.size)||f.size<=0||f.size>MAX_FILE||!SHA.test(f.sha256))throw Error('远端题库文件无效');names.add(f.path.toLowerCase());bytes+=f.size;}
  if(bytes>MAX_BANK||!names.has('manifest.json')||!names.has('exam.json')||revision(e.files)!==e.revision)throw Error('远端题库文件清单不完整');
 }
 return input;
}
async function buildCatalog(examsRoot){
 const store=createStore(examsRoot),found=store.scan(true);if(found.issues.length)throw Error(found.issues[0].error);const exams=[];
 for(const summary of store.listExams()){
  const folder=found.papers.get(summary.id).folder,files=[];
  async function walk(dir,prefix=''){for(const item of await fs.readdir(dir,{withFileTypes:true})){if(item.isSymbolicLink())throw Error('题库不能包含链接');const relative=prefix+item.name;if(item.isDirectory())await walk(path.join(dir,item.name),relative+'/');else{if(!fileAllowed(relative))throw Error('题库包含制作文件：'+relative);const file=path.join(dir,item.name),stat=await fs.stat(file);files.push({path:relative,size:stat.size,sha256:await sha256(file)});}}}
  await walk(folder);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));exams.push({...summary,listeningOmitted:summary.listeningCount===0,files,revision:revision(files)});
 }
 return validateCatalog({schemaVersion:1,exams});
}
function createLibraryManager(root,examsRoot=path.join(root,'exams'),request=fetch){
 const store=createStore(examsRoot),hashes=new Map();let cached=null,busy=false,status={running:false,completed:[],error:null};
 const options=timeout=>({headers:{Accept:'application/json','User-Agent':'Puuka-JLPT-Dojo'},signal:AbortSignal.timeout(timeout||30000),redirect:'error'});
 async function remote(url,limit,timeout){const r=await request(url,options(timeout));if(!r.ok)throw Error(`题库仓库请求失败（${r.status}），请检查校园网络或仓库权限`);const chunks=[];let size=0;for await(const b of r.body){size+=b.length;if(size>limit)throw Error('题库响应超过大小限制');chunks.push(b);}return Buffer.concat(chunks);}
 const raw=(p,commit)=>`${API}/files/${encodeURIComponent(p)}/raw?ref=${commit}`;
 async function readCache(){if(cached)return cached;try{const file=await safe(root,'.runtime/library-catalog.json'),value=JSON.parse(await fs.readFile(file,'utf8'));if(!COMMIT.test(value.commit))throw Error();validateCatalog(value.catalog);cached=value;}catch{cached=null;}return cached;}
 async function writeCache(value){const file=await safe(root,'.runtime/library-catalog.json');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(value));await fs.rename(file+'.tmp',file);cached=value;}
 async function fileMatches(folder,f){try{const file=await safe(folder,f.path),stat=await fs.stat(file);if(!stat.isFile()||stat.size!==f.size)return false;const key=`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,old=hashes.get(file);let hash=old?.key===key?old.hash:await sha256(file);hashes.set(file,{key,hash});return hash===f.sha256;}catch{return false;}}
 async function catalog(){
  const cache=await readCache(),local=store.scan(true);const papers=new Map(store.listExams().map(e=>[e.id,{...e,listeningOmitted:e.listeningCount===0,installed:true,downloadable:false,updateAvailable:false}]));
  for(const e of cache?.catalog.exams||[]){const installed=local.papers.get(e.id),matches=installed?(await Promise.all(e.files.map(f=>fileMatches(installed.folder,f)))).every(Boolean):false;const {files,...summary}=e;papers.set(e.id,{...summary,bytes:files.reduce((s,f)=>s+f.size,0),installed:Boolean(installed),downloadable:true,updateAvailable:Boolean(installed)&&!matches});}
  return {repository:REPOSITORY,commit:cache?.commit||null,exams:[...papers.values()].sort((a,b)=>b.year-a.year||b.month-a.month||a.level.localeCompare(b.level)),issues:local.issues};
 }
 async function refresh(){
  if(busy)throw Error('题库操作正在进行');busy=true;try{const commit=JSON.parse((await remote(`${API}/commits/master`,1024*1024)).toString()).id;if(!COMMIT.test(commit))throw Error('题库版本无效');const old=await readCache();if(old?.commit!==commit){const data=JSON.parse((await remote(raw('catalog.json',commit),8*1024*1024)).toString());await writeCache({commit,catalog:validateCatalog(data)});}return await catalog();}finally{busy=false;}
 }
 async function installOne(e,commit){
  const local=store.scan(true);if(local.issues.some(x=>x.error.includes('重复')))throw Error('本机题库存在重复 ID，请先整理');
  await safe(root,'tmp/library-stage');const temp=path.join(root,'tmp');await fs.mkdir(temp,{recursive:true});const stage=await fs.mkdtemp(path.join(temp,'library-')),candidate=path.join(stage,e.id),backup=path.join(stage,'previous');
  const existing=local.papers.get(e.id),target=existing?.folder||await safe(examsRoot,e.id);const rel=path.relative(examsRoot,target);await safe(examsRoot,rel);
  let moved=false,installed=false,keepBackup=false;
  try{
   for(const f of e.files){status.file=f.path;status.fileBytes=0;status.fileTotal=f.size;const output=await safe(candidate,f.path);await fs.mkdir(path.dirname(output),{recursive:true});
    if(existing&&await fileMatches(existing.folder,f)){await fs.copyFile(await safe(existing.folder,f.path),output);status.downloadedBytes+=f.size;continue;}
    const response=await request(raw(`exams/${e.id}/${f.path}`,commit),options(300000));if(!response.ok)throw Error(`下载 ${e.id} 失败（${response.status}）`);const handle=await fs.open(output,'wx'),hash=createHash('sha256');let size=0;
    try{for await(const chunk of response.body){size+=chunk.length;if(size>f.size)throw Error('下载文件超过声明大小');hash.update(chunk);await handle.write(chunk);status.fileBytes=size;status.downloadedBytes+=chunk.length;}}finally{await handle.close();}
    if(size!==f.size||hash.digest('hex')!==f.sha256)throw Error('题库文件校验失败：'+f.path);
   }
   const verified=discover(stage);if(verified.issues.length||verified.papers.size!==1||!verified.papers.has(e.id))throw Error('下载试卷结构校验失败');
   const m=verified.papers.get(e.id).manifest;if(m.data!=='exam.json'||m.id!==e.id||m.level!==e.level||m.year!==e.year||m.month!==e.month)throw Error('试卷与目录不符');
   const summary=createStore(stage).listExams()[0];for(const k of ['readingCount','listeningCount','questionCount','scoredCount','readingGroups','listeningGroups'])if(summary[k]!==e[k])throw Error('试卷题量与目录不符');
   await fs.mkdir(path.dirname(target),{recursive:true});if(await fs.stat(target).then(()=>true,()=>false)){await fs.rename(target,backup);moved=true;}
   await fs.rename(candidate,target);installed=true;
  }catch(error){if(moved&&!installed){try{await fs.rename(backup,target);}catch(restoreError){keepBackup=true;throw Error(`恢复旧试卷失败，备份保留于 ${backup}：${restoreError.message}`);}}throw error;}finally{if(!keepBackup)await fs.rm(stage,{recursive:true,force:true});}
 }
 async function download(ids){
  if(busy)throw Error('题库操作正在进行');if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!ID.test(id))||new Set(ids).size!==ids.length)throw Error('请选择有效试卷');
  busy=true;try{
  const cache=await readCache();if(!cache)throw Error('请先刷新题库目录');const entries=ids.map(id=>cache.catalog.exams.find(e=>e.id===id));if(entries.some(x=>!x))throw Error('试卷不在远端目录中');
  status={running:true,completed:[],current:null,file:null,downloadedBytes:0,totalBytes:entries.reduce((s,e)=>s+e.files.reduce((n,f)=>n+f.size,0),0),error:null};
  for(const e of entries){status.current=e.id;await installOne(e,cache.commit);status.completed.push(e.id);}return {completed:[...status.completed]};}catch(e){status.error=e.message;throw e;}finally{status.running=false;busy=false;}
 }
 async function remove(id){if(busy)throw Error('题库操作正在进行');if(typeof id!=='string'||!ID.test(id))throw Error('试卷 ID 无效');busy=true;try{const local=store.scan(true);if(local.issues.some(x=>x.error.includes('重复')))throw Error('本机题库存在重复 ID');const paper=local.papers.get(id);if(!paper)throw Error('本机没有这套试卷');const relative=path.relative(examsRoot,paper.folder);await safe(examsRoot,relative);await fs.rm(paper.folder,{recursive:true});hashes.clear();return {removed:id};}finally{busy=false;}}
 return {catalog,refresh,download,remove,status:()=>({...status,completed:[...status.completed]}),isBusy:()=>busy};
}
module.exports={createLibraryManager,buildCatalog,validateCatalog,fileAllowed,sha256,revision,REPOSITORY};
