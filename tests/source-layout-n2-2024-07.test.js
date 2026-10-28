const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {listExams,readExam,readManifest}=require('../exam-store'),installed=listExams().some(e=>e.id==='n2-2024-07');
const clean=s=>s.replace(/<[^>]*>/g,'').replace(/\s/g,'').replace(/【(4[89]|5[01])】/g,'（$1）'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
test('N2 July 2024 source layouts preserve text, scoring, illustration and listening data',{skip:!installed},()=>{
 const e=readExam('n2-2024-07'),f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/visual/n2-2024-07.json'),'utf8'));
 for(const b of f.blocks){const a=e.sections[0].groups.find(g=>g.id===b.groupId).blocks[b.blockIndex];assert.deepEqual(a.questionIds,b.questionIds);assert.equal(hash(clean(a.html)),b.textSha256,b.groupId+'/'+b.blockIndex);}
 const qs=e.sections.flatMap(s=>s.groups.flatMap(g=>g.questions));assert.equal(qs.length,101);assert.equal(hash(JSON.stringify(qs.map(q=>({id:q.id,text:clean(q.text),options:q.options.map(clean),answer:q.answer,excluded:Boolean(q.excludeFromScoring)})))),f.questionContentSha256);assert.deepEqual(qs.filter(q=>q.excludeFromScoring).map(q=>q.id),['r-42','r-56']);
 assert.equal(hash(clean(qs.find(q=>q.id==='r-70').illustrationHtml)),f.illustrationSha256);
 const l=JSON.parse(fs.readFileSync(path.join(readManifest('n2-2024-07').folder,'exam.json'),'utf8')).sections[1];for(const g of l.groups)for(const q of g.questions)delete q.choiceColumns;assert.equal(hash(JSON.stringify(l)),f.listeningContentSha256);
});
test('N2 July 2024 keeps scanned paragraphs, notice frames and entrant table columns',{skip:!installed},()=>{
 const gs=readExam('n2-2024-07').sections[0].groups,pc=b=>Array.from(b.html.matchAll(/class="source-prose">([\s\S]*?)<\/div>/g),m=>(m[1].match(/<p>/g)||[]).length);
 assert.deepEqual(pc(gs[8].blocks[0]),[4]);assert.equal((gs[8].blocks[0].html.match(/exam-gap/g)||[]).length,4);assert.match(gs[8].blocks[0].html,/source-right/);
 assert.deepEqual(pc(gs[9].blocks[0]),[2]);assert.deepEqual(pc(gs[9].blocks[1]),[4]);assert.deepEqual(pc(gs[9].blocks[2]),[1]);assert.deepEqual(pc(gs[9].blocks[4]),[1]);assert.match(gs[9].blocks[3].html,/source-letter source-email/);assert.doesNotMatch(gs[9].blocks[3].html,/source-box/);
 assert.deepEqual(gs[10].blocks.map(pc),[[5],[3],[4],[6]]);assert.deepEqual(pc(gs[11].blocks[0]),[2,3]);assert.equal((gs[11].blocks[0].html.match(/class="source-box"/g)||[]).length,2);assert.deepEqual(pc(gs[12].blocks[0]),[3]);
 for(const g of gs.slice(8))for(const b of g.blocks){assert.doesNotMatch(b.html,/<p>\s*<(?:p|h[1-6]|table)/);assert.doesNotMatch(b.html,/<p><\/p>/);}
 const notice=gs[13].blocks[0].html;assert.match(notice,/source-box source-contest/);assert.equal((notice.match(/source-contest-section/g)||[]).length,5);assert.doesNotMatch(notice,/<table/);
 const t=gs[13].questions[0].illustrationHtml;assert.equal((t.match(/<tr>/g)||[]).length,5);assert.equal((t.match(/<th>/g)||[]).length,5);assert.match(t,/source-table-scroll/);assert.match(t,/3分45秒/);assert.match(t,/中学生/);
 assert.deepEqual(gs[7].questions.map(q=>q.text.match(/＿{2,}|★/g).indexOf('★')),[1,2,2,2,2]);assert.match(gs[4].questions[3].text,/<u>収納して<\/u>/);
});
