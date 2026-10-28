const test=require('node:test'),assert=require('node:assert/strict');let questionFlags,validProgress;
test.before(async()=>{({questionFlags}=await import('../public/question-flags.js'));({validProgress}=await import('../public/exam-library.js'));});
const paper={sections:[{id:'r',groups:[{id:'r1',questions:[{id:'r-1',optionCount:4},{id:'r-2',optionCount:4}]},{id:'r2',questions:[{id:'r-3',optionCount:4}]}]},{id:'l',groups:[{id:'l1',questions:[{id:'l-1-1',optionCount:4},{id:'l-1-2',optionCount:3}]}]}]};
test('legacy group markers expand to the corresponding individual questions only',()=>{
 assert.deepEqual(questionFlags(['r1'],paper),['r-1','r-2']);assert.deepEqual(questionFlags(['l1'],paper),['l-1-1','l-1-2']);
});
test('mixed old and new flags are deduplicated and migration is idempotent',()=>{
 const flags=['r1','r-2','r-3'],once=questionFlags(flags,paper);assert.deepEqual(once,['r-1','r-2','r-3']);assert.deepEqual(questionFlags(once,paper),once);assert.deepEqual(flags,['r1','r-2','r-3']);
});
test('removed banks retain legacy markers until their content is available again',()=>{
 assert.deepEqual(questionFlags(['r1','l-1-1'],null),['r1','l-1-1']);assert.deepEqual(questionFlags(['r1','l-1-1'],paper),['r-1','r-2','l-1-1']);
});
test('client validation accepts individual and legacy flags but rejects unrelated IDs',()=>{
 const state={version:1,activeId:'sample',attempts:[{id:'sample',examId:'n2-2017-07',status:'active',answers:{},notes:{},flags:['r-1','l-1-2'],elapsed:{r:0,l:0},position:{section:'r',group:0},audioTime:0,audioRate:1,startedAt:'2026-10-28T00:00:00Z'}]},library={cache:new Map([['n2-2017-07',paper]])};assert.equal(validProgress(state,library),true);state.attempts[0].flags=['r1'];assert.equal(validProgress(state,library),true);state.attempts[0].flags=['r-999'];assert.equal(validProgress(state,library),false);
});
test('server accepts question-level markers for installed exams without breaking old backups',()=>{
 const {listExams,readExam}=require('../exam-store'),{validState}=require('../server');const summary=listExams()[0];if(!summary)return;const paper=readExam(summary.id),g=paper.sections[0].groups[0];const state={version:1,activeId:'sample',attempts:[{id:'sample',examId:summary.id,status:'active',answers:{},notes:{},flags:[g.questions[0].id],elapsed:{r:0,l:0},position:{section:'r',group:0},audioTime:0,audioRate:1,startedAt:'2026-10-28T00:00:00Z'}]};assert.equal(validState(state),true);state.attempts[0].flags=[g.id];assert.equal(validState(state),true);state.attempts[0].flags=['r-999'];assert.equal(validState(state),false);
});
