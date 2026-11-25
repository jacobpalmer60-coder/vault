'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'..','coach.js'),'utf8');
const context={module:{exports:{}}};vm.runInNewContext(code.slice(code.lastIndexOf('function coachRealityCheck(')),context);
const {coachDiscoveryTargets,coachDiscoveryAssessment,coachDiscoveryShortlist,coachDiscoveryPairs}=context.module.exports;
const player=(key,pos,ppg,value=4000)=>({key,pos,ppg,value,type:'player',age:24});
const me={rosterId:1,lineup:[{id:'a',pos:'RB',ppg:10}],assets:[]};
const others=[{rosterId:2,assets:[player('a','RB',20),player('b','RB',15)]},{rosterId:3,assets:[player('c','RB',17)]}];
const targets=coachDiscoveryTargets(me,others,['rb'],'contend',a=>a.key!=='b');
assert.equal(targets.length,2);assert.equal(targets[0].a.key,'a');assert.equal(targets[1].t.rosterId,3);
const pairs=coachDiscoveryPairs([{a:player('a','RB',20),t:others[0]},{a:player('b','WR',15),t:others[0]},{a:player('c','TE',17),t:others[1]}]);assert.equal(pairs.length,1);assert.equal(pairs[0].get.length,2);assert.equal(pairs[0].t.rosterId,2);
const imp={score:8,level:'good',mode:'contend',ptsPerWeek:2};
const res={dOpt:2,dDepth:0,dPicks:0,dAge:0};
const input={analysis:{resA:res,resB:res},a:imp,b:imp,give:[player('g','WR',12)],get:[player('r','RB',14)],marketFair:true,accepts:true,cutsA:0,cutsB:0};
assert.equal(coachDiscoveryAssessment(input).ok,true);
for(const update of [{accepts:false},{marketFair:false},{cutsA:1},{cutsB:1},{a:{...imp,score:-8,level:'bad'}},{b:{...imp,score:-8,level:'bad'}},{analysis:{resA:{...res,dOpt:0},resB:res}},{analysis:{resA:res,resB:{...res,dOpt:0}}},{analysis:{resA:{...res,dOpt:NaN},resB:res}},{get:[{...input.get[0],value:0}]}])assert.equal(coachDiscoveryAssessment({...input,...update}).ok,false,JSON.stringify(update));
const reversed={...input,a:input.b,b:input.a,analysis:{resA:res,resB:res},give:input.get,get:input.give};
assert.equal(coachDiscoveryAssessment(reversed).ok,true);
const row=(t,g,score)=>({t,give:[player(g,'WR',12)],get:[player('r','RB',14)],mutual:score,r:{score}});
const rows=[row(others[0],'g',10),row(others[0],'h',9),row(others[1],'g',5),row(others[0],'g',10)];
const list=coachDiscoveryShortlist(rows,3);assert.equal(list.length,3);assert.equal(list[1].t.rosterId,3);
console.log('PASS bounded partner-diverse discovery, symmetrical practical benefits, unknown/cut/price/acceptance gates and deduplication');

// Execute the real async search with a cache epoch changing during the first yield.
// No actual team analysis is needed because the stale run must exit before search.
(async()=>{
 const start=code.indexOf('async function coachAimRun('),end=code.indexOf('function coachAimBuild(',start);
 const flow={step:'pick'},oldEpoch=new Map(),newEpoch=new Map();let epoch=oldEpoch,renders=0;
 const me={rosterId:1};const sandbox={coachMe:()=>me,teams:[me],coachFlow:()=>flow,coachCacheFor:()=>({judged:epoch}),coachOpen:()=>true,renderCoach:()=>{renders++},coachTick:async()=>{epoch=newEpoch;}};
 const run=vm.runInNewContext(code.slice(start,end)+'\ncoachAimRun;',sandbox);
 await run('discover');assert.equal(flow.aimRun,null);assert.equal(renders,1,'cache invalidation restarts active search');
 console.log('PASS async Discover cache epoch changes cannot strand the loading screen');
})().catch(e=>{console.error(e);process.exitCode=1;});

const {coachDiscoveryBaseline,coachDiscoveryPriceRead}=context.module.exports;
assert.equal(coachDiscoveryAssessment({...input,a:{...imp,score:-1},b:{...imp,score:-1}}).ok,false);
assert.equal(coachDiscoveryAssessment({...input,a:{...imp,score:-1}}).ok,true);
const p=coachDiscoveryPriceRead({valueA:100,valueB:100},{rawA:120,rawB:80,valueA:120,valueB:80});
assert.equal(p.active,0);assert.equal(p.raw,-40);assert.equal(p.disagreement,true);
const diverse=[row(others[0],'a',10),row(others[0],'b',9),row(others[1],'a',-1),row(others[1],'c',-2)];
assert.equal(coachDiscoveryShortlist(diverse,2).every(x=>x.mutual>=0),true);
const d2=[row(others[0],'a',10),row(others[1],'a',9),row(others[1],'b',8)];
assert.equal(coachDiscoveryBaseline(d2,2)[1].give[0].key,'a');
assert.equal(coachDiscoveryShortlist(d2,2)[1].give[0].key,'b');
assert.equal(coachDiscoveryTargets(me,others,['RB'],'contend',(a,t)=>t.rosterId===3).length,1);
console.log('PASS mutual-grade priority, repeat penalty, team-aware target filtering and signed price disagreement');
