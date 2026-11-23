#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
function read(file){
 const b=fs.readFileSync(path.resolve(file));
 const text=b[0]===255&&b[1]===254||b[0]===123&&b[1]===0?b.toString('utf16le'):b.toString('utf8');
 return JSON.parse(text.replace(/^\uFEFF/,'').trim());
}
function report(data){
 if(data.kind!=='research-price-separation'||data.schemaVersion!==1)
  throw Error('Expected separated pricing research schema v1');
 const rows=[];
 const append=(title,g)=>{
  rows.push(title);
  for(const [key,v] of Object.entries(g)){
   const raw=v.weights['0'],full=v.weights['1'],half=v.weights['0.5'];
   const show=x=>x.accuracyPct==null?'n/a':x.accuracyPct.toFixed(2)+'%';
   const adv=(x,y)=>x.accuracyPct==null||y.accuracyPct==null?'n/a':(x.accuracyPct-y.accuracyPct).toFixed(2)+' pp';
   rows.push('  '+key+' n='+v.decisive+' | raw '+show(raw)+' | 50% '+show(half)+
    ' | full '+show(full)+' | full-minus-raw '+adv(full,raw));
  }
 };
 rows.push('RESEARCH ONLY — separate price fairness from roster decisions');
 rows.push('Sample 1/'+data.sampleMod+' | priced '+data.counts.priced+
  ' | complete '+data.counts.complete+' | missing '+data.counts.missing);
 if(data.filters){
  rows.push('Scope: '+(data.filters.year||'2024 and 2025')+' | '+
   (data.filters.format||'all six league formats')+' | '+
   (data.filters.playerOnlyOneForTwo?'ONLY player-only 1-for-2':'all trade shapes'));
 }
 append('By season',data.byYear);
 append('Player-only by season',data.playerOnlyYear);
 const filtered=Object.fromEntries(Object.entries(data.playerOnlyShape)
  .filter(([,v])=>v.decisive>=1000));
 append('Player-only packages (at least 1,000 decisive cases)',filtered);
 if(data.nearPeer){
  rows.push('');
  rows.push('NEAR-EQUAL LEAD PLAYER TEST — player-only 1-for-2 trades');
  rows.push('Each cohort uses trade-day prices; overlapping cohorts are NOT independent samples.');
  append('All 1-for-2 and lead-closeness cohorts',data.nearPeer);
  if(data.nearPeerByYear)append('Lead-closeness cohorts by year',data.nearPeerByYear);
  rows.push('Outcome: future additive KTC price direction 365 days after each completed trade.');
  rows.push('A higher rate here is NOT a validated fair-offer probability or roster payoff.');
  rows.push('Do not change weights from this result without an untouched chronological, manager-aware holdout.');
 }
 rows.push('The 0% scenario is additive current prices. 100% uses the full Vault consolidation curve.');
 rows.push('The future label is additive KTC prices one year later; this is NOT a roster-aware trade-quality score.');
 rows.push('Research only: No weight is selected, no independent holdout is established, no live valuations were changed.');
 return rows.join('\n');
}
if(require.main===module)console.log(report(read(process.argv[2]||'separated-pricing.json')));
module.exports={read,report};
