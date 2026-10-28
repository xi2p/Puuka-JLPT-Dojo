const test=require('node:test');
const assert=require('node:assert/strict');
const {readExam,listExams}=require('../exam-store.js');
const {validState}=require('../server.js');
const attempt=(id,examId)=>({id,examId,status:'active',answers:{'r-1':1},notes:{r1:'note'},flags:['r1'],elapsed:{r:20,l:3},position:{section:'r',group:0},audioTime:130,audioRate:1.25,startedAt:'2026-10-24T00:00:00.000Z'});
let ExamLibrary,validProgress,library;
test.before(async()=>{
  ({ExamLibrary,validProgress}=await import('../public/exam-library.js'));
  library=new ExamLibrary(async url=>Response.json(url==='/api/exams'?listExams():readExam(url.split('/').at(-1))));await library.refresh();
});
test('old version 1 progress stays valid without changing exam/question IDs',async()=>{
  const state={version:1,activeId:'old-attempt',attempts:[attempt('old-attempt','n2-2016-12')]};await library.preloadProgress(state);
  assert.ok(validProgress(state,library));assert.ok(validState(state));assert.equal(state.attempts[0].examId,'n2-2016-12');assert.equal(state.attempts[0].audioTime,130);
});
test('different exams retain separate answer keys, records and audio endpoints',{skip:!['n2-2010-07','n2-2010-12'].every(id=>listExams().some(e=>e.id===id))},async()=>{
  const [july,december]=await Promise.all([library.get('n2-2010-07'),library.get('n2-2010-12')]);
  assert.equal(july.sections[0].groups[0].questions[0].answer,3);assert.equal(december.sections[0].groups[0].questions[0].answer,1);assert.notEqual(july.audioDataUrl,december.audioDataUrl);
  const state={version:1,activeId:'july',attempts:[attempt('july',july.id),attempt('december',december.id)]};state.attempts[0].answers['r-1']=3;state.attempts[1].audioTime=400;
  assert.ok(validProgress(state,library));assert.ok(validState(state));assert.equal(state.attempts[1].answers['r-1'],1);assert.equal(state.attempts[0].audioTime,130);
});
test('known exam imports reject invalid questions, positions and audio progress',{skip:!listExams().some(e=>e.id==='n2-2010-07')},()=>{
  const state={version:1,activeId:'test',attempts:[attempt('test','n2-2010-07')]};
  state.attempts[0].answers['r-999']=1;assert.equal(validProgress(state,library),false);assert.equal(validState(state),false);
  delete state.attempts[0].answers['r-999'];state.attempts[0].position.group=999;assert.equal(validProgress(state,library),false);assert.equal(validState(state),false);
  state.attempts[0].position.group=0;state.attempts[0].audioTime=-1;assert.equal(validProgress(state,library),false);assert.equal(validState(state),false);
  state.attempts[0].audioTime=0;state.attempts[0].flags=['l999'];assert.equal(validProgress(state,library),false);assert.equal(validState(state),false);
});
test('records for a temporarily removed exam remain available for later restoration',()=>{
  const state={version:1,activeId:null,attempts:[attempt('missing','n2-2009-12')]};assert.ok(validProgress(state,library));assert.ok(validState(state));
});
test('an incomplete source question remains available for listening but never changes the score',{skip:!listExams().some(e=>e.id==='n2-2011-12')},async()=>{
  const {scoreAnswers}=await import('../public/exam-library.js');
  const questions=readExam('n2-2011-12').sections.flatMap(s=>s.groups.flatMap(g=>g.questions));
  const a={answers:{'r-1':4,'l-1-2':3}};
  assert.deepEqual(scoreAnswers(a,questions),{total:105,correct:1,answered:1});
  a.answers['l-1-2']=1;assert.deepEqual(scoreAnswers(a,questions),{total:105,correct:1,answered:1});
  assert.equal(questions.filter(q=>q.excludeFromScoring).length,1);
});

test('remote directory metadata cannot load an undownloaded exam or invalidate its retained record',async()=>{
 const {ExamLibrary,validProgress}=await import('../public/exam-library.js');const remote=new ExamLibrary(async url=>{assert.equal(url,'/api/library/catalog');return Response.json({exams:[{id:'n1-2024-12',installed:false}]});});await remote.refreshRemote();
 const state={version:1,activeId:'retained',attempts:[attempt('retained','n1-2024-12')]};await remote.preloadProgress(state);assert.ok(validProgress(state,remote));await assert.rejects(remote.get('n1-2024-12'),/暂不可用/);assert.equal(remote.cache.size,0);
});
