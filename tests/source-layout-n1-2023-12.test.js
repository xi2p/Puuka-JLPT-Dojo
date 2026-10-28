const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {listExams,readExam}=require('../exam-store'),installed=listExams().some(e=>e.id==='n1-2023-12');
const clean=s=>s.replace(/<sup class="source-note-ref">[\s\S]*?<\/sup>/g,'').replace(/<[^>]*>/g,'').replace(/\s/g,'').replace(/［(4[1-4])］/g,'$1'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
test('N1 December 2023 preserves source text, independent answers and reading-only scope',{skip:!installed},()=>{
 const e=readExam('n1-2023-12'),f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/visual/n1-2023-12.json'),'utf8'));
 for(const b of f.blocks){const a=e.sections[0].groups.find(g=>g.id===b.groupId).blocks[b.blockIndex];assert.deepEqual(a.questionIds,b.questionIds);assert.equal(hash(clean(a.html)),b.textSha256,b.groupId+'/'+b.blockIndex);}
 const qs=e.sections.flatMap(s=>s.groups.flatMap(g=>g.questions));assert.equal(qs.length,66);assert.equal(hash(JSON.stringify(qs.map(q=>({id:q.id,text:clean(q.text),options:q.options.map(clean),answer:q.answer,excluded:Boolean(q.excludeFromScoring)})))),f.questionContentSha256);assert.deepEqual(qs.filter(q=>q.excludeFromScoring).map(q=>q.id),['r-35','r-59','r-60']);assert.equal(e.listeningOmitted,true);assert.deepEqual(e.sections[1].groups,[]);
});
test('N1 December 2023 retains scanned paragraphs, footnote references and buyback table relationships',{skip:!installed},()=>{
 const gs=readExam('n1-2023-12').sections[0].groups,pc=b=>Array.from(b.html.matchAll(/class="source-prose">([\s\S]*?)<\/div>/g),m=>(m[1].match(/<p>/g)||[]).length);
 assert.deepEqual(pc(gs[6].blocks[0]),[4]);assert.equal((gs[6].blocks[0].html.match(/exam-number-box/g)||[]).length,4);assert.match(gs[7].blocks[1].html,/source-mail-meta/);assert.match(gs[7].blocks[3].html,/source-vertical source-box source-prose/);assert.deepEqual(pc(gs[7].blocks[2]),[3]);
 assert.deepEqual(gs[8].blocks.map(pc),[[8],[8],[6],[4]]);assert.deepEqual(pc(gs[9].blocks[0]),[5]);assert.deepEqual(pc(gs[10].blocks[0]),[4,2]);assert.deepEqual(pc(gs[11].blocks[0]),[6]);
 for(const g of gs.slice(6))for(const b of g.blocks)assert.doesNotMatch(b.html,/<p>\s*<(?:p|h[1-6]|table)/);
 const h=gs[12].blocks[0].html;assert.equal((h.match(/source-table-scroll/g)||[]).length,2);assert.equal((h.match(/<tr>/g)||[]).length,7);assert.match(h,/<th aria-label="方法"><\/th>/);assert.match(h,/到着から3営業日以内/);assert.match(h,/25kg以下/);assert.match(h,/160cm以下/);assert.match(h,/自転車の場合、サイズ内でも宅配買取は利用できません/);assert.match(h,/顔写真付き/);
 assert.equal((gs[11].blocks[0].html.match(/source-note-ref/g)||[]).length,7);assert.equal((gs[10].blocks[0].html.match(/source-note-ref/g)||[]).length,4);assert.ok(gs[3].questions.every(q=>q.options.every(s=>s.includes('<u>'))));assert.deepEqual(gs[5].questions.map(q=>q.text.match(/＿{2,}|★/g).indexOf('★')),[0,2,2,2,2]);
});
