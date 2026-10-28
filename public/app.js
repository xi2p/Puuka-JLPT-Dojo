import {questionFlags} from './question-flags.js';
import {ServiceConnection} from './service-connection.js';
import {ExamLibrary,questionsOf,validProgress,isScored,scoreAnswers} from './exam-library.js';
import {ListeningSource} from './listening-source.js';
import {QuestionAudioPlayer,audioTimestamp} from './question-audio.js';
import {STORAGE,browserSnapshots,finishMigration,readFontSize} from './legacy-storage.js';

const $ = (s, p=document) => p.querySelector(s);
const $$ = (s, p=document) => [...p.querySelectorAll(s)];
const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rich = s => escape(s).replace(/&lt;(\/?)(u|b|br)&gt;/g,'<$1$2>');
const app = $('#app'), modal = $('#modal');
let state = {version:1,activeId:null,attempts:[],updatedAt:0}, view = {type:'home'}, saveTimer, saved = true, saveChain = Promise.resolve(), toastTimer;
let fontSize = readFontSize();
let libraryIssues=[];
let updateInfo=null;
let connection=null;
if(!Number.isFinite(fontSize)) fontSize=17;
fontSize=Math.max(15,Math.min(22,fontSize));
const library=new ExamLibrary();
let exam=null,allQuestions=[],groups=[],routeVersion=0,confirmVersion=0,stateReady=false;
const libraryFilters={level:'all',year:'all',local:'all'};
const selectedExams=new Set();let libraryWorking=false,libraryNotice='';
const installed=id=>library.metadata(id)?.installed!==false&&Boolean(library.metadata(id));
const sizeLabel=bytes=>bytes<1024*1024?`${Math.ceil(bytes/1024)} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;
function migrateFlags(){let changed=false;for(const a of state.attempts){const normalized=questionFlags(a.flags,library.cache.get(a.examId));if(JSON.stringify(normalized)!==JSON.stringify(a.flags)){a.flags=normalized;changed=true;}}return changed;}
function flagNumber(q,a,className){const marked=a.flags.includes(q.id),label=marked?`取消第 ${q.label} 题的检查标记`:`标记第 ${q.label} 题稍后检查`;return `<button type="button" class="${className} question-flag-toggle ${marked?'flagged':''}" data-action="flag-question" data-question="${q.id}" aria-pressed="${marked}" aria-label="${label}" title="${label}">${escape(q.label)}</button>`;}
function useExam(paper){exam=paper;allQuestions=questionsOf(paper);groups=paper.sections.flatMap(s=>s.groups);}
const examLabel=paper=>paper?`${paper.year} 年 ${paper.month} 月 ${paper.level}`:'试卷暂不可用';
const attemptLabel=a=>examLabel(library.metadata(a.examId));
const totalOf=a=>library.metadata(a.examId)?.scoredCount||library.questions(a.examId).filter(isScored).length;
const scoreTotal=(a,qs=library.questions(a?.examId))=>scoreAnswers(a,qs).total;
const scoredAnswered=(a,qs=library.questions(a?.examId))=>scoreAnswers(a,qs).answered;
const pendingFor=id=>state.attempts.filter(a=>a.examId===id&&a.status==='active').sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt))[0];
const findAttempt = id => state.attempts.find(a=>a.id===id);
const active = () => findAttempt(state.activeId);
const answered = (a,qs=library.questions(a?.examId)) => qs.filter(q=>a?.answers[q.id]).length;
const grade = (a,qs=library.questions(a?.examId)) => scoreAnswers(a,qs).correct;
const date = v => new Date(v).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const duration = seconds => `${String(Math.floor((seconds||0)/3600)).padStart(2,'0')}:${String(Math.floor((seconds||0)%3600/60)).padStart(2,'0')}:${String(Math.floor((seconds||0)%60)).padStart(2,'0')}`;
const percent = (n,d) => d ? Math.round(n/d*100) : 0;
const brand = `<button class="brand" data-action="home" aria-label="返回试卷库"><span class="brand-mark">日</span>Puuka JLPT Dojo<small>本地练习</small></button>`;
function toast(message){ clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').classList.add('visible'); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3000); }
function dialog(content){ $('#modal-body').innerHTML=content; if(!modal.open) modal.showModal(); }
function modalButtons(buttons){ return `<div class="modal-actions">${buttons}</div>`; }
function setRoute(hash){ if(location.hash===hash) route(); else location.hash=hash; }
function saveLocal(){state.updatedAt=Date.now();try{localStorage.setItem(STORAGE,JSON.stringify(state));return true;}catch{toast('浏览器存储已满，正在尝试保存到本地文件');return false;}}
function updateSaveLabel(text,error=false){if(connection?.connected===false){text='服务已断开';error=true;}$$('.save-state').forEach(el=>{el.textContent=text;el.classList.toggle('error',error);});}
function persist(immediate=false){
  saved=false; const localOK=saveLocal(); updateSaveLabel(localOK?'已暂存 · 正在写入本地':'正在保存…');
  clearTimeout(saveTimer);
  if(immediate) return flush();
  saveTimer=setTimeout(flush,450);
}
function flush(){
  clearTimeout(saveTimer);
  const snapshot=JSON.stringify(state);
  saveChain=saveChain.catch(()=>false).then(async()=>{
    try{const response=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:snapshot,signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error();
      saved=JSON.stringify(state)===snapshot;
      updateSaveLabel(saved?'已保存到本地':'已暂存 · 正在写入本地');return true;
    }catch{updateSaveLabel('文件保存失败 · 请导出备份',true);connection?.check(true);return false;}
  });return saveChain;
}
function validImport(s){return validProgress(s,library);}
async function init(){
  try{await library.refreshRemote();}catch(error){app.innerHTML=`<main class="home"><h1>暂时无法读取试卷库</h1><p>${escape(error.message)}</p><p>请关闭原服务窗口，重新运行启动网站.cmd，再刷新页面。</p></main>`;return;}
  let remote,local,failed=false,remoteInvalid=false;
  try{const response=await fetch('/api/state');if(!response.ok)throw new Error();remote=await response.json();await library.preloadProgress(remote);if(!validImport(remote)){remoteInvalid=true;throw new Error();}}catch{remote=null;failed=true;}
  for(const candidate of browserSnapshots()){try{await library.preloadProgress(candidate);if(validImport(candidate)&&(!local||(candidate.updatedAt||0)>(local.updatedAt||0)))local=candidate;}catch{}}
  if(remoteInvalid&&!local){app.innerHTML='<main class="home"><h1>作答记录暂时无法读取</h1><p>原文件仍保存在 data/progress.json。请先保留该文件，检查记录格式后重新打开网站。</p></main>';return;}
  if(remote)state=remote;
  if(local&&(!remote||(local.updatedAt||0)>(remote.updatedAt||0)))state=local;
  if(!state.attempts.length)state={version:1,activeId:null,attempts:[],updatedAt:Date.now()};
  const flagsMigrated=migrateFlags();
  stateReady=true;
  finishMigration(state);
  try{libraryIssues=(await (await fetch('/api/library-status')).json()).issues||[];}catch{}
  await route();
  if(localStorage.getItem('puuka-jlpt.autoUpdate')!=='off')maintenanceRequest('/api/update/check').then(info=>{updateInfo=info;if(info.available&&view.type==='home')home();}).catch(()=>{}).finally(()=>refreshRemoteCatalog(false));
  else refreshRemoteCatalog(false);
  if(failed)toast('未能读取本地进度文件；浏览器备份和导入备份仍可使用');
  if(flagsMigrated||(local&&state===local))persist(true);
}
function examCard(paper){
  const pending=pendingFor(paper.id),completed=state.attempts.filter(a=>a.examId===paper.id&&a.status==='submitted').sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt));
  return `<article class="exam-card"><div class="book-cover"><div class="cover-top">JAPANESE LANGUAGE<br>PROFICIENCY TEST</div><div class="cover-level">${paper.level}</div><div class="cover-bottom">${paper.year} / ${String(paper.month).padStart(2,'0')}<br>日本語能力試験</div></div><div class="exam-info"><div class="exam-meta"><span class="tag">${paper.installed===false?'未下载':paper.updateAvailable?'有更新':'已下载'}</span><span>${examLabel(paper)}</span></div><h2>日本語能力試験</h2><div class="exam-facts"><div class="fact"><strong>言語知識・読解</strong>${paper.readingGroups} 个問題 · ${paper.readingCount} 题 · 参考 ${paper.referenceMinutes} 分钟</div><div class="fact"><strong>聴解</strong>${paper.listeningCount?`${paper.listeningGroups} 个問題 · ${paper.listeningCount} 题 · 原始音频`:"本卷未收录"}</div><div class="fact"><strong>${paper.listeningCount?"完整收录":"收录范围"}</strong>${paper.listeningCount?"文字试题 / 答案 / 听力原文":"言語知識・読解 / 答案"}${paper.scoredCount<paper.questionCount?` · ${paper.questionCount-paper.scoredCount}题因题源缺漏不计分`:""}</div></div><div class="bank-actions">${paper.downloadable&&(paper.installed===false||paper.updateAvailable)?`<label><input type="checkbox" data-bank-select="${paper.id}" ${selectedExams.has(paper.id)?'checked':''}> 选择 · ${sizeLabel(paper.bytes)}</label><button class="btn secondary" data-action="download-exam" data-exam="${paper.id}">${paper.installed===false?'下载试卷':'更新试卷'}</button>`:''}${paper.installed!==false?`<button class="text-button" data-action="remove-exam" data-exam="${paper.id}">移除本机文件</button>`:''}</div><div class="card-actions">${paper.installed===false?'下载后即可离线作答，已有记录会保留。':pending?`<div class="card-progress"><p><span>上次作答进度</span><span>${answered(pending)} / ${paper.questionCount}</span></p><div class="progress-track"><i style="width:${percent(answered(pending),paper.questionCount)}%"></i></div></div><div><button class="text-button" data-action="new" data-exam="${paper.id}" style="margin-right:20px">重新作答</button><button class="btn" data-action="continue" data-id="${escape(pending.id)}">继续作答 <span class="arrow">↗</span></button></div>`:`<div class="quiet">${completed.length?`已完成 ${completed.length} 次 · 最近正确率 ${percent(grade(completed[0]),paper.scoredCount)}%`:'从第一题开始，留下一次完整的练习。'}</div><button class="btn" data-action="new" data-exam="${paper.id}">开始作答 <span class="arrow">↗</span></button>`}</div></div></article>`;
}
function historyRow(a){
  const ongoing=a.status==='active',metadata=library.metadata(a.examId),paper=library.cache.get(a.examId);
  const section=paper?.sections.find(s=>s.id===a.position.section),group=section?.groups[a.position.group];
  const location=group?`${section.shortTitle||section.title} · 問題 ${group.number}`:'';
  const count=Object.keys(a.answers).length,summary=ongoing?`已答 ${count}${metadata?' / '+metadata.questionCount:''} 题`:installed(a.examId)?`${grade(a)} / ${totalOf(a)} 题正确 · ${percent(grade(a),totalOf(a))}%`:'记录已保留，请先下载对应试卷';
  return `<div class="history-row" data-attempt-id="${escape(a.id)}"><div class="history-info"><strong>${escape(attemptLabel(a))}<span class="history-status ${ongoing?'ongoing':'submitted'}">${ongoing?'进行中':'已交卷'}</span></strong><small>${ongoing?'开始于':'交卷于'} ${date(ongoing?a.startedAt:a.submittedAt)} · 用时 ${duration(a.elapsed.r+a.elapsed.l)}</small>${ongoing&&location?`<small>上次位置：${escape(location)}</small>`:''}${!metadata?`<small>试卷：${escape(a.examId)}</small>`:''}</div><span class="history-summary">${summary}${ongoing&&!installed(a.examId)?'<small>请先下载对应试卷</small>':''}</span><div class="history-actions"><button class="text-button" data-action="${ongoing?'continue':'result'}" data-id="${escape(a.id)}" ${installed(a.examId)?'':'disabled'}>${ongoing?'继续作答':'查看复盘'} →</button><button class="text-button history-delete" data-action="delete-attempt" data-id="${escape(a.id)}" aria-label="删除${escape(attemptLabel(a))}的这次作答记录">删除记录</button></div></div>`;
}
async function deleteAttempt(id){
  if(!findAttempt(id)){modal.close();return;}
  if(audioAttemptId===id){questionAudio.cancel();audio.pause();audioAttemptId=null;}
  state.attempts=state.attempts.filter(a=>a.id!==id);
  if(state.activeId===id)state.activeId=null;
  saved=false;const localOK=saveLocal(),serverOK=await flush();
  modal.close();
  if(view.type==='home')home();else if(view.id===id)setRoute('#home');
  toast(serverOK?'已删除这次作答记录':localOK?'删除已暂存，恢复连接后将继续保存':'删除尚未保存，请保留页面并恢复服务连接');
}
function home(){
  view={type:'home'};audio.pause();
  const history=[...state.attempts].sort((a,b)=>new Date(b.submittedAt||b.startedAt)-new Date(a.submittedAt||a.startedAt));
  const ongoingCount=history.filter(a=>a.status==='active').length,completedCount=history.length-ongoingCount;
  const visible=library.catalog.filter(p=>(libraryFilters.level==='all'||p.level===libraryFilters.level)&&(libraryFilters.year==='all'||String(p.year)===libraryFilters.year)&&(libraryFilters.local==='all'||(libraryFilters.local==='installed'?p.installed!==false:p.updateAvailable)));
  const selectedBytes=library.catalog.filter(p=>selectedExams.has(p.id)).reduce((sum,p)=>sum+(p.bytes||0),0);
  const levels=[...new Set(library.catalog.map(p=>p.level))],years=[...new Set(library.catalog.map(p=>p.year))];
  app.innerHTML=`<header class="topbar">${brand}<nav class="home-tabs"><button class="active" data-action="home">试卷库</button><button data-action="history">作答记录 <span class="n2-label">${history.length?`· ${history.length}`:''}</span></button></nav><div class="top-right"><span class="local-badge"><i class="dot"></i> 仅在本机 · 离线可用</span><button class="text-button" data-action="settings">设置与备份</button></div></header>
  <main class="home">${updateInfo?.available?`<div class="update-notice"><span>Puuka 有可用更新 · ${escape(updateInfo.latest.slice(0,7))}</span><button class="text-button" data-action="check-update">查看更新 →</button></div>`:''}<section class="hero"><div><div class="eyebrow">YOUR QUIET PLACE TO PRACTICE</div><h1>一份试卷，一步进步。</h1><p>在自己的节奏里，认真完成每一道题。</p></div><div class="hero-stamp" aria-hidden="true"><div class="vertical">日々の積み重ねが<br>確かな力になる。</div><div class="seal">日々精進</div></div></section>
  <div class="section-line"><div class="section-title">我的试卷 <span>EXAM COLLECTION / ${String(library.catalog.length).padStart(2,'0')}</span></div><div class="filters"><button class="chip ${libraryFilters.level==='all'?'active':''}" data-action="filter-level" data-level="all" aria-pressed="${libraryFilters.level==='all'}">全部 · ${library.catalog.length}</button>${levels.map(level=>`<button class="chip ${libraryFilters.level===level?'active':''}" data-action="filter-level" data-level="${level}" aria-pressed="${libraryFilters.level===level}">${level}</button>`).join('')}<select id="library-year" aria-label="按年份筛选试卷"><option value="all">全部年份</option>${years.map(year=>`<option value="${year}" ${libraryFilters.year===String(year)?'selected':''}>${year} 年</option>`).join('')}</select></div></div>
  <div class="library-tools"><p>按需下载试卷，下载后可离线练习。</p><div><button class="text-button" data-action="refresh-library">刷新远端目录</button><button class="btn secondary" data-action="check-update">更新程序 ↗</button></div></div><div class="bank-toolbar"><select id="library-local" aria-label="按下载状态筛选"><option value="all" ${libraryFilters.local==='all'?'selected':''}>全部试卷</option><option value="installed" ${libraryFilters.local==='installed'?'selected':''}>已下载</option><option value="updates" ${libraryFilters.local==='updates'?'selected':''}>有更新</option></select><button class="text-button" data-action="select-visible">选择当前筛选中待下载的试卷</button><button class="text-button" data-action="clear-selection">清空选择</button><button class="btn secondary" data-action="download-selected" ${selectedExams.size?'':'disabled'}>下载所选 · ${selectedExams.size} 套${selectedExams.size?` · ${sizeLabel(selectedBytes)}`:''}</button></div>
  ${libraryNotice?`<p class="library-issues" role="status">${escape(libraryNotice)}</p>`:''}
  ${libraryIssues.length?`<details class="library-issues"><summary>${libraryIssues.length} 处试卷目录需要检查</summary><ul>${libraryIssues.map(i=>`<li>${escape(i.folder)}：${escape(i.error)}</li>`).join('')}</ul></details>`:''}
  <div class="exam-collection">${visible.length?visible.map(examCard).join(''):`<div class="empty">${library.catalog.length?'这个筛选条件下还没有试卷。':'题库还是空的。请点击「刷新远端目录」，然后选择需要下载的试卷。'}</div>`}</div>
  <section class="support-grid"><div class="support-item"><div class="support-icon">▤</div><div><h3>像试卷一样，完整阅读</h3><p>每页呈现一个「問題」块<br>文章、题目与答题卡放在一起</p></div></div><div class="support-item"><div class="support-icon">◷</div><div><h3>随时停下，下次继续</h3><p>每份试卷独立保存进度<br>答案、笔记与音频位置随时恢复</p></div></div><div class="support-item"><div class="support-icon">✓</div><div><h3>交卷后，慢慢复盘</h3><p>查看作答情况与正确答案<br>对照原文，按题回听</p></div></div></section>
  <section class="history" id="history"><div class="section-line"><div class="section-title">作答记录 <span>PRACTICE HISTORY</span></div><span class="quiet">${ongoingCount} 次进行中 · ${completedCount} 次已交卷</span></div>${history.length?history.map(historyRow).join(''):'<div class="empty">开始练习后，进行中和已交卷的记录都会出现在这里。</div>'}</section>
  <section class="puuka-note" aria-label="给プーカ的一隅"><img src="/puuka.png" alt="抱着花束的プーカ" width="180" height="180" loading="lazy"><div><span class="eyebrow">A LITTLE PLACE FOR PUUKA</span><blockquote lang="ja">大切な人は、消えない。</blockquote><p>不管任性的小兔子在不在，藏起来的宝物其实一直就在你身边。</p><small>Puuka JLPT Dojo / プーカ JLPT 道場</small></div><span class="puuka-petal" aria-hidden="true">✧</span></section>
  <footer class="footer"><span>Puuka JLPT Dojo · 把每一次练习，留在本地。</span><span>作者：xi2p & GPT6.1-Sol</span></footer></main>`;
}
async function startNew(examId){
  if(state.attempts.length>=100){toast('已保存 100 次记录，请先导出备份并在设置中清理记录');return;}
  useExam(await library.get(examId));
  const a={id:crypto.randomUUID(),examId:exam.id,status:'active',answers:{},notes:{},flags:[],elapsed:{r:0,l:0},position:{section:'r',group:0},audioTime:0,audioRate:1,startedAt:new Date().toISOString(),submittedAt:null};
  state.attempts.push(a);state.activeId=a.id;persist(true);modal.close();setRoute(`#exam/${a.id}/r/0`);
}
async function confirmNew(examId){
  const id=examId||findAttempt(view.id)?.examId||exam?.id||library.catalog[0]?.id,version=++confirmVersion,navigation=routeVersion;
  if(!id)return;
  const paper=await library.get(id),pending=pendingFor(paper.id);
  if(version!==confirmVersion||navigation!==routeVersion)return;
  dialog(`<h2>${pending?'开始新一轮练习':'准备好，开始练习。'}</h2><p><b>${examLabel(paper)}</b></p><p>${pending?'这份试卷现有作答会保留，可以从设置恢复。新一轮练习将使用空白答题卡。':'试卷分为「言語知識・読解」与「聴解」两部分。每页展示完整的問題块，可自由切换，全部完成后统一交卷。'}</p><p>自动记录练习用时，不限时、不自动交卷。听力可暂停、拖动和调整速度。答案和原文在交卷后开放。</p>${modalButtons(`<button class="btn secondary" data-action="close-modal">稍后再来</button><button class="btn" data-action="start-new" data-exam="${paper.id}">${pending?'开始新一轮':'进入考场 →'}</button>`)}`);
}
function groupLink(a,s,g,i){const count=answered(a,g.questions);return `<button class="group-link ${view.section===s.id&&view.index===i?'active':''}" data-action="group" data-section="${s.id}" data-index="${i}" ${view.section===s.id&&view.index===i?'aria-current="page"':''}><span>問題 ${g.number} <span class="flag-icon" data-flag-group="${g.id}">${g.questions.some(q=>a.flags.includes(q.id))?'⚑'+g.questions.filter(q=>a.flags.includes(q.id)).length:''}</span> · ${g.title}</span><span class="nav-status" data-count="${g.id}">${count}/${g.questions.length}</span></button>`;}
function shell(a,content){
  const review=a.status==='submitted';
  const section=exam.sections.find(s=>s.id===view.section)||exam.sections[0];
  return `<header class="topbar workspace-top">${brand}<div class="top-right"><button class="text-button" data-action="save-exit">${review?'返回试卷库':'保存并退出'}</button><button class="btn" data-action="${review?'show-result':'submit'}">${review?'作答报告':'提交试卷'} <span class="arrow">${review?'↗':'→'}</span></button></div></header><div class="exam-layout"><aside class="sidebar"><div class="side-kicker">${exam.year}.${String(exam.month).padStart(2,'0')} / JLPT</div><h2 class="side-title">${exam.level} 日本語能力試験</h2>${exam.sections.filter(s=>s.groups.length).map((s,n)=>`<button class="section-tab ${view.section===s.id?'current':''}" data-action="section" data-section="${s.id}"><span class="num">0${n+1}</span>${s.shortTitle}</button><div class="group-nav">${s.groups.map((g,i)=>groupLink(a,s,g,i)).join('')}</div>`).join('')}<div class="side-bottom"><div class="side-progress"><span>整卷作答进度</span><span class="total-count">${answered(a)} / ${allQuestions.length}</span></div><div class="progress-track"><i class="total-progress" style="width:${percent(answered(a),allQuestions.length)}%"></i></div><p>● 已答　⚑ 稍后检查<br>答案、笔记与音频位置自动保存</p><button class="text-button" data-action="overview">查看整卷答题卡 ↗</button></div></aside><main class="exam-main"><div class="content-width"><div class="exam-toolbar"><div class="breadcrumbs">${examLabel(exam)} <span style="margin:0 10px">/</span> <b>${view.type==='results'?'作答报告':section.title}</b></div><div class="toolbar-controls"><div class="font-controls"><button data-action="font-down" aria-label="缩小题目字号">A−</button><button data-action="font-up" aria-label="放大题目字号">A+</button></div><span class="save-state">${connection?.connected===false?'服务已断开':saved?'已保存到本地':'正在保存…'}</span><div class="timer"><span class="timer-label">${review?'总用时':'本部分用时'}</span><span id="timer-value">${duration(review?a.elapsed.r+a.elapsed.l:a.elapsed[view.section])}</span></div></div></div>${view.type!=='results'?`<select class="mobile-section-select" id="group-select" aria-label="选择問題">${exam.sections.filter(s=>s.groups.length).map(s=>`<optgroup label="${s.title}">${s.groups.map((g,i)=>`<option value="${s.id}:${i}" ${s.id===view.section&&i===view.index?'selected':''}>問題 ${g.number} · ${g.title} (${answered(a,g.questions)}/${g.questions.length})</option>`).join('')}</optgroup>`).join('')}</select>`:''}${content}</div></main></div>`;
}
function renderQuestion(q,a){
  const selected=a.answers[q.id],review=a.status==='submitted';
  const audioJump=review&&Number.isFinite(q.audioStart)?`<div class="question-listen-tools"><button class="question-audio" data-action="play-question" data-question="${q.id}" aria-label="播放第 ${q.label} 题音频，从 ${audioTimestamp(q.audioStart)} 开始">▶ 播放本题 <span>${audioTimestamp(q.audioStart)}</span></button>${q.sharedAudio?'<small>这两个小问共用一段对话</small>':''}</div>`:'';
  return `<div class="question ${a.flags.includes(q.id)?'question-marked':''}" id="q-${q.id}"><div class="question-head">${flagNumber(q,a,'question-number')}<p class="question-text">${rich(q.text)}</p></div>${audioJump}${!isScored(q)?'<p class="question-source-notice">本题资料有缺漏，暂不计分；可听录音练习，复盘查看说明。</p>':''}${q.illustrationHtml?`<div class="question-illustration">${q.illustrationHtml}</div>`:''}${q.options?.length?`<div class="choices ${q.options.some(s=>s.length>24)?'long':''}">${q.options.map((c,i)=>`<button class="choice ${selected===i+1?'selected':''} ${review&&isScored(q)&&i+1===q.answer?'correct':''} ${review&&isScored(q)&&selected===i+1&&selected!==q.answer?'wrong':''}" data-action="answer" data-question="${q.id}" data-value="${i+1}" ${review?'disabled':''} aria-pressed="${selected===i+1}"><span class="choice-n">${i+1}</span><span>${rich(c)}</span></button>`).join('')}</div>`:''}${review?`<div class="review-answer ${!isScored(q)?'is-unscored':selected===q.answer?'':'is-wrong'}">${!isScored(q)?'— 本题不计分':selected===q.answer?'✓ 回答正确':selected?'× 回答错误':'— 未作答'}<span>你的答案：${selected||'—'}　${isScored(q)?'正确':'参考'}答案：${q.answer}</span></div>${q.sourceNote?`<p class="source-note">${escape(q.sourceNote)}</p>`:''}`:''}</div>`;
}
function renderCard(g,a){return `<section class="answer-card" aria-label="問題 ${g.number} 答题卡"><div class="answer-card-header"><strong>解答用紙 <span style="font-weight:400;color:#87957b;margin-left:10px">/ 答题卡</span></strong><small>点击题号可标记，再次点击可取消</small></div><div class="answer-grid">${g.questions.map(q=>`<div class="answer-row ${a.flags.includes(q.id)?'has-flag':''}" data-flag-row="${q.id}">${flagNumber(q,a,'answer-id')}<div class="bubbles">${Array.from({length:q.optionCount},(_,i)=>`<button class="bubble ${a.answers[q.id]===i+1?'selected':''} ${a.status==='submitted'&&isScored(q)&&q.answer===i+1?'correct':''} ${a.status==='submitted'&&isScored(q)&&a.answers[q.id]===i+1&&q.answer!==i+1?'wrong':''}" data-action="answer" data-question="${q.id}" data-value="${i+1}" aria-label="第 ${q.label} 题，选项 ${i+1}" aria-pressed="${a.answers[q.id]===i+1}" ${a.status==='submitted'?'disabled':''}>${i+1}</button>`).join('')}</div></div>`).join('')}</div></section>`;}
function renderExam(a,sectionId,index){
  const s=exam.sections.find(s=>s.id===sectionId);if(!s||!s.groups[index])return setRoute('#home');
  view={type:'exam',id:a.id,section:sectionId,index};const g=s.groups[index],review=a.status==='submitted';
  if(!review){a.position={section:sectionId,group:index};persist();}
  let bodies='';
  if(g.blocks){bodies=g.blocks.map(b=>`${b.label?`<div class="passage-label">${escape(b.label)}</div>`:''}${b.html?`<div class="passage">${b.html}</div>`:''}${b.questionIds.map(id=>renderQuestion(g.questions.find(q=>q.id===id),a)).join('')}`).join('');}
  else bodies=g.audioOnly&&!review?'':g.questions.map(q=>renderQuestion(q,a)).join('');
  const content=`${review?`<div class="review-banner"><span>复盘模式 · 答案已锁定　${grade(a,g.questions)} / ${scoreTotal(a,g.questions)} 题正确${g.questions.length>scoreTotal(a,g.questions)?` · 另有${g.questions.length-scoreTotal(a,g.questions)}题不计分`:""}</span><button data-action="show-result">返回报告 →</button></div>`:''}${sectionId==='l'?'<div id="audio-slot"></div>':''}<article class="paper"><div class="paper-heading"><div><div class="eyebrow">${sectionId==='r'?'LANGUAGE & READING':'LISTENING'} / ${String(index+1).padStart(2,'0')}</div><h1>問題 ${g.number}<span>${g.title}</span></h1><div class="paper-subtitle">${g.questions.length} 道小题${sectionId==='r'?` · 第 ${g.questions[0].label}–${g.questions.at(-1).label} 题`:''}</div></div></div><div class="instruction" lang="ja">${rich(g.instruction)}</div><div class="question-content" lang="ja" style="font-size:${fontSize}px">${g.audioOnly?`<div class="listening-empty"><div class="sound-mark" aria-hidden="true">▂ ▅ ▃ ▇ ▂ ▅</div><p>本問題的题目与选项仅在录音中出现。<br>请听原始音频，在下方答题卡中作答。</p></div>`:''}${bodies}${review&&g.transcript?`<details class="transcript"><summary>查看听力原文 · 問題 ${g.number}</summary><div class="transcript-text">${escape(g.transcript)}</div></details>`:''}</div>${renderCard(g,a)}</article><div class="block-footer"><button class="btn secondary" data-action="prev" ${sectionId==='r'&&index===0?'disabled':''}>← 上一个問題</button><span class="block-counter">${sectionId==='r'?'言語知識・読解':'聴解'} · ${index+1} / ${s.groups.length}</span><button class="btn" data-action="${(sectionId==='l'||exam.listeningOmitted)&&index===s.groups.length-1?(review?'show-result':'submit'):'next'}">${(sectionId==='l'||exam.listeningOmitted)&&index===s.groups.length-1?(review?'查看报告':'提交试卷'):'下一个問題'} →</button></div><details class="notes-box" ${a.notes[g.id]?'open':''}><summary>✎ 本問題的笔记${a.notes[g.id]?' · 已保存':''}</summary><label class="visually-hidden" for="notes">本問題的笔记</label><textarea id="notes" maxlength="20000" placeholder="写下思路、听力关键词，或复盘时想再看一眼的地方。">${escape(a.notes[g.id]||'')}</textarea></details>`;
  app.innerHTML=shell(a,content);
  if(sectionId==='l'){const slot=$('#audio-slot');slot.append(player);setAudioAttempt(a);ensureAudioLoaded();}else audio.pause();
}
function renderResults(a){
  view={type:'results',id:a.id,section:'r',index:0};audio.pause();
  const knowledgeGroupCount=exam.level==='N1'?7:9;
  const stats=[{name:'言語知識（文字・語彙・文法）',qs:allQuestions.filter(q=>q.id.startsWith('r-')&&exam.sections[0].groups.slice(0,knowledgeGroupCount).some(g=>g.questions.includes(q)))},{name:'読解',qs:allQuestions.filter(q=>q.id.startsWith('r-')&&exam.sections[0].groups.slice(knowledgeGroupCount).some(g=>g.questions.includes(q)))},{name:'聴解',qs:allQuestions.filter(q=>q.id.startsWith('l-'))}].filter(s=>s.qs.length);
  const content=`<section class="result-hero"><div><div class="eyebrow">PRACTICE COMPLETED</div><h1>おつかれさまでした。</h1><p>${examLabel(exam)} · ${date(a.submittedAt)}<br>已作答 ${answered(a)} 题 · 未作答 ${allQuestions.length-answered(a)} 题 · 总用时 ${duration(a.elapsed.r+a.elapsed.l)}</p></div><div class="score-number">${percent(grade(a),scoreTotal(a))}<span style="font-size:23px">%</span><small>原始正确率 · ${grade(a)} / ${scoreTotal(a)}</small></div></section><div class="score-grid">${stats.map(s=>`<div class="score-box"><p>${s.name}</p><strong>${grade(a,s.qs)} <span>/ ${scoreTotal(a,s.qs)} 题</span></strong><div class="progress-track"><i style="width:${percent(grade(a,s.qs),scoreTotal(a,s.qs))}%"></i></div></div>`).join('')}</div><p class="result-note">${allQuestions.length>scoreTotal(a)?`本卷有 ${allQuestions.length-scoreTotal(a)} 题因题源缺漏未计分；正确率按 ${scoreTotal(a)} 道计分题计算。`:""}此处统计答对题数与原始正确率。JLPT 正式成绩使用量尺分数，无法由单套试卷的答对题数直接换算；本报告不预测官方分数或合格结果。</p><div class="section-line"><div class="section-title">逐块复盘 <span>REVIEW BY QUESTION GROUP</span></div><button class="text-button" data-action="overview">查看整卷答题卡 ↗</button></div><table class="result-table"><thead><tr><th>部分 / 問題</th><th>答对</th><th>未答</th><th>复盘</th></tr></thead><tbody>${exam.sections.filter(s=>s.groups.length).map(s=>s.groups.map((g,i)=>`<tr><td>${s.shortTitle} · 問題 ${g.number} <span class="quiet">${g.title}</span></td><td>${grade(a,g.questions)} / ${scoreTotal(a,g.questions)}</td><td>${g.questions.length-answered(a,g.questions)}</td><td><button data-action="group" data-section="${s.id}" data-index="${i}">查看 →</button></td></tr>`).join('')).join('')}</tbody></table><div class="result-actions"><button class="btn" data-action="first-wrong">从错题开始复盘 →</button><button class="btn secondary" data-action="export-report">导出作答报告</button><button class="btn secondary" data-action="new">再做一次</button></div>`;
  app.innerHTML=shell(a,content);
}
async function route(){
  const version=++routeVersion;questionAudio.cancel();
  const m=location.hash.match(/^#(exam|results)\/([^/]+)(?:\/([rl])\/(\d+))?$/);
  if(!m)return home();
  const a=findAttempt(m[2]);if(!a)return setRoute('#home');
  try{const paper=await library.get(a.examId);if(version!==routeVersion)return;useExam(paper);}catch(error){if(version===routeVersion){home();toast(error.message);}return;}
  if(m[1]==='results'){if(a.status!=='submitted')return setRoute(`#exam/${a.id}/${a.position.section}/${a.position.group}`);renderResults(a);}
  else renderExam(a,m[3]||'r',Number(m[4]||0));
  window.scrollTo(0,0);
}
function syncAnswers(a,q){
  $$(`[data-question="${q.id}"]`).forEach(el=>{const chosen=Number(el.dataset.value)===a.answers[q.id];el.classList.toggle('selected',chosen);el.setAttribute('aria-pressed',String(chosen));});
  groups.forEach(g=>$$(`[data-count="${g.id}"]`).forEach(el=>el.textContent=`${answered(a,g.questions)}/${g.questions.length}`));
  $$('.total-count').forEach(el=>el.textContent=`${answered(a)} / ${allQuestions.length}`);$$('.total-progress').forEach(el=>el.style.width=percent(answered(a),allQuestions.length)+'%');
}
function goGroup(s,i){modal.close();setRoute(`#exam/${view.id}/${s}/${i}`);}
function scrollQuestion(id){requestAnimationFrame(()=>($('#q-'+id)||$(`.bubble[data-question="${id}"]`))?.scrollIntoView({block:'center'}));}
function move(direction){const s=exam.sections.find(s=>s.id===view.section);let i=view.index+direction,section=s.id;if(i<0){section='r';i=exam.sections[0].groups.length-1;}else if(i>=s.groups.length){section='l';i=0;}goGroup(section,i);}
function overview(){const a=findAttempt(view.id);if(!a)return;dialog(`<h2>整卷答题卡</h2><p>${a.status==='submitted'?'绿色为正确，红色为错误，浅黄色为未答。点击题号可跳至对应問題。':'绿色为已答。点击题号可跳至对应問題。'}⚑ 表示标记为稍后检查的小题。</p>${exam.sections.filter(s=>s.groups.length).map(s=>`<p>${s.shortTitle}</p><div class="jump-panel">${s.groups.map((g,i)=>g.questions.map(q=>`<button class="jump-number ${a.flags.includes(q.id)?'question-marked':''} ${a.answers[q.id]?'done':''} ${a.status==='submitted'&&isScored(q)?(a.answers[q.id]?(q.answer===a.answers[q.id]?'':'bad'):'empty-answer'):''}" data-action="jump" data-section="${s.id}" data-index="${i}" data-question-id="${q.id}" aria-label="${s.shortTitle} 第 ${q.label} 题${a.flags.includes(q.id)?'，已标记':''}">${q.label}${a.flags.includes(q.id)?'<span class="overview-flag" aria-hidden="true">⚑</span>':''}</button>`).join('')).join('')}</div>`).join('')}${modalButtons('<button class="btn secondary" data-action="close-modal">返回试卷</button>')}`);}
function submit(){const a=findAttempt(view.id);if(!a||a.status!=='active')return;const missing=scoreTotal(a)-scoredAnswered(a);dialog(`<h2>${missing?'还有题目没有作答':'完成了，准备交卷。'}</h2><p>计分题已作答 <b>${scoredAnswered(a)}</b> / ${scoreTotal(a)} 题${allQuestions.length>scoreTotal(a)?`（另有${allQuestions.length-scoreTotal(a)}题不计分）`:""}${missing?`，还有 <b>${missing}</b> 道未答。未答题将计入未作答，交卷后答案会锁定。`:'。交卷后将展示正确答案与分部分统计，并开放听力原文。'}</p><p>已标记稍后检查：${a.flags.length} 道小题。${missing?'可以返回继续，也可以直接交卷。':''}</p>${modalButtons(`<button class="btn secondary" data-action="close-modal">继续作答</button>${missing?'<button class="btn secondary" data-action="first-empty">前往未答题</button>':''}<button class="btn" data-action="confirm-submit">确认交卷 →</button>`)}`);}
const player=document.createElement('div');player.className='audio-panel';player.innerHTML=`<div class="audio-heading"><strong class="audio-title">◉ 聴解</strong><small class="audio-status" role="status">完整音轨 · 进度随作答保存</small></div><div class="audio-controls"><audio controls preload="none" aria-label="N2 听力考试录音"></audio><button class="audio-skip" data-audio="back" disabled>↶ 10 秒</button><button class="audio-skip" data-audio="forward" disabled>10 秒 ↷</button><select aria-label="听力播放速度"><option value="0.75">0.75 ×</option><option value="1">1.0 ×</option><option value="1.25">1.25 ×</option><option value="1.5">1.5 ×</option></select></div><div class="audio-file-row"><button type="button" data-audio="local-file">选择本机音频</button><span>被 IDM 等下载插件打断时，可直接选择本目录的 MP3。</span><button type="button" data-audio="retry" hidden>重试读取</button><input type="file" accept=".mp3,audio/mpeg" aria-label="选择听力 MP3 文件" hidden></div>`;
const audio=$('audio',player);let listeningSource=null,audioExamId=null,audioAttemptId=null,audioPendingTime=0,lastAudioSave=0,audioReplacing=false;
const questionAudio=new QuestionAudioPlayer(audio,ensureAudioLoaded);
function applyAudioURL(url){
  if(!url||audio.getAttribute('src')===url)return;
  const a=findAttempt(audioAttemptId);
  if(a&&audio.readyState>=1&&!audioReplacing){a.audioTime=audio.currentTime;audioPendingTime=a.audioTime;}
  audioReplacing=true;
  audio.pause();audio.src=url;audio.preload='auto';audio.load();
}
async function ensureAudioLoaded(){
  const source=listeningSource,requestedExamId=audioExamId;
  if(!source)return false;
  if(audio.getAttribute('src')===source.url&&source.url)return true;
  $('.audio-status',player).textContent='正在读取本地音频…';
  $('[data-audio="retry"]',player).hidden=true;
  try{
    const url=await source.load();
    if(source!==listeningSource||requestedExamId!==audioExamId)return false;
    if(view.type==='exam'&&view.section==='l'){applyAudioURL(url);return Boolean(url);}
    return false;
  }catch(error){if(source!==listeningSource)return false;$('.audio-status',player).textContent='读取失败，请重启服务或选择本机 MP3';$('[data-audio="retry"]',player).hidden=false;toast(error.message);return false;}
}
function setAudioAttempt(a){
  if(audioAttemptId===a.id)return;
  questionAudio.cancel();audio.pause();
  const changed=audioExamId!==a.examId;
  if(changed){
    audioAttemptId=null;audioReplacing=true;audio.removeAttribute('src');audio.load();listeningSource?.dispose();
    listeningSource=new ListeningSource({endpoint:exam.audioDataUrl});audioExamId=a.examId;
    $$('.audio-skip',player).forEach(button=>button.disabled=true);
  }
  audioAttemptId=a.id;audioPendingTime=a.audioTime||0;audio.playbackRate=a.audioRate||1;$('select',player).value=String(a.audioRate||1);
  $('.audio-title',player).textContent=`◉ 聴解 · ${examLabel(exam)}`;
  audio.setAttribute('aria-label',`${examLabel(exam)} 听力考试录音`);
  if(!changed&&audio.readyState>=1)audio.currentTime=Math.min(audio.duration||Infinity,audioPendingTime);
}
audio.addEventListener('loadedmetadata',()=>{audioReplacing=false;if(audioAttemptId){audio.currentTime=Math.min(audio.duration||Infinity,audioPendingTime);audio.playbackRate=findAttempt(audioAttemptId)?.audioRate||1;}$('.audio-status',player).textContent='音频已就绪 · 进度随作答保存';$$('.audio-skip',player).forEach(button=>button.disabled=false);});
audio.addEventListener('timeupdate',()=>{const a=findAttempt(audioAttemptId);if(a&&audio.readyState>=1&&!audioReplacing){a.audioTime=audio.currentTime;if(Date.now()-lastAudioSave>5000){persist();lastAudioSave=Date.now();}}});
audio.addEventListener('pause',()=>{const a=findAttempt(audioAttemptId);if(a&&audio.readyState>=1&&!audioReplacing){a.audioTime=audio.currentTime;persist();}});
audio.addEventListener('error',()=>{$('.audio-status',player).textContent='音频无法播放，请重新选择 MP3';toast('听力文件无法播放，请点击“选择本机音频”，选择对应的 MP3。');});
player.addEventListener('click',e=>{const action=e.target.closest('[data-audio]')?.dataset.audio;if(action==='local-file')$('input[type="file"]',player).click();else if(action==='retry')ensureAudioLoaded();else if((action==='back'||action==='forward')&&audio.readyState>=1)audio.currentTime=Math.max(0,Math.min(audio.duration||Infinity,audio.currentTime+(action==='back'?-10:10)));});
$('input[type="file"]',player).addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;try{questionAudio.cancel();applyAudioURL(listeningSource.useFile(file));$('[data-audio="retry"]',player).hidden=true;toast('已选择本机音频，将从已保存的位置继续');}catch(error){toast(error.message);}e.target.value='';});
$('select',player).addEventListener('change',e=>{audio.playbackRate=Number(e.target.value);const a=findAttempt(audioAttemptId);if(a){a.audioRate=audio.playbackRate;persist();}});
function download(filename,content,type='application/json'){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportState(){download(`Puuka JLPT Dojo-进度备份-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2));toast('已导出全部作答进度');}
function exportReport(a){const lines=[`Puuka JLPT Dojo · ${examLabel(exam)} 作答报告`,`交卷时间：${date(a.submittedAt)}`,`答对 ${grade(a)}/${scoreTotal(a)}，正确率 ${percent(grade(a),scoreTotal(a))}%，总用时 ${duration(a.elapsed.r+a.elapsed.l)}`,`统计为原始正确率，不代表 JLPT 官方量尺分数。`];for(const s of exam.sections){lines.push('\n'+s.title);for(const g of s.groups){lines.push(`\n問題 ${g.number} · ${g.title}`);for(const q of g.questions)lines.push(`${q.label}：作答 ${a.answers[q.id]||'未答'} / 正确 ${q.answer} ${!isScored(q)?'资料缺漏，未计分（答案仅供参考）':a.answers[q.id]===q.answer?'✓':'×'}`);if(a.notes[g.id])lines.push('笔记：'+a.notes[g.id]);}}download(`${exam.year}-${String(exam.month).padStart(2,'0')}-${exam.level}-作答报告.txt`,lines.join('\n'),'text/plain;charset=utf-8');}
function settings(){dialog(`<h2>设置与备份</h2><div class="modal-option"><div><strong>程序更新</strong><p>从程序仓库获取最新程序；题库在首页单独下载</p><label class="auto-update-label"><input type="checkbox" id="auto-update-check" ${localStorage.getItem('puuka-jlpt.autoUpdate')!=='off'?'checked':''}> 启动时自动检查更新</label></div><button class="btn secondary" data-action="check-update">检查更新</button></div><p>自动保存位置：项目目录的 data/progress.json，同时保留一份浏览器备份。更换浏览器或迁移电脑时，建议先导出。</p><div class="modal-option"><div><strong>进度备份</strong><p>包含全部答案、记录、笔记与音频位置</p></div><button class="btn secondary" data-action="export">导出备份</button></div><div class="modal-option"><div><strong>恢复进度</strong><p>从 Puuka JLPT Dojo 导出的 JSON 备份恢复</p></div><button class="btn secondary" data-action="import">导入备份</button></div>${state.attempts.some(a=>a.status==='active'&&a.id!==state.activeId)?`<div class="modal-option"><div><strong>未交卷的练习</strong><p>恢复之前保留的作答</p></div><select id="resume-select" aria-label="恢复未交卷练习"><option value="">选择一次练习</option>${state.attempts.filter(a=>a.status==='active').map(a=>`<option value="${escape(a.id)}">${attemptLabel(a)} · ${date(a.startedAt)} · ${answered(a)} 题</option>`).join('')}</select></div>`:''}<div class="modal-option"><div><strong>清理作答记录</strong><p>删除答案与历史记录，保留试题资料</p></div><button class="text-button" style="color:var(--danger)" data-action="clear-data">清理</button></div>${modalButtons('<button class="btn" data-action="close-modal">完成</button>')}`);}
async function importState(){const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{const file=input.files?.[0];if(!file)return;if(file.size>5e6)return toast('备份文件过大');try{const incoming=JSON.parse(await file.text());await library.preloadProgress(incoming);if(!validImport(incoming))throw new Error();window.pendingImport=incoming;dialog(`<h2>恢复这份备份？</h2><p>备份包含 ${incoming.attempts.length} 次练习。恢复后会替换当前记录，请先导出当前进度以备需要。</p>${modalButtons('<button class="btn secondary" data-action="export">先导出当前进度</button><button class="btn secondary" data-action="close-modal">取消</button><button class="btn" data-action="confirm-import">确认恢复</button>')}`);}catch{toast('无法读取：请选择有效的 Puuka JLPT Dojo 进度备份');}};input.click();}
document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-action]');if(!el||el.disabled)return;const action=el.dataset.action,a=findAttempt(view.id);
 if(action==='home'){audio.pause();await flush();setRoute('#home');}
 else if(action==='history'){if(view.type!=='home')setRoute('#home');setTimeout(()=>$('#history')?.scrollIntoView({behavior:'smooth'}),40);}
 else if(action==='settings')settings();
 else if(action==='refresh-library')await refreshRemoteCatalog(true);
 else if(action==='download-exam')await downloadBanks([el.dataset.exam]);
 else if(action==='download-selected')await downloadBanks([...selectedExams]);
 else if(action==='select-visible'){for(const box of $$('[data-bank-select]'))selectedExams.add(box.dataset.bankSelect);home();}
 else if(action==='clear-selection'){selectedExams.clear();home();}
 else if(action==='remove-exam'){dialog(`<h2>移除本机试卷？</h2><p>${examLabel(library.metadata(el.dataset.exam))} 的试卷和音频将从本机移除。作答记录和笔记保留，以后可重新下载。</p>${modalButtons(`<button class="btn secondary" data-action="close-modal">取消</button><button class="btn danger" data-action="confirm-remove-exam" data-exam="${el.dataset.exam}">移除文件</button>`)}`);}
 else if(action==='confirm-remove-exam'){try{await maintenanceRequest('/api/library/remove',JSON.stringify({id:el.dataset.exam}));resetBankCache();await refreshLibrary();modal.close();toast('本机试卷已移除，作答记录已保留');}catch(error){toast(error.message);}}
 else if(action==='check-update')checkProgramUpdate();
 else if(action==='apply-update')applyProgramUpdate();
 else if(action==='new')await confirmNew(el.dataset.exam);else if(action==='start-new')await startNew(el.dataset.exam);
 else if(action==='filter-level'){libraryFilters.level=el.dataset.level;home();}
 else if(action==='continue'){const a=findAttempt(el.dataset.id)||active();if(a){state.activeId=a.id;persist();}if(a)setRoute(`#exam/${a.id}/${a.position.section}/${a.position.group}`);}
 else if(action==='delete-attempt'){
   const target=findAttempt(el.dataset.id);if(!target)return;
   dialog(`<h2>删除这次作答记录？</h2><p>${escape(attemptLabel(target))} · ${target.status==='active'?'进行中':'已交卷'}</p><p>开始于 ${date(target.startedAt)}。将删除本次练习的答案、笔记和用时，不会删除试卷或其他记录。此操作无法撤销。</p>${modalButtons(`<button class="btn secondary" data-action="close-modal">取消</button><button class="btn danger" data-action="confirm-delete-attempt" data-id="${escape(target.id)}">删除这次记录</button>`)}`);
 }
 else if(action==='confirm-delete-attempt'){el.disabled=true;await deleteAttempt(el.dataset.id);}
 else if(action==='close-modal'){modal.close();window.pendingImport=null;}
 else if(action==='answer'&&a&&a.status==='active'){const q=allQuestions.find(q=>q.id===el.dataset.question);const n=Number(el.dataset.value);if(!q||n>q.optionCount)return;if(a.answers[q.id]===n)delete a.answers[q.id];else a.answers[q.id]=n;syncAnswers(a,q);persist();}
 else if(action==='play-question'&&a?.status==='submitted'){
   const q=allQuestions.find(q=>q.id===el.dataset.question);if(!q||!Number.isFinite(q.audioStart))return;
   el.disabled=true;el.setAttribute('aria-busy','true');
   try{if(await questionAudio.play(q.audioStart)){a.audioTime=audio.currentTime;persist();toast(`已跳转至第 ${q.label} 题 · ${audioTimestamp(q.audioStart)}`);}}
   catch(error){toast(error.name==='NotAllowedError'?'已定位到本题，请点击上方播放器的播放按钮。':error.message);}
   finally{el.disabled=false;el.removeAttribute('aria-busy');}
 }
 else if(action==='group')goGroup(el.dataset.section,Number(el.dataset.index));
 else if(action==='section')goGroup(el.dataset.section,0);
 else if(action==='prev')move(-1);else if(action==='next')move(1);
 else if(action==='flag-question'&&a){
   const q=allQuestions.find(q=>q.id===el.dataset.question);if(!q)return;
   a.flags=questionFlags(a.flags,exam);if(a.flags.includes(q.id))a.flags=a.flags.filter(id=>id!==q.id);else a.flags.push(q.id);
   const marked=a.flags.includes(q.id);
   for(const button of $$('[data-action="flag-question"]'))if(button.dataset.question===q.id){button.classList.toggle('flagged',marked);button.setAttribute('aria-pressed',String(marked));const label=marked?`取消第 ${q.label} 题的检查标记`:`标记第 ${q.label} 题稍后检查`;button.setAttribute('aria-label',label);button.title=label;}
   document.getElementById('q-'+q.id)?.classList.toggle('question-marked',marked);
   for(const row of $$('[data-flag-row]'))if(row.dataset.flagRow===q.id)row.classList.toggle('has-flag',marked);
   for(const icon of $$('[data-flag-group]')){const g=groups.find(g=>g.id===icon.dataset.flagGroup),count=g?.questions.filter(q=>a.flags.includes(q.id)).length||0;icon.textContent=count?'⚑'+count:'';}
   persist();
 }
 else if(action==='overview')overview();
 else if(action==='jump'){goGroup(el.dataset.section,Number(el.dataset.index));scrollQuestion(el.dataset.questionId);}
 else if(action==='save-exit'){audio.pause();const ok=await flush();setRoute('#home');toast(ok?'进度已保存，下次可以继续':'浏览器已保留进度，本地文件保存失败；请导出备份');}
 else if(action==='submit')submit();
 else if(action==='confirm-submit'&&a){a.status='submitted';a.submittedAt=new Date().toISOString();audio.pause();await persist(true);modal.close();setRoute(`#results/${a.id}`);}
 else if(['first-empty','first-wrong'].includes(action)&&a){const q=allQuestions.find(q=>isScored(q)&&(action==='first-empty'?!a.answers[q.id]:a.answers[q.id]!==q.answer));if(!q){toast('全部回答正确，做得不错！');return;}const s=exam.sections.find(s=>s.groups.some(g=>g.questions.includes(q))),i=s.groups.findIndex(g=>g.questions.includes(q));goGroup(s.id,i);scrollQuestion(q.id);}
 else if(action==='show-result'&&a)setRoute(`#results/${a.id}`);else if(action==='result')setRoute(`#results/${el.dataset.id}`);
 else if(action==='export')exportState();else if(action==='import')importState();
 else if(action==='confirm-import'&&window.pendingImport){audio.pause();audioAttemptId=null;state=window.pendingImport;window.pendingImport=null;migrateFlags();await persist(true);modal.close();setRoute('#home');toast('进度已恢复');}
 else if(action==='export-report'&&a)exportReport(a);
 else if(action==='clear-data')dialog(`<h2>清理全部作答记录？</h2><p>将删除 ${state.attempts.length} 次练习的答案、笔记与记录。此操作无法撤销。需要保留时，请先导出进度。</p>${modalButtons('<button class="btn secondary" data-action="export">先导出备份</button><button class="btn secondary" data-action="close-modal">取消</button><button class="btn danger" data-action="confirm-clear">确认清理</button>')}`);
 else if(action==='confirm-clear'){audio.pause();audioAttemptId=null;state={version:1,activeId:null,attempts:[],updatedAt:Date.now()};await persist(true);modal.close();setRoute('#home');toast('作答记录已清理');}
 else if(action==='font-up'||action==='font-down'){fontSize=Math.max(15,Math.min(22,fontSize+(action==='font-up'?1:-1)));localStorage.setItem('puuka-jlpt.fontSize',String(fontSize));$$('.question-content').forEach(el=>el.style.fontSize=fontSize+'px');}
});
document.addEventListener('input',e=>{if(e.target.id==='notes'){const a=findAttempt(view.id),g=exam.sections.find(s=>s.id===view.section).groups[view.index];a.notes[g.id]=e.target.value;persist();}});
document.addEventListener('change',e=>{if(e.target.dataset.bankSelect){if(e.target.checked)selectedExams.add(e.target.dataset.bankSelect);else selectedExams.delete(e.target.dataset.bankSelect);home();return;}if(e.target.id==='library-local'){libraryFilters.local=e.target.value;home();return;}if(e.target.id==='auto-update-check'){localStorage.setItem('puuka-jlpt.autoUpdate',e.target.checked?'on':'off');}else if(e.target.id==='library-year'){libraryFilters.year=e.target.value;home();}else if(e.target.id==='group-select'){const [s,i]=e.target.value.split(':');goGroup(s,Number(i));}else if(e.target.id==='resume-select'&&e.target.value){state.activeId=e.target.value;persist(true);modal.close();const a=active();setRoute(`#exam/${a.id}/${a.position.section}/${a.position.group}`);}});
modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();}});
window.addEventListener('hashchange',route);
window.addEventListener('pagehide',()=>{if(stateReady){saveLocal();navigator.sendBeacon('/api/state',new Blob([JSON.stringify(state)],{type:'application/json'}));}});
let lastTick=Date.now();setInterval(()=>{const now=Date.now(),delta=Math.min(3,(now-lastTick)/1000);lastTick=now;const a=findAttempt(view.id);if(view.type==='exam'&&a?.status==='active'&&!modal.open){a.elapsed[view.section]+=delta;const timer=$('#timer-value');if(timer)timer.textContent=duration(a.elapsed[view.section]);if(Math.floor(a.elapsed.r+a.elapsed.l)%10===0)persist();}},1000);
async function maintenanceRequest(url,body='{}',type='application/json'){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':type,'X-Puuka-Request':'1'},body});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'操作失败');return result;
}
async function refreshLibrary(){
  await library.refreshRemote();libraryIssues=(await (await fetch('/api/library-status')).json()).issues||[];
  await library.preloadProgress(state);if(migrateFlags())persist(true);if(view.type==='home')home();
}

