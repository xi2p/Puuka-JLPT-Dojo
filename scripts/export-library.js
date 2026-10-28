// Export validated banks into the separate library checkout; no Git operations are performed.
const fs=require('node:fs/promises'),path=require('node:path');
const {buildCatalog}=require('./library-manager.js');
async function main(){
 if(!process.argv[2])throw Error('用法：node scripts/export-library.js <题库仓库目录> [本机exams目录]');
 const source=path.resolve(process.argv[3]||'exams'),destination=path.resolve(process.argv[2]);
 if(destination===source||destination.startsWith(source+path.sep)||source.startsWith(destination+path.sep))throw Error('导出目录不能包含本机题库或位于题库内');
 const catalog=await buildCatalog(source),{createStore}=require('../exam-store'),store=createStore(source),found=store.scan(true);
 for(const e of catalog.exams){const folder=found.papers.get(e.id).folder;for(const f of e.files){const output=path.join(destination,'exams',e.id,f.path);await fs.mkdir(path.dirname(output),{recursive:true});await fs.copyFile(path.join(folder,f.path),output+'.export-tmp');await fs.rename(output+'.export-tmp',output);}}
 await fs.mkdir(destination,{recursive:true});await fs.writeFile(path.join(destination,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
 console.log(`${catalog.exams.length} 套试卷已导出。请在题库仓库核对并提交 exams/ 与 catalog.json。`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
