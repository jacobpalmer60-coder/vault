/*
 * Trade Stress Test — hypothetical sensitivity, NOT a second trade grade.
 *
 * Receives the exact pre/post snapshots from Vault.simulateTrade. Every
 * assumption is applied to the SAME asset both before and after the trade,
 * so neither manager receives special treatment or a fictional free asset.
 *
 * - Player market value: a user-chosen % decline for one traded player.
 * - Missed games: a 17-game illustrative exposure; replaced by the best
 *   available lineup for games missed, not a new injury or playoff forecast.
 * - Draft pick: current Vault/KTC early/mid/late price spread only where
 *   Vault has a tier spread for that KTC-normalized round. Otherwise
 *   no repricing is performed (never invent an outcome for a rookie).
 *
 * Does not mutate teams, prices, rankings, grades, or original assets.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.VaultTradeStress=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const tierNames=['current','early','mid','late'];
 const num=(value,otherwise=0)=>Number.isFinite(Number(value))?Number(value):otherwise;
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,num(n)));
 const pickId=p=>[p.season,p.round,p.original].join('-');
 const playerId=p=>String(p.id);
 const small=v=>Math.abs(v)<0.0000001?0:v;
 function pickTierQuote(p,tier,spreadFor){
  if(!p||tier==='current')return null;
  if(!tierNames.includes(tier))return null;
  // Already-selected rookies have an actual price, not a future pick tier.
  if(p.became)return null;
  const round=num(p.ktcRound??p.round);
  const spread=typeof spreadFor==='function'?spreadFor(round):null;
  const current=String(p.ktcTier??p.tier??'mid').toLowerCase();
  const factor=t=>t==='mid'?1:num(spread?.[t],NaN);
  const old=factor(current),next=factor(tier);
  if(!Number.isFinite(old)||old<=0||!Number.isFinite(next)||next<=0)return null;
  return {baseTier:current,tier,round,original:num(p.value),value:Math.max(0,num(p.value)*next/old)};
 }
 function scan(before,after,tradeA,tradeB){
  const transferred=[...(tradeA||[]),...(tradeB||[])];
  const players=transferred.filter(p=>p?.type==='player'&&p.id!=null&&num(p.value)>0);
  const picks=transferred.filter(p=>p?.type==='pick'&&p.season!=null&&p.round!=null&&p.original!=null&&num(p.value)>0);
  return {players,picks};
 }
 function evaluate(params){
  const {before,after,tradeA=[],tradeB=[],slots=[],player='',pick='',
   decline=0,missed=0,tier='current',spreadFor,lineupOf}=params||{};
  if(!before?.A||!before?.B||!after?.A||!after?.B)throw Error('Stress test requires both before/after team snapshots');
  const assets=scan(before,after,tradeA,tradeB);
  const target=assets.players.find(p=>playerId(p)===String(player))||null;
  const draft=assets.picks.find(p=>pickId(p)===String(pick))||null;
  const quote=draft?pickTierQuote(draft,tier,spreadFor):null;
  const drop=target?clamp(decline,0,60):0;
  const missedWeeks=target?clamp(Math.round(num(missed)),0,17):0;
  const affectedId=target?playerId(target):null;
  const targetPick=draft?pickId(draft):null;
  // A price shock changes the selected player's value in whichever team
  // actually owns them in the specified (pre or post) universe.
  function measure(snapshot){
   const plist=Array.isArray(snapshot.plist)?snapshot.plist:[];
   const picks=Array.isArray(snapshot.picks)?snapshot.picks:[];
   const hasTarget=affectedId!=null&&plist.some(p=>playerId(p)===affectedId);
   const playerValue=plist.reduce((sum,p)=>{
    const base=num(p.value);
    return sum+(playerId(p)===affectedId?base*(1-drop/100):base);
   },0);
   const pickValue=picks.reduce((sum,p)=>{
    const base=num(p.value);
    return sum+(targetPick&&pickId(p)===targetPick&&quote?quote.value:base);
   },0);
   const healthy=num(snapshot.opt);
   let replacement=healthy;
   if(missedWeeks>0&&hasTarget&&typeof lineupOf==='function'){
    const remaining=plist.filter(p=>playerId(p)!==affectedId);
    replacement=clamp(lineupOf(remaining,slots),0,healthy);
   }
   // Illustrative average across 17 games, NOT scheduled week-by-week odds.
   const lineupPpg=healthy-(healthy-replacement)*missedWeeks/17;
   return {playerValue:small(playerValue),pickValue:small(pickValue),
    totalValue:small(playerValue+pickValue),lineupPpg:small(lineupPpg),
    healthyLineupPpg:healthy,replacementLineupPpg:replacement};
  }
  const output={before:{A:measure(before.A),B:measure(before.B)},
   after:{A:measure(after.A),B:measure(after.B)}};
  output.change={};
  for(const side of ['A','B']){
   const was=output.before[side],now=output.after[side];
   output.change[side]={
    playerValue:small(now.playerValue-was.playerValue),
    pickValue:small(now.pickValue-was.pickValue),
    totalValue:small(now.totalValue-was.totalValue),
    lineupPpg:small(now.lineupPpg-was.lineupPpg)
   };
  }
  return { ...output,player:target,pick:draft,drop,missedWeeks,
   tier:quote?.tier||'current',tierQuote:quote,pickScenarioAvailable:!!quote,
   assumptions:[
    'Hypothetical sensitivity, not predicted market prices, future rookie results, or acceptance odds.',
    'The same changed player or pick is valued consistently both with and without the trade.',
    'Missed games use a 17-game illustration with best available replacement starters; real week-by-week matchups and playoff odds are not recalculated.',
    'Pick early/mid/late is a current-price tier sensitivity using Vault’s existing KTC-normalized round spread, not the actual future draft position.'
   ]};
 }
 return Object.freeze({evaluate,scan,pickTierQuote,pickId});
});
