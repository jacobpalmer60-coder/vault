#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {pair,side,pieces}=require('../team-impact');
const pick=(year,round,original,value)=>({type:'pick',season:year,round,original,value});
const player=(id,pos,value)=>({id,key:id,type:'player',pos,value});
const q=player('q','QB',5500),wr=player('wr','WR',4100),rb=player('rb','RB',2600);
const first=pick(2027,1,1,3500),second=pick(2028,2,2,1250);
const roster=(rosterId,teamName,plist,picks,opt)=>({
 rosterId,teamName,plist,picks,opt,total:pieces(plist).playerValue,
 picksValue:pieces(picks).pickValue,
 overall:pieces(plist).playerValue+pieces(picks).pickValue
});
const A=roster(1,'Alpha',[q,rb],[first],31.4), B=roster(2,'Beta',[wr],[second],19.3);
const afterA=roster(1,'Alpha',[rb,wr],[first,second],29.6);
const afterB=roster(2,'Beta',[q],[],22.4);
const before={A,B},after={A:afterA,B:afterB},giveA=[q],giveB=[wr,second];
const impact=pair(before,after,giveA,giveB);
const reverse=pair({A:B,B:A},{A:afterB,B:afterA},giveB,giveA);
assert.deepEqual(impact.A,reverse.B,'swapping sides preserves team A exact facts');
assert.deepEqual(impact.B,reverse.A,'swapping sides preserves team B exact facts');
assert.equal(impact.A.change.pickValue,1250,'incoming pick adds draft capital');
assert.equal(impact.B.change.pickValue,-1250,'outgoing pick subtracts draft capital');
assert.equal(impact.A.change.playerValue,-1400,'player value reflects moved assets');
assert.equal(impact.B.change.playerValue,1400,'partner gets opposite player value');
assert.equal(impact.A.change.overall,-150,'team value includes both categories');
assert.equal(impact.B.change.overall,150,'zero-sum exchange of market assets');
assert.ok(Math.abs(impact.A.change.lineupPpg+1.8)<1e-9);
assert.ok(Math.abs(impact.B.change.lineupPpg-3.1)<1e-9);
assert.deepEqual(impact.A.picksAdded,['2028-2-2']);
assert.deepEqual(impact.B.picksRemoved,['2028-2-2']);
assert.equal(impact.A.change.playerValue+impact.B.change.playerValue,0);
assert.equal(impact.A.change.pickValue+impact.B.change.pickValue,0);
assert.equal(impact.A.change.overall+impact.B.change.overall,0);
// Zero transfers show no phantom changes.
const same=pair(before,before,[],[]);
for(const k of ['playerValue','pickValue','overall','lineupPpg','playerCount','pickCount']){
 assert.equal(same.A.change[k],0);assert.equal(same.B.change[k],0);
}
assert.deepEqual(same.A.picksAdded,[]);assert.deepEqual(same.B.picksRemoved,[]);
assert.equal(pieces([]).pickValue,0);
assert.equal(side(A,A,[],[]).change.overall,0);
console.log('PASS trade impact ledger swap symmetry, draft capital, player value, lineup, conserved assets, and no-op');
