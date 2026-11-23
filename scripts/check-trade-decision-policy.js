#!/usr/bin/env node
'use strict';
// No network or historical outcome files: deterministic correctness checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Policy = require('../trade-policy');
const {loadVault} = require('./lib-market');
const Vault = loadVault();
const trade = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');
const negotiation = fs.readFileSync(path.join(__dirname, '..', 'negotiation.js'), 'utf8');
const block = (src, a, b) => {
  const start = src.indexOf(a), end = src.indexOf(b, start + a.length);
  assert.ok(start >= 0 && end > start, 'missing code interval: ' + a);
  return src.slice(start, end);
};

// The formula for each side's trade-market value must mirror when teams swap.
const a = [{key:'A',type:'player',pos:'WR',value:7000,age:25}];
const b = [{key:'B',type:'player',pos:'RB',value:4300,age:27},
  {key:'C',type:'pick',pos:'PICK',value:2400,season:2027,round:1}];
const fixed = JSON.stringify([a,b]);
const left = Policy.ledger(Vault,a,b), right = Policy.ledger(Vault,b,a);
assert.ok(Math.abs(left.additiveGap + right.additiveGap) < 1e-7);
assert.ok(Math.abs(left.packageGap + right.packageGap) < 1e-7);
assert.ok(Math.abs(left.packageA - right.packageB) < 1e-7);
assert.ok(Math.abs(left.packageB - right.packageA) < 1e-7);
assert.equal(JSON.stringify([a,b]),fixed,'price read never mutates original assets');
console.log('PASS additive vs consolidation reads are separate and mirror teams');

// Recommendation is the same one used by the recipient verdict, not an
// independent "would accept" that contradicts the displayed advice.
const warning = Policy.receiverDecision({will:12,ask:-12,drops:0,level:'bad'});
assert.equal(warning.accepts,true,'behavior can differ from advisory grade');
assert.equal(warning.gradeConflict,true,'the difference must not be hidden');
assert.deepEqual(Policy.receiverDecision({will:0,ask:-12,drops:0,level:'tossup'}).accepts,true);
assert.equal(Policy.receiverDecision({will:0,ask:-12,drops:0,level:'good'}).gradeConflict,false);
assert.equal(Policy.receiverDecision({will:0,ask:-12,drops:2,level:'good'}).accepts,false);
assert.equal(Policy.receiverDecision({will:-13,ask:-12,drops:0,level:'good'}).accepts,false);
assert.equal(Policy.receiverDecision({will:NaN,ask:-12,drops:0,level:'good'}).accepts,false);
for(const [trades,basis] of [[0,'market'],[2,'history'],[8,'history'],[30,'history']]){
  const e=Policy.evidence({basis,style:{trades}});
  assert.equal(e.count,trades);
  assert.match(e.note,/not a measured acceptance probability|no dependable manager-specific acceptance estimate/);
  if(trades<4)assert.notEqual(e.sample,'Meaningful league sample');
}
console.log('PASS independent recommendation, roster-cap, and evidence labeling');

// Exercise the exact negotiation implementation, not a re-created formula.
const nsrc = block(negotiation,'function negJudgeFor(teamO, oAssets, teamR, rAssets, ctx) {',
  '// The manager\'s reply');
const negCtx = {
  VaultTradePolicy:Policy,
  Vault:{
    tradeSideValues:(x,y)=>({valueA:x.reduce((s,p)=>s+p.value,0),valueB:y.reduce((s,p)=>s+p.value,0)}),
    ownTradeRead:()=>0, acceptTolerance:()=>12, escapeHtml:x=>x
  },
  computeTradeAnalysis:()=>({fairness:{overallSigned:0,value:0},
    heads:{A:{tone:'good'},B:{tone:'good'}}, rosterFit:{B:0},timelineFit:{B:0}}),
  improvementOf:()=>({level:'bad'}),
  VAULT_CONFIG:{ROSTER_FIT_SCALE:1,TIMELINE_FIT_SCALE:1},
  rosterCap:40,projectedRosterCount:()=>10,negConcerns:()=>[],
  NEG:{CONSOLIDATION_BONUS:1,SITE_NO_PENALTY:5,STAR_1FOR1:[]},
  Math,Set,Number
};
const manager = {rosterId:2,teamName:'Partner'};
const give = [{key:'a',value:3000,type:'player',name:'A'}];
const get = [{key:'b',value:3000,type:'player',name:'B'}];
const judge = vm.runInNewContext(nsrc + '\nnegJudgeFor;',negCtx);
const negative = judge({rosterId:1},give,manager,get,{basis:'market',needs:[],surpluses:[]});
assert.equal(negative.siteSaysNo,true);
assert.equal(negative.accepts,true,'acceptance remains distinct from team benefit');
assert.equal(negative.gradeConflict,true,'the conflict must be explicit');
negCtx.improvementOf = ()=>({level:'tossup'});
const neutral = judge({rosterId:1},give,manager,get,{basis:'market',needs:[],surpluses:[]});
assert.equal(neutral.accepts,true);
assert.equal(neutral.gradeConflict,false);
assert.ok(neutral.evidence?.note);
console.log('PASS negotiation flags acceptance-versus-benefit conflicts');

