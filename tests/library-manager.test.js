const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createLibraryManager,buildCatalog,validateCatalog,revision,sha256}=require('../scripts/library-manager.js');
let work;const commit='c'.repeat(40),id='n1-2024-12',other='n2-2024-12';
async function write(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,value);}
async function paper(root,id,audio='test audio'){
 const manifest={schemaVersion:1,id,level:id.startsWith('n1')?'N1':'N2',year:2024,month:12,title:id,referenceMinutes:110,data:'exam.json',audio:'assets/listening.mp3'};
 const exam={id,sections:['r','l'].map(s=>({id:s,title:s,groups:[{id:s+'1',questions:[{id:s==='r'?'r-1':'l-1-1',label:'1',text:'test',options:['A','B','C','D'],optionCount:4,answer:1,...(s==='l'?{audioStart:1}:{})}]}]}))};
 for(const [p,v] of Object.entries({'manifest.json':JSON.stringify(manifest),'exam.json':JSON.stringify(exam),'assets/listening.mp3':audio}))await write(path.join(root,id,p),v);
}
async function remoteSet(name){const source=path.join(work,name,'source');await paper(source,id);await paper(source,other);const catalog=await buildCatalog(source),calls=[];const request=async url=>{calls.push(url);if(url.endsWith('/commits/master'))return Response.json({id:commit});const u=new URL(url);assert.equal(u.searchParams.get('ref'),commit);const file=decodeURIComponent(u.pathname.split('/files/')[1].split('/raw')[0]);if(file==='catalog.json')return Response.json(catalog);return new Response(await fs.readFile(path.join(source,file.replace(/^exams\//,''))));};return {source,catalog,request,calls};}
test.before(async()=>{await fs.mkdir(path.join(__dirname,'../tmp'),{recursive:true});work=await fs.mkdtemp(path.join(__dirname,'../tmp/library-test-'));});
test.after(async()=>{await fs.rm(work,{recursive:true,force:true});});
test('catalog contains complete sizes and hashes; rejects paths, collisions, metadata and inconsistent revisions',async()=>{
 const r=await remoteSet('validation');assert.equal(r.catalog.exams.length,2);assert.equal(r.catalog.exams[0].files.length,3);validateCatalog(r.catalog);
 for(const mutate of [c=>{c.exams[0].files[0].path='../data/progress.json';},c=>c.exams.push(c.exams[0]),c=>{c.exams[0].id=null;},c=>{c.exams[0].questionCount=99;},c=>{c.exams[0].files[0].sha256='a'.repeat(64);},c=>{c.exams[0].files[0].size=300*1024*1024;}]){const c=structuredClone(r.catalog);mutate(c);assert.throws(()=>validateCatalog(c));}
});
test('fresh installation downloads only selected bank, pins requests and retains progress; cache works offline',async()=>{
 const r=await remoteSet('select'),root=path.join(work,'select/install');await write(path.join(root,'data/progress.json'),'personal');const m=createLibraryManager(root,path.join(root,'exams'),r.request);
 assert.deepEqual((await m.catalog()).exams,[]);await m.refresh();assert.equal((await m.catalog()).exams.every(e=>!e.installed),true);
 await m.download([id]);assert.equal((await m.catalog()).exams.find(e=>e.id===id).updateAvailable,false);assert.equal((await m.catalog()).exams.find(e=>e.id===other).installed,false);assert.equal(r.calls.some(u=>u.includes(encodeURIComponent(other))),false);
 assert.equal(await fs.readFile(path.join(root,'data/progress.json'),'utf8'),'personal');const offline=createLibraryManager(root,path.join(root,'exams'),async()=>{throw Error('offline');});assert.equal((await offline.catalog()).exams.length,2);assert.equal((await offline.catalog()).exams.find(e=>e.id===id).installed,true);
 await assert.rejects(offline.refresh(),/offline/);assert.equal((await offline.catalog()).exams.length,2);
});
test('existing nested banks are adopted without downloading audio and untracked local banks remain',async()=>{
 const r=await remoteSet('adopt'),root=path.join(work,'adopt/install');await paper(path.join(root,'exams/wrapper'),id);await paper(path.join(root,'exams'),'n1-2023-12');const m=createLibraryManager(root,path.join(root,'exams'),r.request);await m.refresh();let c=await m.catalog();assert.equal(c.exams.find(e=>e.id===id).updateAvailable,false);assert.equal(c.exams.find(e=>e.id==='n1-2023-12').downloadable,false);
 r.calls.length=0;await m.download([id]);assert.equal(r.calls.length,0);assert.equal(await fs.stat(path.join(root,'exams/wrapper',id,'manifest.json')).then(()=>true),true);
});
test('corrupt audio never replaces an installed bank; changed audio is detected and a correct retry repairs it',async()=>{
 const r=await remoteSet('corrupt'),root=path.join(work,'corrupt/install');await paper(path.join(root,'exams'),id,'old audio!');const bad=createLibraryManager(root,path.join(root,'exams'),async url=>url.includes('listening.mp3')?new Response('bad audio!'):r.request(url));await bad.refresh();assert.equal((await bad.catalog()).exams.find(e=>e.id===id).updateAvailable,true);
 await assert.rejects(bad.download([id]),/校验失败/);assert.equal(await fs.readFile(path.join(root,'exams',id,'assets/listening.mp3'),'utf8'),'old audio!');assert.equal(bad.status().running,false);assert.match(bad.status().error,/校验/);
 const good=createLibraryManager(root,path.join(root,'exams'),r.request);await good.download([id]);assert.equal((await good.catalog()).exams.find(e=>e.id===id).updateAvailable,false);
});
test('interrupted batch retains completed banks and does not expose incomplete next bank',async()=>{
 const r=await remoteSet('batch'),root=path.join(work,'batch/install'),m=createLibraryManager(root,path.join(root,'exams'),async url=>{if(url.includes(encodeURIComponent('exams/'+other+'/')))throw Error('network lost');return r.request(url);});await m.refresh();await assert.rejects(m.download([id,other]),/network lost/);assert.deepEqual(m.status().completed,[id]);assert.equal((await m.catalog()).exams.find(e=>e.id===id).installed,true);assert.equal((await m.catalog()).exams.find(e=>e.id===other).installed,false);
});
test('invalid staged content with matching hashes is rejected before publishing',async()=>{
 const r=await remoteSet('structure');const e=r.catalog.exams.find(x=>x.id===id),file=path.join(r.source,id,'exam.json');await fs.writeFile(file,JSON.stringify({id,sections:[]}));const f=e.files.find(x=>x.path==='exam.json');f.size=(await fs.stat(file)).size;f.sha256=await sha256(file);e.revision=revision(e.files);
 const root=path.join(work,'structure/install'),m=createLibraryManager(root,path.join(root,'exams'),r.request);await m.refresh();await assert.rejects(m.download([id]),/结构/);assert.equal((await m.catalog()).exams.find(x=>x.id===id).installed,false);
});
test('removing a downloaded bank keeps progress and its remote entry for reinstall',async()=>{
 const r=await remoteSet('remove'),root=path.join(work,'remove/install'),m=createLibraryManager(root,path.join(root,'exams'),r.request);await write(path.join(root,'data/progress.json'),'notes and answers');await m.refresh();await m.download([id]);await m.remove(id);assert.equal(await fs.readFile(path.join(root,'data/progress.json'),'utf8'),'notes and answers');assert.equal((await m.catalog()).exams.find(e=>e.id===id).installed,false);await m.download([id]);assert.equal((await m.catalog()).exams.find(e=>e.id===id).installed,true);await assert.rejects(m.remove('../data'),/无效/);
});
test('concurrent library operations are rejected and failures clear the busy state',async()=>{
 const r=await remoteSet('busy'),root=path.join(work,'busy/install');let release;const gate=new Promise(resolve=>release=resolve);const m=createLibraryManager(root,path.join(root,'exams'),async u=>{if(u.includes('/commits/'))await gate;return r.request(u);});const refresh=m.refresh();assert.equal(m.isBusy(),true);await assert.rejects(m.download([id]),/正在进行/);release();await refresh;assert.equal(m.isBusy(),false);
});
test('library mutations reject missing or cross-origin request headers',async()=>{
 process.env.JLPT_STATE_FILE=path.join(work,'isolated-state.json');const {server}=require('../server');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const p of ['refresh','download','remove']){assert.equal((await fetch(base+'/api/library/'+p,{method:'POST'})).status,403);assert.equal((await fetch(base+'/api/library/'+p,{method:'POST',headers:{'X-Puuka-Request':'1',Origin:'https://external.example'}})).status,403);}assert.equal((await fetch(base+'/api/library/download-status')).status,200);assert.equal((await fetch(base+'/api/library/download',{method:'POST',headers:{'X-Puuka-Request':'1'},body:'{"ids":["../data"]}'})).status,400);}finally{await new Promise(r=>server.close(r));}
});
