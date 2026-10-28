const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {listExams,readExam}=require('../exam-store');
const installed=listExams().some(e=>e.id==='n1-2024-12');
const clean=s=>s.replace(/<[^>]*>/g,'').replace(/\s/g,'').replace(/[［【](4[1-4])[］】]/g,'$1');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
test('N1 December 2024 visual changes preserve questions, answers and source-reviewed passage text',{skip:!installed},()=>{
 const e=readExam('n1-2024-12'),f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/visual/n1-2024-12.json'),'utf8'));
 for(const b of f.blocks){const a=e.sections[0].groups.find(g=>g.id===b.groupId).blocks[b.blockIndex];assert.deepEqual(a.questionIds,b.questionIds);assert.equal(hash(clean(a.html)),b.textSha256,b.groupId+'/'+b.blockIndex);}
 const qs=e.sections.flatMap(s=>s.groups.flatMap(g=>g.questions));
 assert.equal(hash(JSON.stringify(qs.map(q=>({id:q.id,text:clean(q.text),options:q.options.map(clean),answer:q.answer,excluded:Boolean(q.excludeFromScoring)})))),f.questionContentSha256);
 assert.deepEqual(qs.filter(q=>q.excludeFromScoring).map(q=>q.id),['r-32','r-35','r-37']);
});
test('N1 December 2024 retains vertical prose, separate materials and the actual grant form',{skip:!installed},()=>{
 const gs=readExam('n1-2024-12').sections[0].groups,counts=g=>g.blocks.map(b=>(b.html.match(/<p>/g)||[]).length);
 assert.deepEqual(counts(gs[6]),[7]);assert.equal((gs[6].blocks[0].html.match(/exam-number-box/g)||[]).length,4);
 assert.deepEqual(counts(gs[7]),[4,1,1,3]);assert.match(gs[7].blocks[3].html,/source-vertical-scroll/);assert.match(gs[7].blocks[3].html,/source-vertical source-box/);
 assert.deepEqual(counts(gs[8]),[4,6,3,4]);assert.deepEqual(counts(gs[9]),[8]);assert.deepEqual(counts(gs[11]),[6]);
 assert.equal((gs[10].blocks[0].html.match(/class="source-box"/g)||[]).length,2);
 const grant=gs[12].blocks[0].html;assert.doesNotMatch(grant,/<table/);assert.equal((grant.match(/<h4>/g)||[]).length,7);assert.match(grant,/2泊分までを支給対象とします/);assert.match(grant,/<u>3月24日（厳守）<\/u>/);
 assert.match(gs[12].questions[0].illustrationHtml,/source-memo/);assert.doesNotMatch(gs[12].questions[0].illustrationHtml,/<table/);
 assert.equal(gs[5].questions.find(q=>q.id==='r-37').layout,undefined);
});
