#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {fitAsOf}=require('./market-history/forecast-training');
const row=(originDate,outcomeDate,v1,pos='RB',ageBand='27-29',format='sf')=>
 ({originDate,outcomeDate,v0:2000,v1,pos,ageBand,format});
const train=[
 row('2020-01-01','2023-01-01',1000),
 row('2020-02-01','2023-02-01',1200),
 row('2021-01-01','2024-01-01',4000),
 row('2020-03-01','2023-03-01',null),
 row('2020-02-01','2023-02-01',3000,'WR'),
 row('2020-02-01','2023-02-01',3000,'RB','27-29','oneQB'),
 row('2020-02-01','2023-02-01',0,'TE')
];
let fit=fitAsOf(train,'2023-02-01');
assert.equal(fit.eligible,1,'outcomes on prediction date are not yet eligible');
assert.equal(fit.rejectedFuture,6);
assert.ok(fit.factor(train[0])<1);
fit=fitAsOf(train,'2023-04-01');
assert.equal(fit.eligible,5,'known zero counts; null does not; 2024 result excluded');
assert.equal(fit.unknown,1);
assert.equal(fit.rejectedFuture,1);
assert.ok(fit.factor(train[0])<1);
assert.ok(fit.factor(row('2020-01-01','2023-01-01',0,'QB'))===1,'no cohort evidence preserves baseline');
const reversed=fitAsOf(train.slice().reverse(),'2023-04-01');
assert.equal(fit.factor(train[0]),reversed.factor(train[0]),'source row order does not matter');
assert.equal(fit.factor(row('2020-01-01','2023-01-01',0,'WR')),
 reversed.factor(row('2020-01-01','2023-01-01',0,'WR')));
console.log('PASS as-of chronology, missing handling, zero observations, format isolation, order invariance');
