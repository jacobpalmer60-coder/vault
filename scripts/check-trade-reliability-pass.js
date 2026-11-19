#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const trade=read('trade.html'),coach=read('coach.js');
const part=(source,a,b)=>{
 const start=source.indexOf(a),end=source.indexOf(b,start+a.length);
 assert.ok(start>=0&&end>start,a+' not found');return source.slice(start,end);
};
assert.ok(trade.includes('evenFix.contextKey===evenContextKey()'),'Even It Out must validate both-team and timeline identity');
assert.ok(trade.includes('evenLine.plan.contextKey!==evenContextKey()'),'outdated suggestions cannot be applied');
assert.ok(trade.includes('if(current!==key)return;'),'deferred suggestion must check selected assets before commit');
assert.ok(trade.includes('Scenario difference from usual:'),'Stress Test shows deviation from unchanged trade');
assert.ok(trade.includes('Official grading, Even It Out and Trade Coach are unaffected.'),'scenario is not promoted to a verdict');
// Make sure resetting Coach clears not just displayed scores but cached decisions.
const reset=part(coach,'function coachReset() {','// From a roster row:');
const state={Coach:{results:{old:true},work:{tweaks:[1]}},coachScoreMemo:new Map([['a',1]]),
 coachCache:{me:{},plan:'old',pool:{},judged:new Map([['a',2]])},
 coachOpen:()=>false,renderCoach:()=>{throw Error('unexpected redraw')},coachWorkTweaks:()=>{}};
vm.runInNewContext(reset+'\ncoachReset();',state);
assert.equal(state.coachCache.me,null);
assert.equal(state.coachCache.pool,null);
assert.equal(state.coachCache.judged.size,0);
assert.equal(state.coachScoreMemo.size,0);
assert.equal(state.Coach.work.tweaks,null);
assert.equal(Object.keys(state.Coach.results).length,0);
// Even without an explicit reset, a newly loaded trade-history style map
// invalidates the scores and the cached counterparty's acceptance prediction.
const cacheCode=part(coach,'const coachCache = {','function coachJudged(');
const stylesCtx={
 Vault:{planOverride:{}},Negotiation:{styles:null},
 coachScoreMemo:new Map([['a',1]]),Map,Object,JSON
};
const cacheFunctions=vm.runInNewContext(cacheCode+'\n({coachCacheFor,coachCache})',stylesCtx);
const currentTeam={rosterId:1};
cacheFunctions.coachCacheFor(currentTeam);
cacheFunctions.coachCache.judged.set('offer',{accepts:true});
stylesCtx.coachScoreMemo.set('score',3);
stylesCtx.Negotiation.styles=new Map([[2,{trades:4}]]);
cacheFunctions.coachCacheFor(currentTeam);
assert.equal(cacheFunctions.coachCache.judged.size,0,'new partner history invalidates acceptance');
assert.equal(stylesCtx.coachScoreMemo.size,0,'new partner history invalidates rank scores');
const audits=require('./audit-trade-accuracy');
const sample={
 schemaVersion:2,generated:'2026-11-18',sampleMod:10,
 counts:{complete:3000,playerOnlyComplete:2000},
 overall:{strict:{matched:3000,vaultAdvantagePoints:1}},
 playerOnly:{strict:{matched:2000,vaultAdvantagePoints:-1}},
 by:{
  year:{2024:{strict:{matched:1500,vaultAdvantagePoints:-4},imputed:{matched:1500,vaultAdvantagePoints:-1}},
    2025:{strict:{matched:1500,vaultAdvantagePoints:3},imputed:{matched:1500,vaultAdvantagePoints:3}}},
  playerOnlyYear:{2024:{strict:{matched:1000,vaultAdvantagePoints:2}},
    2025:{strict:{matched:1000,vaultAdvantagePoints:1}}},
  shape:{'2024|1-for-2':{strict:{matched:1100,vaultAdvantagePoints:-5}}}
 }
};
const audit=audits.audit(sample);
assert.ok(audit.findings.some(x=>x.severity==='weakness'&&x.scope==='package 2024|1-for-2'));
assert.ok(audit.findings.some(x=>x.severity==='warning'&&x.scope==='year stability'));
assert.ok(audit.findings.some(x=>x.severity==='warning'&&x.scope==='player-only 2024'));
assert.ok(audit.findings.some(x=>x.severity==='sensitivity'));
assert.throws(()=>audits.audit({...sample,schemaVersion:1}),/schema v2/);
assert.ok(audit.guardrails.some(x=>x.includes('not auto-change live')));
console.log('PASS two-team adjustment freshness, Coach cache reset, Stress Test isolation and accuracy-audit guardrails');
