#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const core=fs.readFileSync(path.join(__dirname,'..','vault-core.js'),'utf8');
const managers=fs.readFileSync(path.join(__dirname,'..','managers.html'),'utf8');
const grades=fs.readFileSync(path.join(__dirname,'..','trade_grades.html'),'utf8');
const start=core.indexOf('  buildManagerStats(allGraded, teams, tradeActivity = null) {');
const end=core.indexOf('  // Turns one manager\'s aggregated stats',start);
assert.ok(start>0&&end>start,'complete manager aggregation function found');
const body=core.slice(start,end).replace(/^\s*buildManagerStats\(/,'function buildManagerStats(').replace(/,\s*$/,'');
const build=new Function('Vault','VAULT_CONFIG',body+'\nreturn buildManagerStats;')({},{}); 
const teams=[
 {rosterId:1,teamName:'TURBONUTZ',record:{wins:2,losses:2}},
 {rosterId:2,teamName:'Trade partner',record:{wins:2,losses:2}},
 {rosterId:3,teamName:'Another partner',record:{wins:2,losses:2}}
];
const raw=[
 {transaction_id:'new',roster_ids:[1,2],graded:false},
 {transaction_id:'old',roster_ids:[1,3],graded:true},
 {transaction_id:'new',roster_ids:[1,2],graded:false}, // duplicate from week cache
 {transaction_id:'unknown-old-owner',roster_ids:[1,2],_ownerAttributionUncertain:true,graded:false},
 {transaction_id:'partial-owner',roster_ids:[1,999],graded:false}
];
const results=build([],teams,raw),byId=new Map(results.map(r=>[r.rosterId,r]));
assert.equal(byId.get(1).trades,3,'new ungraded completed trade is counted');
assert.equal(byId.get(2).trades,1,'each manager gets one trade credit, no duplicate');
assert.equal(byId.get(3).trades,1,'other manager shows the same transaction');
assert.equal(byId.get(1).pricedTrades,0,'recording a trade never fabricates its price');
assert.equal(byId.get(2).netValue,0,'ungraded trades cannot alter winnings or value');
assert.equal(build([],teams).find(x=>x.rosterId===1).trades,0,'legacy graded-only path remains valid');
assert.ok(core.includes('Array(19)')&&core.includes('/transactions/${i}'), 'offseason week 0 through week 18 must be fetched');
assert.ok(core.includes("const missingWeeks = weeks.flatMap"),'failed weeks must be surfaced');
assert.ok(core.includes('weekErrors'),'incomplete history is disclosed');
assert.ok(core.includes("['pending','review'].includes(t.status)"),'pending trades exposed separately');
assert.ok(core.includes("cache: 'no-store'"),'current transactions bypass stale browser HTTP cache');
assert.ok(core.includes('const gradeIds = new Set'),'grade status tracked without deducing it from value');
assert.ok(managers.includes('const stats = Vault.buildManagerStats(allGraded, teams, tradeActivity)'),'manager counts read raw trades');
assert.ok(managers.includes('Sleeper #${Vault.escapeHtml(String(tx.transaction_id))}'),'ungraded trades visible in manager record');
assert.ok(managers.includes('awaiting Sleeper processing'),'pending activity clearly labeled');
assert.ok(managers.includes('trade counts may be incomplete'),'missing-week warning clear');
assert.ok(grades.includes('reliably graded of'),'Trade Grades explains reliable grading coverage');
console.log('PASS complete unpriced trades counted on both teams, duplicates excluded, uncertain owner excluded, pending kept separate, week-0/current fetch and coverage warnings');
