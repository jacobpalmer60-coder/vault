#!/usr/bin/env node
'use strict';
/*
 Rebuild-oriented player-value research at 1-, 2-, and 3-year horizons.
 Price preservation is not equivalent to rebuilding-team success, and draft
 picks are not included. No current calculator grade or weights are changed.
 Training origins and test origins are separated chronologically by horizon:
 1y: 2022-23 train, 2025 test
 2y: 2020-22 train, 2024 test
 3y: 2020-21 train, 2023 test
 Models use ONLY earlier-origin prices for training; current age-curve is
 included as a retrospective comparator (it is NOT a clean holdout).
 Today's known player names/ages introduce survivorship bias.
 */
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const {normalizeName}=require('./market-history/ktc-book');
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
const trainFactor=(rows,key,r)=> {
 const entries=rows.filter(x=>x.v1!==null&&key(x)===key(r));
 const values=entries.reduce((acc,x)=>{
  // cap huge multipliers so a one-year breakout doesn't set the whole cohort
  acc.num+=Math.min(2,x.v1/x.v0)*x.v0;
  acc.den+=x.v0;
  return acc;
 },{num:0,den:0});
 // prior equivalent to 100k KTC units at 1.0, applied identically to all cohorts
 return (values.num+100000)/(values.den+100000);
};
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
   rows.push({format,pos:p.pos,age,ageBand:ageBand(age),planBand:planBand(age),v0,v1:values.get(end)??null});
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
 // Train age/position/format cell from earlier years, with a position-wide
 // fallback for sparse groups. The per-cell shrinkage prevents runaway ratios.
 const buckets=new Map();
 const add=(key,x)=>{
  const e=buckets.get(key)||{count:0,num:0,den:0};
  e.count++;e.num+=Math.min(2,x.v1/x.v0)*x.v0;e.den+=x.v0;
  buckets.set(key,e);
 };
 for(const row of train)if(row.v1!==null){
  add(row.format+'|'+row.pos+'|'+row.ageBand,row);
  add(row.format+'|'+row.pos,row);
 }
 const factor=r=>{
  const a=buckets.get(r.format+'|'+r.pos+'|'+r.ageBand);
  const b=buckets.get(r.format+'|'+r.pos);
  const e=a&&a.count>=20?a:b;
  return e?(e.num+100000)/(e.den+100000):1;
 };
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
  trainN:train.length,testN:test.length,missing:test.length-scored.length,
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
  'Repeated monthly observations for the same player are dependent; report groups and period effects, not naive independent confidence intervals.',
  'These experiments do NOT change live market-price trade value, player grade or fantasy team odds.'
 ],horizons:outputs
};
console.log(JSON.stringify(output,null,2));
