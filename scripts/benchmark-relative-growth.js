#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DATA,readSleeperPlayers,seasonFiles,readSeason,formatOf,normalizeName}=require('./market-history/ktc-book');
const {CUTOFF,HORIZON,TRAIL,datePlus,hash,cohort,makeSeries,example,fit,evaluate}=require('./market-history/relative-growth');
const format=process.env.BENCHMARK_FORMAT||'sf',mod=Number(process.env.SAMPLE_MOD||100);
if(!['sf','sf_tep','sf_tepp','oneQB','oneQB_tep','oneQB_tepp'].includes(format)||!Number.isSafeInteger(mod)||mod<1)throw Error('Invalid format or sample modulus');
const files=seasonFiles(2024).filter(f=>Number(f.slice(0,4))<=2025);
if(!files.some(f=>f.startsWith('2024'))||!files.some(f=>f.startsWith('2025')))throw Error('Both 2024 and 2025 release archives required under data/sleeper-trades');
const players=readSleeperPlayers(),book=makeSeries(JSON.parse(fs.readFileSync(path.join(DATA,'history','players-'+format+'.json'),'utf8')));
const names=new Map(),nameCounts=new Map();
for(const [id,p] of Object.entries(players)){
 if(!['QB','RB','WR','TE'].includes(p.position))continue;
 const name=normalizeName((p.first_name||'')+' '+(p.last_name||''));
 if(name){names.set(id,name);nameCounts.set(name,(nameCounts.get(name)||0)+1);}
}
const premium=require('./market-history/premium-validation');
const history=JSON.parse(fs.readFileSync(path.join(DATA,'grade-values-history',format+'.json'),'utf8'));
const priceRows=[],priceCounts={eligible:0,noSnapshotOrInvalid:0,complete:0};
const stats=()=>({sampled:0,eligiblePlayerPackages:0,mature:0,missingBase:0,missingTrail:0,missingFuture:0,complete:0});
const counts={train:stats(),test:stats()},rows={train:[],test:[]},seen=new Set();
for(const file of files){
 console.error('[growth] Loading '+file+' for '+format);
 const doc=readSeason(file);
 for(const id in doc.trades){
  if(hash(id)%mod!==0||seen.has(id))continue;
  const [d,league,a,b]=doc.trades[id],fmt=doc.leagues[league];
  if(!fmt||formatOf(fmt)!==format||!d||!a?.length||!b?.length)continue;
  const split=cohort(d,league);if(!split)continue;
  seen.add(id);const c=counts[split];c.sampled++;
  const keys=[...a,...b].map(String);
  // Exclude picks, IDP, and ambiguous or missing player identities rather
  // than pretend a round-average rookie or name collision is an observation.
  if(new Set(keys).size!==keys.length||keys.some(k=>!names.has(k)||nameCounts.get(names.get(k))!==1))continue;
  c.eligiblePlayerPackages++;
  // Price agreement is measured on all held-out player packages with base
  // prices, irrespective of whether a future outcome or trailing price exists.
  const now=keys.map(k=>book.at(names.get(k),d));
  if(split==='test'&&now.every(v=>v>0)){
   priceCounts.eligible++;
   const assets=keys.map((k,i)=>({name:names.get(k),now:now[i]}));
   const pr=premium.priceRow(assets.slice(0,a.length),assets.slice(a.length),premium.snapshot(history,d));
   if(pr){priceRows.push(pr);priceCounts.complete++;}else priceCounts.noSnapshotOrInvalid++;
  }
  const future=datePlus(d,HORIZON);if(future>book.latest)continue;c.mature++;
  if(now.some(v=>!(v>0))){c.missingBase++;continue;}
  const before=keys.map(k=>book.at(names.get(k),datePlus(d,-TRAIL)));
  if(before.some(v=>!(v>0))){c.missingTrail++;continue;}
  const after=keys.map(k=>book.at(names.get(k),future));
  if(after.some(v=>v===null)){c.missingFuture++;continue;}
  const assets=keys.map((k,i)=>({now:now[i],before:before[i],after:after[i]}));
  const row=example(assets.slice(0,a.length),assets.slice(a.length));
  if(!row)throw Error('Valid priced row failed invariant');
  rows[split].push(row);c.complete++;
 }
 console.error('[growth] '+file+' done: '+JSON.stringify(counts));
}
const model=fit(rows.train),test=rows.test;
const groups={};
for(const r of test)(groups[r.shape]||=[]).push(r);
const report={schemaVersion:1,kind:'relative-growth-research',format,sampleMod:mod,generated:new Date().toISOString(),cutoff:CUTOFF,horizonDays:HORIZON,trailDays:TRAIL,
 counts,model,marketPremiumDiagnostic:{counts:priceCounts,snapshotLagDays:16,all:premium.summarize(priceRows),adjustedOnly:premium.summarize(priceRows.filter(r=>r.adjusted)),caveat:'Reconstructed historical tables may overlap calibration trades. Completed-trade price agreement is descriptive, not acceptance accuracy or proof of fair value. No weight selected.'},results:evaluate(test,model.beta),byShape:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,evaluate(v,model.beta)])),
 interpretation:model.n>=100&&test.length>=100?'retrospective held-out league-season keys and dates; evaluate uncertainty before rollout':'insufficient samples for a meaningful comparison',
 caveats:['Training labels mature before cutoff; test origins start at cutoff, and hashed league keys are disjoint. League-season keys are not guaranteed to identify the same manager or franchise across seasons.','No roster outcomes, acceptance data or rejected offers; relative price growth is not fantasy utility. Same KTC source for labels and inputs; not an independent provider.','Completed trades only; same players can appear across partitions. No independent prospective test. Excludes draft picks and ambiguous current metadata, so coverage and survivorship bias matter.','All models evaluated on the identical complete cases with positive trade-day and trailing prices; observed future zero is retained. No future-data imputation.','Trend model and unchanged-price baseline are fixed before test; no automatic live deployment.']};
console.log(JSON.stringify(report,null,2));
