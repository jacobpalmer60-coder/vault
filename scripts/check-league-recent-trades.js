#!/usr/bin/env node
'use strict';
/*
 Read-only, direct Sleeper transaction diagnostic. This makes no price
 assumptions, never writes league data, and prints failed API weeks.
 Run: node scripts/check-league-recent-trades.js <leagueId> [team name]
 */
const leagueId=process.argv[2],needle=(process.argv[3]||'TURBONUTZ').toLowerCase();
if(!/^\d+$/.test(leagueId||'')){console.error('Usage: node scripts/check-league-recent-trades.js <leagueId> [team name]');process.exit(2)}
const base='https://api.sleeper.app/v1/league/'+leagueId;
const json=async url=>{
 const r=await fetch(url,{cache:'no-store'});
 if(!r.ok)throw Error('Sleeper HTTP '+r.status+' at '+url);
 return r.json();
};
(async()=>{
 const [league,rosters,users]=await Promise.all([json(base),json(base+'/rosters'),json(base+'/users')]);
 const names=new Map(rosters.map(r=>{
  const u=users.find(x=>String(x.user_id)===String(r.owner_id));
  return [String(r.roster_id),u?.metadata?.team_name||r.metadata?.team_name||u?.display_name||'Team '+r.roster_id];
 }));
 const matches=[...names].filter(([id,n])=>n.toLowerCase().includes(needle));
 console.log('League: '+league.name+' ('+leagueId+')');
 console.log('Matching teams: '+(matches.length?matches.map(([id,n])=>n+' (roster '+id+')').join(', '):'none; checking all trades'));
 const results=await Promise.allSettled(Array.from({length:19},(_,week)=>json(base+'/transactions/'+week)));
 const raw=[],errors=[];
 for(let week=0;week<results.length;week++){
  const res=results[week];
  if(res.status==='rejected'){errors.push('Week '+week+': '+res.reason.message);continue}
  if(!Array.isArray(res.value)){errors.push('Week '+week+': unexpected payload');continue}
  for(const tx of res.value){
   if(tx?.type!=='trade'||!(tx.roster_ids||[]).length)continue;
   if(matches.length&&!tx.roster_ids.some(rid=>matches.some(([id])=>id===String(rid))))continue;
   raw.push({...tx,_week:week});
  }
 }
 const unique=[...new Map(raw.map(t=>[String(t.transaction_id),t])).values()]
  .sort((a,b)=>Number(b.status_updated||b.created||0)-Number(a.status_updated||a.created||0));
 console.log('\nSleeper trades involving '+(matches.length?'matching teams':'all teams')+': '+unique.length);
 for(const tx of unique.slice(0,20)){
  const ts=Number(tx.status_updated||tx.created||0);
  const when=ts?new Date(ts).toISOString().slice(0,16).replace('T',' ')+' UTC':'date unavailable';
  const sides=(tx.roster_ids||[]).map(rid=>names.get(String(rid))||'roster '+rid).join(' ↔ ');
  console.log(when+' | week '+tx._week+' | '+tx.status+' | '+sides+' | ID '+tx.transaction_id+
   ' | players '+Object.keys(tx.adds||{}).length+' | picks '+(tx.draft_picks||[]).length);
 }
 if(errors.length)console.log('\nIncomplete feed:\n'+errors.join('\n'));
 if(!unique.length)console.log('No matching trade in these transaction endpoints. Check this league ID, processing status, and exact manager name.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
