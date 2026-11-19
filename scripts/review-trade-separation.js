#!/usr/bin/env node
'use strict';
/* Research-only human-readable four-question trade review; requires explicit
 * evidence for roster and acceptance. Not loaded in Vault's browser page.
 * JSON: {sideA:[{name,value}],sideB:[...],rosterImpact?:{A,B},
 *        acceptance?:{A,B}}. A/B are the RECEIVING sides (not senders).
 */
const fs=require('node:fs'),path=require('node:path');
const {loadVault}=require('./lib-market');
const {assessment}=require('./research-trade-separation');
function review(input,ratio){
 if(!input||!input.sideA||!input.sideB)throw Error('Specify sideA and sideB receiving assets');
 const a=assessment(input.sideA,input.sideB,{
  tradeValueRatio:ratio,rosterImpact:input.rosterImpact??null,acceptance:input.acceptance??null
 });
 const pct=v=>v==null?'unavailable':(v>=0?'+':'')+v.toFixed(2)+'%';
 const lines=[
  'RESEARCH ONLY — not the Vault trade grade',
  'Side A receives: '+input.sideA.map(x=>x.name||x.key||'Asset').join(', '),
  'Side B receives: '+input.sideB.map(x=>x.name||x.key||'Asset').join(', '),
  '1. Additive market price: A '+a.market.valueA.toLocaleString('en-US')+
   ' / B '+a.market.valueB.toLocaleString('en-US')+' | A minus B '+pct(a.market.marketPct),
  '2. Full consolidation context (not extra cash): '+pct(a.market.packagePct)+
   ' | additional adjustment '+pct(a.consolidation.deltaPct),
  '3. Roster impact: '+(a.rosterImpact?'A '+JSON.stringify(a.rosterImpact.A)+
   ' | B '+JSON.stringify(a.rosterImpact.B):'NOT MEASURED; supply real two-team snapshots'),
  '4. Manager acceptance: '+(a.acceptance?'A '+JSON.stringify(a.acceptance.A)+
   ' | B '+JSON.stringify(a.acceptance.B):'UNKNOWN; price parity does not imply acceptance'),
  'Decision: '+(a.researchRecommendation?'Evidence supplied for BOTH sides; interpret all four factors.':
   'No final trade recommendation without independently measured roster and acceptance evidence.'),
  'Nothing here changes the live calculator.'
 ];
 return lines.join('\n');
}
if(require.main===module){
 const input=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'docs/trade-separation-example.json'),'utf8'));
 const Vault=loadVault();
 console.log(review(input,(a,b)=>Vault.tradeValueRatio(a,b)));
}
module.exports={review};
