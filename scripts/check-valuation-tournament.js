'use strict';
const a=require('node:assert/strict'),T=require('./market-history/valuation-tournament');
const model=id=>T.candidates.find(x=>x.id===id);
const comps=Array.from({length:5},()=>({age:1,exact:true,premium:120}));
a.equal(T.premium(model('rolling-full'),comps,0,'player'),120);
a.equal(T.premium(model('cap-50'),comps,0,'player'),50);
a.equal(T.premium(model('confidence-25'),comps,0,'player'),20);
a.equal(T.premium(model('confidence-25'),comps.slice(0,4),0,'player'),0);
a.equal(T.weightedMedian([{age:1,premium:10},{age:40,premium:100},{age:41,premium:120}],7),10);
a.equal(T.evidence([{day:99,value:100,format:'sf'},{day:100,value:100},{day:54,value:100},{day:98,value:200}],100,100,'sf').length,1);
a.equal(T.premium(model('combined-no-cross-format'),comps.map(x=>({...x,exact:false})),0,'player'),0);
const x={now:100,records:comps,archive:5,type:'player'},y={now:150,records:[],archive:0,type:'pick'};
const r=T.row([x],[y],{league:'1',month:'2025-10'}),s=T.row([y],[x],{league:'1',month:'2025-10'});
for(let i=0;i<T.candidates.length;i++){a.ok(Math.abs(r.signed[i]+s.signed[i])<1e-8);a.equal(r.gaps[i],s.gaps[i]);}
a.equal(T.report([r],[s]).candidate,null);
const train=Array.from({length:600},(_,i)=>({...r,league:String(i%60)}));
const t=T.report(train,[s]);a.ok(t.candidate);a.match(t.decision,/insufficient/);
a.deepEqual(T.report(train,[s]).candidate,T.report(train,[r]).candidate);
console.log('PASS valuation tournament: caps, sample shrinkage, recency, chronology, format isolation, symmetry, sparse cohorts and train-only selection');
