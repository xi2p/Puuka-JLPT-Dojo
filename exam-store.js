const fs=require('node:fs');
const path=require('node:path');
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function inside(folder,relative){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||/^[a-z]:|\\|\0/i.test(relative))throw new Error('试卷文件路径无效');
  const file=path.resolve(folder,relative),rel=path.relative(folder,file);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error('试卷文件超出目录');
  if(fs.existsSync(file)){const real=path.relative(fs.realpathSync(folder),fs.realpathSync(file));if(real.startsWith('..')||path.isAbsolute(real))throw new Error('试卷文件超出目录');}
  return file;
}
function readJSON(file){if(fs.statSync(file).size>20*1024*1024)throw new Error('试卷文字文件过大');return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function loadFolder(folder){
  const manifest=readJSON(path.join(folder,'manifest.json')),id=manifest.id;
  if(manifest.schemaVersion!==1||!ID.test(id)||!['N1','N2','N3','N4','N5'].includes(manifest.level)||!Number.isInteger(manifest.year)||![7,12].includes(manifest.month)||typeof manifest.title!=='string')throw new Error('试卷清单无效');
  const readingOnly=manifest.listeningOmitted===true;
  const data=inside(folder,manifest.data),audio=readingOnly?null:inside(folder,manifest.audio);
  if(!readingOnly&&(!fs.statSync(audio).isFile()||fs.statSync(audio).size===0))throw new Error('缺少听力音频');
  const content=readJSON(data);
  if(content.id!==id||!Array.isArray(content.sections)||content.sections.length!==2||!['r','l'].every(s=>content.sections.some(x=>x.id===s)))throw new Error('试卷内容或编号无效');
  const cues=manifest.cues?readJSON(inside(folder,manifest.cues)):{};const seen=new Set();
  for(const section of content.sections){
    if(!Array.isArray(section.groups)||(!section.groups.length&&!(readingOnly&&section.id==='l')))throw new Error('缺少問題块');
    if(readingOnly&&section.id==='l'&&section.groups.length)throw new Error('仅文字阅读试卷不能包含听力题');
    for(const group of section.groups){
      if(!Array.isArray(group.questions)||!group.questions.length)throw new Error('缺少题目');
      for(const q of group.questions){
        if(!/^(r-\d{1,3}|l-\d{1,2}-[\d-]+)$/.test(q.id)||seen.has(q.id)||typeof q.text!=='string'||![3,4].includes(q.optionCount)||!Number.isInteger(q.answer)||q.answer<1||q.answer>q.optionCount||!Array.isArray(q.options)||(q.options.length!==0&&q.options.length!==q.optionCount)||!q.options.every(x=>typeof x==='string'))throw new Error(`题目或答案无效：${q.id}`);
        seen.add(q.id);if(Number.isFinite(cues[q.id]))q.audioStart=cues[q.id];
      }
      if(group.blocks&&!Array.isArray(group.blocks))throw new Error('阅读文章格式无效');
      for(const block of group.blocks||[])if(typeof block.html!=='string'||!Array.isArray(block.questionIds)||!block.questionIds.every(q=>group.questions.some(x=>x.id===q)))throw new Error('阅读文章关联无效');
      for(const q of group.questions)q.sharedAudio=Number.isFinite(q.audioStart)&&group.questions.some(other=>other!==q&&other.audioStart===q.audioStart);
    }
  }
  return {folder,manifest,exam:{...content,id,level:manifest.level,year:manifest.year,month:manifest.month,title:manifest.title,listeningOmitted:readingOnly,referenceMinutes:manifest.referenceMinutes||110,audioDataUrl:readingOnly?null:`/api/exams/${id}/audio-data`}};
}
function discover(root){
  const papers=new Map(),issues=[],duplicates=new Set(),stack=[root];let count=0;
  while(stack.length){
    const folder=stack.pop();if(!fs.existsSync(folder))continue;
    if(++count>20000){issues.push({folder:'.',error:'目录数量过多，剩余目录未扫描'});break;}
    if(fs.existsSync(path.join(folder,'manifest.json'))){
      try{const paper=loadFolder(folder),id=paper.manifest.id;if(papers.has(id)||duplicates.has(id)){papers.delete(id);duplicates.add(id);issues.push({folder:path.relative(root,folder),error:`试卷ID重复：${id}，请只保留一份`});}else papers.set(id,paper);}
      catch(e){issues.push({folder:path.relative(root,folder)||'.',error:e.message});}
      continue;
    }
    try{for(const item of fs.readdirSync(folder,{withFileTypes:true}))if(item.isDirectory()&&!item.isSymbolicLink()&&!['__MACOSX','.git'].includes(item.name))stack.push(path.join(folder,item.name));}catch{issues.push({folder:path.relative(root,folder)||'.',error:'无法读取目录'});}
  }
  return {papers,issues};
}
function createStore(root=path.join(__dirname,'exams')){
  let cached=null,at=0;
  const scan=(force=false)=>{if(force||!cached||Date.now()-at>1500){cached=discover(root);at=Date.now();}return cached;};
  function readManifest(id){if(!ID.test(id)||!scan().papers.has(id))throw Object.assign(new Error('试卷不存在'),{status:404});const {folder,manifest}=scan().papers.get(id);return {folder,manifest};}
  function readExam(id){return loadFolder(readManifest(id).folder).exam;}
  function listExams(){return [...scan().papers.values()].map(({exam})=>{const r=exam.sections.find(s=>s.id==='r'),l=exam.sections.find(s=>s.id==='l'),qs=s=>s.groups.flatMap(g=>g.questions);return {id:exam.id,title:exam.title,level:exam.level,year:exam.year,month:exam.month,referenceMinutes:exam.referenceMinutes,readingCount:qs(r).length,listeningCount:qs(l).length,questionCount:qs(r).length+qs(l).length,scoredCount:[...qs(r),...qs(l)].filter(q=>q.excludeFromScoring!==true).length,readingGroups:r.groups.length,listeningGroups:l.groups.length};}).sort((a,b)=>b.year-a.year||b.month-a.month||a.level.localeCompare(b.level));}
  function audioFile(id){const {folder,manifest}=readManifest(id);if(manifest.listeningOmitted===true)throw Object.assign(new Error('本卷未收录听力'),{status:404});return inside(folder,manifest.audio);}
  function publicExamFile(id,relative){const {folder}=readManifest(id);if(!relative.startsWith('assets/'))throw Object.assign(new Error('文件不存在'),{status:404});return inside(folder,relative);}
  return {readManifest,readExam,listExams,audioFile,publicExamFile,scan};
}
module.exports={...createStore(process.env.JLPT_EXAMS_DIR||path.join(__dirname,'exams')),createStore,discover,loadFolder,inside};
