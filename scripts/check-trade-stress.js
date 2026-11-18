#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Stress=require('../trade-stress');
const html=fs.readFileSync(path.join(__dirname,'..','trade.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','vault.css'),'utf8');
const a1={id:'a1',key:'p_a1',name:'One',type:'player',pos:'RB',value:1000,ppg:20};
const a2={id:'a2',key:'p_a2',name:'A reserve',type:'player',pos:'RB',value:200,ppg:7};
const b1={id:'b1',key:'p_b1',name:'Two',type:'player',pos:'RB',value:800,ppg:12};
const pick={key:'k_2027-1-2',type:'pick',name:'2027 Round 1',season:2027,round:1,original:2,value:500,ktcRound:1,ktcTier:'mid'};
const snap=(plist,picks)=>({
 plist,picks,opt:Math.max(0,...plist.map(x=>x.ppg)),total:plist.reduce((s,x)=>s+x.value,0),
 picksValue:picks.reduce((s,x)=>s+x.value,0)
});
const before={A:snap([a1,a2],[]),B:snap([b1],[pick])};
const after={A:snap([a2,b1],[pick]),B:snap([a1],[])};
const original=JSON.stringify({before,after,a1,a2,b1,pick});
const args={before,after,tradeA:[a1],tradeB:[b1,pick],slots:['RB'],player:'a1',
 pick:Stress.pickId(pick),decline:0,missed:0,tier:'current',
 spreadFor:round=>round===1?{early:1.1,late:.97}:null,
 lineupOf:players=>Math.max(0,...players.map(x=>x.ppg))};
const base=Stress.evaluate(args);
assert.equal(base.change.A.totalValue,300,'A gains a 500 pick, gives 1k, receives 800');
assert.equal(base.change.B.totalValue,-300,'B change mirrors A');
assert.equal(base.change.A.lineupPpg,-8,'A now starts B player at 12 instead of A at 20');
const shock=Stress.evaluate({...args,decline:30});
assert.equal(shock.change.A.totalValue,600,'A avoids 30% markdown on player sent');
assert.equal(shock.change.B.totalValue,-600,'B acquires markdown and bears downside');
assert.equal(shock.before.A.totalValue,900,'original A player shocked before the trade');
assert.equal(shock.after.B.totalValue,700,'received A player shocked after trade');
assert.equal(shock.change.A.totalValue+shock.change.B.totalValue,0,'all value stays inside the deal');
const injury=Stress.evaluate({...args,missed:5});
assert.ok(injury.change.A.lineupPpg>base.change.A.lineupPpg,
 'team sending missed-time player benefits relative to no trade');
assert.ok(injury.change.B.lineupPpg<base.change.B.lineupPpg,
 'team receiving missed-time player bears missed games');
assert.equal(injury.after.B.lineupPpg,20-(20-0)*5/17);
const tier=Stress.evaluate({...args,tier:'early'});
assert.equal(tier.tierQuote.baseTier,'mid');
assert.ok(Math.abs(tier.after.A.pickValue-550)<1e-8,'uses existing first-round tier spread');
assert.equal(tier.after.B.pickValue,0);
assert.equal(tier.change.A.totalValue+ tier.change.B.totalValue,0);
assert.equal(Stress.evaluate({...args,tier:'late'}).after.A.pickValue,485);
assert.equal(Stress.evaluate({...args,tier:'unknown'}).after.A.pickValue,500);
assert.equal(Stress.evaluate({...args,spreadFor:()=>null,tier:'early'}).after.A.pickValue,500,
 'unknown pick spread must not invent value');
const neutral=Stress.evaluate({...args,decline:'bad',missed:-5,tier:'current'});
assert.equal(neutral.drop,0);
assert.equal(neutral.missedWeeks,0);
const mirror=Stress.evaluate({...args,before:{A:before.B,B:before.A},after:{A:after.B,B:after.A},tradeA:[b1,pick],tradeB:[a1],decline:30,missed:5,tier:'early'});
const originalStress=Stress.evaluate({...args,decline:30,missed:5,tier:'early'});
assert.equal(mirror.change.A.totalValue,originalStress.change.B.totalValue,'swap invariance for team B');
assert.equal(mirror.change.B.lineupPpg,originalStress.change.A.lineupPpg,'swap invariance for team A');
assert.equal(JSON.stringify({before,after,a1,a2,b1,pick}),original,'no original roster or player mutations');
const playerOnly=Stress.evaluate({...args,tradeB:[b1],pick:'',tier:'early'});
assert.equal(playerOnly.pick,null);
assert.equal(playerOnly.tierQuote,null);
const pickOnly=Stress.evaluate({...args,tradeA:[],tradeB:[pick],player:'a1',missed:8,decline:40});
assert.equal(pickOnly.player,null,'cannot stress untraded player');
assert.equal(pickOnly.drop,0);
assert.equal(pickOnly.missedWeeks,0);
assert.ok(html.includes('trade-stress.js?v='),'must load helper in live builder');
assert.ok(html.includes('renderTradeStress(teamA, teamB, aAssets, bAssets, analysis)'),'render same analysis once for both sides');
assert.ok(html.includes('aria-controls="stressTest"')&&html.includes('data-tt="stress"'),'phone tab wired');
assert.ok(css.includes('#tradeBar:not([data-tab="stress"]) #stressTest'),'phone tab hides what-if outside chosen tab');
console.log('PASS Trade Stress Test: two-team symmetry, player downside, missed games, supported pick tiers, no invented prices, no mutation, phone wiring');