function resetBankCache(){questionAudio.cancel();audio.pause();audioAttemptId=null;audioExamId=null;listeningSource?.dispose();listeningSource=null;audio.removeAttribute('src');library.cache.clear();}
async function refreshRemoteCatalog(notify){
 if(libraryWorking){if(notify)toast('题库操作正在进行');return;}
 libraryWorking=true;
 try{await maintenanceRequest('/api/library/refresh');libraryNotice='';await refreshLibrary();if(notify)toast('远端题库目录已刷新');}
 catch(error){libraryNotice=error.message+'；当前显示缓存目录，已下载的试卷仍可使用。';if(view.type==='home')home();if(notify)toast(error.message);}
 finally{libraryWorking=false;}
}
async function downloadBanks(ids){
 if(libraryWorking){toast('题库操作正在进行，请稍候');return;}
 if(!ids.length)return;libraryWorking=true;
 dialog('<h2>正在下载题库</h2><p id="bank-download-progress" role="status">正在连接题库仓库，请保持服务窗口打开。</p><p>仅下载所选试卷；已完成的试卷在中断后仍会保留。</p>');
 let polling=false;
 const poll=setInterval(async()=>{if(polling)return;polling=true;try{const r=await fetch('/api/library/download-status',{cache:'no-store'}),p=await r.json(),el=$('#bank-download-progress');if(el&&p.running)el.textContent=`${p.current||''} · ${p.file||''} · ${sizeLabel(p.downloadedBytes)} / ${sizeLabel(p.totalBytes)} · 已完成 ${p.completed.length} / ${ids.length} 套`;}catch{}finally{polling=false;}},600);
 try{await flush();const result=await maintenanceRequest('/api/library/download',JSON.stringify({ids}));for(const id of result.completed)selectedExams.delete(id);resetBankCache();await refreshLibrary();dialog(`<h2>下载完成</h2><p>${result.completed.length} 套试卷已可离线作答，无需重启网站。</p>${modalButtons('<button class="btn" data-action="close-modal">完成</button>')}`);}
 catch(error){try{const p=await (await fetch('/api/library/download-status')).json();for(const id of p.completed||[])selectedExams.delete(id);}catch{}resetBankCache();await refreshLibrary();dialog(`<h2>下载未全部完成</h2><p>${escape(error.message)}</p><p>已完成的试卷已保留，可稍后重新选择未完成的试卷下载。</p>${modalButtons('<button class="btn" data-action="close-modal">关闭</button>')}`);}
 finally{clearInterval(poll);libraryWorking=false;}
}

