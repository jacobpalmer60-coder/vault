'use strict';
/* Research-only draft slot identification.
 * A draft's first round must have 8–16 unique ordered selections.
 * For subsequent rounds, use rank of selection's overall pick number within
 * that round. Only accept rounds whose selection count matches round one.
 * This makes no assertion that an archive draft is rookie-only.
 */
function slotsForDraft(selections){
 if(!Array.isArray(selections))return {slots:[],reason:'invalid'};
 const rounds=new Map();
 for(const s of selections){
  if(!Array.isArray(s))continue;
  const overall=Number(s[0]),round=Number(s[1]),sid=String(s[2]||'');
  if(!Number.isInteger(overall)||overall<1||!Number.isInteger(round)||round<1||round>4||!sid)continue;
  if(!rounds.has(round))rounds.set(round,[]);
  rounds.get(round).push({overall,round,sid});
 }
 const first=rounds.get(1)||[];
 const size=first.length;
 if(size<8||size>16)return {slots:[],reason:'unknown-draft-size'};
 const firstNums=new Set(first.map(p=>p.overall));
 if(firstNums.size!==size||Math.min(...firstNums)!==1||Math.max(...firstNums)!==size) return {slots:[],reason:'incomplete-first-round'};
 const result=[];
 for(const [round,items] of rounds){
  if(items.length!==size)continue;
  const sorted=[...items].sort((a,b)=>a.overall-b.overall);
  if(new Set(sorted.map(x=>x.overall)).size!==size)continue;
  const start=(round-1)*size+1;
  if(sorted.some((p,i)=>p.overall!==start+i))continue;
  sorted.forEach((p,i)=>result.push({round,slot:i+1,overall:p.overall,sid:p.sid,draftSize:size}));
 }
 return {slots:result,reason:result.length?'ok':'no-complete-rounds'};
}
module.exports={slotsForDraft};
