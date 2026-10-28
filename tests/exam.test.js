const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {listExams,readExam,audioFile}=require('../exam-store.js');
const catalog=listExams();
test('library discovers valid exams, including an empty code-only installation',()=>{
  assert.equal(new Set(catalog.map(e=>e.id)).size,catalog.length);
  for(const e of catalog){assert.equal(e.questionCount,e.readingCount+e.listeningCount);assert.equal(e.sources,undefined);}
});
for(const summary of catalog){
  const exam=readExam(summary.id),qs=exam.sections.flatMap(s=>s.groups.flatMap(g=>g.questions));
  test(`${exam.id}: full questions, passages, verified answer key and listening cues`,async()=>{
    let expected;try{expected=JSON.parse(await fs.readFile(path.join(__dirname,'fixtures',exam.id+'.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return;throw error;}
    assert.equal(exam.sections[0].groups.length,expected.readingAnswers.length);assert.equal(exam.sections[1].groups.length,expected.listeningAnswers.length);
    assert.equal(qs.length,summary.questionCount);assert.equal(new Set(qs.map(q=>q.id)).size,qs.length);
    const written=exam.sections[0].groups.flatMap(g=>g.questions);
    assert.deepEqual(written.map(q=>Number(q.label)),Array.from({length:summary.readingCount},(_,i)=>i+1));
    for(const q of qs){assert.ok(q.answer>=1&&q.answer<=q.optionCount,q.id);if(q.options.length)assert.equal(q.options.length,q.optionCount,q.id);}
    for(const g of exam.sections[0].groups.filter(g=>g.blocks)){assert.deepEqual(g.blocks.flatMap(b=>b.questionIds),g.questions.map(q=>q.id));assert.ok(g.blocks.every(b=>b.html.length>100));}
    assert.deepEqual(exam.sections[0].groups.map(g=>g.questions.map(q=>q.answer).join('')),expected.readingAnswers);
    assert.deepEqual(exam.sections[1].groups.map(g=>g.questions.map(q=>q.answer).join('')),expected.listeningAnswers);
    if(expected.readingOnly){assert.equal(exam.listeningOmitted,true);assert.equal(summary.listeningCount,0);assert.equal(exam.audioDataUrl,null);assert.deepEqual(written.filter(q=>q.excludeFromScoring).map(q=>q.id),expected.excludedQuestionIds);return;}
    const listening=exam.sections[1].groups.flatMap(g=>g.questions);
    assert.equal(listening.filter(q=>Number.isFinite(q.audioStart)).length,summary.listeningCount);assert.ok(exam.sections[1].groups[3].questions.every(q=>q.optionCount===3));
    assert.deepEqual(exam.sections[1].groups[4].questions.map(q=>q.label),expected.listeningFinalLabels||['1','2','3-1','3-2']);assert.deepEqual(exam.sections[1].groups.map(g=>g.transcript.length),expected.transcriptLengths);
    for(const [i,q] of listening.entries()){assert.ok(Number.isFinite(q.audioStart)&&q.audioStart>=0&&q.audioStart<(expected.audioMaxSeconds||3100),q.id);if(i>0&&i<listening.length-1)assert.ok(q.audioStart>listening[i-1].audioStart,q.id);}
    assert.equal(listening.at(-1).audioStart,listening.at(-2).audioStart);assert.equal(listening.at(-1).sharedAudio,true);assert.equal(listening.at(-2).sharedAudio,true);
    assert.ok(written.every(q=>q.audioStart===undefined));assert.doesNotMatch(JSON.stringify(exam),/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/);
  });
}
test('loopback API serves each exam and its own audio, while authoring and progress stay private',async()=>{
  const {server}=require('../server.js');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    assert.equal(server.address().address,'127.0.0.1');const base=`http://127.0.0.1:${server.address().port}`;
    const root=await fetch(base);assert.equal(root.status,200);assert.match(await root.text(),/Puuka JLPT Dojo/);
    const listing=await fetch(base+'/api/exams');assert.deepEqual((await listing.json()).map(e=>e.id),catalog.map(e=>e.id));
    for(const summary of catalog){
      const api=await fetch(base+`/api/exams/${summary.id}`);assert.equal(api.status,200);const exam=await api.json();assert.equal(exam.id,summary.id);
      if(exam.listeningOmitted){assert.equal((await fetch(base+`/api/exams/${summary.id}/audio-data`)).status,404);continue;}
      const original=await fs.readFile(audioFile(summary.id)),data=await fetch(base+exam.audioDataUrl);assert.equal(data.status,200);assert.match(data.headers.get('content-type'),/application\/json/);assert.equal(data.headers.get('cache-control'),'no-store');assert.equal(data.headers.get('content-disposition'),null);
      assert.ok(Buffer.from((await data.json()).base64,'base64').equals(original));
      const partial=await fetch(base+`/exams/${summary.id}/assets/listening.mp3`,{headers:{Range:'bytes=0-127'}});assert.equal(partial.status,206);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),original.subarray(0,128));
      const suffix=await fetch(base+`/exams/${summary.id}/assets/listening.mp3`,{headers:{Range:'bytes=-64'}});assert.equal(suffix.status,206);assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),original.subarray(-64));
      assert.equal((await fetch(base+`/exams/${summary.id}/assets/listening.mp3`,{headers:{Range:'bytes=999999999-'}})).status,416);
      assert.equal((await fetch(base+`/exams/${summary.id}/sources/exam.pdf`)).status,404);assert.equal((await fetch(base+`/exams/${summary.id}/work/import.py`)).status,404);
    }
    assert.equal((await fetch(base+'/api/exams/missing')).status,404);assert.equal((await fetch(base+'/data/progress.json')).status,404);
    assert.equal((await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"version":1,"activeId":null,"attempts":[{}]}'})).status,400);
    assert.equal((await fetch(base+'/source/exam.pdf',{method:'HEAD'})).status,404);if(catalog.some(e=>e.id==='n2-2016-12'))assert.equal((await fetch(base+'/media/listening.mp3',{headers:{Range:'bytes=0-3'}})).status,206);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