async function checkProgramUpdate(){
  dialog('<h2>正在检查更新</h2><p role="status">正在连接浙大 GitLab，请稍候。</p>');
  try{
    const info=await maintenanceRequest('/api/update/check');
    dialog(`<h2>${info.available?'有可用更新':'已经是最新版本'}</h2><p>最新版本 ${escape(info.latest.slice(0,7))}${info.message?' · '+escape(info.message):''}</p>${info.available?'<p>更新只下载程序的变化文件，保留已下载试卷和个人作答记录。更新完成后需要关闭服务窗口，再运行「启动网站.cmd」。</p>':''}${modalButtons(`${info.available?'<button class="btn" data-action="apply-update">下载并更新</button>':''}<button class="btn secondary" data-action="close-modal">关闭</button>`)}`);
  }catch(error){dialog(`<h2>暂时无法检查更新</h2><p>${escape(error.message)}</p>${modalButtons('<button class="btn" data-action="close-modal">关闭</button>')}`);}
}
async function applyProgramUpdate(){
  audio.pause();if(!await flush())return toast('请先导出进度备份，再更新程序');
  dialog('<h2>正在更新程序</h2><p role="status">下载与更新可能需要几分钟，请保持服务窗口和页面打开。</p>');
  try{const result=await maintenanceRequest('/api/update/apply');dialog(`<h2>${result.updated?'更新完成，请重启':'已经是最新版本'}</h2><p>${result.updated?'关闭网站的服务窗口，重新运行「启动网站.cmd」，然后按 Ctrl+F5 刷新页面。':'无需更新。'}</p>${modalButtons('<button class="btn" data-action="close-modal">知道了</button>')}`);}
  catch(error){dialog(`<h2>更新未完成</h2><p>${escape(error.message)}</p><p>可以稍后重试，或关闭服务后双击「更新网站.cmd」。</p>${modalButtons('<button class="btn" data-action="close-modal">关闭</button>')}`);}
}
connection=new ServiceConnection({
  isVisible:()=>document.visibilityState==='visible',
  onChange(connected,previous){
    $('#connection-banner').hidden=connected;$('#modal-connection-notice').hidden=connected;
    if(!connected){
      if(stateReady)saveLocal();
      updateSaveLabel('服务已断开',true);
    }else if(previous===false){
      toast('已重新连接本机服务');
      if(stateReady&&!saved)flush();
      else updateSaveLabel(saved?'已保存到本地':'正在保存…');
    }
  }
});
$('#connection-retry').addEventListener('click',()=>connection.check(true));
for(const event of ['pointerdown','keydown','input'])document.addEventListener(event,()=>connection.check(),{passive:true});
window.addEventListener('focus',()=>connection.check(true));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')connection.check(true);});
window.addEventListener('pagehide',()=>connection.stop());
window.addEventListener('pageshow',()=>connection.start());
connection.start();
init();
