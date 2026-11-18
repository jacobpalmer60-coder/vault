#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {slotsForDraft}=require('./market-history/rookie-slot');
const evidence=require('./market-history/rookie-evidence');
const script=fs.readFileSync(path.join(__dirname,'benchmark-rookie-pick-outcomes.js'),'utf8');
const player={};
for(let i=1;i<=12;i++)player[String(i)]={first_name:'R',last_name:String(i),position:i%3===0?'RB':'WR',draft_year:2024};
const selections=(ids)=>ids.map((sid,i)=>[i+1,1,String(sid)]);
const drafts={
 a:['2024-05-01','L',null,selections([1,2,3,4,5,6,7,8,9,10])],
 b:['2024-05-02','L',null,selections([2,1,3,4,5,6,7,8,9,10])],
 c:['2024-05-03','L',null,selections([11,12,3,4,5,6,7,8,9,10])],
 incomplete:['2024-05-04','L',null,selections([1,2,3])]
};
const doc={leagues:{L:[2,0]},drafts},prices={at:(sid,date)=>{
 if(String(sid).startsWith('p'))return null;
 if(sid==='2')return null; // truly missing, never 0
 if(sid==='11')return 0; // observed zero
 return Number(sid)*100
},latestDate:'2026-11-17'};
let result;
const mocks=name=>{
 if(name==='./market-history/ktc-book')return {
  readSleeperPlayers:()=>player,seasonFiles:()=>['2024.json.gz'],readSeason:()=>doc,
  ktcPrices:()=>prices,formatOf:()=>'sf'
 };
 if(name==='./market-history/rookie-evidence')return {loadDraftIndex:()=>null,draftYearEvidence:evidence.draftYearEvidence};
 if(name==='./market-history/rookie-slot')return {slotsForDraft};
 if(name==='node:fs')return fs;
 if(name==='node:path')return path;
 throw Error(name);
};
vm.runInNewContext(script,{require:mocks,__dirname,process:{env:{MIN_DRAFTS:'1'}},console:{log:s=>result=JSON.parse(s)},Date,Map,Set,Number,String,Object,Array,Math,RegExp,Error});
assert.equal(result.counts.slotDraftsValidated,3);
assert.equal(result.counts.slotDraftsRejected,1);
assert.equal(result.counts.uniqueRookies,12,'original unique-per-player round totals unchanged');
const one=result.slotGroups.find(g=>g.format==='sf'&&g.year===2024&&g.draftSize===10&&g.round===1&&g.slot===1);
assert.equal(one.selections,3);
assert.equal(one.distinctRookies,3,'same rookie per slot counts once');
assert.equal(one.known,2);
assert.equal(one.missing,1);
assert.equal(one.followup.p25,50,'actual zero counted in median cohort');
const two=result.slotGroups.find(g=>g.slot===2);
assert.equal(two.distinctRookies,3);
assert.equal(two.missing,1,'missing price retained as missing');
const three=result.slotGroups.find(g=>g.slot===3);
assert.equal(three.distinctRookies,1);
assert.equal(three.selections,3,'repeated selection not treated as three independent rookie outcomes');
console.log('PASS slot integration, per-slot deduplication, missing-vs-zero, full-round rejection and baseline round parity');
