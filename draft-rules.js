/* Pure commissioner-configurable rookie draft model; source and status travel with each slot. */
(function(root){
'use strict';
const id=x=>String(x), n=x=>x==null||x===''?null:Number.isFinite(+x)?+x:null;
const mpfOf=r=>{const s=r?.settings||{};return n(s.ppts)==null?null:+s.ppts+(n(s.ppts_decimal)??0)/100};
const orderInRound=(slot,round,count,style='linear')=>{
 if(!Number.isInteger(slot)||slot<1||slot>count)return null;
 const reverse=style==='snake'&&round%2===0 || style==='3rr'&&(round===2||round>=3&&round%2===1);
 return reverse?count+1-slot:slot;
};
function bracketInfo(bracket,all){
 const pool=new Set(),placements=new Map(),conflicts=new Set();
 for(const m of Array.isArray(bracket)?bracket:[]){
  for(const k of ['t1','t2','w','l'])if(Number.isInteger(+m?.[k])&&+m[k]>0&&all.has(id(m[k])))pool.add(id(m[k]));
  const p=n(m?.p),w=id(m?.w),l=id(m?.l);
  if(!Number.isInteger(p)||p<1||w===l||!all.has(w)||!all.has(l))continue;
  for(const [team,place] of [[w,p],[l,p+1]]){
   if(placements.has(team)&&placements.get(team)!==place)conflicts.add(team);
   placements.set(team,place);
  }
 }
 conflicts.forEach(t=>placements.delete(t));return {pool,placements,conflicts};
}
function build({teams=[],rosters=[],bracket=[],league={},settings={}}={}){
 const ids=new Set(teams.map(t=>id(t.rosterId))),count=ids.size;
 const playoffCount=Math.min(count,Math.max(0,Math.trunc(n(settings.playoffCount)??n(league.settings?.playoff_teams)??0)));
 const info=bracketInfo(bracket,ids),warn=[],manual=(settings.playoffIds||[]).map(id);
 let qualifiers=new Set(),source='unavailable';
 if(playoffCount===0){source='no-playoffs'}
 else if(manual.length===playoffCount&&new Set(manual).size===playoffCount&&manual.every(x=>ids.has(x))){qualifiers=new Set(manual);source='manual'}
 else if(info.pool.size===playoffCount){qualifiers=info.pool;source='sleeper-bracket'}
 else if(teams.every(t=>n(t.record?.wins)!=null&&n(t.record?.losses)!=null)){
  const ranked=[...teams].sort((a,b)=>{
    const aa=(+a.record.wins+(+a.record.ties||0)/2)/(+a.record.wins+(+a.record.losses||0)+(+a.record.ties||0)||1);
    const bb=(+b.record.wins+(+b.record.ties||0)/2)/(+b.record.wins+(+b.record.losses||0)+(+b.record.ties||0)||1);
    return bb-aa || (+b.record.pointsFor||0)-(+a.record.pointsFor||0) || id(a.rosterId).localeCompare(id(b.rosterId));
  });
  qualifiers=new Set(ranked.slice(0,playoffCount).map(t=>id(t.rosterId)));source='standings-projection';
  warn.push('Playoff qualification is projected from records; final teams and tiebreakers may differ.');
 }else warn.push('Playoff field unknown: choose the actual playoff teams before calculating non-playoff draft slots.');
 if(info.conflicts.size)warn.push('Conflicting Sleeper bracket placement results; these teams remain TBD.');
 const rosterMap=new Map(rosters.map(r=>[id(r.roster_id),r]));
 const rows=teams.map(t=>({rosterId:id(t.rosterId),teamName:t.teamName||'Team '+t.rosterId,
  mpf:mpfOf(rosterMap.get(id(t.rosterId))),playoff:qualifiers.size===playoffCount?qualifiers.has(id(t.rosterId)):null,
  slot:null,source:'pending',placement:null}));
 const byId=new Map(rows.map(r=>[r.rosterId,r])),known=qualifiers.size===playoffCount;
 if(known){
  const lower=rows.filter(r=>!r.playoff).sort((a,b)=>(a.mpf??Infinity)-(b.mpf??Infinity)||a.rosterId.localeCompare(b.rosterId));
  if(lower.some(r=>r.mpf==null))warn.push('Missing Sleeper Max Points For for a non-playoff team: non-playoff slots remain TBD.');
  else for(let i=0;i<lower.length;i++){
   if((i&&Math.abs(lower[i].mpf-lower[i-1].mpf)<1e-9)||(i+1<lower.length&&Math.abs(lower[i].mpf-lower[i+1].mpf)<1e-9)){
    warn.push('Equal Max Points For: use commissioner tie-break and manual slot overrides.');continue;
   }
   lower[i].slot=i+1;lower[i].source=source==='standings-projection'?'projected-mpf':'mpf';
  }
  for(const r of rows.filter(r=>r.playoff)){
   const p=info.placements.get(r.rosterId);
   if(Number.isInteger(p)&&p>=1&&p<=playoffCount){r.placement=p;r.slot=count-p+1;r.source='sleeper-placement'}
   else r.source='playoff-pending';
  }
 }
 // Manual slots displace conflicting model values; duplicates never silently shift.
 const claims=new Map();
 for(const r of rows){
  const slot=n(settings.manualSlots?.[r.rosterId]);
  if(!Number.isInteger(slot)||slot<1||slot>count)continue;
  if(claims.has(slot)){warn.push('Manual override collision for slot '+slot+'.');claims.set(slot,null)}
  else claims.set(slot,r.rosterId);
 }
 const manualRows=new Set();
 for(const [slot,who] of claims){if(!who)continue;const r=byId.get(who);r.slot=slot;r.source='manual-slot';manualRows.add(who)}
 const taken=new Set([...claims.keys()]);
 for(const r of rows){if(!manualRows.has(r.rosterId)&&r.slot!=null&&taken.has(r.slot)){r.slot=null;r.source='conflict';warn.push('Manual slot displaces calculated slot for '+r.teamName+'.')}}
 const seen=new Set();
 for(const r of rows){if(r.slot!=null){if(seen.has(r.slot)){warn.push('Duplicate slot prevented for '+r.teamName);r.slot=null;r.source='conflict'}else seen.add(r.slot)}}
 rows.sort((a,b)=>(a.slot??Infinity)-(b.slot??Infinity)||a.teamName.localeCompare(b.teamName));
 return {rows,count,playoffCount,qualifiers:[...qualifiers],qualifierSource:source,warnings:[...new Set(warn)],
  complete:rows.every(r=>r.slot!=null)&&source!=='standings-projection'};
}
function applyPicks(teams,year,order,style='linear'){
 const slots=new Map(order.rows.map(r=>[r.rosterId,r]));
 return teams.flatMap(t=>(t.picks||[]).filter(p=>+p.season===+year).map(p=>{
  const r=slots.get(id(p.original));const slot=r?.slot==null?null:orderInRound(r.slot,+p.round,order.count,style);
  return {year:+year,round:+p.round,original:id(p.original),holder:id(t.rosterId),value:p.value,
   baseSlot:r?.slot??null,roundSlot:slot,overall:slot==null?null:(+p.round-1)*order.count+slot,source:r?.source||'pending'};
 })).sort((a,b)=>a.round-b.round||(a.roundSlot??Infinity)-(b.roundSlot??Infinity)||a.original.localeCompare(b.original));
}
const api={mpfOf,orderInRound,bracketInfo,build,applyPicks};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.VaultDraftOrder=api;
})(typeof globalThis==='undefined'?this:globalThis);