// A restricted search must include real swaps, not only straightforward adds.
// Diversification keeps a competitive swap even when the raw price ordering
// buries all swaps behind 80 cheap singles.
const have=[{key:'owned1',value:40},{key:'owned2',value:50}];
const pool=Array.from({length:100},(_,i)=>({key:'fresh'+i,value:i+1}));
const candidates=Policy.evenCandidates(pool,have,30);
assert.ok(candidates.some(c=>c.add.length===1&&c.drop.length===1));
assert.ok(candidates.some(c=>c.add.length===2&&c.drop.length===1));
const priced=candidates.map((c,i)=>({...c,preScore:c.drop.length ? 500+i : i}));
const shortlist=Policy.evenShortlist(priced);
assert.ok(shortlist.some(c=>c.add.length&&c.drop.length),'swaps survive the shortlist');
assert.ok(shortlist.length<=80,'full-simulation candidate budget stays bounded');
const keys=c=>[...c.add.map(x=>'a'+x.key),...c.drop.map(x=>'d'+x.key)].sort().join('|');
assert.equal(new Set(candidates.map(keys)).size,candidates.length);
console.log('PASS bounded, diverse, deduplicated add/drop/swap search');

assert.match(trade,/id="tradeDecisionLens"/,'two-sided decision summary exists');
assert.match(trade,/VaultTradePolicy\.ledger\(Vault, aAssets, bAssets\)/);
assert.match(trade,/VaultTradePolicy\.evenShortlist\(priced\)/);
assert.match(negotiation,/Simulated manager response, not an actual message/);
console.log('PASS explicit price/manager separation and negotiation uncertainty in UI');

// Every trade shows an actionable Even It Out button; balanced grades must
// not launch the costly candidate search until the user asks for alternatives.
const evenStart=trade.indexOf("  // Even It Out is a tool, not a badge");
const evenEnd=trade.indexOf('/* ---------- Even it out',evenStart);
assert.ok(evenStart>0&&evenEnd>evenStart);
const evenUi=trade.slice(evenStart,evenEnd).replace(/\n}\s*$/, '');
const showEven=(mine,theirs,plan=null,cached=false)=>{
  const box={innerHTML:''};let scheduled=0,painted=0;
  const key='two|managers|original|trade';
  vm.runInNewContext(evenUi,{
    document:{getElementById:id=>id==='workBoth'?box:null},
    imp:{level:mine},them:{level:theirs},
    evenFix:plan,evenFixLive:()=>!!plan,
    evenLine:cached?{key,plan:null}:null,evenSearchKey:()=>key,
    scheduleEvenLine:()=>{scheduled++;},paintEvenLine:()=>{painted++;}
  });
  return {html:box.innerHTML,scheduled,painted};
};
const fairUi=showEven('good','tossup');
assert.match(fairUi.html,/Even It Out/);
assert.match(fairUi.html,/onclick="evenSearch\(\)"/);
assert.match(fairUi.html,/You can still search for a closer price/);
assert.equal(fairUi.scheduled,0,'balanced trades never auto-run lineup simulations');
const badUi=showEven('good','bad');
assert.match(badUi.html,/Even It Out/);
assert.match(badUi.html,/id="evenLine"/);
assert.equal(badUi.scheduled,1,'poor-grade trades still auto-search');
const oldUi=showEven('good','tossup',null,true);
assert.equal(oldUi.painted,1,'cached result is restored after redraw');
const appliedUi=showEven('good','tossup',{options:[{},{}],at:0});
assert.match(appliedUi.html,/Try another \(1 of 2\)/);
const evenSearchStart=trade.indexOf('function evenSearch() {');
const evenSearchEnd=trade.indexOf('function scheduleEvenLine()',evenSearchStart);
assert.ok(evenSearchStart>0&&evenSearchEnd>evenSearchStart);
const searchBlock=trade.slice(evenSearchStart,evenSearchEnd);
const searchLine={textContent:''};let searches=0;
const searchCtx={evenLine:{old:true},
 document:{getElementById:id=>id==='evenLine'?searchLine:null},
 scheduleEvenLine:()=>{searches++;}};
vm.runInNewContext(searchBlock+'\nevenSearch();',searchCtx);
assert.equal(searchCtx.evenLine,null,'explicit search invalidates the prior offer');
assert.equal(searches,1,'explicit search starts the computation');
assert.match(searchLine.textContent,/Finding alternative packages/);
assert.match(trade,/Both sides grade Toss-up or better · acceptance unconfirmed/);
console.log('PASS Even It Out can be launched manually on any trade and auto-repairs bad offers');

