const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {listExams,readExam}=require('../exam-store'),installed=listExams().some(e=>e.id==='n2-2024-12');
const clean=s=>s.replace(/<[^>]*>/g,'').replace(/\s/g,'').replace(/【(4[89]|5[01])】/g,'$1');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
test('N2 December 2024 source layouts retain question content, scoring and reviewed passage text',{skip:!installed},()=>{
 const e=readExam('n2-2024-12'),f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/visual/n2-2024-12.json'),'utf8'));
 for(const b of f.blocks){const a=e.sections[0].groups.find(g=>g.id===b.groupId).blocks[b.blockIndex];assert.deepEqual(a.questionIds,b.questionIds);assert.equal(hash(clean(a.html)),b.textSha256,b.groupId+'/'+b.blockIndex);}
 const qs=e.sections.flatMap(s=>s.groups.flatMap(g=>g.questions));assert.equal(qs.length,101);
 assert.equal(hash(JSON.stringify(qs.map(q=>({id:q.id,text:clean(q.text),options:q.options.map(clean),answer:q.answer,excluded:Boolean(q.excludeFromScoring)})))),f.questionContentSha256);
 assert.deepEqual(qs.filter(q=>q.excludeFromScoring).map(q=>q.id),['r-50','r-51','r-53','r-55','r-57','r-58','r-61','r-62','l-1-2']);
});
test('N2 December 2024 uses scanned paragraphs and hotel row/column relationships',{skip:!installed},()=>{
 const gs=readExam('n2-2024-12').sections[0].groups,counts=g=>g.blocks.map(b=>(b.html.match(/<p>/g)||[]).length);
 assert.deepEqual(counts(gs[8]),[3]);assert.deepEqual(counts(gs[9]),[1,1,1,2,1]);assert.deepEqual(counts(gs[10]),[3,2,2,4]);assert.deepEqual(counts(gs[11]),[4]);assert.deepEqual(counts(gs[12]),[4]);
 for(const g of gs.slice(8,13))for(const b of g.blocks){assert.doesNotMatch(b.html,/<p>\s*<(?:p|h[1-6])/);assert.doesNotMatch(b.html,/<p><\/p>/);}
 assert.equal((gs[11].blocks[0].html.match(/source-material-label/g)||[]).length,2);assert.doesNotMatch(gs[11].blocks[0].html,/source-box/);
 assert.equal((gs[8].blocks[0].html.match(/exam-number-box/g)||[]).length,4);
 const h=gs[13].blocks[0].html;assert.match(h,/<th rowspan="3" scope="rowgroup" class="source-plan-label">プラン/);assert.match(h,/<th colspan="2">お部屋のタイプ/);
 assert.equal((h.match(/class="source-table-scroll"/g)||[]).length,2);assert.match(h,/Cタイプ（定員2～6名）/);
 for(const price of ['7,000','6,000','8,500','6,500','9,300','6,800','8,200','7,200','9,700','7,700','10,500','8,000','11,200','10,200','12,700','10,700','13,500','11,000'])assert.ok(h.includes('>'+price+'</td>'),price);
 assert.match(h,/土曜日は上記料金に1,100円/);assert.match(h,/特別和食膳は4,000円/);assert.match(h,/前日午後5時まで/);
});
