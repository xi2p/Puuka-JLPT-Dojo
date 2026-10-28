const test=require('node:test'),assert=require('node:assert/strict');
let migration;
test.before(async()=>{migration=await import('../public/legacy-storage.js');});
test.afterEach(()=>{delete global.localStorage;});
test('historical records are copied intact before legacy keys are removed',()=>{
  const state={version:1,activeId:null,attempts:[{id:'old-record',answers:{'r-1':2}}]};
  const map=new Map([['kotoba.jlpt.v1',JSON.stringify(state)],['jlpt-local.practice.v1','invalid-json']]);
  global.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  assert.deepEqual(migration.browserSnapshots(),[state]);migration.finishMigration(state);
  assert.deepEqual(JSON.parse(map.get(migration.STORAGE)),state);assert.equal(map.has('kotoba.jlpt.v1'),false);assert.equal(map.has('jlpt-local.practice.v1'),false);
});
test('a failed new-key write never deletes existing browser backups',()=>{
  let removed=false;global.localStorage={setItem:()=>{throw Error('full');},removeItem:()=>{removed=true;}};
  migration.finishMigration({version:1,attempts:[]});assert.equal(removed,false);
});
