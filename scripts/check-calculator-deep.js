#!/usr/bin/env node
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadVault}=require('./lib-market'),Vault=loadVault();
const trade=fs.readFileSync(path.join(__dirname,'..','trade.html'),'utf8');
const extract=(a,b)=>{const i=trade.indexOf(a),j=trade.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,a);return trade.slice(i,j)};
const pool=[{id:'r20',pos:'RB',ppg:20},{id:'w19',pos:'WR',ppg:19},{id:'r1',pos:'RB',ppg:1}];
assert.equal(Vault.optimalLineup(pool,['FLEX','RB']),39);
assert.equal(Vault.optimalLineup(pool,['RB','FLEX']),39);
assert.equal(Vault.optimalLineup([{id:'q',pos:'QB',ppg:28},{id:'r',pos:'RB',ppg:22},{id:'q2',pos:'QB',ppg:9}],['SUPER_FLEX','QB']),50);
console.log('PASS restricted and flexible slot order cannot lower best lineup');
function brute(p,s,i=0,used=new Set()){
 if(i===s.length)return 0;let best=brute(p,s,i+1,used);
 p.forEach((v,k)=>{if(used.has(k)||!Vault.slotAllows(s[i]).includes(v.pos))return;used.add(k);best=Math.max(best,v.ppg+brute(p,s,i+1,used));used.delete(k)});
 return best;
}
let seed=8723;const rand=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
const positions=['QB','RB','WR','TE'],slots=['RB','WR','FLEX','SUPER_FLEX','REC_FLEX','WRRB_FLEX','QB','TE'];
for(let i=0;i<100;i++){
 const players=Array.from({length:3+Math.floor(rand()*5)},(_,j)=>({id:'p'+j,pos:positions[Math.floor(rand()*4)],ppg:Math.floor(rand()*31)}));
 const starts=Array.from({length:2+Math.floor(rand()*3)},()=>slots[Math.floor(rand()*slots.length)]);
 const expected=brute(players,starts);
 assert.equal(Vault.optimalLineup(players,starts),expected,'random lineup '+i);
 assert.equal(Vault.optimalLineup(players,[...starts].reverse()),expected,'slot inversion '+i);
}
console.log('PASS 100 exact-vs-brute-force lineup scenarios');
const week=Vault.seasonLineupDetail(pool.map(p=>({...p,avail:'1'.repeat(18)})),['FLEX','RB'],[11,12]);
assert.equal(week.total,39);assert.equal(week.byWeek.get(11),39);
const future=Vault.futureLineupValue([
 {type:'player',pos:'RB',value:2000,age:26},{type:'player',pos:'WR',value:1900,age:25},{type:'player',pos:'RB',value:100,age:28}
],['FLEX','RB'],1,{RB:{26:[1],28:[1]},WR:{25:[1]}},2026);
assert.equal(future,3900);
console.log('PASS weekly and dynasty future lineup projections');
const A={rosterId:1,teamName:'One',lineup:[],assets:[{key:'a1',type:'player',value:100},{key:'a2',type:'player',value:70}]};
const B={rosterId:2,teamName:'Two',lineup:[],assets:[{key:'b1',type:'player',value:20},{key:'b2',type:'player',value:70},{key:'b3',type:'pick',value:10}]};
function checkPlan(accept, opts={}){
 const approvals=[];
 const ctx={
  teamOf:s=>s==='A'?(opts.A||A):(opts.B||B),selectedA:opts.selectedA||new Set(['a1']),selectedB:opts.selectedB||new Set(['b1']),
  EVEN_MAX_GAP:8,EVEN_OPTIONS:6,EVEN_PIECE_REPEATS:2,
  Vault:{tradeSideValues:(a,b)=>({valueA:a.reduce((n,x)=>n+x.value,0),valueB:b.reduce((n,x)=>n+x.value,0)})},
  computeTradeAnalysis:(_a,_b,_aa,_bb,vA,vB)=>({gap:200*Math.abs(vA-vB)/(vA+vB)}),
  improvementOf:an=>({level:an.gap<=8?'tossup':'bad',score:an.gap<=8?0:-20}),
  negContextFor:t=>({team:t}),
  negJudgeFor:(_o,_og,r,_rg,c)=>{approvals.push(r.rosterId);return {accepts:accept(r.rosterId,c.team.rosterId)}},
  Math,Map,Set
 };
 const f=vm.runInNewContext(extract('function evenPlan() {','// The first fix in words')+'\nevenPlan;',ctx);
 return {plan:f(),approvals};
}
const good=checkPlan(()=>true);assert.ok(good.plan?.options?.length);
assert.ok(good.approvals.includes(1)&&good.approvals.includes(2));
assert.equal(checkPlan(id=>id!==1).plan,null);
assert.equal(checkPlan(id=>id!==2).plan,null);
console.log('PASS both sides must approve Even It Out recommendations');
const tripleA={rosterId:11,teamName:'Triple A',lineup:[],assets:[{key:'anchorA',type:'player',value:100}]};
const tripleB={rosterId:12,teamName:'Triple B',lineup:[],assets:[
 {key:'anchorB',type:'player',value:20},{key:'x15',type:'player',value:15},
 {key:'x25',type:'player',value:25},{key:'x40',type:'player',value:40}
]};
const triple=checkPlan(()=>true,{A:tripleA,B:tripleB,selectedA:new Set(['anchorA']),selectedB:new Set(['anchorB'])});
assert.ok(triple.plan?.options.some(o=>o.add.length===3),'must find a fair three-piece repair');
const starterB={...tripleB,lineup:[{id:'starter'}],assets:[
 {key:'anchorB',type:'player',value:20},{key:'p_starter',type:'player',value:80,id:'starter'}
]};
const starter=checkPlan(()=>true,{A:tripleA,B:starterB,selectedA:new Set(['anchorA']),selectedB:new Set(['anchorB'])});
assert.ok(starter.plan?.options.some(o=>o.add.some(a=>a.key==='p_starter')),'starter must be eligible when the manager accepts');
const mirrored=checkPlan(()=>true,{A:starterB,B:tripleA,selectedA:new Set(['anchorB']),selectedB:new Set(['anchorA'])});
assert.ok(mirrored.plan?.options.some(o=>o.add.some(a=>a.key==='p_starter')),'same fix must survive swapping A and B');
console.log('PASS three-piece repairs, optional starters, and team-side symmetry');

const corner=vm.runInNewContext(extract('function cornerstoneWarningsHtml(','function updateTrade()')+'\ncornerstoneWarningsHtml;',{
 Vault:{cornerstone:(_t,a)=>a.key.endsWith('1')?{rank:1,mode:'contend',share:0.02}:null,escapeHtml:x=>x}
});
const warnings=corner(A,[A.assets[0]],B,[B.assets[0]]);
assert.ok(warnings.includes('One sends')&&warnings.includes('Two sends'));
assert.ok(trade.includes('[teamA, teamB].map(t =>')&&trade.includes('setTeamTimeline('));
console.log('PASS both sides show cornerstone warnings and timeline controls');
console.log('All deep calculator parity tests passed.');
