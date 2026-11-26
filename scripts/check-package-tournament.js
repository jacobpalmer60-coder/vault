'use strict';
const assert=require('node:assert/strict'),P=require('./market-history/package-tournament'),{loadVault}=require('./lib-market');
const vault=loadVault();
const vba=(a,b)=>vault.ktcVerdict(a.map(value=>({value})),b.map(value=>({value}))).signed;
const a={now:6086,type:'player',archive:0,records:[]},b={now:2556,type:'player',archive:0,records:[]},c={now:4492,type:'pick',archive:0,records:[]};
const meta={league:'fixture',month:'2026-10'};
const r=P.row([a],[b,c],meta,vba),s=P.row([b,c],[a],meta,vba);
assert.ok(r);assert.equal(r.shape,'1-for-2');assert.equal(r.kind,'mixed');
const idx=id=>P.models.findIndex(x=>x.id===id);
assert.ok(Math.abs(r.gaps[idx('raw-additive')]-200*Math.abs(6086-7048)/(6086+7048))<1e-9);
assert.equal(r.gaps[idx('estimated-vba')],Math.abs(vba([6086],[2556,4492])));
for(let i=0;i<P.models.length;i++)if(P.models[i].basis!=='vba')assert.ok(Math.abs(r.gaps[i]-s.gaps[i])<1e-9);
for(const p of [1,1.1,1.25,1.5,2]){
 assert.equal(P.power([6086],p),6086);
 assert.ok(P.power([2556,4492],p)>=4492);
 assert.ok(P.power([2556,4492],p)<=7048+1e-8);
 assert.ok(P.power([2556,4492,1],p)>=P.power([2556,4492],p));
}
for(const w of [.1,.25,.5]){
 assert.equal(P.concentration([6086],w),6086);
 assert.ok(P.concentration([2556,4492,1],w)>=P.concentration([2556,4492],w));
}
assert.equal(P.row([{...a,now:0}],[b,c],meta,vba),null);
assert.equal(P.report([r],[r]).candidate,null);
const train=Array.from({length:600},(_,i)=>({...r,league:'fixture-'+i%100}));
const report=P.report(train,[]);assert.ok(report.candidate);
assert.deepEqual(report.candidate,P.report(train,[s]).candidate);
assert.match(report.decision,/no sufficient/);
console.log('Lamar / Geno + first fixture: '+JSON.stringify(Object.fromEntries(P.models.map((m,i)=>[m.id,Number(r.gaps[i].toFixed(2))]))));
console.log('Estimated VBA fixture: '+JSON.stringify(vault.ktcVerdict([{value:6086}],[{value:2556},{value:4492}])));
console.log('PASS package model: VBA comparator, monotonicity, side symmetry, sparse and train-only selection');
