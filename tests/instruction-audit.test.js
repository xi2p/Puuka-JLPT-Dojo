const test=require('node:test'),assert=require('node:assert/strict');
const {repeatedInstructions}=require('../scripts/audit-instructions');
const instruction='下線の言葉に意味が最も近いものを、1・2・3・4から一つ選びなさい。';
const sample=(text,custom=instruction)=>({id:'sample',sections:[{id:'r',groups:[{id:'r5',number:5,instruction:custom,questions:[{id:'r-23',text}]}]}]});
test('detects a numbered full-width instruction before the real vocabulary sentence',()=>{
 const e=sample('問題５＿＿＿＿の言葉に意味が最も近いものを、１・２・３・４・から一つ選びなさい。最近は生産が<u>過剰</u>であることが問題になっている。');assert.equal(repeatedInstructions(e).length,1);
});
test('detects use and word-order instructions even with OCR variations',()=>{
 for(const text of ['問題6次の言葉の使い方として最も近いものを、１・２・３・４・から一つ選びなさい。頂上','問題8次の文の__★ __に入る最もよいものを、１・２・３・４・から一つ選びなさい。良い＿＿ ★ ＿＿ ＿＿ 増加は期待できない。'])assert.equal(repeatedInstructions(sample(text)).length,1);
});
test('detects repeated instruction without a problem label, ignoring width, spaces and markup',()=>{
 assert.equal(repeatedInstructions(sample('下線の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。本文')).length,1);assert.equal(repeatedInstructions(sample('<b>'+instruction+'</b>本文')).length,1);
});
test('retains ordinary problem vocabulary and genuine commands inside question sentences',()=>{
 for(const text of ['問題の再発防止のために、何度も会議を開いて対策を（　）。','<u>くわしい</u>ことは、あとで担当の先生に聞いてください。','このメールを書いた人は、自習室のどのような問題を指摘しているか。','最近は生産が<u>過剰</u>であることが問題になっている。','頂上','良い＿＿ ★ ＿＿ ＿＿ 増加は期待できない。'])assert.deepEqual(repeatedInstructions(sample(text)),[]);
});
test('keeps gap references and audio-only response prompts that serve as question labels',()=>{
 assert.deepEqual(repeatedInstructions(sample('［41］に入る最もよいものを選びなさい。','次の文章を読んで、文章全体の趣旨を踏まえて、（41）から（44）の中に入る最もよいものを、1・2・3・4から一つ選びなさい。')),[]);assert.deepEqual(repeatedInstructions(sample('応答として最もよいものを選んでください。','問題用紙に何も印刷されていません。まず文を聞いてください。それから、それに対する返事を聞いて、1から3の中から、最もよいものを一つ選んでください。')),[]);
});
test('the audit reports problems without mutating source text',()=>{
 const e=sample(instruction+'本文'),before=structuredClone(e);repeatedInstructions(e);assert.deepEqual(e,before);
});
test('all installed exams pass the repeated-instruction content audit',()=>{
 const {listExams,readExam}=require('../exam-store');for(const e of listExams())assert.deepEqual(repeatedInstructions(readExam(e.id)),[],e.id);
});
test('2017 July N2 retains actual stems after all five instruction prefixes are removed',()=>{
 const {listExams,readExam}=require('../exam-store');if(!listExams().some(e=>e.id==='n2-2017-07'))return;const e=readExam('n2-2017-07'),questions=e.sections.flatMap(s=>s.groups.flatMap(g=>g.questions));const expected={'r-11':'4月中にご入会になると、（　）年度の会費が無料になります。','r-16':'骨を丈夫にするために、カルシウムを（　）含む食品をとるようにしている。','r-23':'最近は生産が<u>過剰</u>であることが問題になっている。','r-28':'頂上','r-45':'良い＿＿ ★ ＿＿ ＿＿ 増加は期待できない。'};for(const [id,text] of Object.entries(expected))assert.equal(questions.find(q=>q.id===id).text,text,id);
});
