// Content audit only: never remove text automatically. Keep the full group instruction above the questions.
const {createStore}=require('../exam-store');
const normalize=text=>(text||'').normalize('NFKC').replace(/<[^>]*>|[\s\u200b-\u200d\ufeff＿_、・。，．,.「」()（）［］\[\]【】]/g,'');
function repeatedInstructions(exam){
 const issues=[];
 for(const section of exam.sections)for(const group of section.groups){
  const instruction=normalize(group.instruction);if(instruction.length<15)continue;
  for(const question of group.questions){
   const raw=question.text||'',plain=raw.replace(/<[^>]*>/g,'').normalize('NFKC').trim(),text=normalize(raw).replace(/^問題[0-9一二三四五六七八九十]+/,'');
   const header=plain.match(/^問\s*[題题]\s*([0-9]+|[一二三四五六七八九十]+)\s*/);
   const numberedHeader=header&&/最も|一つ|ひとつ/.test(plain.slice(header[0].length,200))&&/選びなさい|選んでください|えらびなさい/.test(plain.slice(header[0].length,200));
   if(text.startsWith(instruction)||numberedHeader)issues.push({examId:exam.id,groupId:group.id,questionId:question.id,reason:'小题混入了题组作答说明'});
  }
 }
 return issues;
}
if(require.main===module){const path=require('path'),store=createStore(path.resolve(process.argv[2]||process.env.JLPT_EXAMS_DIR||'exams')),scan=store.scan(true);let groups=0,questions=0,issues=[];for(const row of store.listExams()){const exam=store.readExam(row.id);groups+=exam.sections.reduce((n,s)=>n+s.groups.length,0);questions+=row.questionCount;issues.push(...repeatedInstructions(exam));}for(const issue of issues)console.error(`${issue.examId} ${issue.groupId} ${issue.questionId}：${issue.reason}`);for(const issue of scan.issues)console.error(issue.error);console.log(`已检查 ${scan.papers.size} 套、${groups} 个题组、${questions} 题；重复说明 ${issues.length} 处。`);if(issues.length||scan.issues.length)process.exitCode=1;}
module.exports={repeatedInstructions};
