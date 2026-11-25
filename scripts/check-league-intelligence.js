'use strict';
const assert=require('node:assert/strict');
const {profileLeague}=require('../league-intelligence');
const date='2026-11-24';
const rows=[
 {rosterId:1,complete:true,starterPpg:150,playerValue:90,pickValue:10,weightedAge:29},
 {rosterId:2,complete:true,starterPpg:130,playerValue:80,pickValue:20,weightedAge:26},
 {rosterId:3,complete:true,starterPpg:100,playerValue:50,pickValue:30,weightedAge:25},
 {rosterId:4,complete:true,starterPpg:70,playerValue:40,pickValue:40,weightedAge:24}
];
const a=profileLeague(rows,date);
assert.equal(a.teams[0].archetype,'aging-contender');
assert.equal(a.teams[3].archetype,'rebuild-position');
assert.equal(a.teams[0].ranks.starterPpg,1);
assert.deepEqual(profileLeague([...rows].reverse(),date).teams.reverse(),a.teams);
assert.deepEqual(profileLeague(rows.map(r=>({...r,isUser:r.rosterId===3})),date).teams,a.teams);
const partial=profileLeague(rows.map((r,i)=>i===0?{...r,complete:false}:r),date);
assert.equal(partial.teams[0].starterPpg,null);
assert.ok(partial.teams.every(t=>t.archetype==='unknown'));
const tied=profileLeague(rows.map(r=>({...r,starterPpg:100})),date);
assert.ok(tied.teams.every(t=>t.ranks.starterPpg===.5));
assert.throws(()=>profileLeague([rows[0],rows[0]],date),/Unique/);
assert.throws(()=>profileLeague(rows,'2026-02-30'),/valid/);
assert.equal(profileLeague(rows.slice(0,3),date).teams[0].archetype,'unknown');
console.log('PASS symmetric, tie-aware, complete-league-only descriptive intelligence; no inferred missing data or user bias');
