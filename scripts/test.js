const {readdirSync}=require('node:fs');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const tests=readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.test.js')).map(f=>path.join(root,'tests',f));
const result=spawnSync(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
