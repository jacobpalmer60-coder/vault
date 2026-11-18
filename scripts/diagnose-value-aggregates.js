#!/usr/bin/env node
'use strict';
/* Reproduce the existing player history and published proof summary. This does
   not substitute for a chronological, transaction-level benchmark. */
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
function diagnostic(H,P,I,date) {
 const by={},comp=[],limitations=[
  'Existing published aggregates only; raw transactions have not been reprocessed.',
  'Headline trade observations are correlated by player, time and league.',
  'Player-level percentages were rounded before this weighted diagnostic.',
  'Player median change is a median of player medians, not all trade observations.',
  'The proof scores were taken as published, not remeasured with current code.',
  'Some trade-side outcomes are unknown: missing later prices are not automatically true losses.'
 ];
 let players=0,observations=0;
 for(const row of Object.values(H.players||{})) {
  if(!row.buy||!Number.isFinite(row.buy[0])||row.buy[0]<10)continue;
  const [n,win,change]=row.buy;
  const x=by[row.pos] ||= {players:0,headlineObservations:0,winWeighted:0,changes:[]};
  x.players++;x.headlineObservations+=n;x.winWeighted+=n*win;x.changes.push(change);
  players++;observations+=n;
 }
 for(const x of Object.values(by)) {
  x.approxShareAheadPct=+(x.winWeighted/x.headlineObservations).toFixed(1);
  const changes=x.changes.filter(Number.isFinite).sort((a,b)=>a-b);
  x.medianOfPlayerMedianChangesPct=changes.length?changes[Math.floor((changes.length-1)/2)]:null;
  delete x.changes;delete x.winWeighted;
 }
 for(const c of P.compare||[]) {
  if(!/value since, on trade value/.test(c.label))continue;
  comp.push({cohort:c.label.replace(': value since, on trade value',''),sides:c.sides,vaultScore:c.ours,ktcScore:c.ktc,gapToKtc:+(c.ktc-c.ours).toFixed(1)});
 }
 return {analysisDate:date,sourceDates:{playerHistory:H.updated,holdoutProof:P.updated,marketInsights:I.updated},
  playerMarket:{playersWithOutcome:players,headlineTradeObservations:observations,byPosition:by},
  proofComparison:comp,limitations};
}
if(require.main===module) {
 const out=diagnostic(read('data/market-history/player-history.json'),read('data/market-history/proof.json'),
  read('data/market-history/insights.json'),new Date().toISOString().slice(0,10));
 console.log(JSON.stringify(out,null,2));
}
module.exports={diagnostic};
