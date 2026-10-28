const fs=require('node:fs/promises'),{createReadStream}=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const REPOSITORY='https://git.zju.edu.cn/3240104224/puuka-jlpt-dojo';
const API='https://git.zju.edu.cn/api/v4/projects/3240104224%2Fpuuka-jlpt-dojo/repository';
const roots=new Set(['public','scripts','tests','docs']);
const files=new Set(['server.js','exam-store.js','updater.js','package.json','README.md','LICENSE','.gitignore','.gitattributes','启动网站.cmd','部署网站.cmd','更新网站.cmd']);
const retired=['exam-import.js','zip.js'];
function allowed(relative){
  if(typeof relative!=='string')return false;
  const parts=relative.split('/');
  if(parts.some(x=>!x||x==='.'||x==='..'||/[\\\x00-\x1f:<>"|?*]/.test(x)||/[. ]$/.test(x)))return false;
  if(files.has(relative))return true;
  if(parts.some(x=>x.startsWith('.'))||relative==='docs/batch-progress.json'||relative.startsWith('docs/imports/'))return false;
  return roots.has(parts[0]);
}
async function blobHash(file){const stat=await fs.stat(file);if(!stat.isFile())throw new Error('更新目标不是普通文件');const h=createHash('sha1').update(`blob ${stat.size}\0`);for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
async function currentVersion(root){
  try{return JSON.parse(await fs.readFile(path.join(root,'.runtime/version.json'),'utf8')).sha;}catch{}
  try{
    const args=['-c',`safe.directory=${root}`],opt={cwd:root,windowsHide:true,stdio:['ignore','pipe','ignore'],timeout:5000};
    const top=execFileSync('git',[...args,'rev-parse','--show-toplevel'],opt).toString().trim(),normalize=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
    if(normalize(top)!==normalize(root))return null;
    return execFileSync('git',[...args,'rev-parse','HEAD'],opt).toString().trim();
  }catch{return null;}
}
const options=(timeout=30000)=>({headers:{Accept:'application/json','User-Agent':'Puuka-JLPT-Dojo'},signal:AbortSignal.timeout(timeout),redirect:'error'});
const remoteError=status=>new Error(status===401||status===403?'GitLab访问受限，请检查校园网络或仓库权限':`GitLab请求失败（${status}），请检查校园网络后重试`);
async function checkUpdate(root,request=fetch){
  const r=await request(`${API}/commits/master`,options());if(!r.ok)throw remoteError(r.status);
  const remote=await r.json();if(!/^[a-f0-9]{40}$/.test(remote.id))throw new Error('GitLab版本信息无效');
  const current=await currentVersion(root);return {current,latest:remote.id,available:current!==remote.id,repository:REPOSITORY,message:remote.message?.split('\n')[0]||''};
}
async function safeTarget(root,relative){
  const target=path.resolve(root,relative),rel=path.relative(root,target);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error('更新路径超出项目目录');
  let parent=root;for(const part of relative.split('/')){parent=path.join(parent,part);try{if((await fs.lstat(parent)).isSymbolicLink())throw new Error('更新路径包含链接，请手动更新');}catch(e){if(e.code!=='ENOENT')throw e;}}
  return target;
}
async function applySource(source,root,sha,backup){
  if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('版本号无效');const queue=[];
  async function walk(folder,prefix=''){
    for(const item of await fs.readdir(folder,{withFileTypes:true})){
      const relative=prefix+item.name;if(item.isSymbolicLink())throw new Error('更新包不允许链接');
      if(item.isDirectory()){if(roots.has(relative)||prefix)await walk(path.join(folder,item.name),relative+'/');}
      else if(allowed(relative))queue.push({source:relative,target:relative});
    }
  }
  await walk(source);
  if(!['server.js','public/index.html','package.json'].every(x=>queue.some(q=>q.source===x)))throw new Error('更新包缺少程序文件');
  const pkg=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));if(pkg.name.toLowerCase()!=='puuka-jlpt-dojo')throw new Error('更新包不属于Puuka JLPT Dojo');
  const changed=[];let copied=0;await fs.mkdir(backup,{recursive:true});
  async function remember(relative){
    const target=await safeTarget(root,relative),saved=path.join(backup,relative);let existed=false;
    try{await fs.lstat(target);existed=true;await fs.mkdir(path.dirname(saved),{recursive:true});await fs.copyFile(target,saved);}catch(e){if(e.code!=='ENOENT')throw e;}
    changed.push({relative,existed});return target;
  }
  try{
    for(const q of queue){const input=path.join(source,q.source),target=await safeTarget(root,q.target);if(await blobHash(target).then(h=>blobHash(input).then(x=>h===x),()=>false))continue;await remember(q.target);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(input,target);copied++;}
    for(const relative of retired)if(await fs.lstat(path.join(root,relative)).then(()=>true,()=>false))await fs.rm(await remember(relative));
    const target=await remember('.runtime/version.json');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify({sha,updatedAt:new Date().toISOString()}));
    return {updated:true,sha,files:copied,restartRequired:true};
  }catch(e){for(const {relative,existed} of changed.reverse()){const target=path.join(root,relative);if(existed)await fs.copyFile(path.join(backup,relative),target);else await fs.rm(target,{force:true});}throw e;}
}
async function update(root,request=fetch){
  const info=await checkUpdate(root,request);if(!info.available)return {...info,updated:false};
  const temp=path.join(root,'tmp');await fs.mkdir(temp,{recursive:true});const stage=await fs.mkdtemp(path.join(temp,'update-')),source=path.join(stage,'source');let bytes=0;
  try{
    const entries=[];let page='1';
    while(page){
      const r=await request(`${API}/tree?ref=${info.latest}&recursive=true&per_page=100&page=${page}`,options());if(!r.ok)throw remoteError(r.status);
      const rows=await r.json();if(!Array.isArray(rows)||entries.length+rows.length>20000)throw new Error('GitLab文件目录无效或过大');entries.push(...rows);
      const next=r.headers.get('x-next-page')||'';if(next&&(!/^\d+$/.test(next)||Number(next)<=Number(page)||Number(next)>200))throw new Error('GitLab分页信息无效');page=next;
    }
    const seen=new Set();
    for(const entry of entries){
      if(entry.type!=='blob'||!allowed(entry.path))continue;
      if(!['100644','100755'].includes(entry.mode)||!/^[a-f0-9]{40}$/.test(entry.id)||seen.has(entry.path.toLowerCase()))throw new Error('远端文件编号、类型或路径无效');seen.add(entry.path.toLowerCase());
      const output=await safeTarget(source,entry.path),local=await safeTarget(root,entry.path);await fs.mkdir(path.dirname(output),{recursive:true});
      if(await blobHash(local).then(h=>h===entry.id,()=>false)){try{await fs.link(local,output);}catch{await fs.copyFile(local,output);}continue;}
      const r=await request(`${API}/blobs/${entry.id}/raw`,options(300000));if(!r.ok)throw remoteError(r.status);
      const h=await fs.open(output,'wx');let length=0;
      try{for await(const chunk of r.body){length+=chunk.length;bytes+=chunk.length;if(length>256*1024*1024||bytes>4*1024*1024*1024)throw new Error('更新下载超过大小限制');await h.write(chunk);}}finally{await h.close();}
      if(await blobHash(output)!==entry.id)throw new Error('更新文件校验失败，请重试');
    }
    return {...await applySource(source,root,info.latest,path.join(stage,'backup')),downloadedBytes:bytes};
  }finally{await fs.rm(stage,{recursive:true,force:true});}
}
if(require.main===module)update(__dirname).then(r=>console.log(r.updated?'程序更新完成。请重新运行启动网站.cmd。':'已经是最新版本。')).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={checkUpdate,update,applySource,allowed,blobHash,REPOSITORY};
