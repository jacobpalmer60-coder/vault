#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {pair,side,pieces,explain}=require('../team-impact');
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
const explanationA=explain(impact.A,'rebuild'),explanationB=explain(impact.B,'contend');
assert.ok(explanationA.some(x=>x.includes('draft-pick value')),'rebuilding impact explains acquired draft capital');
assert.ok(explanationA.some(x=>x.includes('future assets')),'rebuild guidance distinguishes timeline');
assert.ok(explanationB.some(x=>x.includes('immediate lineup effect')),'contending guidance explains win-now tradeoff');
assert.ok(explanationB.some(x=>x.includes('spends')),'contender is told about lost picks');
assert.ok(explain(reverse.A,'contend').join('; ')===explanationB.join('; '),'side swapping preserves contending explanation');
assert.ok(explain(reverse.B,'rebuild').join('; ')===explanationA.join('; '),'side swapping preserves rebuilding explanation');
// Integration guard: both cards must render the SAME ledger helper, and future
// ranking cannot imply that future rookie production is included.
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','trade.html'),'utf8');
assert.ok(html.includes('<script src="team-impact.js?'),'team-impact helper must load before inline script');
assert.ok(html.includes('VaultTradeImpact.pair(before, after, aAssets, bAssets)'),'must derive impacts for both sides once');
assert.ok(html.includes('teamImpactLedgerHtml(impactBySide[side])'),'both team cards must share ledger renderer');
assert.ok(html.includes('VaultTradeImpact.explain(impactBySide[side], res.mode)'),'both team cards must use side-neutral explanation');
assert.ok(html.includes('Future picks and the rookies they might become are not included'),'future rank must disclose omission of draft outcomes');
console.log('PASS trade impact ledger swap symmetry, draft capital, player value, lineup, conserved assets, and no-op');

const {assessment,assessmentHtml}=require('../team-impact');
const an={before,after,resA:{mode:'rebuild',fit:3,dDepth:0},resB:{mode:'contend',fit:3,dDepth:0},dValueAdjA:-150,dValueAdjB:150,pctDiff:8.2};
const report=assessment(an,giveA,giveB);
assert.equal(report.teams.A.headline,'Strong fit, at a market cost');
assert.equal(report.teams.A.pct,-8.2);
assert.equal(report.teams.B.pct,8.2);
const rev=assessment({before:{A:B,B:A},after:{A:afterB,B:afterA},resA:an.resB,resB:an.resA,dValueAdjA:150,dValueAdjB:-150,pctDiff:8.2},giveB,giveA);
assert.deepEqual(report.teams.A,rev.teams.B);
assert.deepEqual(report.teams.B,rev.teams.A);
assert.equal(assessment(an,[{...q,value:0}],giveB).teams.A.pct,null);
assert.equal(assessment(an,giveA,giveB,{marketAvailable:false}).basis,'KTC fallback price');
assert.equal(assessment(an,[],giveB),null);
assert.equal(assessment({...an,pctDiff:45},giveA,giveB).teams.A.headline,'Strong fit, substantial market overpay');
assert.ok(assessmentHtml(report).includes('A strong fit does not erase an overpay'));
assert.ok(assessmentHtml(report).includes('Projected lineup PPG'));
assert.ok(!assessmentHtml({...report,teams:{...report.teams,A:{...report.teams.A,name:'<script>bad</script>'}}}).includes('<script>'));
assert.ok(html.includes('VaultTradeImpact.assessment(analysis,aAssets,bAssets'));
assert.ok(html.includes('VaultTradeImpact.assessmentHtml(assessment,{only:side})'));
console.log('PASS shared strategic assessment: side symmetry, price vs fit, unknown prices, fallback, escaping');
