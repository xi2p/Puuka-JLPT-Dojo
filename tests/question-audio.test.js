const test=require('node:test');
const assert=require('node:assert/strict');
let QuestionAudioPlayer,audioTimestamp;
test.before(async()=>{({QuestionAudioPlayer,audioTimestamp}=await import('../public/question-audio.js'));});
class AudioStub extends EventTarget {
  constructor(){super();this.readyState=1;this.currentTime=87;this.duration=2478.891813;this.playbackRate=1.25;this.plays=0;this.pauses=0;}
  pause(){this.pauses++;}
  async play(){this.plays++;}
}
test('seeks and plays the selected question without changing playback speed',async()=>{
  const audio=new AudioStub(),player=new QuestionAudioPlayer(audio,async()=>true);
  assert.equal(await player.play(215.4),true);
  assert.equal(audio.currentTime,215.4);assert.equal(audio.plays,1);assert.equal(audio.playbackRate,1.25);
  assert.equal(audioTimestamp(215.4),'03:35');
});
test('waits for the audio metadata before seeking',async()=>{
  const audio=new AudioStub();audio.readyState=0;
  const player=new QuestionAudioPlayer(audio,async()=>true),pending=player.play(312);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(audio.currentTime,87);assert.equal(audio.plays,0);
  audio.readyState=1;audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(await pending,true);assert.equal(audio.currentTime,312);
});
test('the most recent click wins while audio is still loading',async()=>{
  let finish;const loading=new Promise(resolve=>finish=resolve),audio=new AudioStub();
  const player=new QuestionAudioPlayer(audio,()=>loading);
  const first=player.play(100),second=player.play(400);finish(true);
  assert.equal(await first,false);assert.equal(await second,true);
  assert.equal(audio.currentTime,400);assert.equal(audio.plays,1);
});
test('navigation cancels a pending jump so another page cannot start playing later',async()=>{
  const audio=new AudioStub();audio.readyState=0;
  const player=new QuestionAudioPlayer(audio,async()=>true),pending=player.play(600);
  await new Promise(resolve=>setImmediate(resolve));player.cancel();
  assert.equal(await pending,false);assert.equal(audio.currentTime,87);assert.equal(audio.plays,0);
});
test('load failures and invalid timestamps never seek or play',async()=>{
  const audio=new AudioStub(),player=new QuestionAudioPlayer(audio,async()=>false);
  await assert.rejects(player.play(100),/载入音频/);
  await assert.rejects(player.play(NaN),/时间无效/);
  assert.equal(audio.currentTime,87);assert.equal(audio.plays,0);
});
