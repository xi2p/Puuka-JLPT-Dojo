// Expand legacy group flags once; current flags use stable individual question IDs.
export function questionFlags(flags,paper){
  if(!paper)return [...flags];
  const groups=new Map(paper.sections.flatMap(s=>s.groups).map(g=>[g.id,g.questions.map(q=>q.id)]));
  return [...new Set(flags.flatMap(flag=>groups.get(flag)||[flag]))];
}
