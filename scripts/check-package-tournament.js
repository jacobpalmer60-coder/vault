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

const shared=require('../package-pricing');
const pa=shared.compare([6086],[2556,4492]),pb=shared.compare([2556,4492],[6086]);
assert.ok(pa.signedPct>0&&pa.additivePct<0);
assert.ok(Math.abs(pa.valueA-pb.valueB)<1e-8);assert.ok(Math.abs(pa.valueB-pb.valueA)<1e-8);
assert.ok(Math.abs(pa.signedPct+pb.signedPct)<1e-9);
assert.equal(shared.compare([0],[1]),null);
assert.equal(shared.compare([100],[100]).bonusA,0);
assert.ok(Math.abs(r.gaps[idx('raw-power-2')]-Math.abs(pa.signedPct))<1e-9);
const ui=shared.html({raw:pa,adjusted:null},'Salt Factory','TURBONUTZ',String);
assert.match(ui,/Favors Salt Factory/);assert.match(ui,/not the live grade/);
assert.match(ui,/reverses the additive price direction/);
const fs=require('node:fs'),path=require('node:path');
for(const f of ['trade.html','grade.html','trade_grades.html','trade_database.html']){
 const doc=fs.readFileSync(path.join(__dirname,'..',f),'utf8');
 assert.match(doc,/package-pricing\.js\?v=/);
 assert.match(doc,/VaultPackagePricing\.read/);
}
assert.match(fs.readFileSync(path.join(__dirname,'..','coach.js'),'utf8'),/VaultPackagePricing\.read/);
console.log('PASS shared research preview, direction and cross-tool wiring');
