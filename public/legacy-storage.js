// Old keys are read only to migrate existing users' answers after the rename.
// Keep these two historical spellings until all old installations have migrated.
export const STORAGE='puuka-jlpt.practice.v1';
const oldKeys=['jlpt-local.practice.v1','kotoba.jlpt.v1'];
export function browserSnapshots(){return [STORAGE,...oldKeys].flatMap(key=>{try{const value=JSON.parse(localStorage.getItem(key));return value?[value]:[];}catch{return [];}});}
export function finishMigration(state){try{localStorage.setItem(STORAGE,JSON.stringify(state));for(const key of oldKeys)localStorage.removeItem(key);}catch{/* Retain all old backups if writing fails. */}}
export function readFontSize(){const value=localStorage.getItem('puuka-jlpt.fontSize')||localStorage.getItem('jlpt-local.fontSize')||localStorage.getItem('kotoba.fontSize')||17;return Math.max(15,Math.min(22,Number(value)||17));}
