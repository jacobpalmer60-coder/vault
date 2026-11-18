#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'summarize-rookie-pick-outcomes.js'),'utf8');
const slot=(format,size,round,slot,all,heavy)=>({
 format,year:2024,draftSize:size,round,slot,selections:100,
 distinctRookies:14,known:13,missing:1,missingSelectionRatePct:2,
 rookieHeavySelectionWeightedFollowup:{median:heavy,p25:heavy-100,p75:heavy+100},
 selectionWeightedFollowup:{median:all,p25:all-100,p75:all+100},
 verifiedRookieSelectionsInRookieHeavyDrafts:80,rookieHeavyMissingSelectionRatePct:1,
 rookieHeavySharePct:80,mostCommonRookieSharePct:50
});
const report={generated:'2026-11-18',registryLoaded:true,
 counts:{eligibleDrafts:5,uniqueRookies:25,verifiedFromNflverse:100,verifiedFromSleeper:0,
  unverifiableRookieYear:0,rejectedVeterans:0,ambiguousIdentity:0,
  slotDraftsValidated:3,slotDraftsRejected:1,slotDraftsRookieHeavy:2,slotDraftsNotRookieHeavy:1},
 groups:[{format:'sf',year:2024,round:1,n:25,known:24,missing:1,missingRatePct:4,
  followup:{median:4400},preDraftPickMidMedian:null}],
 slotGroups:[
  slot('sf',12,1,1,4400,4800),slot('sf',12,1,12,2500,2900),
  slot('sf',10,1,1,4100,4600),slot('sf_tep',12,1,1,4500,5000)
 ]};
function render(argv){
 const output=[];
 vm.runInNewContext(script,{
  require:n=>n==='node:fs'?{readFileSync:()=>Buffer.from(JSON.stringify(report))}:
   n==='node:path'?path:null,
  process:{argv:['node','script','research.json',...argv]},
  console:{log:s=>output.push(s)},
  Number,String,Boolean,Array,Object,Math,JSON,Set,Error
 });
 return output.join('\n');
}
const compact=render([]);
assert.match(compact,/sf \| 12-team \| 1.01/);
assert.match(compact,/sf \| 12-team \| 1.12/);
assert.doesNotMatch(compact,/sf \| 10-team \| 1.01/);
assert.doesNotMatch(compact,/sf_tep \| 12-team \| 1.01/);
assert.match(compact,/ROOKIE-HEAVY 4,800/);
assert.match(compact,/HEURISTIC/);
const full=render(['--full']);
assert.match(full,/sf_tep \| 12-team \| 1.01/);
assert.match(full,/sf \| 10-team \| 1.01/);
const filtered=render(['--format=sf','--size=10','--year=2024']);
assert.match(filtered,/sf \| 10-team \| 1.01/);
assert.doesNotMatch(filtered,/sf \| 12-team \| 1.01/);
assert.doesNotMatch(filtered,/sf_tep/);
assert.ok(compact.split('\n').length<35,'default summary remains readable');
console.log('PASS concise default summary, weighted and rookie-heavy medians, full output, size and format filters');
