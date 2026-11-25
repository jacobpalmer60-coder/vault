#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {FORMATS,snapshotFor,tradeRow,summarize}=require('./market-history/prospective-prices');
const {seasonFiles,readSeason,readSleeperPlayers,formatOf,normalizeName}=require('./market-history/ktc-book');
const {datePlus,hash}=require('./market-history/relative-growth');
const dir=process.argv[2],mod=Number(process.env.SAMPLE_MOD||20),today=new Date().toISOString().slice(0,10);
if(!dir||!Number.isSafeInteger(mod)||mod<1)throw Error('Usage: node scripts/benchmark-prospective-prices.js SNAPSHOT_DIR');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'assets.json'),'utf8'));
const items=manifest.filter(a=>/^prices-20\d\d-\d\d-\d\d\.json\.gz$/.test(a.name)&&fs.existsSync(path.join(dir,a.name))).map(asset=>({asset,snapshot:JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,asset.name))))}));
const start=datePlus(today,-28),end=datePlus(today,-2),days=new Map();
for(let d=start;d<=end;d=datePlus(d,1))days.set(d,snapshotFor(items,d));
const players=readSleeperPlayers(),names=new Map(),counts=new Map();
for(const [id,p] of Object.entries(players))if(['QB','RB','WR','TE'].includes(p.position)){
 const n=normalizeName((p.first_name||'')+' '+(p.last_name||''));if(n){names.set(id,n);counts.set(n,(counts.get(n)||0)+1);}
}
for(const [k,n] of names)if(counts.get(n)!==1)names.delete(k);
const rows=Object.fromEntries(FORMATS.map(f=>[f,[]])),coverage=Object.fromEntries(FORMATS.map(f=>[f,{sampled:0,noSnapshot:0,missingPrice:0,complete:0}]));
const seen=new Set(),files=seasonFiles(Number(start.slice(0,4))).filter(f=>Number(f.slice(0,4))<=Number(end.slice(0,4)));
if(!files.length)throw Error('Current Sleeper trade archive missing');
for(const file of files){
 console.error('[prospective] '+file);
 const doc=readSeason(file);
 for(const id in doc.trades){
  if(hash(id)%mod!==0||seen.has(id))continue;
  const [d,league,a,b]=doc.trades[id],fmt=doc.leagues[league];
  if(!days.has(d)||!fmt||!a?.length||!b?.length)continue;
  const f=formatOf(fmt),c=coverage[f];if(!c)continue;
  seen.add(id);c.sampled++;
  const snap=days.get(d);if(!snap){c.noSnapshot++;continue;}
  const r=tradeRow(snap,f,a,b,names,league,d);if(!r){c.missingPrice++;continue;}
  rows[f].push(r);c.complete++;
 }
}
const report={schemaVersion:1,kind:'prospective-completed-price-agreement',generated:new Date().toISOString(),start,end,sampleMod:mod,snapshotAssets:items.length,
 daysWithEligibleSnapshot:[...days.values()].filter(Boolean).length,daysChecked:days.size,coverage,
 formats:Object.fromEntries(FORMATS.map(f=>[f,summarize(rows[f])])),
 caveats:['Snapshot asset must have been created before trade UTC date; no same-day or post-trade publication/update. Maximum 3 calendar days of age.','No claim of independent provider or causal fair price. Completed trades only; no rejected offers, manager acceptance or future utility.','Same-round pick mid-price proxy; no owner or eventual slot. Rolling window and repeated players limit statistical independence.','Recent archive may be incomplete due to ingestion lag; no weight selected.']};
console.log(JSON.stringify(report,null,2));
