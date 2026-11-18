#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { laterOutcome } = require('./market-history/outcome-values');
const book = { later: (k) => ({good:100, faded:0, gone:0, rival:90, missing:NaN})[k] };
const ratio = (a,b) => a.reduce((s,v)=>s+v,0)/b.reduce((s,v)=>s+v,0);
const x = k => ({k});
let r = laterOutcome([x('good'),x('faded')],[x('rival')],'2026-10-01',book,ratio);
assert.deepEqual(r.got,[100,0], 'keep delisted assets in original package');
assert.deepEqual(r.gave,[90]);
assert.ok(r.pct>0);
r = laterOutcome([x('gone')],[x('rival')],'2026-10-01',book,ratio);
assert.equal(r.pct,-200,'entire losing side cannot disappear from evaluation');
r = laterOutcome([x('rival')],[x('gone')],'2026-10-01',book,ratio);
assert.equal(r.pct,200,'reverse direction is symmetric');
assert.equal(laterOutcome([x('gone')],[x('faded')],'2026-10-01',book,ratio),null,'both worthless is uninformative');
r = laterOutcome([x('missing')],[x('rival')],'2026-10-01',book,ratio);
assert.equal(r.pct,-200,'non-finite later values do not introduce NaN');
console.log('PASS retained zero-value assets, one-sided wipeouts, mirror symmetry, and null-safe outcomes');
