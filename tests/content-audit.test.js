const test=require('node:test'),assert=require('node:assert/strict');
const {auditContent}=require('../scripts/audit-content');
const sample=()=>({id:'sample',sections:[{id:'r',groups:[{id:'r1',title:'文法',instruction:'文に合うものを選びなさい。',questions:[{id:'r-1',label:'1',text:'今日は（　）。',options:['晴れ','雨','雪','曇り'],optionCount:4,answer:1}]}]}]});
test('content audit finds missing text, numbering, invalid answers and broken article markup',()=>{
 const exam=sample(),g=exam.sections[0].groups[0],q=g.questions[0];q.text='';q.label='2';q.answer=5;q.options[2]='';g.blocks=[{html:'<table><tr><td>料金</tr></table>',questionIds:['r-1']}];
 const reasons=auditContent(exam).errors.map(x=>x.reason);for(const reason of ['文字题题干为空','文字题题号不连续','答案编号越界','存在空选项','HTML 标签未配对'])assert.ok(reasons.includes(reason),reason);
});
test('source duplicate options are review warnings and never automatically rewritten',()=>{
 const exam=sample();exam.sections[0].groups[0].questions[0].options=['晴れ','雨','雨','曇り'];const before=structuredClone(exam),result=auditContent(exam);assert.equal(result.errors.length,0);assert.equal(result.warnings[0].reason,'存在重复选项');assert.deepEqual(exam,before);
});
test('listening subquestions may share an onset, but backwards onsets are reported',()=>{
 const exam={id:'sample',sections:[{id:'l',groups:[{id:'l5',title:'統合理解',instruction:'',questions:[1,2].map(n=>({id:'l-'+n,label:'2-'+n,text:'質問'+n,options:[],optionCount:4,answer:1,audioStart:100}))}]}]};assert.deepEqual(auditContent(exam),{errors:[],warnings:[]});exam.sections[0].groups[0].questions[1].audioStart=90;assert.equal(auditContent(exam).warnings[0].reason,'组内音频起点倒序');
});
test('all installed banks pass hard content checks; duplicate warnings have source notes',()=>{
 const {listExams,readExam}=require('../exam-store');for(const row of listExams()){const exam=readExam(row.id),result=auditContent(exam);assert.deepEqual(result.errors,[],exam.id);for(const issue of result.warnings.filter(x=>x.reason==='存在重复选项')){const q=exam.sections.flatMap(s=>s.groups.flatMap(g=>g.questions)).find(q=>q.id===issue.questionId);assert.ok(q.sourceNote,exam.id+' '+q.id+' must explain source duplication');}}
});
