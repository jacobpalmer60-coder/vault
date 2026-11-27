#!/usr/bin/env node
'use strict';
// Regressions for the additive-market-first redesign, including the live
// Boston + Kiner / Kittle failure case and BOTH managers' reversed order.
// Historical accepted-trade curve remains visible, but is no longer a price
// source for active advice, coach, negotiation, or completed-trade grading.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {loadVault}=require('./lib-market');
const Policy=require('../trade-policy');
const Vault=loadVault();
Vault.setGradeMarket({updated:'2026-11-22',formats:{sf_tep:{
 'n:corey kiner':-6.1,'n:george kittle':-1.7
}}},true,0.5);
const player=(name,value,pos,age)=>({name,type:'player',key:'n:'+name.toLowerCase(),pos,value,age});
const A=[player('Denzel Boston',4472,'WR',23),player('Corey Kiner',1984,'RB',24)];
const B=[player('George Kittle',4524,'TE',33)];
const baseline=JSON.stringify([A,B]);
const pct=(x,y)=>200*(x-y)/(x+y||1);
const close=(actual,want,tol=0.02)=>assert.ok(Math.abs(actual-want)<tol,
 'got '+actual+' but expected '+want+' ± '+tol);
const market=Vault.marketSideValues(A,B),legacy=Vault.tradeSideValues(A,B);
close(pct(market.valueA,market.valueB),35.019);
close(pct(legacy.valueA,legacy.valueB),1.37985);
assert.equal(Vault.priceWord(Vault.fairnessBucket(Math.abs(pct(market.valueA,market.valueB)),0,0)),'Lopsided');
assert.equal(Vault.priceWord(Vault.fairnessBucket(Math.abs(pct(legacy.valueA,legacy.valueB)),0,0)),'Fair');
close(market.valueA,6334.976);
close(market.valueB,4447.092);
assert.equal(market.bonusA,0);
assert.equal(market.bonusB,0);
assert.equal(market.basis,'additive-market');
assert.equal(Policy.priceAudit(Vault,A,B).primaryBasis,'additive-market');
assert.equal(Policy.priceAudit(Vault,A,B).historicalCurveOnly,true);
assert.equal(JSON.stringify([A,B]),baseline,'pricing must never modify an offer');
console.log('PASS Boston/Kiner/Kittle: primary 35% market Lopsided; old 1% only in archived curve');

for(const [a,b] of [[A,B],[B,A],[A,[B[0],A[1]]],[[A[0]],B],
 [[{value:10,type:'pick'},{value:25,type:'player'}],[{value:35,type:'player'}]]]){
 const m=Vault.marketSideValues(a,b),reverse=Vault.marketSideValues(b,a);
 close(m.valueA,reverse.valueB,1e-10);
 close(m.valueB,reverse.valueA,1e-10);
 close(pct(m.valueA,m.valueB),-pct(reverse.valueA,reverse.valueB),1e-10);
 const noPremium=Vault.marketSideValues(a,b,{market:false});
 close(noPremium.valueA,a.reduce((s,x)=>s+x.value,0),1e-10);
 close(noPremium.valueB,b.reduce((s,x)=>s+x.value,0),1e-10);
}
const single=Vault.marketSideValues([A[0]],B);
close(market.valueA-single.valueA,Vault.gradeValue(A[1]),1e-9);
const vp=Vault.verdictValuePct(A,B);
const pieceA=A.reduce((s,p)=>s+Vault.verdictPieceValue(p),0);
const pieceB=B.reduce((s,p)=>s+Vault.verdictPieceValue(p),0);
close(vp,pct(pieceA,pieceB),1e-9);
close(vp,-Vault.verdictValuePct(B,A),1e-9);
assert.ok(Vault.verdictPieceValue(A[1])>1000,'Kiner cannot disappear from a team verdict either');
assert.equal(Vault.verdictRecordText({mode:'rebuild',record:{rebuild:0.99}}),'',
 'old tier win-rate predictions cannot leak under the new price model');
console.log('PASS symmetry, one-for-one, picks, additive monotonicity and verdict piece accounting');

const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
for(const p of ['trade.html','coach.js','negotiation.js','trade_grades.html',
  'grade.html','market-data.js','trade_database.html']){
 const src=read(p);
 assert.match(src,/Vault\.marketSideValues\(/,p+' must use live additive market pricing');
 assert.doesNotMatch(src,/Vault\.tradeSideValues\(/,p+' must not use retired curve for advice');
}
const core=read('vault-core.js');
const grade=core.slice(core.indexOf('  gradeTrade('),core.indexOf('    // Walks the same previous_league_id',core.indexOf('  gradeTrade(')));
assert.match(grade,/Vault\.marketSideValues\(toB, toA/);
assert.match(grade,/Vault\.marketSideValues\(toBTodayPrices, toATodayPrices/);
assert.doesNotMatch(grade,/Vault\.tradeSideValues\(/);
const trade=read('trade.html');
assert.match(trade,/Primary market-price grade/);
assert.match(trade,/Legacy package curve/);
assert.match(trade,/Primary price gap/);
assert.match(trade,/VaultTradePolicy\.evenImprovement\(/);
assert.doesNotMatch(trade,/originalAdditiveGap|improvement\.packageGain/);
assert.match(read('trade-price-audit-ui.js'),/does not determine today's price grade/);
assert.match(read('how_we_grade.html'),/cutoffs are provisional/i);
assert.match(read('trade_database.html'),/retired package-consolidation curve/i,
 'precomputed historical market charts must identify their previous price model');
assert.match(read('trade_lab.html'),/retired nonlinear consolidation curve/,
 'Trade Lab historical data must not claim to be freshly re-priced');
console.log('PASS calculator, coach, negotiation, trade grades, balancing, explanatory labels');

const policy=Policy.evenImprovement({
 before:{A:{level:'tossup',score:0},B:{level:'tossup',score:0}},
 after:{A:{level:'tossup',score:0},B:{level:'tossup',score:0}},
 priceBefore:35,priceAfter:50
});
assert.equal(policy,null,'worse market price is not a better offer');
console.log('PASS no old consolidation model silently controls recommendations');
