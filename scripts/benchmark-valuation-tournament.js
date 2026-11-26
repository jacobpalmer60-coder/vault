#!/usr/bin/env node
'use strict';
// Reconstruct prior-only evidence from completed Sleeper trades, not from
// the archived premium tables used by the previous calibration grid.
const fs=require('node:fs'),path=require('node:path');
const {DATA,readSleeperPlayers,seasonFiles,readSeason,formatOf,normalizeName}=require('./market-history/ktc-book');
const {datePlus,hash,makeSeries}=require('./market-history/relative-growth');
const old=require('./market-history/premium-validation');
const T=require('./market-history/valuation-tournament');
const format=process.env.BENCHMARK_FORMAT||'sf',sample=Number(process.env.SAMPLE_MOD||10),evidenceMod=Number(process.env.EVIDENCE_MOD||5);
const formats=['sf','sf_tep','sf_tepp','oneQB','oneQB_tep','oneQB_tepp'];
if(!formats.includes(format)||![sample,evidenceMod].every(x=>Number.isInteger(x)&&x>=1))throw Error('Bad format/sample');
const shadow=process.argv.includes('--shadow'),today=new Date().toISOString().slice(0,10);
if(shadow&&(!['sf','oneQB'].includes(format)||evidenceMod!==5))throw Error('Shadow supports only the frozen confidence-25 model with evidence sampling 1/5');
const qb=format.startsWith('sf')?'sf':'oneQB',siblings=formats.filter(f=>f.startsWith(qb));
const read=p=>JSON.parse(fs.readFileSync(path.join(DATA,p),'utf8'));
const books=Object.fromEntries(siblings.map(f=>[f,makeSeries(read('history/players-'+f+'.json'))]));
const history=read('grade-values-history/'+format+'.json'),pickSnaps=read('pick-value-history.json').snapshots||[];
const players=readSleeperPlayers(),names=new Map(),counts=new Map();
for(const [id,p] of Object.entries(players))if(['QB','RB','WR','TE'].includes(p.position)){
 const name=normalizeName((p.first_name||'')+' '+(p.last_name||''));
 if(name){names.set(id,name);counts.set(name,(counts.get(name)||0)+1);}
}
for(const [id,name] of names)if(counts.get(name)!==1)names.delete(id);
const files=shadow?seasonFiles(+today.slice(0,4)-1).filter(f=>+f.slice(0,4)<=+today.slice(0,4)):seasonFiles(2024).filter(f=>+f.slice(0,4)<=2025);
if(shadow?!files.some(f=>f.startsWith(today.slice(0,4))):files.length!==2||!files[0].startsWith('2024')||!files[1].startsWith('2025'))throw Error('Required season archives missing');
const records=new Map(), seen=new Set(), train=[],test=[];
const coverage={evidenceTrades:0,evidenceMissing:0,trainEligible:0,testEligible:0,trainMissing:0,testMissing:0,trainComplete:0,testComplete:0};
let lastDay='',daily=new Map(),table=null,day=0;
const dayNum=d=>Math.floor(Date.parse(d)/86400000);
const holdout=league=>hash(league)%5===0;
const cohort=(date,league)=>date>='2024-03-01'&&date<'2025-01-01'&&!holdout(league)?'train':date>='2025-08-01'&&date<'2026-01-01'&&holdout(league)?'test':null;
function price(id,date,fmt){
 if(id.startsWith('p')){
  if(+id.slice(1,5)<+date.slice(0,4))return null;
  const x=old.pickAt(pickSnaps,id,datePlus(date,-1),fmt);return x?{...x,key:x.premiumKey}:null;
 }
 const name=names.get(id),now=name&&books[fmt].at(name,datePlus(date,-1));
 return now>0?{name,key:'n:'+name,now,type:'player'}:null;
}
function addEvidence(xs,ys,fmt){
 const s=xs.reduce((n,x)=>n+x.now,0),o=ys.reduce((n,x)=>n+x.now,0),main=Math.max(...xs.map(x=>x.now));
 const p=(o/s-1)*100;
 // Same-round pick tokens may be duplicates; each trade is at most one observation
 // per key, and a token present on both sides cannot identify an individual pick.
 const done=new Set(),other=new Set(ys.map(x=>x.key));
 for(const x of xs){
  if(x.now!==main||done.has(x.key)||other.has(x.key))continue;
  done.add(x.key);
  const rows=records.get(x.key)||[];
  rows.push({day,format:fmt,value:x.now,premium:p});
  records.set(x.key,rows);
 }
}
function enrich(x){
 const key=x.key+'|'+x.now;
 if(daily.has(key))return daily.get(key);
 const recs=T.evidence(records.get(x.key)||[],day,x.now,format);
 const v={...x,records:recs,archive:table?.[x.key]??0};
 daily.set(key,v);return v;
}
const days=new Map();
for(const file of files){
 const doc=readSeason(file);
 for(const id in doc.trades){
  if(seen.has(id))continue;
  const [date,league,a,b]=doc.trades[id],f=doc.leagues[league];
  if(!f||!date||!a?.length||!b?.length)continue;
  if(shadow&&(date>=today||date<datePlus(today,-45)))continue;
  const fmt=formatOf(f);if(!siblings.includes(fmt))continue;
  const split=!shadow&&fmt===format&&hash('eval:'+id)%sample===0?cohort(date,league):null;
  const useEvidence=!holdout(league)&&hash('evidence:'+id)%evidenceMod===0;
  if(!split&&!useEvidence)continue;
  seen.add(id);
  if(!days.has(date))days.set(date,[]);
  days.get(date).push({date,league,a,b,fmt,split,useEvidence});
 }
 console.error('[tournament] indexed '+file+'; '+seen.size+' sampled unique transactions');
}
 for(const [date,trades] of [...days].sort((a,b)=>a[0].localeCompare(b[0]))){
  if(date<lastDay)throw Error('Archive chronology regression');
  day=dayNum(date);lastDay=date;daily=new Map();table=old.snapshot(history,date);
  // Drop expired rows before pricing; same-day evidence enters only after all evaluation.
  for(const [k,xs] of records){let i=0;while(i<xs.length&&day-xs[i].day>45)i++;if(i===xs.length)records.delete(k);else if(i)records.set(k,xs.slice(i));}
  const additions=[];
  for(const tr of trades){
   const keys=[...tr.a,...tr.b].map(String),pkeys=keys.filter(k=>!k.startsWith('p'));
   const assets=new Set(pkeys).size!==pkeys.length?null:keys.map(k=>price(k,date,tr.fmt));
   const valid=assets&&assets.every(Boolean);
   if(tr.split){const s=tr.split;coverage[s+'Eligible']++;
    if(!valid||!table){coverage[s+'Missing']++;}else{
     const a=assets.slice(0,tr.a.length).map(enrich),b=assets.slice(tr.a.length).map(enrich);
     const row=T.row(a,b,{league:String(tr.league),month:date.slice(0,7)});
     if(row){(s==='train'?train:test).push(row);coverage[s+'Complete']++;}else coverage[s+'Missing']++;
    }
   }
   if(tr.useEvidence){if(valid){additions.push([assets.slice(0,tr.a.length),assets.slice(tr.a.length),tr.fmt]);coverage.evidenceTrades++;}else coverage.evidenceMissing++;}
  }
  for(const [a,b,f] of additions){addEvidence(a,b,f);addEvidence(b,a,f);}
  days.delete(date);
 }
 console.error('[tournament] merged archive '+JSON.stringify(coverage));
