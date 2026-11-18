#!/usr/bin/env node
'use strict';
/*
  Forward-time, player-level 365-day VALUE benchmark; no manager/team labels.
  TRAIN: origins in 2022-2023 (outcomes no later than 2024).
  TEST:  origins in 2025 through the latest date with a full 365-day horizon.
  Historical dates, not today's values, are used for both the base and outcome.
  Missing subsequent listings are shown separately from observed outcomes.
  Existing age-curve is retrospective and NOT an independent holdout model.
  Usage: node scripts/benchmark-future-values.js
*/
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const {normalizeName}=require('./market-history/ktc-book');
const ktc=read('data/ktc-values.json');
const AGE_BANDS=[0,24,27,30,99];
const band=a=>Math.max(0,AGE_BANDS.findIndex((b,i)=>i<AGE_BANDS.length-1&&a>=b&&a<AGE_BANDS[i+1]));
const YEAR=365.25*864e5, horizonDays=365, MIN_VALUE=1000;
const med=a=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y);return b[Math.floor((b.length-1)/2)]};
const today=new Date(ktc.updated||Date.now());
const meta=new Map(ktc.players.filter(p=>p.age>0).map(p=>[normalizeName(p.name),p]));
const train=[],test=[],formats=['sf','oneQB'];
for(const format of formats){
 const doc=read('data/history/players-'+format+'.json');
 const dates=doc.dates, index=new Map(dates.map((d,i)=>[d,i]));
 const first=dates.map((d,i)=>d.endsWith('-01')?i:-1).filter(i=>i>=0);
 for(const [name,row] of Object.entries(doc.players)){
  const p=meta.get(normalizeName(name));
  if(!p||!['QB','RB','WR','TE'].includes(p.pos))continue;
  const [start,initial,...deltas]=row;
  const vals=new Map([[start,initial]]);
  let cur=initial;
  deltas.forEach((d,i)=>{if(d!==null){cur+=d;vals.set(start+i+1,cur)}});
  for(const i of first){
   const d=dates[i],yr=+d.slice(0,4);
   if(!(yr>=2022&&yr<=2023||yr===2025))continue;
   const j=index.get(String(yr+1)+d.slice(4));
   if(j===undefined)continue;
   const v0=vals.get(i),v1=vals.get(j);
   if(!(v0>=MIN_VALUE))continue;
   const age=p.age-(today-Date.parse(d))/YEAR;
   const rowOut={format,pos:p.pos,age,group:p.pos+'|'+band(age),v0,v1:v1??null};
   (yr===2025?test:train).push(rowOut);
  }
 }
}
if(!train.length||!test.length)throw Error('No training or test examples; inspect historical date coverage');
const buckets=new Map();
for(const r of train){
 if(r.v1==null)continue;
 const e=buckets.get(r.group)||{n:0,sum:0,weight:0};
 e.n++;e.sum+=Math.min(2,r.v1/r.v0)*r.v0;e.weight+=r.v0;buckets.set(r.group,e);
}
const model=r=>{const x=buckets.get(r.group);return x ? (x.sum+100000)/(x.weight+100000) : 1;};
const currentCurve=read('data/market-history/age-curve.json');
const curve=r=>{const age=Math.max(21,Math.min(36,Math.round(r.age)));return currentCurve[r.format]?.[r.pos]?.[age]?.[0]??1;};
const rows=[];
for(const includeMissing of [false,true]){
 const data=test.filter(r=>includeMissing||r.v1!=null);
 if(!data.length)continue;
 const metric=(name,predict)=>{
  let error=0,weighted=0,base=0;
  for(const r of data){
   const observed=r.v1??0,estimate=Math.max(0,r.v0*predict(r));
   error+=Math.abs(observed-estimate);
   weighted+=Math.abs(observed-estimate)/r.v0;
   base+=r.v0;
  }
  return {model:name,n:data.length,mae:Math.round(error/data.length),normalizedMAE:+(weighted/data.length).toFixed(4),errorVsBase:+(error/base).toFixed(4)};
 };
 rows.push({missingAsZero:includeMissing,results:[
  metric('unchanged price',()=>1),
  metric('2022-23 trained position/age bands',model),
  metric('current age curve (retrospective, leaks holdout)',curve)
 ]});
}
const output={
 generated:new Date().toISOString().slice(0,10),
 horizonDays,train:train.length,test:test.length,missingOutcomes:test.filter(r=>r.v1==null).length,
 warnings:[
  'This is a player-price benchmark, not a backtest of trade acceptance or team championship probabilities.',
  'Current KTC player catalog is used for age/identity; players absent today are missing (survivorship bias).',
  'Historical missing prices are not provably zero; both missing-excluded and zero-imputed results are reported.',
  'The current age curve was built using history through 2026, so its holdout comparison is retrospective, not valid for model selection.',
  'Compare the 2022-23 trained model against unchanged-price baseline before considering any live rollout.'
 ],rows
};
console.log(JSON.stringify(output,null,2));
if(process.argv.includes('--write'))fs.writeFileSync(path.join(root,'data/market-history/future-value-benchmark.json'),JSON.stringify(output,null,2)+'\n');
