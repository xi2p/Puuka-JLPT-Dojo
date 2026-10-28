// Read-only checks for installed runtime banks. Warnings require source review.
const {listExams,readExam}=require('../exam-store');
const {repeatedInstructions}=require('./audit-instructions');
const plain=value=>String(value??'').replace(/<[^>]*>/g,'').normalize('NFKC').trim();
function auditContent(exam){
 const errors=repeatedInstructions(exam),warnings=[];
 const add=(target,group,question,reason,detail)=>target.push({examId:exam.id,groupId:group.id,questionId:question?.id,reason,detail});
 const seen=new Map();
 for(const section of exam.sections){
  let previousLabel=0;
  for(const group of section.groups){
   for(const block of group.blocks||[])if(!plain(block.html))add(errors,group,null,'阅读材料为空',block.questionIds);
   let previousStart=-1;
   for(const question of group.questions){
    const options=question.options.map(plain);
    if(section.id==='r'){
     if(!plain(question.text))add(errors,group,question,'文字题题干为空');
     if(Number(question.label)!==previousLabel+1)add(errors,group,question,'文字题题号不连续',{previousLabel,label:question.label});
     previousLabel=Number(question.label);
     if(options.length!==4)add(errors,group,question,'文字题不是四个选项',options.length);
     if(/漢字の読み|漢字の表記|言い換え|類義/.test(group.title)&&!/<u>|<span|［|【|「/.test(question.text))add(warnings,group,question,'目标词可能缺少强调',question.text);
     const key=JSON.stringify([plain(question.text),options]);
     if(seen.has(key))add(warnings,group,question,'题干和全部选项与另一题相同',seen.get(key));
     seen.set(key,question.id);
    }
    if(options.some(option=>!option))add(errors,group,question,'存在空选项');
    if(new Set(options).size!==options.length)add(warnings,group,question,'存在重复选项',options);
    if(!Number.isInteger(question.answer)||question.answer<1||question.answer>question.optionCount)add(errors,group,question,'答案编号越界',question.answer);
    if(section.id==='l'){
     if(!Number.isFinite(question.audioStart)||question.audioStart<0)add(errors,group,question,'音频起点无效',question.audioStart);
     if(question.audioStart<previousStart)add(warnings,group,question,'组内音频起点倒序',question.audioStart);
     previousStart=question.audioStart;
    }
   }
   function inspect(value,field){
    if(typeof value==='string'){
     if(/�|TODO|FIXME|\[object Object\]|&lt;\/?(?:p|u|table)/.test(value))add(warnings,group,null,'疑似乱码或制作残留',field);
     for(const tag of ['u','b','strong','table','tr','td','th']){
      const open=(value.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>','g'))||[]).length;
      const close=(value.match(new RegExp('</'+tag+'>','g'))||[]).length;
      if(open!==close)add(errors,group,null,'HTML 标签未配对',field+': '+tag);
     }
    }else if(value&&typeof value==='object')for(const [key,item]of Object.entries(value))inspect(item,field+'.'+key);
   }
   inspect(group,group.id);
  }
 }
 return {errors,warnings};
}
if(require.main===module){
 const totals={exams:0,groups:0,questions:0,errors:[],warnings:[]};
 for(const row of listExams()){
  const exam=readExam(row.id),result=auditContent(exam);totals.exams++;totals.questions+=row.questionCount;
  totals.groups+=exam.sections.reduce((sum,section)=>sum+section.groups.length,0);
  totals.errors.push(...result.errors);totals.warnings.push(...result.warnings);
 }
 console.log(JSON.stringify(totals,null,2));if(totals.errors.length)process.exitCode=1;
}
module.exports={auditContent};
