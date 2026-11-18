#!/usr/bin/env node
'use strict';
// The future label must NOT be derived from a candidate trade formula.
// Check that player-only trades are isolated from approximate pick outcomes.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {laterOutcome}=require('./market-history/outcome-values');
const script=fs.readFileSync(path.join(__dirname,'benchmark-trade-value-outcomes.js'),'utf8');
const players={A:{position:'WR'},B:{position:'RB'}};
const book={
 latestDate:'2026-11-17',
 at:(k,d)=>({A:150,B:100,'p2024-1':200})[k]??null,
 later:(k,d)=>({A:200,B:300,'p2024-1':100})[k]??null
};
const doc={leagues:{L:[2,0]},trades:{
 trade1:['2024-01-01','L',['A'],['B']],
 trade2:['2024-02-01','L',['A','p2024-1'],['B']]
}};
let result;
const mocks=name=>{
 if(name==='./market-history/ktc-book')return {
  readSleeperPlayers:()=>players,seasonFiles:()=>['2024.json.gz'],
  readSeason:()=>doc,ktcPrices:()=>book,formatOf:()=>'sf'
 };
 if(name==='./lib-market')return {loadVault:()=>({tradeValueRatio:()=>5})};
 if(name==='./market-history/outcome-values')return {laterOutcome};
 throw Error(name);
};
vm.runInNewContext(script,{require:mocks,
 process:{env:{SAMPLE_MOD:'1'}},
 console:{log:s=>{result=JSON.parse(s)}},
 Date,Map,Set,Math,Number,String,Object,Array,Error});
assert.equal(result.schemaVersion,2);
assert.equal(result.counts.mature,2);
assert.equal(result.counts.complete,2);
assert.equal(result.counts.playerOnlyMature,1);
assert.equal(result.counts.playerOnlyComplete,1);
assert.equal(result.playerOnly.strict.n,1);
assert.equal(result.playerOnly.strict.matched,1);
assert.equal(result.playerOnly.strict.vaultWins,0,
 'Vault predicts A wins but future A=200 B=300, so the independent winner is B');
assert.equal(result.playerOnly.strict.rawWins,0);
assert.equal(result.overall.strict.notDecisive,1,
 'pick-containing trade finishes with equal future sums and must not be assigned a winner');
assert.equal(result.by.playerOnlyYear['2024'].strict.n,1);
assert.equal(result.by.year['2024'].strict.n,2);
assert.ok(result.warnings.some(x=>x.includes('independently')));
console.log('PASS independent future-value trade labels, future ties and player-only cohort isolation');
