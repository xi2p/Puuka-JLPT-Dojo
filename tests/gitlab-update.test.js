const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {applySource,checkUpdate,update,allowed}=require('../updater.js');
const {createStore}=require('../exam-store.js');
let work;const sha='a'.repeat(40);
const hash=v=>createHash('sha1').update(`blob ${Buffer.byteLength(v)}\0`).update(v).digest('hex');
const program={'server.js':'new server','public/index.html':'new html','package.json':'{"name":"puuka-jlpt-dojo"}'};
function exam(id='n2-2020-07',audio='new audio'){
 const e={id,sections:['r','l'].map(s=>({id:s,title:s,groups:[{id:s+'1',questions:[{id:s==='r'?'r-1':'l-1-1',text:'test',options:['A','B','C','D'],optionCount:4,answer:1}]}]}))};
 return {'manifest.json':JSON.stringify({schemaVersion:1,id,level:'N2',year:2020,month:7,title:'test',data:'exam.json',audio:'assets/listening.mp3'}),'exam.json':JSON.stringify(e),'assets/listening.mp3':audio};
}
async function write(root,entries){for(const [name,v] of Object.entries(entries)){const p=path.join(root,name);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,v);}}
const prefixed=(prefix,e)=>Object.fromEntries(Object.entries(e).map(([k,v])=>[prefix+'/'+k,v]));
test.before(async()=>{const root=path.join(__dirname,'../tmp');await fs.mkdir(root,{recursive:true});work=await fs.mkdtemp(path.join(root,'gitlab-test-'));});
test.after(async()=>{await fs.rm(work,{recursive:true,force:true});});
test('GitLab commit endpoint and response format replace GitHub',async()=>{
 const root=path.join(work,'version');await write(root,{'.runtime/version.json':JSON.stringify({sha})});
 const r=await checkUpdate(root,async url=>{assert.match(url,/git\.zju\.edu\.cn\/api\/v4\/projects\/3240104224%2Fpuuka-jlpt-dojo\/repository\/commits\/master$/);return Response.json({id:sha,message:'sync exams\nmore'});});
 assert.equal(r.available,false);assert.equal(r.message,'sync exams');assert.match(r.repository,/git.zju.edu.cn/);
 await assert.rejects(checkUpdate(root,async()=>Response.json({sha})),/无效/);
 await assert.rejects(checkUpdate(root,async()=>new Response('',{status:403})),/权限/);
});
test('program update ignores all remote exams and preserves local banks and personal files',async()=>{
 const root=path.join(work,'installed'),source=path.join(work,'source');
 await write(root,{'data/progress.json':'personal','.runtime/node-path.txt':'D:/node.exe','tmp/checkpoint':'pending','docs/batch-progress.json':'checkpoint','exam-import.js':'old importer',...prefixed('exams/wrapper/old',exam()),...prefixed('exams/custom',exam('n2-2020-12'))});
 await write(source,{...program,...prefixed('exams/n2-2020-07',exam('n2-2020-07','updated audio')),...prefixed('exams/new',exam('n2-2021-07')),'data/progress.json':'bad','docs/batch-progress.json':'bad','.git/config':'bad'});
 const r=await applySource(source,root,sha,path.join(work,'backup'));assert.equal(r.exams,undefined);assert.equal(r.restartRequired,true);
 assert.equal(await fs.readFile(path.join(root,'exams/wrapper/old/assets/listening.mp3'),'utf8'),'new audio');assert.equal(createStore(path.join(root,'exams')).listExams().length,2);
 for(const [p,v] of Object.entries({'data/progress.json':'personal','.runtime/node-path.txt':'D:/node.exe','tmp/checkpoint':'pending','docs/batch-progress.json':'checkpoint'}))assert.equal(await fs.readFile(path.join(root,p),'utf8'),v);
 assert.equal(await fs.stat(path.join(root,'exam-import.js')).then(()=>true,()=>false),false);assert.equal(await fs.stat(path.join(root,'.git')).then(()=>true,()=>false),false);
});
test('failed update restores program, bank and installed version after a late write failure',async()=>{
 const root=path.join(work,'rollback'),source=path.join(work,'rollback-source');
 await write(root,{'server.js':'old','public':'block directory creation','.runtime/version.json':'old version',...prefixed('exams/n2-2020-07',exam('n2-2020-07','old audio'))});
 await write(source,{...program,...prefixed('exams/n2-2020-07',exam())});
 await assert.rejects(applySource(source,root,sha,path.join(work,'rollback-backup')));
 assert.equal(await fs.readFile(path.join(root,'server.js'),'utf8'),'old');assert.equal(await fs.readFile(path.join(root,'exams/n2-2020-07/assets/listening.mp3'),'utf8'),'old audio');assert.equal(await fs.readFile(path.join(root,'.runtime/version.json'),'utf8'),'old version');
});
test('program update never inspects or installs remote bank files',async()=>{
 const root=path.join(work,'invalid'),source=path.join(work,'invalid-source');await write(root,{'server.js':'old'});await write(source,{...program,'exams/broken/manifest.json':'{}'});
 await applySource(source,root,sha,path.join(work,'invalid-backup'));assert.equal(await fs.readFile(path.join(root,'server.js'),'utf8'),'new server');assert.equal(await fs.stat(path.join(root,'exams')).then(()=>true,()=>false),false);
 for(const p of ['data/progress.json','tmp/checkpoint','.git/config','exams/../data/progress.json','exams/source.pdf','exams/n1-2024-12/exam.json','exams/n1-2024-12/assets/listening.mp3','docs/imports/private.md','public/../../secret'])assert.equal(allowed(p),false,p);
});
test('incremental download follows pagination, skips identical blobs and verifies changed bytes',async()=>{
 const root=path.join(work,'incremental');await write(root,{'server.js':'old','public/index.html':program['public/index.html']});
 const remote={...program,...prefixed('exams/n2-2020-07',exam())},entries=Object.entries(remote).map(([p,v])=>({path:p,type:'blob',mode:'100644',id:hash(v)})),downloads=[];
 const request=async url=>{
  if(url.includes('/commits/'))return Response.json({id:sha,message:'test'});
  if(url.includes('/tree?')){const page=new URL(url).searchParams.get('page');return Response.json(page==='1'?entries.slice(0,2):entries.slice(2),{headers:{'x-next-page':page==='1'?'2':''}});}
  const id=url.split('/').at(-2);downloads.push(id);const value=Object.values(remote).find(v=>hash(v)===id);assert.ok(value);return new Response(value);
 };
 const r=await update(root,request);assert.equal(r.updated,true);assert.equal(downloads.includes(hash(program['public/index.html'])),false);assert.equal(createStore(path.join(root,'exams')).listExams().length,0);assert.equal(await fs.readFile(path.join(root,'server.js'),'utf8'),'new server');
 const bad=path.join(work,'bad-download');await fs.mkdir(bad);await assert.rejects(update(bad,async url=>url.includes('/commits/')?Response.json({id:sha}):url.includes('/tree?')?Response.json(entries):new Response('corrupt')),/校验失败/);assert.equal(await fs.stat(path.join(bad,'server.js')).then(()=>true,()=>false),false);
});
test('removed exam upload endpoint cannot install a ZIP; update still rejects cross-origin requests',async()=>{
 process.env.JLPT_STATE_FILE=path.join(work,'http-state.json');const {server}=require('../server.js');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{assert.equal((await fetch(base+'/api/exams/import',{method:'POST',body:'zip'})).status,405);assert.equal((await fetch(base+'/api/update/apply',{method:'POST'})).status,403);assert.equal((await fetch(base+'/api/update/check',{method:'POST',headers:{'X-Puuka-Request':'1',Origin:'https://external.example'}})).status,403);}finally{await new Promise(r=>server.close(r));}
});
