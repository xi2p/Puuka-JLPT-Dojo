export const questionsOf=exam=>exam?.sections.flatMap(s=>s.groups.flatMap(g=>g.questions))||[];
export const isScored=q=>q.excludeFromScoring!==true;
export function scoreAnswers(attempt,questions){const scored=questions.filter(isScored);return {total:scored.length,correct:scored.filter(q=>attempt.answers[q.id]===q.answer).length,answered:scored.filter(q=>attempt.answers[q.id]).length};}
export class ExamLibrary {
  constructor(fetchJSON=(...args)=>fetch(...args)){this.fetch=fetchJSON;this.catalog=[];this.cache=new Map();this.loading=new Map();}
  async refresh(){const response=await this.fetch('/api/exams',{cache:'no-store'});if(!response.ok)throw new Error('无法读取试卷库，请重启本地服务。');this.catalog=await response.json();return this.catalog;}
  async refreshRemote(){const response=await this.fetch('/api/library/catalog',{cache:'no-store'});if(!response.ok)throw new Error('无法读取题库目录');const data=await response.json();this.catalog=data.exams;return this.catalog;}
  metadata(id){return this.catalog.find(exam=>exam.id===id);}
  async get(id){
    if(this.cache.has(id))return this.cache.get(id);
    if(!this.metadata(id)||this.metadata(id).installed===false)throw new Error('这份试卷暂不可用，请检查 exams 目录。');
    if(this.loading.has(id))return this.loading.get(id);
    const request=(async()=>{try{const response=await this.fetch(`/api/exams/${encodeURIComponent(id)}`,{cache:'no-store'});if(!response.ok)throw new Error('试卷内容读取失败');const exam=await response.json();this.cache.set(id,exam);return exam;}finally{this.loading.delete(id);}})();
    this.loading.set(id,request);return request;
  }
  async preloadProgress(state){if(!Array.isArray(state?.attempts))return;await Promise.all([...new Set(state.attempts.map(a=>a?.examId))].filter(id=>this.metadata(id)&&this.metadata(id).installed!==false).map(id=>this.get(id)));}
  questions(id){return questionsOf(this.cache.get(id));}
}
export function validProgress(state,library){
  return state&&state.version===1&&Array.isArray(state.attempts)&&state.attempts.length<=100&&
    (state.activeId===null||typeof state.activeId==='string')&&new Set(state.attempts.map(a=>a?.id)).size===state.attempts.length&&
    state.attempts.every(a=>{
      if(!a||typeof a.id!=='string'||typeof a.examId!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.examId))return false;
      const exam=library.cache.get(a.examId),questions=questionsOf(exam),groups=exam?.sections.flatMap(s=>s.groups);
      return ['active','submitted'].includes(a.status)&&a.answers&&typeof a.answers==='object'&&!Array.isArray(a.answers)&&
        Object.entries(a.answers).every(([id,value])=>{const q=questions.find(q=>q.id===id);return /^(r-\d{1,3}|l-\d{1,2}-[\d-]+)$/.test(id)&&Number.isInteger(value)&&value>=1&&value<=(q?.optionCount||4)&&(!exam||Boolean(q));})&&
        a.notes&&typeof a.notes==='object'&&!Array.isArray(a.notes)&&Object.values(a.notes).every(n=>typeof n==='string'&&n.length<=20000)&&
        a.elapsed&&['r','l'].every(k=>Number.isFinite(a.elapsed[k])&&a.elapsed[k]>=0)&&
        a.position&&['r','l'].includes(a.position.section)&&Number.isInteger(a.position.group)&&a.position.group>=0&&(!exam||a.position.group<exam.sections.find(s=>s.id===a.position.section)?.groups.length)&&
        Array.isArray(a.flags)&&a.flags.every(flag=>typeof flag==='string'&&(!groups||groups.some(g=>g.id===flag||g.questions.some(q=>q.id===flag))))&&
        Number.isFinite(a.audioTime)&&a.audioTime>=0&&Number.isFinite(a.audioRate)&&a.audioRate>=.5&&a.audioRate<=2&&typeof a.startedAt==='string';
    });
}
