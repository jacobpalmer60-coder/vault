#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'benchmark-rookie-pick-outcomes.js'),'utf8');
const readSeason=()=>({
 leagues:{L:[2,0]},
 drafts:{
  d1:['2024-05-01','L',null,[[1,1,'100'],[2,1,'200'],[3,2,'300']]],
  d2:['2024-06-01','L',null,[[1,1,'100'],[2,1,'200'],[3,2,'400']]],
  d3:['2025-06-01','L',null,[[1,1,'500']]]
 }
});
const prices={
 at:(k,date)=>{
  if(k==='100')return date<'2025-01-01'?3100:6000;
  if(k==='200')return date<'2025-01-01'?2500:900;
  if(k==='300')return null;
  if(k==='400')return date<'2025-01-01'?1200:0;
  if(k==='500')return date<'2026-01-01'?4500:5200;
  if(k.startsWith('p'))return 4000;
  return null;
 },latestDate:'2026-11-17'
};
let output;
const requireMock=name=>{
 if(name==='./market-history/ktc-book')return {
  readSleeperPlayers:()=>({'100':{position:'QB'},'200':{position:'WR'},'300':{position:'RB'},'400':{position:'TE'},'500':{position:'QB'}}),
  seasonFiles:()=>['2024.json.gz','2025.json.gz'],readSeason,ktcPrices:()=>prices,formatOf:()=>'sf'
 };
 if(name==='node:fs')return fs;
 if(name==='node:path')return path;
 throw Error(name);
};
vm.runInNewContext(code,{require:requireMock,process:{env:{MIN_DRAFTS:'1'}},console:{log:x=>output=JSON.parse(x)},Date,Map,Set,Number,String,Object,Array,Math,RegExp,Error}, {filename:'benchmark-rookie-pick-outcomes.js'});
assert.equal(output.counts.draftsSeen,6,'two season files each include three draft fixtures');
assert.equal(output.counts.uniqueRookies,4,'2025 is not yet matured?');
assert.ok(output.warnings.some(w=>w.includes('not a return forecast')));
const r1=output.groups.find(g=>g.year===2024&&g.round===1);
assert.equal(r1.n,2,'duplicates across drafts count once');
assert.equal(r1.known,2);
const r2=output.groups.find(g=>g.year===2024&&g.round===2);
assert.equal(r2.n,2);
assert.equal(r2.missing,1);
assert.equal(r2.followup.median,0,'observed zero stays in results');
console.log('PASS rookie draft deduplication, explicit missing prices, real zeros, and non-forecast disclosure');
