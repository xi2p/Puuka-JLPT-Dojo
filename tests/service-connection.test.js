const test=require('node:test'),assert=require('node:assert/strict');let ServiceConnection;
test.before(async()=>{({ServiceConnection}=await import('../public/service-connection.js'));});
const healthy=()=>Response.json({app:'puuka-jlpt-dojo'});
test('connection checks the local health endpoint and verifies the app identity',async()=>{
 const states=[],monitor=new ServiceConnection({request:async(url,options)=>{assert.equal(url,'/api/health');assert.equal(options.cache,'no-store');assert.ok(options.signal);return healthy();},onChange:(...s)=>states.push(s)});assert.equal(await monitor.check(),true);assert.deepEqual(states,[[true,null]]);
});
test('repeated failures produce one disconnect transition and recovery is reported once',async()=>{
 let available=true;const changes=[],m=new ServiceConnection({request:async()=>{if(!available)throw Error('closed');return healthy();},onChange:c=>changes.push(c)});await m.check(true);available=false;await m.check(true);await m.check(true);available=true;await m.check(true);await m.check(true);assert.deepEqual(changes,[true,false,true]);
});
test('HTTP errors, a different service and malformed health responses are disconnected',async()=>{
 for(const response of [new Response('error',{status:500}),Response.json({app:'other-app'}),new Response('not json')]){const m=new ServiceConnection({request:async()=>response});assert.equal(await m.check(true),false);}
});
test('hung health requests time out and abort instead of leaving the UI permanently checking',async()=>{
 let signal;const m=new ServiceConnection({request:async(_,options)=>{signal=options.signal;return new Promise(()=>{});},timeoutMs:15});assert.equal(await m.check(true),false);assert.equal(signal.aborted,true);assert.equal(m.pending,null);
});
test('timeout includes reading the health response body',async()=>{
 const m=new ServiceConnection({request:async()=>({ok:true,json:()=>new Promise(()=>{})}),timeoutMs:15});assert.equal(await m.check(true),false);
});
test('activity is throttled but explicit retries bypass the throttle',async()=>{
 let now=0,calls=0;const m=new ServiceConnection({request:async()=>{calls++;return healthy();},now:()=>now,activityGapMs:1000});await m.check();now=500;await m.check();assert.equal(calls,1);await m.check(true);assert.equal(calls,2);now=1500;await m.check();assert.equal(calls,3);
});
test('simultaneous activity reuses one health request',async()=>{
 let resolve,calls=0;const response=new Promise(r=>resolve=r),m=new ServiceConnection({request:()=>{calls++;return response;}});const first=m.check(true),second=m.check(true);assert.equal(first,second);resolve(healthy());await first;assert.equal(calls,1);
});
test('stopping ignores late health responses and restarting can recover',async()=>{
 let resolve;const changes=[],m=new ServiceConnection({request:()=>new Promise(r=>resolve=r),onChange:c=>changes.push(c)});const pending=m.check(true);await Promise.resolve();m.stop();resolve(healthy());await pending;assert.deepEqual(changes,[]);m.request=async()=>healthy();m.start();await m.check(true);assert.equal(m.connected,true);m.stop();assert.deepEqual(changes,[true]);
});
test('a synchronous network failure does not trap subsequent retries',async()=>{
 const m=new ServiceConnection({request:()=>{throw Error('network error');}});await m.check(true);m.request=async()=>healthy();assert.equal(await m.check(true),true);
});

test('default fetch is called without binding the monitor as its browser receiver',async()=>{
 const previous=global.fetch;let monitor,calls=0;
 try{global.fetch=function(){assert.notEqual(this,monitor);calls++;return Promise.resolve(healthy());};monitor=new ServiceConnection();assert.equal(await monitor.check(true),true);assert.equal(calls,1);}finally{global.fetch=previous;}
});
