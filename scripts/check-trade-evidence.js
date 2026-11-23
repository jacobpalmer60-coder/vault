#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const Evidence=require('../trade-evidence.js');
const known=[{rosterId:1},{rosterId:2},{rosterId:3},{rosterId:4}];
const activity=[
 {transaction_id:'A',roster_ids:[1,2]},
 {transaction_id:'A',roster_ids:[1,2]},
 {transaction_id:'B',roster_ids:[2,3]},
 {transaction_id:'C',roster_ids:[1,4],_ownerAttributionUncertain:true},
 {transaction_id:'D',roster_ids:[1,3]}];
const grade=(id,partial=false,uncertain=false)=>({tx:{transaction_id:id,_ownerAttributionUncertain:uncertain},anyMissingValue:partial,fairness:{overallPct:14}});
const graded=[grade('A'),grade('B',true),grade('C',false,true),grade('D')];
const stats=Evidence.summarize({tradeActivity:activity,allGraded:graded,weekErrors:[{season:'2024',weeks:[2,7]}]});
assert.equal(stats.total,4);
assert.equal(stats.graded,2);
assert.equal(stats.ungraded,2);
assert.equal(stats.ownerUncertain,1);
assert.equal(stats.missingWeeks,2);
assert.deepEqual(stats.reliableGrades.map(g=>g.tx.transaction_id),['A','D']);
assert.equal(Evidence.reliable(grade('B',true)),false);
assert.equal(Evidence.reliable(grade('C',false,true)),false);
const per=Evidence.byManager(activity,known);
assert.deepEqual([...per],[['1',2],['2',2],['3',2],['4',0]]);
assert.ok(Evidence.render(stats,{activityHref:'activity.html?league_id=xyz'}).includes('Recorded trades'));
assert.ok(Evidence.render(stats).includes('counts may be incomplete'));
const empty=Evidence.summarize({tradeActivity:[{transaction_id:'Z',roster_ids:[2,3]}]});
assert.equal(empty.total,1);assert.equal(empty.graded,0);
assert.ok(Evidence.render(empty).includes('cannot receive a trustworthy verdict'));
console.log('PASS trade evidence: all-team parity, missing prices, duplicates, uncertain owners and incomplete seasons');
