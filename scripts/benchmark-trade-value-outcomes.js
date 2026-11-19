#!/usr/bin/env node
'use strict';
/*
 Retrospective 365-day completed-trade diagnostic; never an acceptance model.
 With missing follow-up prices, STRICT removes the trade while IMPUTED counts
 unknown assets as zero. Split by date, league format, trade shape, strongest
 asset position, and value disparity to locate the 2024/2025 reversal.
 The future winner uses independent additive KTC price sums, NEVER Vault's own
 consolidation formula. Player-only rows avoid the round-average future-pick
 outcome proxy. Uses trade-date KTC and an ID-deterministic sample; prior years may overlap
 training data for Vault's existing value curve. No causal/holdout claims.
 Usage: node --max-old-space-size=6144 scripts/benchmark-trade-value-outcomes.js
 SAMPLE_MOD=10 (default, 10%); SAMPLE_MOD=1 (all).
 */
const {readSleeperPlayers,seasonFiles,readSeason,ktcPrices,formatOf}=require('./market-history/ktc-book');
const {loadVault}=require('./lib-market');
const {laterOutcome}=require('./market-history/outcome-values');
const Vault=loadVault(),players=readSleeperPlayers();
const books=new Map(),book=f=>books.get(f)||books.set(f,ktcPrices(f,players)).get(f);
const mod=Math.max(1,Number(process.env.SAMPLE_MOD)||10),horizon=365*864e5;
const SKIP=new Set(['K','DEF']);
const hash=s=>{let x=2166136261;for(let i=0;i<s.length;i++){x^=s.charCodeAt(i);x=Math.imul(x,16777619)}return x>>>0};
const sum=a=>a.reduce((s,x)=>s+x.v,0);
const shape=(a,b)=>{
 const x=Math.min(a,b),y=Math.max(a,b);
 return `${Math.min(x,4)}-for-${y>=4?'4+':y}`;
};
const stats=()=>({n:0,matched:0,notDecisive:0,vaultWins:0,rawWins:0,disagree:0,
  vaultOnlyRight:0,rawOnlyRight:0,bothWrong:0});
