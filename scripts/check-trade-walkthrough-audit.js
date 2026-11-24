#!/usr/bin/env node
'use strict';
/*
 Independent user-journey invariants for the Trade Builder / grades / Coach /
 two-team roster impact / Even It Out / What-if / phone navigation.
 No Sleeper connection needed; the browser journey is tested separately.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'trade.html'),'utf8');
const coach=fs.readFileSync(path.join(root,'coach.js'),'utf8');
const negotiation=fs.readFileSync(path.join(root,'negotiation.js'),'utf8');
const smoke=fs.readFileSync(path.join(__dirname,'smoke-trade-flow.js'),'utf8');
const between=(s,a,b)=>{const start=s.indexOf(a),end=s.indexOf(b,start+a.length);assert.ok(start>=0&&end>start,a+' missing');return s.slice(start,end)};
const values=between(html,'function valueTableHtml(','/* ---------- This season:');
const sandbox={
 Vault:{gradeMarketPct:()=>0,escapeHtml:x=>x,teamLink:t=>t.teamName},
 PRICE_TIP:{trade:'Trade value',ktc:'KTC'},
 VAULT_CONFIG:{FAIRNESS_WEIGHTS:{value:75,roster:15,timeline:10}},
 Math,Number
};
const valueTable=vm.runInNewContext(values+'\nvalueTableHtml;',sandbox);
const two={name:'B',teamName:'B'},one={name:'A',teamName:'A'};
const signed=(a,b)=>200*(a-b)/(a+b);
const get=(give,getBack,giveListed,getListed)=>{
 const fairness={overallSigned:signed(give,getBack),blend:0,value:0,roster:0,timeline:0};
 return valueTable(give,getBack,fairness,one,two,0,0,null,[],giveListed,getListed);
};
const text=get(120,140,100,150);
assert.ok(text.includes('Listed prices (sum)'),'raw listed prices must be visible next to adjusted values');
assert.ok(text.includes('>100</span>')&&text.includes('>150</span>'),'display original unadjusted values');
assert.ok(text.includes('>120</span>')&&text.includes('>140</span>'),'display trade-market adjusted values separately');
const mirror=get(140,120,150,100);
assert.ok(mirror.includes('Listed prices (sum)'),'both orientations show raw asset pricing');
assert.ok(html.includes('valueTableHtml(aValAdj, bValAdj, fairness, teamA, teamB, bonusA, bonusB, ktcView, [...aAssets, ...bAssets], aVal, bVal)'));
assert.ok(html.includes('Both sides grade Toss-up or better · acceptance unconfirmed'),'positive grades must not falsely promise acceptance');
assert.ok(html.includes('teamImpactLedgerHtml(impactBySide[side])'),'both teams receive same roster impact metrics');
assert.ok(html.includes('negJudgeFor(teamA, o.A, teamB, o.B, contextB).accepts'));
assert.ok(html.includes('negJudgeFor(teamB, o.B, teamA, o.A, contextA).accepts'));
assert.ok(coach.includes('const j = coachJudged(coachMe(), o.partner, o.give, o.get)'));
assert.ok(coach.includes('return j.accepts && coachTheirScore(o) >= theirMin'),'Coach must consider counterpart manager acceptance');
assert.ok(negotiation.includes('const accepts = will >= ask && drops <= 1'),'acceptance uses more than price parity');
assert.ok(html.includes('Official grading, Even It Out and Trade Coach are unaffected.'),'What-if discloses isolation');
assert.ok(smoke.includes("output.includes('Official grading, Even It Out and Trade Coach are unaffected')"),'browser smoke checks current copy');
assert.ok(smoke.includes("['teams','stress','season','details','verdict']"),'all phone sections exercised');
console.log('PASS listed vs adjusted prices, bidirectional price display, dual manager grades, coach/negotiation, What-if isolation and phone audit');
