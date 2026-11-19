#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {loadVault}=require('./lib-market');
const {audit}=require('./audit-trade-accuracy');
const Vault=loadVault();
// With one traded asset on each side the nonlinear consolidation rule MUST
// reduce to the raw market value direction exactly.
for(const a of [1,100,1000,5000,10000]){
 for(const b of [1,150,1200,5500,10000]){
  const raw=Math.sign(a-b);
  const vault=Math.sign(Vault.tradeValueRatio([a],[b])-1);
  assert.equal(vault,raw,'one-for-one '+a+' / '+b);
 }
}
const s=(matched,advantage,disagree=0)=>({
 matched,vaultAdvantagePoints:advantage,disagree,
 vaultOnlyRight:Math.round(disagree/3),rawOnlyRight:Math.round(disagree*2/3)
});
const data={
 schemaVersion:2,generated:'2026-11-18',sampleMod:10,
 counts:{complete:3000,playerOnlyComplete:1000},
 overall:{strict:s(3000,-10)},playerOnly:{strict:s(1000,-5)},
 by:{year:{2024:{strict:s(3000,-10),imputed:s(3000,-8)}},
 playerOnlyYear:{2024:{strict:s(1000,-5)}},
 shape:{'2024|1-for-1':{strict:s(1200,0,0)},'2024|1-for-2':{strict:s(1500,-15,600)}},
 tradeValueGap:{'2024|0-5%':{strict:s(1800,-13,500)}}}
};
const result=audit(data);
assert.equal(result.majorShapes.length,2);
assert.equal(result.majorShapes[0].shape,'2024|1-for-2');
assert.equal(result.majorShapes[1].disagree,0);
assert.equal(result.gapGroups[0].disagreementRatePct,27.78);
assert.ok(result.guardrails.some(x=>x.includes('nonlinear consolidation')));
console.log('PASS price-direction parity on 1-for-1, package-disagreement and original-price gap diagnostics');
