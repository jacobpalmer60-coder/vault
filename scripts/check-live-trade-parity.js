#!/usr/bin/env node
'use strict';
// Real, read-only Sleeper acceptance: a completed trade must count for both
// participating managers even if KTC cannot provide a historical grade.
// No credentials and no user data written anywhere.
const assert=require('node:assert/strict');
const {loadVault}=require('./lib-market');
const leagueId=process.env.VAULT_LIVE_LEAGUE_ID||process.argv[2];
const expectedId=process.env.VAULT_EXPECT_TRADE_ID||process.argv[3];
if(!/^\d+$/.test(leagueId||'')||!/^\d+$/.test(expectedId||'')){
 console.error('Usage: node scripts/check-live-trade-parity.js <league-id> <completed-transaction-id>');
 process.exit(2);
}
const ROOT='https://api.sleeper.app/v1/league/'+leagueId;
const get=async path=>{
 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch(ROOT+path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
  if(r.ok)return r.json();
  if(![429,500,502,503,504].includes(r.status)||attempt===2)throw Error('Sleeper HTTP '+r.status+' '+path);
  await new Promise(resolve=>setTimeout(resolve,(attempt+1)*1000));
 }
};
(async()=>{
 const [league,rosters,users]=await Promise.all([get(''),get('/rosters'),get('/users')]);
 assert.ok(league?.league_id&&Array.isArray(rosters)&&Array.isArray(users),'Complete live Sleeper league responses');
 const names=new Map(users.map(u=>[String(u.user_id),u.metadata?.team_name||u.display_name||'']));
 const teams=rosters.map(r=>({rosterId:r.roster_id,teamName:names.get(String(r.owner_id))||r.metadata?.team_name||'Team '+r.roster_id,record:{wins:0,losses:0}}));
 const weeks=[],errors=[];
 let cursor=0;
 async function worker(){
  while(cursor<19){
   const week=cursor++;
   try{const tx=await get('/transactions/'+week);if(!Array.isArray(tx))throw Error('Unexpected payload');
    weeks.push(...tx.filter(t=>t&&t.type==='trade'&&t.status==='complete'));
   }catch(e){errors.push('week '+week+': '+e.message)}
  }
 }
 await Promise.all(Array.from({length:4},worker));
 const unique=[...new Map(weeks.map(x=>[String(x.transaction_id),x])).values()];
 const target=unique.find(tx=>String(tx.transaction_id)===String(expectedId));
 assert.ok(target,'Expected completed trade '+expectedId+' missing from loaded Sleeper weeks '+errors.join(', '));
 assert.equal(target.status,'complete');
 assert.equal(new Set(target.roster_ids||[]).size,2,'Expected trade needs two distinct roster participants');
 const Vault=loadVault();
 const stats=Vault.buildManagerStats([],teams,unique);
 for(const rosterId of target.roster_ids){
  const manager=stats.find(s=>String(s.rosterId)===String(rosterId));
  assert.ok(manager && manager.trades>=1,'Completed trade omitted on roster '+rosterId);
 }
 const sides=target.roster_ids.map(r=>teams.find(t=>String(t.rosterId)===String(r))?.teamName||r);
 console.log('PASS live Sleeper trade',expectedId,'appears symmetrically for',sides.join(' ↔ '),';',unique.length,'distinct completed trades;',errors.length,'missing transaction weeks');
 if(errors.length)console.warn('Partial Sleeper API coverage:',errors.join('; '));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
