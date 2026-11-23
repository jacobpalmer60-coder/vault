/* Pure, parity-safe event normalization for Sleeper season activity. */
(function(root){
'use strict';
const id=x=>String(x), ms=t=>Number(t?.status_updated||t?.created||0)||0;
const showPlayer=(pid,players)=>{const p=players?.[pid];const v=p?[p.first_name,p.last_name].filter(Boolean).join(' ').trim():'';return v||'Player #'+pid};
const uniq=a=>[...new Set(a.filter(x=>x!=null).map(id))];
const label=(type)=>({trade:'Trade',waiver:'Waiver',free_agent:'Free agent',commissioner:'Commissioner'})[type]||'Transaction';
function build({weeks=[],players={},rosters=[],users=[],drafts=[],season='',leagueId=''}={}){
 const usersById=new Map(users.map(u=>[id(u.user_id),u]));
 const names=new Map(rosters.map(r=>{
   const u=usersById.get(id(r.owner_id))||{},raw=u.metadata?.team_name||r.metadata?.team_name||u.display_name||'Roster '+r.roster_id;
   return [id(r.roster_id),String(raw)];
 }));
 const name=roster=>names.get(id(roster))||'Roster '+roster;
 const missingWeeks=weeks.flatMap((w,i)=>Array.isArray(w)?[]:[i]),found=new Map();
 weeks.forEach((week,i)=>{
  if(!Array.isArray(week))return;
  for(const tx of week){
   if(!tx||!tx.transaction_id)continue;
   const txid=id(tx.transaction_id),prev=found.get(txid);
   if(!prev||(tx.status==='complete'&&prev.tx.status!=='complete')||(tx.status===prev.tx.status&&ms(tx)>ms(prev.tx)))found.set(txid,{tx,week:i});
  }
 });
 const transactions=[...found.values()].map(({tx,week})=>{
  const adds=Object.entries(tx.adds||{}).map(([player,owner])=>({player,owner:id(owner)}));
  const drops=Object.entries(tx.drops||{}).map(([player,owner])=>({player,owner:id(owner)}));
  const picks=(tx.draft_picks||[]).map(p=>({season:+p.season,round:+p.round,original:id(p.roster_id),from:id(p.previous_owner_id),to:id(p.owner_id)}));
  const participants=uniq([...(tx.roster_ids||[]),...adds.map(a=>a.owner),...drops.map(a=>a.owner),...picks.flatMap(p=>[p.from,p.to])]);
  const affected=[];
  for(const team of participants){
   const gets=adds.filter(a=>a.owner===team).map(a=>showPlayer(a.player,players))
    .concat(picks.filter(p=>p.to===team).map(p=>p.season+' '+p.round+'th from '+name(p.original)));
   const loses=drops.filter(d=>d.owner===team).map(d=>showPlayer(d.player,players))
    .concat(picks.filter(p=>p.from===team&&p.to!==team).map(p=>p.season+' '+p.round+'th from '+name(p.original)));
   // Players traded away can be inferred only for an unambiguous two-party trade.
   if(tx.type==='trade'&&(tx.roster_ids||[]).length===2){
    const other=id(tx.roster_ids.find(x=>id(x)!==team));
    gets.forEach(()=>{});
    loses.push(...adds.filter(a=>a.owner===other).map(a=>showPlayer(a.player,players)));
   }
   affected.push({id:team,name:name(team),gets,loses});
  }
  return {id:id(tx.transaction_id),kind:tx.type||'unknown',status:tx.status||'unknown',when:ms(tx),week,
    season:String(season),leagueId:id(leagueId),participants,affected,picks,
    description:label(tx.type),linkable:tx.type==='trade'&&tx.status==='complete'};
 });
 const pickEvents=(drafts||[]).flatMap(d=>{
  const draft=d.draft||{},picks=Array.isArray(d.picks)?d.picks:[];
  return picks.filter(p=>p.player_id&&p.pick_no!=null).map(p=>{
   const owner=id(p.roster_id||p.picked_by||''),who=name(owner);
   return {id:'draft:'+id(draft.draft_id)+':'+p.pick_no,kind:'draft',status:'complete',
    when:Number(p.picked_at)||Number(draft.start_time)||0,week:-1,season:String(season),leagueId:id(leagueId),
    participants:[owner],affected:[{id:owner,name:who,gets:[showPlayer(p.player_id,players)],loses:[]}],
    description:'Draft selection '+(p.round||'?')+'.'+(p.draft_slot||p.pick_no||'?'),
    pickNo:+p.pick_no,sourceTimestamp:Number(p.picked_at)?'selection':'draft-start',linkable:false};
  });
 });
 const events=transactions.concat(pickEvents).sort((a,b)=>b.when-a.when||a.id.localeCompare(b.id));
 return {events,teams:[...names].map(([rosterId,teamName])=>({rosterId,teamName})).sort((a,b)=>a.teamName.localeCompare(b.teamName)),
  missingWeeks,checked:weeks.length-missingWeeks.length,total:weeks.length,transactions:transactions.length,draftPicks:pickEvents.length};
}
function filter(events,{team='all',kind='all',status='complete',q=''}={}){
 const needle=String(q).toLowerCase().trim(),wanted=id(team);
 return events.filter(e=>(team==='all'||e.participants.includes(wanted))&&
  (kind==='all'||kind==='roster'?kind==='roster'?['waiver','free_agent','commissioner'].includes(e.kind):true:e.kind===kind)&&
  (status==='all'||e.status===status)&&(!needle||JSON.stringify([e.description,...e.affected.flatMap(a=>[a.name,...a.gets,...a.loses])]).toLowerCase().includes(needle)));
}
const api=Object.freeze({build,filter,showPlayer});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.VaultActivity=api;
})(typeof globalThis==='undefined'?this:globalThis);
