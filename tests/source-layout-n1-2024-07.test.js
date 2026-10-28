const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {listExams,readExam,readManifest}=require('../exam-store'),installed=listExams().some(e=>e.id==='n1-2024-07');
const clean=s=>s.replace(/<[^>]*>/g,'').replace(/\s/g,'').replace(/［(4[1-4])］/g,'$1');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
test('N1 July 2024 source corrections retain questions, scoring and listening data',{skip:!installed},()=>{
 const e=readExam('n1-2024-07'),f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/visual/n1-2024-07.json'),'utf8'));
 for(const b of f.blocks){const a=e.sections[0].groups.find(g=>g.id===b.groupId).blocks[b.blockIndex];assert.deepEqual(a.questionIds,b.questionIds);assert.equal(hash(clean(a.html)),b.textSha256,b.groupId+'/'+b.blockIndex);}
 const qs=e.sections.flatMap(s=>s.groups.flatMap(g=>g.questions));assert.equal(qs.length,96);
 assert.equal(hash(JSON.stringify(qs.map(q=>({id:q.id,text:clean(q.text),options:q.options.map(clean),answer:q.answer,excluded:Boolean(q.excludeFromScoring)})))),f.questionContentSha256);
 assert.deepEqual(qs.filter(q=>q.excludeFromScoring).map(q=>q.id),['r-26','r-33','r-37','r-38']);
 const listening=JSON.parse(fs.readFileSync(path.join(readManifest('n1-2024-07').folder,'exam.json'),'utf8')).sections[1];for(const g of listening.groups)for(const q of g.questions)delete q.choiceColumns;assert.equal(hash(JSON.stringify(listening)),f.listeningContentSha256);
});
test('N1 July 2024 retains scanned paragraph boundaries, vertical text and library merged cells',{skip:!installed},()=>{
 const gs=readExam('n1-2024-07').sections[0].groups;
 const proseCount=b=>Array.from(b.html.matchAll(/class="source-prose">([\s\S]*?)<\/div>/g),m=>(m[1].match(/<p>/g)||[]).length);
 assert.deepEqual(proseCount(gs[6].blocks[0]),[6]);assert.equal((gs[6].blocks[0].html.match(/exam-gap/g)||[]).length,4);
 assert.deepEqual(gs[7].blocks.slice(0,3).map(proseCount),[[2],[1],[1]]);assert.match(gs[7].blocks[3].html,/source-vertical source-box/);
 assert.deepEqual(gs[8].blocks.map(proseCount),[[8],[5],[5],[4]]);assert.deepEqual(proseCount(gs[9].blocks[0]),[8]);assert.deepEqual(proseCount(gs[10].blocks[0]),[4,2]);assert.deepEqual(proseCount(gs[11].blocks[0]),[7]);
 assert.match(gs[8].blocks[2].html,/<u>「正しい怒り」の罠<\/u>/);
 for(const g of gs.slice(6))for(const b of g.blocks){assert.doesNotMatch(b.html,/<p>\s*<(?:p|h[1-6]|table)/);assert.doesNotMatch(b.html,/<p><\/p>/);}
 const h=gs[12].blocks[0].html;assert.match(h,/source-box source-library/);assert.equal((h.match(/rowspan="2"/g)||[]).length,2);assert.equal((h.match(/<tr>/g)||[]).length,5);assert.match(h,/<th aria-label="図書館"><\/th>/);assert.match(h,/9:00–22:00/);assert.match(h,/9:00–18:00/);
 const blanks=gs[5].questions.map(q=>q.text.match(/＿{2,}|★/g));assert.deepEqual(blanks.map(a=>a.indexOf('★')),[1,2,2,2,2]);assert.ok(gs[5].questions.every(q=>q.layout==='word-order'));
 assert.ok(gs[3].questions.every(q=>q.options.every(o=>o.includes('<u>'))));
});
