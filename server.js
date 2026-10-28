const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {listExams,readExam,audioFile,publicExamFile,scan}=require('./exam-store.js');
const {checkUpdate,update}=require('./updater.js');
const ROOT = __dirname;
const {createLibraryManager}=require('./scripts/library-manager.js');
const libraryManager=createLibraryManager(ROOT,path.resolve(ROOT,process.env.JLPT_EXAMS_DIR||'exams'));
const PUBLIC = path.join(ROOT, 'public');
const STATE = path.resolve(ROOT, process.env.JLPT_STATE_FILE || 'data/progress.json');
const PORT = Number(process.env.JLPT_PORT || 3300);
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.mp3':'audio/mpeg', '.pdf':'application/pdf', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.doc':'application/msword' };
let writes = Promise.resolve();
let maintenanceBusy=false;
function json(res, status, value) { res.writeHead(status, {'Content-Type': MIME['.json'], 'Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
function validState(state) {
  const exams=new Map();
  const getExam=id=>{if(exams.has(id))return exams.get(id);let value;try{value=readExam(id);}catch(error){if(error.status!==404)return null;}exams.set(id,value);return value;};
  return state && state.version === 1 && Array.isArray(state.attempts) && state.attempts.length <= 100 &&
    (state.activeId === null || typeof state.activeId === 'string') &&
    new Set(state.attempts.map(a=>a?.id)).size===state.attempts.length&&
    state.attempts.every(a => a && typeof a.id === 'string' && typeof a.examId==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.examId)&&
      ['active','submitted'].includes(a.status) && a.answers && typeof a.answers === 'object' && !Array.isArray(a.answers) &&
      Object.entries(a.answers).every(([k,v]) => {const exam=getExam(a.examId);const q=exam?.sections.flatMap(s=>s.groups.flatMap(g=>g.questions)).find(q=>q.id===k);return /^(r-\d{1,3}|l-\d{1,2}-[\d-]+)$/.test(k)&&Number.isInteger(v)&&v>=1&&v<=(q?.optionCount||4)&&(!exam||Boolean(q));}) &&
      a.notes && typeof a.notes === 'object'&&!Array.isArray(a.notes) && Object.values(a.notes).every(v => typeof v === 'string' && v.length <= 20000)&&
      a.elapsed&&['r','l'].every(key=>Number.isFinite(a.elapsed[key])&&a.elapsed[key]>=0)&&
      a.position&&['r','l'].includes(a.position.section)&&Number.isInteger(a.position.group)&&a.position.group>=0&&
      (!getExam(a.examId)||a.position.group<getExam(a.examId).sections.find(s=>s.id===a.position.section)?.groups.length)&&
      Array.isArray(a.flags)&&a.flags.every(flag=>typeof flag==='string'&&(!getExam(a.examId)||getExam(a.examId).sections.some(section=>section.groups.some(group=>group.id===flag||group.questions.some(q=>q.id===flag)))))&&Number.isFinite(a.audioTime)&&a.audioTime>=0&&
      Number.isFinite(a.audioRate)&&a.audioRate>=.5&&a.audioRate<=2&&typeof a.startedAt==='string');
}
async function serveFile(req, res, file) {
  let stat; try { stat = await fsp.stat(file); } catch { return json(res,404,{error:'文件不存在'}); }
  const headers = {'Content-Type':MIME[path.extname(file)] || 'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
  let start = 0, end = stat.size - 1, status = 200;
  if (req.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!range || (!range[1] && !range[2])) { res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}); return res.end(); }
    if (!range[1]) start = Math.max(0, stat.size - Number(range[2]));
    else { start = Number(range[1]); if (range[2]) end = Math.min(end,Number(range[2])); }
    if (start > end || start >= stat.size) { res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}); return res.end(); }
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`; status = 206;
  }
  headers['Content-Length'] = end-start+1;
  res.writeHead(status,headers);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file,{start,end}); stream.pipe(res); res.on('close',()=>stream.destroy());
}
const server = http.createServer(async (req,res) => {
  try {
    const host = req.headers.host || '';
    if (!['127.0.0.1','localhost'].includes(host.split(':')[0])) return json(res,403,{error:'仅允许本机访问'});
    const url = new URL(req.url, `http://${host}`);
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if(url.pathname==='/api/health')return json(res,200,{app:'puuka-jlpt-dojo'});
    if(url.pathname==='/api/library-status'&&req.method==='GET')return json(res,200,{issues:scan(true).issues});
    if(url.pathname==='/api/library/catalog'&&req.method==='GET')return json(res,200,await libraryManager.catalog());
    if(url.pathname==='/api/library/download-status'&&req.method==='GET')return json(res,200,libraryManager.status());
    if(['/api/library/refresh','/api/library/download','/api/library/remove'].includes(url.pathname)){
      if(req.method!=='POST')return json(res,405,{error:'需要POST请求'});
      if(req.headers['x-puuka-request']!=='1'||(req.headers.origin&&req.headers.origin!==`http://${host}`))return json(res,403,{error:'请从本机网站执行此操作'});
      if(maintenanceBusy||libraryManager.isBusy())return json(res,409,{error:'正在处理更新或题库，请稍候'});
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>50000)return json(res,413,{error:'请求过大'});}
      let input;try{input=JSON.parse(body||'{}');}catch{return json(res,400,{error:'无效JSON'});}
      try{const result=url.pathname.endsWith('/refresh')?await libraryManager.refresh():url.pathname.endsWith('/download')?await libraryManager.download(input.ids):await libraryManager.remove(input.id);scan(true);return json(res,200,result);}catch(e){scan(true);return json(res,400,{error:e.message,completed:libraryManager.status().completed});}
    }
    if(['/api/update/check','/api/update/apply'].includes(url.pathname)){
      if(req.method!=='POST')return json(res,405,{error:'需要POST请求'});
      if(req.headers['x-puuka-request']!=='1'||(req.headers.origin&&req.headers.origin!==`http://${host}`))return json(res,403,{error:'请从本机网站执行此操作'});
      if(maintenanceBusy||libraryManager.isBusy())return json(res,409,{error:'正在更新，请稍后再试'});
      maintenanceBusy=true;
      try{
        const result=url.pathname.endsWith('/check')?await checkUpdate(ROOT):await update(ROOT);scan(true);return json(res,200,result);
      }catch(e){return json(res,400,{error:e.message});}
      finally{maintenanceBusy=false;}
    }
    if (url.pathname === '/api/state') {
      if (req.method === 'GET') {
        try { return json(res,200,JSON.parse(await fsp.readFile(STATE,'utf8'))); }
        catch(e) { if(e.code === 'ENOENT') return json(res,200,{version:1,activeId:null,attempts:[]}); throw e; }
      }
      if (req.method !== 'POST') return json(res,405,{error:'Method not allowed'});
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res,403,{error:'来源不匹配'});
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res,415,{error:'需要 JSON'});
      let body = ''; for await (const chunk of req) { body += chunk; if(Buffer.byteLength(body)>5e6) return json(res,413,{error:'进度文件过大'}); }
      let state; try { state = JSON.parse(body); } catch { return json(res,400,{error:'无效 JSON'}); }
      if (!validState(state)) return json(res,400,{error:'进度格式不正确'});
      const operation = writes.catch(()=>{}).then(async()=>{
        await fsp.mkdir(path.dirname(STATE),{recursive:true});
        await fsp.writeFile(STATE+'.tmp',JSON.stringify(state,null,2),'utf8');
        await fsp.rename(STATE+'.tmp',STATE);
      }); writes = operation; await operation;
      return json(res,200,{ok:true,savedAt:new Date().toISOString()});
    }
    if (!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'Method not allowed'});
    if(url.pathname==='/api/exams')return json(res,200,listExams());
    const examAPI=url.pathname.match(/^\/api\/exams\/([a-z0-9-]+)(\/audio-data)?$/);
    if(examAPI){
      if(!examAPI[2])return json(res,200,readExam(examAPI[1]));
      const file=audioFile(examAPI[1]);
      if(req.method==='HEAD'){res.writeHead(200,{'Content-Type':MIME['.json'],'Cache-Control':'no-store'});return res.end();}
      const bytes=await fsp.readFile(file);return json(res,200,{base64:bytes.toString('base64')});
    }
    const examAsset=url.pathname.match(/^\/exams\/([a-z0-9-]+)\/(.+)$/);
    if(examAsset)return serveFile(req,res,publicExamFile(examAsset[1],decodeURIComponent(examAsset[2])));
    // Transfer ordinary JSON instead of a downloadable media response, then let
    // the browser create one local Blob for playback and seeking.
    if(url.pathname === '/api/listening-data') {
      if(req.method === 'HEAD'){res.writeHead(200,{'Content-Type':MIME['.json'],'Cache-Control':'no-store'});return res.end();}
      const bytes=await fsp.readFile(audioFile('n2-2016-12'));
      return json(res,200,{base64:bytes.toString('base64')});
    }
    if(url.pathname === '/media/listening.mp3') return serveFile(req,res,audioFile('n2-2016-12'));
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(PUBLIC,'.'+relative);
    if(!file.startsWith(PUBLIC+path.sep)) return json(res,403,{error:'禁止访问'});
    return serveFile(req,res,file);
  } catch(e) { console.error(e.message); if(!res.headersSent) json(res,e.status||500,{error:e.status?e.message:'本地服务发生错误'}); else res.end(); }
});
if(require.main === module) {
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`端口 ${PORT} 已被占用。若网站已运行，请直接打开 http://127.0.0.1:${PORT}；否则按 README 的说明更换端口。`:error.message);process.exitCode=1;});
  server.listen(PORT,'127.0.0.1',()=>console.log(`\n  Puuka JLPT Dojo\n  http://127.0.0.1:${PORT}\n  仅本机可访问。关闭此窗口即停止服务。\n`));
}
module.exports = {server,validState};
