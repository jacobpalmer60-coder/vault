#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const S=require('./market-history/confidence-shadow');
const vbaVault=require('./lib-market').loadVault();
const {seasonFiles,readSeason,readSleeperPlayers,formatOf,normalizeName}=require('./market-history/ktc-book');
const {datePlus,hash}=require('./market-history/relative-growth');
const dir=process.argv[2],today=new Date().toISOString().slice(0,10);
if(!dir)throw Error('Usage: node scripts/benchmark-confidence-shadow.js SNAPSHOT_DIR');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'assets.json'),'utf8'));
const items=manifest.filter(a=>/^confidence-(sf|oneQB)-20\d\d-\d\d-\d\d\.json\.gz$/.test(a.name)&&fs.existsSync(path.join(dir,a.name))).map(asset=>({asset,snap:JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,asset.name))))}));
const start=datePlus(today,-45),end=datePlus(today,-2),dates=new Map();
for(let d=start;d<=end;d=datePlus(d,1))for(const f of S.FORMATS){
 const found=items.filter(x=>x.snap.format===f&&S.eligibleShadow(x.snap,x.asset,d)).sort((a,b)=>b.snap.capturedAt.localeCompare(a.snap.capturedAt))[0];
 dates.set(f+'|'+d,found?.snap||null);
}
const names=new Map(),counts=new Map();
for(const [id,p] of Object.entries(readSleeperPlayers()))if(['QB','RB','WR','TE'].includes(p.position)){
 const n=normalizeName((p.first_name||'')+' '+(p.last_name||''));if(n){names.set(id,n);counts.set(n,(counts.get(n)||0)+1);}
}
for(const [id,n] of names)if(counts.get(n)!==1)names.delete(id);
const rows=Object.fromEntries(S.FORMATS.map(f=>[f,[]])),coverage=Object.fromEntries(S.FORMATS.map(f=>[f,{sampled:0,noSnapshot:0,missingPrice:0,complete:0}]));
const seen=new Set(),files=seasonFiles(+start.slice(0,4)-1).filter(f=>+f.slice(0,4)<=+end.slice(0,4));
if(!files.length)throw Error('Missing current completed trade archive');
for(const file of files){
 const doc=readSeason(file);
 for(const id in doc.trades){
  if(seen.has(id)||hash('eval:'+id)%10!==0)continue;
  const [date,league,a,b]=doc.trades[id],fmt=doc.leagues[league];
  if(!fmt||!league||hash(league)%5!==0||!a?.length||!b?.length)continue;
  const f=formatOf(fmt),k=f+'|'+date,c=coverage[f];if(!c||!dates.has(k))continue;
  seen.add(id);c.sampled++;
  const snap=dates.get(k);if(!snap){c.noSnapshot++;continue;}
  const r=S.row(snap,a,b,names,league,date,vbaVault);
  if(!r){c.missingPrice++;continue;}rows[f].push(r);c.complete++;
 }
}
console.log(JSON.stringify({kind:'confidence-shadow-evaluation',generated:new Date().toISOString(),start,end,coverage,
 formats:Object.fromEntries(S.FORMATS.map(f=>[f,{...S.report(rows[f]),package:S.packageReport(rows[f])}])),
 caveats:['Publication must precede trade UTC day; at most three days old.','Identical held-out trade rows, 1/10 deterministic sample.','Pick price is exact year/round mid-tier proxy; no owner or rookie outcome.','Completed price agreement is not a strategic outcome or acceptance prediction.','No automatic price deployment.']},null,2));
