#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'summarize-value-research.js'),'utf8');
const sampleTrades={schemaVersion:2,counts:{
 sampled:2,mature:2,complete:2,missing:0,playerOnlyMature:1,playerOnlyComplete:1},
 by:{year:{'2024':{strict:{n:2,vaultAgreementPct:0,rawAgreementPct:0,vaultAdvantagePoints:0}}},
 playerOnlyYear:{'2024':{strict:{n:1,vaultAgreementPct:0,rawAgreementPct:0,vaultAdvantagePoints:0}}},
 yearQuarter:{},shape:{}}};
const sampleForecast={horizons:[]};
function run(version){
 const output=[];
 const trades={...sampleTrades,schemaVersion:version};
 const fakeFs={readFileSync:p=>Buffer.from(JSON.stringify(String(p).includes('trade')?trades:sampleForecast),'utf8')};
 vm.runInNewContext(src,{
  require:n=>n==='node:fs'?fakeFs:n==='node:path'?path:null,
  process:{argv:['node','summary','trade-cohorts.txt','rebuild-horizons.txt'],cwd:()=>'.'},
  console:{log:(...xs)=>output.push(xs.join(' '))},
  Number,Object,Array,String,JSON,Math,Date,Error
 });
 return output.join('\n');
}
const report=run(2);
assert.match(report,/PLAYER-ONLY TRADES/);
assert.match(report,/Mature player-only trades: 1 Complete: 1/);
assert.match(report,/independent additive price-sum/);
assert.match(report,/corrected in schema v2/);
assert.throws(()=>run(1),/Outdated trade-cohorts benchmark/);
console.log('PASS independent trade research summary, player-only rows and outdated schema guard');