if(shadow){
 const ktc=read('ktc-values.json'),grade=read('grade-values.json');
 const {capture}=require('./market-history/prospective-prices');
 const sourceCommit=process.env.SOURCE_SHA;
 const base=capture(ktc,grade,sourceCommit);
 const f=base.formats[format],model=T.candidates.find(m=>m.id==='confidence-25'),nowDay=dayNum(today);
 if(base.capturedAt.slice(0,10)!==today)throw Error('UTC day changed during capture');
 if(coverage.evidenceTrades<100||!lastDay||lastDay<datePlus(today,-7))throw Error('Insufficient or stale recent evidence');
 const premiums={},sampleCounts={};let adjusted=0;
 for(const [key,price] of Object.entries(f.prices)){
  const evidence=T.evidence(records.get(key)||[],nowDay,price,format);
  const exact=evidence.filter(x=>x.exact);
  const n=exact.length>=10?exact.length:evidence.length;
  const p=T.premium(model,evidence,0,key.startsWith('k:')?'pick':'player');
  if(!Number.isFinite(p)||p<=-100)throw Error('Invalid shadow premium '+key);
  premiums[key]=p;sampleCounts[key]=n;if(p!==0)adjusted++;
 }
 if(adjusted<10)throw Error('Too few nonzero adjustments');
 console.log(JSON.stringify({schemaVersion:1,kind:'confidence-shadow-format',format,model:model.id,evidenceMod,sourceCommit,capturedAt:base.capturedAt,ktcUpdated:base.ktcUpdated,marketUpdated:base.marketUpdated,prices:f.prices,archivedPremiums:f.premiums,candidatePremiums:premiums,sampleCounts,coverage,lastEvidenceDay:lastDay,adjusted}));
 process.exit(0);
}
const report={schemaVersion:1,kind:'rolling-valuation-tournament',format,sample,evidenceMod,generatedAt:new Date().toISOString(),coverage,
 split:{train:'March–December 2024, non-held-out league keys',test:'August–December 2025, held-out league keys',lookbackDays:45,priceLagDays:1},
 ...T.report(train,test)};
console.log(JSON.stringify(report,null,2));
