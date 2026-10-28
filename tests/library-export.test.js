const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {prepareLibrary}=require('../scripts/export-library');
const {createStore}=require('../exam-store');
let work;const id='n1-2024-12';
async function fixture(root,relative){const folder=path.join(root,relative);await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify({schemaVersion:1,id,level:'N1',year:2024,month:12,title:'test',referenceMinutes:110,data:'exam.json',listeningOmitted:true}));await fs.writeFile(path.join(folder,'exam.json'),JSON.stringify({id,sections:[{id:'r',title:'r',groups:[{id:'r1',questions:[{id:'r-1',label:'1',text:'test',options:['A','B','C','D'],optionCount:4,answer:1}]}]},{id:'l',title:'l',groups:[]}]}));return folder;}
test.before(async()=>{const temp=path.join(__dirname,'../tmp');await fs.mkdir(temp,{recursive:true});work=await fs.mkdtemp(path.join(temp,'library-export-test-'));});
test.after(async()=>{await fs.rm(work,{recursive:true,force:true});});
test('in-place preparation preserves canonical bank bytes and creates a deterministic catalog',async()=>{
 const root=path.join(work,'canonical');const folder=await fixture(root,'exams/'+id);await fs.mkdir(path.join(root,'.git'));await fs.writeFile(path.join(root,'README.md'),'library notes');const before=await fs.readFile(path.join(folder,'exam.json'));const result=await prepareLibrary(root,root);assert.equal(result.exams,1);assert.equal(result.inPlace,true);const first=await fs.readFile(path.join(root,'catalog.json'));await prepareLibrary(root,root);assert.deepEqual(await fs.readFile(path.join(root,'catalog.json')),first);assert.deepEqual(await fs.readFile(path.join(folder,'exam.json')),before);assert.equal(await fs.readFile(path.join(root,'README.md'),'utf8'),'library notes');
});
test('new flat bank is moved into the checkout layout without duplicate manifest IDs',async()=>{
 const root=path.join(work,'flat');await fixture(root,id);await fs.mkdir(path.join(root,'.git'));await prepareLibrary(root,root);assert.equal(await fs.stat(path.join(root,id)).then(()=>true,()=>false),false);assert.equal(createStore(root).listExams().length,1);assert.equal(createStore(root).scan(true).issues.length,0);assert.equal(await fs.stat(path.join(root,'exams',id,'manifest.json')).then(()=>true),true);
});
test('ordinary runtime folders cannot accidentally become an in-place publication directory',async()=>{
 const root=path.join(work,'runtime');await fixture(root,id);await assert.rejects(prepareLibrary(root,root),/独立题库仓库/);assert.equal(await fs.stat(path.join(root,id,'exam.json')).then(()=>true),true);
});
test('external export keeps source files and copies only bank runtime files',async()=>{
 const source=path.join(work,'source'),destination=path.join(work,'output');const folder=await fixture(source,id);await fs.writeFile(path.join(source,'README.md'),'not bank content');await prepareLibrary(destination,source);assert.deepEqual(await fs.readFile(path.join(destination,'exams',id,'exam.json')),await fs.readFile(path.join(folder,'exam.json')));assert.equal(await fs.stat(path.join(destination,'README.md')).then(()=>true,()=>false),false);assert.equal(createStore(destination).listExams().length,1);
});
test('overlapping external roots are rejected before writing',async()=>{
 const root=path.join(work,'overlap');await fixture(root,id);await assert.rejects(prepareLibrary(path.join(root,'out'),root),/不能包含/);assert.equal(await fs.stat(path.join(root,'out')).then(()=>true,()=>false),false);
});
