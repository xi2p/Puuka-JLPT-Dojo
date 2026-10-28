// Run with: node scripts/check-exams.js
const {listExams,readExam,audioFile}=require('../exam-store.js');
const fs=require('node:fs');
let failed=false;
for(const summary of listExams()){
  const exam=readExam(summary.id),questions=exam.sections.flatMap(s=>s.groups.flatMap(g=>g.questions));
  const errors=[];
  if(new Set(questions.map(q=>q.id)).size!==questions.length)errors.push('题号重复');
  for(const section of exam.sections)for(const group of section.groups){
    if(group.blocks&&JSON.stringify(group.blocks.flatMap(b=>b.questionIds))!==JSON.stringify(group.questions.map(q=>q.id)))errors.push(`文章关联不完整：${group.id}`);
    for(const q of group.questions){
      if(q.options.length&&q.options.length!==q.optionCount)errors.push(`选项数错误：${q.id}`);
      if(section.id==='l'&&!Number.isFinite(q.audioStart))errors.push(`缺少音频时间：${q.id}`);
    }
  }
  if(!exam.listeningOmitted&&!fs.existsSync(audioFile(exam.id)))errors.push('缺少音频文件');
  if(errors.length){failed=true;console.error(exam.id,errors.join('；'));}
  else console.log(`${exam.id}：${summary.readingCount} + ${summary.listeningCount} 题，${exam.listeningOmitted?'仅文字阅读，结构':'音频和结构'}检查通过`);
}
process.exitCode=failed?1:0;