const detail={},summary={
 seen:0,sampled:0,priced:0,mature:0,complete:0,missing:0,imputedUsable:0,
 playerOnlyMature:0,playerOnlyComplete:0,
 bothZero:0,strict:{},imputed:{},by:{formatYear:{},year:{},yearQuarter:{},yearMonth:{},
 shape:{},playerOnlyShape:{},highestAssetPosition:{},tradeValueGap:{},monthOfYear:{},playerOnlyYear:{}}
};
summary.strict=stats();summary.imputed=stats();
summary.playerOnlyStrict=stats();summary.playerOnlyImputed=stats();
const accumulate=(s,predA,predB,outcome)=>{
 if(outcome==null)return;
 const win=Math.sign(outcome),a=Math.sign(predA),b=Math.sign(predB);
 s.n++;
 if(!win||!a||!b){s.notDecisive++;return}
 s.matched++;
 const aa=win===a,bb=win===b;
 if(aa)s.vaultWins++;
 if(bb)s.rawWins++;
 if(a!==b){s.disagree++;if(aa)s.vaultOnlyRight++;if(bb)s.rawOnlyRight++}
 if(!aa&&!bb)s.bothWrong++;
};
const rounded=s=>({
 ...s,vaultAgreementPct:s.matched?+(100*s.vaultWins/s.matched).toFixed(2):null,
 rawAgreementPct:s.matched?+(100*s.rawWins/s.matched).toFixed(2):null,
 vaultAdvantagePoints:s.matched?+(100*(s.vaultWins-s.rawWins)/s.matched).toFixed(2):null
});
const side=(keys,b,d)=>{
 const out=[];
 for(const k of keys){
  if(k[0]==='p'){if(Number(k.split('-')[1])>=5)continue}
  else if(SKIP.has(players[k]?.position))continue;
  const v=b.at(k,d);
  if(!(v>0))return null;
  out.push({k,v,pos:k[0]==='p'?'PICK':players[k]?.position||'UNKNOWN'});
 }
 return out.length?out:null;
};
const seen=new Set(),files=seasonFiles(2024).filter(x=>+x.slice(0,4)<=2025);
if(!files.length)throw Error('Missing data/sleeper-trades archive. Download sleeper-trades GitHub release.');
for(const file of files){
 const doc=readSeason(file);
 for(const [id,t] of Object.entries(doc.trades)){
  if(seen.has(id))continue;seen.add(id);summary.seen++;
  if(hash(id)%mod!==0)continue;summary.sampled++;
  const [date,leagueKey,s1,s2]=t,fmt=doc.leagues[leagueKey];
  if(!fmt||!date||!s1||!s2)continue;
  const format=formatOf(fmt),b=book(format),a=side(s1,b,date),c=side(s2,b,date);
  if(!a||!c)continue;
  summary.priced++;
  const later=new Date(Date.parse(date)+horizon).toISOString().slice(0,10);
  if(later>b.latestDate)continue;summary.mature++;
  const out=laterOutcome(a,c,later,b);
  if(out.complete)summary.complete++;else summary.missing++;
  if(out.pctImputed===null)summary.bothZero++;else summary.imputedUsable++;
  const pricesA=a.map(x=>x.v),pricesB=c.map(x=>x.v);
  const v=Vault.tradeValueRatio(pricesA,pricesB)-1,raw=sum(a)-sum(c);
  accumulate(summary.strict,v,raw,out.pct);
  accumulate(summary.imputed,v,raw,out.pctImputed);
  // Future draft-pick 'returns' are round averages, not real owner outcomes.
  // Report the cleaner fully player-only benchmark alongside the broad one.
  const playerOnly=[...a,...c].every(x=>x.pos!=='PICK');
  if(playerOnly){
   summary.playerOnlyMature++;
   if(out.complete)summary.playerOnlyComplete++;
   accumulate(summary.playerOnlyStrict,v,raw,out.pct);
   accumulate(summary.playerOnlyImputed,v,raw,out.pctImputed);
  }
  const year=date.slice(0,4),mo=date.slice(5,7),q='Q'+Math.ceil(Number(mo)/3);
  const top=[...a,...c].reduce((best,x)=>x.v>best.v?x:best);
  const originalGap=200*Math.abs(sum(a)-sum(c))/(sum(a)+sum(c));
  const gap=originalGap<5?'0-5%':originalGap<10?'5-10%':originalGap<20?'10-20%':'20%+';
  const keys={
   formatYear:year+'|'+format,year,
   yearQuarter:year+'|'+q,yearMonth:year+'-'+mo,
   shape:year+'|'+shape(a.length,c.length),
   highestAssetPosition:year+'|'+top.pos,
   tradeValueGap:year+'|'+gap,monthOfYear:mo,
   ...(playerOnly?{playerOnlyYear:year,playerOnlyShape:year+'|'+shape(a.length,c.length)}:{})
  };
  for(const [dimension,key] of Object.entries(keys)){
   const map=summary.by[dimension],record=map[key] ||= {strict:stats(),imputed:stats(),missing:0};
   if(!out.complete)record.missing++;
   accumulate(record.strict,v,raw,out.pct);
   accumulate(record.imputed,v,raw,out.pctImputed);
  }
 }
}
const by=Object.fromEntries(Object.entries(summary.by).map(([dimension,entries])=>
 [dimension,Object.fromEntries(Object.entries(entries).sort(([a],[b])=>a.localeCompare(b))
 .map(([key,x])=>[key,{strict:rounded(x.strict),imputed:rounded(x.imputed),missing:x.missing}]))]));
const result={
 schemaVersion:2,generated:new Date().toISOString().slice(0,10),sampleMod:mod,horizonDays:365,
 description:'Year-stratified retrospective one-year trade value agreement; no manager acceptance data',
 warnings:[
  'Rejected offers are unobserved; cannot calculate the probability another manager accepts a trade.',
  'Incomplete follow-up prices are excluded from strict results and zero-imputed only in sensitivity results.',
  'Known zero prices stay zero; a missing listing is NOT automatically a complete loss.',
  'Future winner is now scored independently: additive sum of future KTC prices, not Vault.tradeValueRatio. Historical results from older benchmark versions are NOT comparable.',
  'Trades with picks have estimated post-draft pick outcomes based on round-average rookie prices; the player-only cohort avoids this proxy.',
  'Player-only shape cohorts isolate consolidation adjustments without round-average draft pick outcome proxies; they remain retrospective and are not roster-aware grades.',
  'The same trade may appear in the existing calibration data; this is not a sealed chronological holdout.',
  'Team roster mode (contend/rebuild) was not reconstructed at the trade date.',
  '2024 and 2025 have different calendar coverage; compare month/quarter cohorts rather than concluding season-specific causality.'
 ],counts:{seen:summary.seen,sampled:summary.sampled,priced:summary.priced,
  mature:summary.mature,complete:summary.complete,missing:summary.missing,
  imputedUsable:summary.imputedUsable,bothZero:summary.bothZero,
  playerOnlyMature:summary.playerOnlyMature,playerOnlyComplete:summary.playerOnlyComplete},
 overall:{strict:rounded(summary.strict),imputed:rounded(summary.imputed)},
 playerOnly:{strict:rounded(summary.playerOnlyStrict),imputed:rounded(summary.playerOnlyImputed)},
 by
};
console.log(JSON.stringify(result,null,2));
