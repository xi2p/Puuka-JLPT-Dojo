// Generate the remote catalog from verified runtime files. Never include authoring sources.
const fs=require('node:fs/promises'),path=require('node:path');
const {buildCatalog}=require('./library-manager.js');
async function main(){const source=path.resolve(process.argv[2]||'exams'),output=path.resolve(process.argv[3]||'tmp/library-export/catalog.json');const catalog=await buildCatalog(source);await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(catalog,null,2)+'\n');console.log(`${catalog.exams.length} 套试卷目录已写入 ${output}`);}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
