#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {priceSignals,weightedSignal,assessment,WEIGHTS}=require('./research-trade-separation');
const {report}=require('./report-separated-trade-pricing');
const {review}=require('./review-trade-separation');
const {laterOutcome}=require('./market-history/outcome-values');
const raw=[{key:'star',value:100}],bundle=[{key:'b',value:65},{key:'c',value:65}];
const copy=JSON.stringify({raw,bundle});
const ratio=(a,b)=>a.length===1&&b.length===1?a[0]/b[0]:1.5;
const m=priceSignals(raw,bundle,{tradeValueRatio:ratio});
assert.ok(m.marketPct<0&&m.packagePct>0,'full consolidation reverses price direction');
assert.equal(weightedSignal(m,0),m.marketPct,'0 is raw additive KTC');
assert.equal(weightedSignal(m,1),m.packagePct,'1 is old consolidation');
assert.ok(weightedSignal(m,0.5)>m.marketPct&&weightedSignal(m,0.5)<m.packagePct);
const mirroredPrice=priceSignals(bundle,raw,{tradeValueRatio:(a,b)=>2/3});
assert.ok(Math.abs(mirroredPrice.marketPct+m.marketPct)<1e-9,
 'reversing team A/B must reverse market price advantage');
assert.ok(Math.abs(mirroredPrice.packagePct+m.packagePct)<1e-9,
 'reversing team A/B must reverse the consolidation advantage');
for(const w of WEIGHTS)assert.ok(Math.abs(weightedSignal(mirroredPrice,w)+weightedSignal(m,w))<1e-9,
 'reversing teams must reverse every predeclared scenario');

assert.throws(()=>weightedSignal(m,0.15),/declared research/);
assert.deepEqual(JSON.stringify({raw,bundle}),copy,'original assets never mutated');
const noEvidence=assessment(raw,bundle,{tradeValueRatio:ratio});
assert.equal(noEvidence.rosterImpact,null);
assert.equal(noEvidence.acceptance,null);
assert.equal(noEvidence.researchRecommendation,null,'never fabricate a recommendation');
assert.throws(()=>assessment(raw,bundle,{rosterImpact:{A:{}}}),/both teams/);
assert.throws(()=>assessment(raw,bundle,{acceptance:{A:{}}}),/both teams/);
const withEvidence=assessment(raw,bundle,{tradeValueRatio:ratio,
 rosterImpact:{A:{lineupPpg:-2},B:{lineupPpg:2}},
 acceptance:{A:{accepts:false},B:{accepts:true}}});
assert.equal(withEvidence.researchRecommendation.acceptanceA.accepts,false,'do not silently overwrite manager acceptance');
for(const w of WEIGHTS)assert.equal(weightedSignal({marketPct:25,packagePct:25},w),25);

const source=fs.readFileSync(path.join(__dirname,'benchmark-separated-trade-pricing.js'),'utf8');
const players={A:{position:'WR'},B:{position:'RB'},C:{position:'WR'},D:{position:'TE'}};
const book={
 latestDate:'2026-11-18',
 at:k=>({A:100,B:65,C:65,D:110})[k]??null,
 later:k=>({A:90,B:80,C:80,D:120})[k]??null
};
const docs={
 '2024.json.gz':{leagues:{L:[2,0]},trades:{
  t1:['2024-01-01','L',['A'],['B','C']],
  t2:['2024-02-01','L',['A'],['D']]
 }},
 '2025.json.gz':{leagues:{L:[2,0]},trades:{
  t3:['2025-01-01','L',['A'],['B','C']]
 }}
};
let data;
const mocks=name=>{
 if(name==='./market-history/ktc-book')return {
  readSleeperPlayers:()=>players,seasonFiles:()=>Object.keys(docs),
  readSeason:f=>docs[f],ktcPrices:()=>book,formatOf:()=>'sf'
 };
 if(name==='./market-history/outcome-values')return {laterOutcome};
 if(name==='./lib-market')return {loadVault:()=>({tradeValueRatio:ratio})};
 if(name==='./research-trade-separation')return require('./research-trade-separation');
 throw Error(name);
};
vm.runInNewContext(source,{
 require:mocks,process:{env:{SAMPLE_MOD:'1'}},console:{log:s=>{data=JSON.parse(s)}},
 Date,Map,Set,Math,Number,String,Object,Array,Error
});
assert.equal(data.kind,'research-price-separation');
assert.equal(data.counts.complete,3);
assert.equal(data.playerOnlyShape['2024|1-for-2'].decisive,1);
assert.equal(data.playerOnlyShape['2025|1-for-2'].decisive,1);
assert.equal(data.playerOnlyYear['2025'].weights['0'].right,1,'raw price winner is bundle');
assert.equal(data.playerOnlyYear['2025'].weights['1'].wrong,1,'full consolidation predicts wrong bundle direction');
assert.equal(data.playerOnlyShape['2024|1-for-1'].weights['0'].right,
 data.playerOnlyShape['2024|1-for-1'].weights['1'].right,'one-for-one parity');
const sideBySide=review({sideA:raw,sideB:bundle},ratio);
assert.ok(sideBySide.includes('Additive market price'));
assert.ok(sideBySide.includes('NOT MEASURED'));
assert.ok(sideBySide.includes('UNKNOWN'));
assert.ok(sideBySide.includes('No final trade recommendation'));
const described=review({sideA:raw,sideB:bundle,
 rosterImpact:{A:{lineupDelta:2},B:{lineupDelta:-2}},
 acceptance:{A:{accepts:true},B:{accepts:false}}},ratio);
assert.ok(described.includes('"accepts":false'));
assert.ok(described.includes('Evidence supplied for BOTH sides'));
const formatted=report(data);
assert.ok(formatted.includes('Player-only packages'));
assert.ok(formatted.includes('full-minus-raw'));
assert.ok(formatted.includes('no live valuations were changed'));
console.log('PASS research price/roster/acceptance separation, 2024-2025 historical scenarios, cohort parity, immutable inputs, report');
