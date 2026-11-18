#!/usr/bin/env node
'use strict';
/*
 Rebuild-oriented player-value research at 1-, 2-, and 3-year horizons.
 Price preservation is not equivalent to rebuilding-team success, and draft
 picks are not included. No current calculator grade or weights are changed.
 Training requires outcomes known BEFORE each prediction origin,
 not merely earlier training-origin years. A three-year outcome from 2021
 was not knowable in 2023 and is therefore excluded. As-of training is
 recomputed by test month. Current age-curve is a retrospective comparator
 only; it has seen the test period.
 Today's known player names/ages introduce survivorship bias.
 */
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const {normalizeName}=require('./market-history/ktc-book');
const {fitAsOf}=require('./market-history/forecast-training');
const catalog=read('data/ktc-values.json');
const meta=new Map(catalog.players.filter(p=>p.age>0).map(p=>[normalizeName(p.name),p]));
const today=Date.parse(catalog.updated),YEAR=365.25*864e5,MIN_VALUE=1000;
const configurations=[
 {years:1,train:[2022,2023],test:2025},
 {years:2,train:[2020,2021,2022],test:2024},
 {years:3,train:[2020,2021],test:2023}
];
const formats=['sf','oneQB'],POSITIONS=new Set(['QB','RB','WR','TE']);
const ageBand=a=>a<24?'under24':a<27?'24-26':a<30?'27-29':'30plus';
const planBand=a=>a<27?'youngCore':a>=28?'veteran':'transition';
const sampleFor=(doc,format,years,allowedYears)=>{
 const dates=doc.dates,indices=new Map(dates.map((d,i)=>[d,i]));
 const months=dates.map((d,i)=>d.endsWith('-01')?i:-1).filter(i=>i>=0);
 const rows=[];
 for(const [name,enc] of Object.entries(doc.players)){
  const p=meta.get(normalizeName(name));
  if(!p||!POSITIONS.has(p.pos))continue;
  const [start,initial,...deltas]=enc,values=new Map([[start,initial]]);
  let current=initial;
  for(let i=0;i<deltas.length;i++){
   const delta=deltas[i];
   if(delta!==null){current+=delta;values.set(start+i+1,current)}
  }
  for(const i of months){
   const d=dates[i],yr=Number(d.slice(0,4));
   if(!allowedYears.includes(yr))continue;
   const end=indices.get(String(yr+years)+d.slice(4));
   if(end===undefined)continue;
   const v0=values.get(i);
   if(!(v0>=MIN_VALUE))continue;
   const age=p.age-(today-Date.parse(d))/YEAR;
   rows.push({format,pos:p.pos,age,ageBand:ageBand(age),planBand:planBand(age),v0,v1:values.get(end)??null,originDate:d,outcomeDate:dates[end]});
  }
 }
 return rows;
};
const simpleMetric=(rows,predict)=>{
 let abs=0,relative=0,base=0;
 for(const r of rows){
  const v=r.v1??0,forecast=r.v0*predict(r);
  abs+=Math.abs(v-forecast);relative+=Math.abs(v-forecast)/r.v0;base+=r.v0;
 }
 return {n:rows.length,mae:rows.length?Math.round(abs/rows.length):null,
  relativeError:rows.length?+(relative/rows.length).toFixed(4):null,
  weightedError:base?+(abs/base).toFixed(4):null};
};
const curve=read('data/market-history/age-curve.json');
const outputs=[];
for(const cfg of configurations){
 const train=[],test=[];
 for(const format of formats){
  const doc=read('data/history/players-'+format+'.json');
  train.push(...sampleFor(doc,format,cfg.years,cfg.train));
  test.push(...sampleFor(doc,format,cfg.years,[cfg.test]));
 }
 if(!train.length||!test.length){outputs.push({years:cfg.years,error:'Insufficient history'});continue}
 // Fit only outcomes already observable strictly before each test month.
 // In particular 2021 + 3 years is 2024, and cannot be used to test 2023.
 const byMonth=new Map();
 for(const month of new Set(test.map(r=>r.originDate)))byMonth.set(month,fitAsOf(train,month));
 const factor=r=>byMonth.get(r.originDate).factor(r);
 const trainingCoverage=Object.fromEntries([...byMonth.entries()].sort(([a],[b])=>a.localeCompare(b))
  .map(([month,x])=>[month,{eligible:x.eligible,excludedFuture:x.rejectedFuture,unknown:x.unknown}]));
 const existing=r=>curve[r.format]?.[r.pos]?.[Math.min(36,Math.max(21,Math.round(r.age)))]?.[cfg.years-1]??1;
 const analyze=rows=>({
  unmodified:simpleMetric(rows,()=>1),
  priorYearsTrained:simpleMetric(rows,factor),
  currentCurveRetrospective:simpleMetric(rows,existing)
 });
 const scored=test.filter(r=>r.v1!==null);
 const groups={};
 for(const [dimension,keyFn] of [
  ['format',x=>x.format],['position',x=>x.pos],['age',x=>x.ageBand],
  ['planningProxy',x=>x.planBand],['formatAndPosition',x=>x.format+'|'+x.pos]
 ]){
  groups[dimension]={};
  for(const key of new Set(test.map(keyFn))){
   const all=test.filter(x=>keyFn(x)===key),known=all.filter(x=>x.v1!==null);
   groups[dimension][key]={known:known.length,missing:all.length-known.length,
    completeCase:analyze(known)};
  }
 }
 outputs.push({years:cfg.years,trainYears:cfg.train,testYear:cfg.test,
  trainN:train.length,testN:test.length,missing:test.length-scored.length,trainingCoverage,
  completeCase:analyze(scored),
  missingAsZero:analyze(test),
  groups
 });
}
const output={
 generated:new Date().toISOString().slice(0,10),
 description:'Rebuild-oriented research: value preservation of players 1-3 years later, not team rebuild success',
 warnings:[
  'Draft picks are excluded. A true rebuilding-team backtest needs full contemporaneous rosters and ownership.',
  'Historical player population is matched through the current KTC player catalog; delisted players are omitted (survivorship).',
  'An absent follow-up KTC price is not certainly a worthless asset; both complete and zero-imputed outcomes are shown.',
  'Current age curve contains post-test data and is retrospective only. Never select a model using its apparent holdout performance.',
  'As-of training is recomputed for each test month; only prior observed outcomes are eligible.',
  'Repeated monthly observations for the same player are dependent; report groups and period effects, not naive independent confidence intervals.',
  'These experiments do NOT change live market-price trade value, player grade or fantasy team odds.'
 ],horizons:outputs
};
console.log(JSON.stringify(output,null,2));
