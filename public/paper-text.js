const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function paperText(text,{wordOrder=false}={}){
 let html=escape(text).replace(/&lt;(\/?)(u|b|br)&gt;/g,'<$1$2>');
 if(wordOrder)html=html.replace(/＿{2,}|_{2,}|★/g,slot=>`<span class="word-order-slot${slot==='★'?' is-target':''}">${slot==='★'?'★':'&#160;<span class="visually-hidden">空欄</span>'}</span>`);
 return html;
}
export const choiceLayout=q=>[1,2,4].includes(q.choiceColumns)?` source-columns-${q.choiceColumns}`:'';
