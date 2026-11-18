#!/usr/bin/env node
'use strict';
/*
  Price-side versus one-year future value on held-out completed Sleeper trades.
  This is a descriptive outcome comparison, NOT an acceptance classifier.
  Uses each trade's own-day KTC price and a full 365-day outcome horizon.
  Reads the raw compressed archive from data/sleeper-trades (not in git).
  Run: node --max-old-space-size=6144 scripts/benchmark-trade-value-outcomes.js
  Set SAMPLE_MOD=1 for all trades (default 10 samples ~10% deterministically).
*/
const {readSleeperPlayers,seasonFiles,readSeason,ktcPrices,formatOf}=require('./market-history/ktc-book');
const {loadVault}=require('./lib-market');
const {laterOutcome}=require('./market-history/outcome-values');
const Vault=loadVault(),players=readSleeperPlayers();
const books=new Map(),book=f=>books.get(f)||books.set(f,ktcPrices(f,players)).get(f);
const sampleMod=Math.max(1,Number(process.env.SAMPLE_MOD)||10);
const horizon=365*864e5,SKIP=new Set(['K','DEF']);
const hash=s=>{let x=2166136261;for(let i=0;i<s.length;i++){x^=s.charCodeAt(i);x=Math.imul(x,16777619)}return x>>>0;};
const score={seen:0,sampled:0,priced:0,mature:0,usable:0,missing:0,bothZero:0,fullFollowup:0,detail:{}};
const group=(fmt,year)=>score.detail[fmt+'|'+year] ||= {n:0,priceWins:{vault:0,raw:0},priceTies:{vault:0,raw:0},sum: {vault:0,raw:0},missing:0,withMissing:0};
const sign=x=>Math.sign(x),pct=(a,b)=>(200*(a-b)/((a+b)||1));
const byVal=a=>a.reduce((s,x)=>s+x.v,0);
const side=(keys,b,d)=>{
 const out=[];
 for(const k of keys){
  if(k[0]==='p'){if(Number(k.split('-')[1])>=5)continue;}
  else if(SKIP.has(players[k]?.position))continue;
  const v=b.at(k,d);
  if(!(v>0))return null;
  out.push({k,v});
 }
 return out.length?out:null;
};
const seen=new Set(),files=seasonFiles(2024).filter(x=>+x.slice(0,4)<=2025);
if(!files.length)throw Error('Missing data/sleeper-trades archive; download the sleeper-trades GitHub release first.');
for(const file of files){
 const doc=readSeason(file);
 for(const [id,t] of Object.entries(doc.trades)){
  if(seen.has(id))continue;seen.add(id);score.seen++;
  if(hash(id)%sampleMod!==0)continue;
  score.sampled++;
  const [date,leagueKey,s1,s2]=t,fmt=doc.leagues[leagueKey];
  if(!fmt)continue;
  const format=formatOf(fmt),b=book(format);
  const a=side(s1,b,date),c=side(s2,b,date);
  if(!a||!c)continue;
  score.priced++;
  const later=new Date(Date.parse(date)+horizon).toISOString().slice(0,10);
  if(later>b.latestDate)continue;
  score.mature++;
  const x=laterOutcome(a,c,later,b,Vault.tradeValueRatio);
  if(!x){score.bothZero++;continue;}
  score.usable++;
  const g=group(format,date.slice(0,4)),vA=a.map(x=>x.v),vB=c.map(x=>x.v);
  const vaultEdge=Vault.tradeValueRatio(vA,vB)-1;
  const rawEdge=byVal(a)-byVal(c);
  const outcome=sign(x.pct);
  const missing=[...a,...c].filter(x=>b.later(x.k,later)==null).length;
  if(missing){score.missing++;g.withMissing++}else score.fullFollowup++;
  // Winner agreement only on non-ties, never label acceptance as a rejection.
  g.n++;
  for(const [name,edge] of [['vault',vaultEdge],['raw',rawEdge]]){
   if(!sign(edge)||!outcome)g.priceTies[name]++;
   else if(sign(edge)===outcome)g.priceWins[name]++;
   g.sum[name] += Math.abs(sign(edge)-outcome);
  }
 }
}
for(const g of Object.values(score.detail)){
 g.directionAgreement=Object.fromEntries(['vault','raw'].map(name=>[name,
  +((g.priceWins[name]/Math.max(1,g.n-g.priceTies[name]))*100).toFixed(2)]));
}
console.log(JSON.stringify({
 generated:new Date().toISOString().slice(0,10),sampleMod,horizonDays:365,
 description:'One-year future-value direction for previously accepted trades, not a trading-skill or acceptance-prediction metric',
 warnings:[
  'Selection bias: rejected offers are absent. Do not interpret these rates as manager acceptance probabilities.',
  'A missing KTC price can mean delisting or data absence. Review both fullFollowup and missing counts.',
  'This uses trade-day prices; it does not reconstruct full historical team rosters or contend/rebuild status.',
  'Vault trade pricing was calibrated on prior completed trades. This is not fully independent unless the training data are excluded from evaluation.',
  'A direction-agreement win does not prove a better prospective model; use forward chronological holdouts.'
 ],...score
},null,2));
