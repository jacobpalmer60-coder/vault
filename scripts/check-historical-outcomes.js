#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {laterOutcome}=require('./market-history/outcome-values');
const values={good:100,faded:0,gone:0,rival:90,missing:NaN,absent:null};
const book={later:k=>values[k]};
const ratio=(a,b)=>a.reduce((s,v)=>s+v,0)/b.reduce((s,v)=>s+v,0);
const x=k=>({k});
const read=(a,b)=>laterOutcome(a.map(x),b.map(x),'2026-10-01',book,ratio);
let r=read(['good','faded'],['rival']);
assert.deepEqual(r.got,[100,0]);
assert.deepEqual(r.gave,[90]);
assert.equal(r.complete,true);
assert.ok(r.pct>0);
assert.ok(Math.abs(r.pct-200*(100-90)/(100+90))<1e-9,
 'future outcome must equal normalized sum difference, not any nonlinear trade ratio');
const malicious=()=>0.00001; // would invert the label in the old circular benchmark
const unaffected=laterOutcome([x('good'),x('faded')],[x('rival')],
 '2026-10-01',book,malicious);
assert.ok(unaffected.pct>0,'future winner must be independent of the Vault valuation algorithm');
assert.ok(Math.abs(unaffected.pct-r.pct)<1e-9,'changing candidate model cannot change ground truth');

assert.equal(read(['gone'],['rival']).pct,-200,'known zero-side loss stays visible');
assert.equal(read(['rival'],['gone']).pct,200,'side reversal preserves sign');
assert.equal(read(['gone'],['faded']).pct,null,'both known-zero outcomes have no winner');
r=read(['absent'],['rival']);
assert.equal(r.complete,false);
assert.equal(r.missingCount,1);
assert.equal(r.pct,null,'unavailable value is NOT a confirmed loss');
assert.equal(r.pctImputed,-200,'imputed sensitivity is explicit');
assert.deepEqual(r.got,[null]);
assert.equal(read(['missing'],['rival']).pct,null,'invalid value is missing, not zero');
assert.equal(read(['faded','absent'],['rival']).pct,null,'one missing asset invalidates complete case');
assert.equal(read(['faded','absent'],['rival']).pctImputed,-200);
console.log('PASS observed zeros, missing versus wiped-out, mirrored sides, and imputed sensitivity');
