#!/usr/bin/env node
'use strict';
/*
 * RESEARCH ONLY; reproduces the existing historical 365-day label and sample.
 * No future price is used in any trade-day prediction. Price prediction and
 * roster outcome are NOT interchangeable. No automatically selected weight
 * or changes to live Vault behavior. 2024/2025 are retrospective and can
 * overlap original model calibration. 2025 is NOT a sealed holdout.
 *
 * Run: node --max-old-space-size=6144 scripts/benchmark-separated-trade-pricing.js > separated-pricing.json
 */
const {readSleeperPlayers,seasonFiles,readSeason,ktcPrices,formatOf}=require('./market-history/ktc-book');
const {laterOutcome}=require('./market-history/outcome-values');
const {loadVault}=require('./lib-market');
const {WEIGHTS,priceSignals,weightedSignal}=require('./research-trade-separation');
const Vault=loadVault(),players=readSleeperPlayers();
const bookCache=new Map(),book=f=>bookCache.get(f)||bookCache.set(f,ktcPrices(f,players)).get(f);
const sampleMod=Math.max(1,Number(process.env.SAMPLE_MOD)||10),horizon=365*864e5;
const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0};
const SKIP=new Set(['K','DEF']);
const side=(keys,b,date)=>{
 const out=[];
 for(const k of keys){
  if(k[0]==='p'){if(Number(k.split('-')[1])>=5)continue}
  else if(SKIP.has(players[k]?.position))continue;
  const v=b.at(k,date);
  if(!(v>0))return null;
  out.push({k,v,pos:k[0]==='p'?'PICK':players[k]?.position||'UNKNOWN'});
 }
 return out.length?out:null;
};
const shape=(a,b)=>{
 const n=Math.min(a,b),m=Math.max(a,b);
 return Math.min(n,4)+'-for-'+(m>=4?'4+':m);
};
const init=()=>({eligible:0,decisive:0,missing:0,zeroSignal:0,
 weights:Object.fromEntries(WEIGHTS.map(w=>[String(w),{right:0,wrong:0,tie:0}]))});
const groups={all:init(),playerOnly:init(),byYear:{},playerOnlyYear:{},playerOnlyShape:{}};
const get=(group,key)=>(group[key]||=init());
const record=(r,signals,winner)=>{
 r.eligible++;
 if(!winner){r.zeroSignal++;return}
 r.decisive++;
 for(const weight of WEIGHTS){
  const signal=weightedSignal(signals,weight),entry=r.weights[String(weight)];
  const sign=Math.sign(signal??0);
  if(!sign)entry.tie++;
  else if(sign===winner)entry.right++;
  else entry.wrong++;
 }
};
const seen=new Set(),files=seasonFiles(2024).filter(f=>+f.slice(0,4)<=2025);
if(!files.length)throw Error('Missing historical data/sleeper-trades archive');
let sampled=0,priced=0,mature=0,complete=0,missing=0;
for(const file of files){
 const doc=readSeason(file);
 for(const [id,t] of Object.entries(doc.trades)){
  if(seen.has(id))continue;seen.add(id);
  if(hash(id)%sampleMod!==0)continue;sampled++;
  const [date,leagueKey,aKeys,bKeys]=t;
  if(!date||!doc.leagues[leagueKey]||!aKeys||!bKeys)continue;
  const b=book(formatOf(doc.leagues[leagueKey])),a=side(aKeys,b,date),c=side(bKeys,b,date);
  if(!a||!c)continue;priced++;
  const later=new Date(Date.parse(date)+horizon).toISOString().slice(0,10);
  if(later>b.latestDate)continue;mature++;
  const out=laterOutcome(a,c,later,b);
  if(!out.complete){missing++;continue}
  complete++;
  const signal=priceSignals(a,c,{tradeValueRatio:(x,y)=>Vault.tradeValueRatio(x,y)});
  const year=date.slice(0,4),winner=Math.sign(out.pct??0),isPlayerOnly=[...a,...c].every(p=>p.pos!=='PICK');
  record(groups.all,signal,winner);
  record(get(groups.byYear,year),signal,winner);
  if(isPlayerOnly){
   record(groups.playerOnly,signal,winner);
   record(get(groups.playerOnlyYear,year),signal,winner);
   record(get(groups.playerOnlyShape,year+'|'+shape(a.length,c.length)),signal,winner);
  }
 }
}
const rates=r=>({
 eligible:r.eligible,decisive:r.decisive,zeroSignal:r.zeroSignal,
 weights:Object.fromEntries(Object.entries(r.weights).map(([w,v])=>[w,{
  ...v,accuracyPct:r.decisive?+(100*v.right/r.decisive).toFixed(2):null
 }]))
});
const maps=m=>Object.fromEntries(Object.entries(m).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,rates(v)]));
console.log(JSON.stringify({
 schemaVersion:1,kind:'research-price-separation',sampleMod,
 dateGenerated:new Date().toISOString().slice(0,10),horizonDays:365,
 caveats:[
  'Future label is the one-year change in additive KTC market prices, not roster value, wins, titles, or manager acceptance.',
  'These are already completed trades; unaccepted offers are absent and no independent manager-level holdout exists.',
  'This reuses a consolidation curve that may have been fitted to overlapping historical trades. Neither 2024 nor 2025 is a sealed holdout.',
  'Trades involving draft picks rely on round-average future pick proxies; use playerOnlyYear and playerOnlyShape for cleaner comparisons.',
  'Weights are predeclared sensitivity scenarios, NOT automatically selected coefficients or deployed changes.'
 ],counts:{sampled,priced,mature,complete,missing},
 all:rates(groups.all),playerOnly:rates(groups.playerOnly),
 byYear:maps(groups.byYear),playerOnlyYear:maps(groups.playerOnlyYear),
 playerOnlyShape:maps(groups.playerOnlyShape)
},null,2));
