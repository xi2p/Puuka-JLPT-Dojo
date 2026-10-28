const test=require('node:test');
const assert=require('node:assert/strict');
let ListeningSource;
test.before(async()=>{({ListeningSource}=await import('../public/listening-source.js'));});

test('loads one local Blob for concurrent requests, and reuses it for seeking and navigation',async()=>{
  let calls=0,loadedBlob;
  const source=new ListeningSource({fetchBytes:async(url,options)=>{
    calls++;assert.equal(url,'/api/listening-data');assert.equal(options.cache,'no-store');
    return Response.json({base64:'SUQz'});
  },createURL:blob=>{loadedBlob=blob;return 'blob:local-audio';}});
  assert.deepEqual(await Promise.all([source.load(),source.load()]),['blob:local-audio','blob:local-audio']);
  assert.equal(await source.load(),'blob:local-audio');assert.equal(calls,1);
  assert.equal(loadedBlob.type,'audio/mpeg');assert.deepEqual([...new Uint8Array(await loadedBlob.arrayBuffer())],[73,68,51]);
});
test('a chosen MP3 needs no HTTP request and releases the previous source',async()=>{
  let requests=0,created=0;const revoked=[];
  const source=new ListeningSource({fetchBytes:async()=>{requests++;throw new Error('should not fetch');},createURL:()=>`blob:${++created}`,revokeURL:url=>revoked.push(url)});
  const file=new Blob(['mp3'],{type:'audio/mpeg'});
  source.useFile(file);assert.equal(await source.load(),'blob:1');assert.equal(requests,0);
  source.useFile(file);assert.equal(await source.load(),'blob:2');assert.deepEqual(revoked,['blob:1']);
  assert.throws(()=>source.useFile(new Blob([],{type:'audio/mpeg'})),/MP3/);
});
test('selecting a local file during a pending read cannot be overwritten by that read',async()=>{
  let finish;const response=new Promise(resolve=>finish=resolve);
  const source=new ListeningSource({fetchBytes:()=>response,createURL:()=> 'blob:chosen-file'});
  const pending=source.load();source.useFile(new Blob(['local'],{type:'audio/mpeg'}));
  finish(Response.json({base64:'bmV0d29yayBjb3B5'}));
  assert.equal(await pending,'blob:chosen-file');assert.equal(await source.load(),'blob:chosen-file');
});
test('a failed server read can be retried without losing the local-file fallback',async()=>{
  let requests=0;
  const source=new ListeningSource({fetchBytes:async()=>++requests===1?new Response('',{status:404}):Response.json({base64:'bXAz'}),createURL:()=> 'blob:retried'});
  await assert.rejects(source.load(),/重启本地服务/);
  assert.equal(await source.load(),'blob:retried');assert.equal(requests,2);
});

test('switching exams releases the previous Blob and prevents its pending load from creating a source',async()=>{
  let finish,created=0;const revoked=[];
  const source=new ListeningSource({endpoint:'/api/exams/n2-2010-07/audio-data',fetchBytes:url=>{assert.equal(url,'/api/exams/n2-2010-07/audio-data');return new Promise(resolve=>finish=resolve);},createURL:()=>{created++;return 'blob:old';},revokeURL:url=>revoked.push(url)});
  const pending=source.load();source.dispose();finish(Response.json({base64:'SUQz'}));
  assert.equal(await pending,null);assert.equal(created,0);
  source.useFile(new Blob(['mp3'],{type:'audio/mpeg'}));source.dispose();assert.deepEqual(revoked,['blob:old']);assert.equal(source.url,null);
});
