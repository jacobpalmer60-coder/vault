#!/usr/bin/env node
'use strict';
// Regression: repeated rookie selections must use EACH draft's 365-day
// outcome; rookie-heavy results must never inherit startup-like drafts.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {slotsForDraft}=require('./market-history/rookie-slot');
const {draftYearEvidence}=require('./market-history/rookie-evidence');
const script=fs.readFileSync(path.join(__dirname,'benchmark-rookie-pick-outcomes.js'),'utf8');
const players={};
for(let id=1;id<=12;id++)players[String(id)]={position:'WR',draft_year:2024};
for(let id=21;id<=29;id++)players[String(id)]={position:'RB',draft_year:2023};
const make=(date,ids)=>[date,'L',null,ids.map((id,i)=>[i+1,1,String(id)])];
const archive={leagues:{L:[2,0]},drafts:{
 a:make('2024-05-01',[1,2,3,4,5,6,7,8,9,10]),
 b:make('2024-06-01',[1,2,3,4,5,6,7,8,9,10]),
 c:make('2024-07-01',[12,21,22,23,24,25,26,27,28,29])
}};
const prices={latestDate:'2026-11-17',at:(sid,date)=>{
 if(sid==='2')return null;
 if(sid==='1')return date>='2025-06-01'?900:100;
 if(sid==='12')return 4000;
 if(String(sid).startsWith('p'))return null;
 return 300;
}};
let result;
const mocks=name=>{
 if(name==='./market-history/ktc-book')return {
  readSleeperPlayers:()=>players,seasonFiles:()=>['2024.json.gz'],
  readSeason:()=>archive,ktcPrices:()=>prices,formatOf:()=>'sf'
 };
 if(name==='./market-history/rookie-evidence')return {loadDraftIndex:()=>null,draftYearEvidence};
 if(name==='./market-history/rookie-slot')return {slotsForDraft};
 if(name==='node:fs')return fs;
 if(name==='node:path')return path;
 throw Error(name);
};
vm.runInNewContext(script,{require:mocks,__dirname,
 process:{env:{MIN_DRAFTS:'1'}},console:{log:s=>{result=JSON.parse(s)}},
 Date,Map,Set,Number,String,Object,Array,Math,RegExp,Error});
assert.equal(result.counts.slotDraftsValidated,3);
assert.equal(result.counts.slotDraftsRookieHeavy,2);
assert.equal(result.counts.slotDraftsNotRookieHeavy,1);
const first=result.slotGroups.find(g=>g.year===2024&&g.format==='sf'&&g.draftSize===10&&g.round===1&&g.slot===1);
assert.ok(first,'slot 1.01 is present');
assert.equal(first.selections,3);
assert.equal(first.distinctRookies,2);
assert.equal(first.rookieHeavySharePct,66.7);
assert.equal(first.selectionWeightedFollowup.median,900,'each draft-day follow-up gets its own outcome');
assert.equal(first.rookieHeavySelectionWeightedFollowup.median,100,'likely startup selection excluded from heuristic subset');
assert.equal(first.rookieHeavySelectionWeightedFollowup.p75,900);
assert.equal(first.followup.median,2050,'first-seen distinct-player metric remains a separate diagnostic');
const second=result.slotGroups.find(g=>g.slot===2&&g.round===1&&g.draftSize===10);
assert.equal(second.selections,2);
assert.equal(second.missingSelectionRatePct,100);
assert.equal(second.rookieHeavyMissingSelections,2);
assert.equal(second.rookieHeavySelectionWeightedFollowup.median,null,'never turn absent prices into zero');
assert.equal(second.followup.median,null);
assert.equal(result.counts.uniqueRookies,11,'previous unique-per-player round research unchanged');
console.log('PASS draft-day-aware weighting, rookie-heavy cohort isolation, missing followups and round parity');
