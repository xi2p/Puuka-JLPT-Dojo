// Prepare validated banks and catalog in the library checkout; never commit or push automatically.
const fs=require('node:fs/promises'),path=require('node:path');
const {buildCatalog}=require('./library-manager.js');
async function prepareLibrary(destination=path.resolve('exams'),source=path.resolve('exams')){
 destination=path.resolve(destination);source=path.resolve(source);const inPlace=source===destination;
 if(!inPlace&&(destination.startsWith(source+path.sep)||source.startsWith(destination+path.sep)))throw Error('导出目录不能包含本机题库或位于题库内');
 if(inPlace){try{await fs.lstat(path.join(destination,'.git'));}catch{throw Error('原地整理需要独立题库仓库；请先将 lib 仓库克隆到 exams，或指定其他导出目录');}}
 const catalog=await buildCatalog(source),{createStore}=require('../exam-store'),found=createStore(source).scan(true);
 const placements=catalog.exams.map(e=>({entry:e,folder:path.resolve(found.papers.get(e.id).folder),target:path.join(destination,'exams',e.id)}));
 if(inPlace){
  for(const {folder,target} of placements){if(folder===target)continue;if(!folder.startsWith(source+path.sep)||!target.startsWith(destination+path.sep)||target.startsWith(folder+path.sep))throw Error('试卷移动路径无效');try{await fs.lstat(target);throw Error('目标试卷目录已经存在：'+target);}catch(e){if(e.code!=='ENOENT')throw e;}}
 }
 for(const {entry,folder,target} of placements){
  if(inPlace){if(folder!==target){await fs.mkdir(path.dirname(target),{recursive:true});await fs.rename(folder,target);}continue;}
  for(const f of entry.files){const output=path.join(target,f.path);await fs.mkdir(path.dirname(output),{recursive:true});await fs.copyFile(path.join(folder,f.path),output+'.export-tmp');await fs.rename(output+'.export-tmp',output);}
 }
 await fs.mkdir(destination,{recursive:true});const output=path.join(destination,'catalog.json');await fs.writeFile(output+'.export-tmp',JSON.stringify(catalog,null,2)+'\n');await fs.rename(output+'.export-tmp',output);
 return {exams:catalog.exams.length,destination,inPlace};
}
if(require.main===module)prepareLibrary(process.argv[2]||'exams',process.argv[3]||'exams').then(r=>console.log(`${r.exams} 套试卷目录已更新。请在 ${r.destination} 核对并提交 exams/ 与 catalog.json。`)).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={prepareLibrary};
