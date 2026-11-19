#!/usr/bin/env node
'use strict';
/*
 Research-only accuracy audit of the version-2 historical price-direction test.
 This is not a holdout, not a trade recommendation score, and not an estimate
 of another manager's acceptance probability.
 Usage: node scripts/audit-trade-accuracy.js trade-cohorts.txt
 PowerShell 5.1 redirects JSON as UTF-16LE; read both UTF-16LE and UTF-8.
 */
const fs=require('node:fs'),path=require('node:path');
function decode(bytes){
 if(bytes[0]===255&&bytes[1]===254)return bytes.toString('utf16le').replace(/^\uFEFF/,'');
 if(bytes[0]===123&&bytes[1]===0)return bytes.toString('utf16le').replace(/^\uFEFF/,'');
 return bytes.toString('utf8').replace(/^\uFEFF/,'');
}
function audit(data){
 if(data.schemaVersion!==2)throw Error('Need schema v2 trade benchmark; rerun benchmark-trade-value-outcomes.js');
 const findings=[];
 const push=(severity,scope,message,n)=>findings.push({severity,scope,message,n});
 const full=data.overall?.strict,players=data.playerOnly?.strict;
 if(!full||!players)throw Error('Expected overall and playerOnly complete-case statistics');
 const min=1000;
 // A benchmark of price direction is not a direct benchmark of roster-aware
 // trade grades. Report how much performance differs within the specific
 // conditions where the consolidation curve could plausibly matter.
 const strata=(data.by?.tradeValueGap||{});
 const majorShapes=Object.entries(data.by?.shape||{}).filter(([,e])=>e.strict?.matched>=min)
  .sort((a,b)=>a[1].strict.vaultAdvantagePoints-b[1].strict.vaultAdvantagePoints)
  .map(([shape,e])=>({shape,n:e.strict.matched,advantage:e.strict.vaultAdvantagePoints,
    disagree:e.strict.disagree||0,vaultOnlyRight:e.strict.vaultOnlyRight||0,rawOnlyRight:e.strict.rawOnlyRight||0}));
 const playerOnlyShapes=Object.entries(data.by?.playerOnlyShape||{}).filter(([,e])=>e.strict?.matched>=min)
  .sort((a,b)=>a[1].strict.vaultAdvantagePoints-b[1].strict.vaultAdvantagePoints)
  .map(([shape,e])=>({shape,n:e.strict.matched,advantage:e.strict.vaultAdvantagePoints,
    disagree:e.strict.disagree||0,vaultOnlyRight:e.strict.vaultOnlyRight||0,
    rawOnlyRight:e.strict.rawOnlyRight||0}));
 const gapGroups=Object.entries(strata).filter(([,e])=>e.strict?.matched>=min)
  .map(([gap,e])=>({gap,n:e.strict.matched,advantage:e.strict.vaultAdvantagePoints,
    disagreementRatePct:e.strict.matched?+(100*(e.strict.disagree||0)/e.strict.matched).toFixed(2):null}));
 for(const [year,entry] of Object.entries(data.by?.year||{})){
  const r=entry.strict;
  if(r.matched<min){push('limited','year '+year,'Too few decisive cases for comparison',r.matched);continue}
  const delta=r.vaultAdvantagePoints;
  push(delta>=0?'positive':'negative','year '+year,
   'Vault vs raw one-year direction agreement '+(delta>=0?'+':'')+delta+' percentage points (retrospective)',r.matched);
  const imputed=entry.imputed;
  if(imputed?.matched>=min&&Math.abs(imputed.vaultAdvantagePoints-delta)>=2)
   push('sensitivity','year '+year,'Missing-as-zero sensitivity changes relative advantage by at least 2 percentage points',r.matched);
 }
 for(const [year,entry] of Object.entries(data.by?.playerOnlyYear||{})){
  const r=entry.strict;
  if(r.matched<min){push('limited','player-only '+year,'Insufficient player-only matched outcomes',r.matched);continue}
  const inclusive=data.by?.year?.[year]?.strict;
  if(inclusive?.matched>=min && Math.sign(inclusive.vaultAdvantagePoints)!==Math.sign(r.vaultAdvantagePoints))
   push('warning','player-only '+year,'Direction of advantage reverses when trades with picks are removed',r.matched);
  else push('diagnostic','player-only '+year,
   'Player-only advantage '+(r.vaultAdvantagePoints>=0?'+':'')+r.vaultAdvantagePoints+' pp',r.matched);
 }
 for(const [key,entry] of Object.entries(data.by?.shape||{})){
  const r=entry.strict;
  if(r.matched<min)continue;
  if(r.vaultAdvantagePoints<=-3)push('weakness','package '+key,
   'Vault trails raw by at least 3 percentage points for this trade shape',r.matched);
 }
 const byYears=Object.entries(data.by?.year||{}).filter(([,e])=>e.strict.matched>=min)
   .map(([year,e])=>({year,n:e.strict.matched,advantage:e.strict.vaultAdvantagePoints}));
 if(byYears.some(x=>x.advantage>0)&&byYears.some(x=>x.advantage<0))
  push('warning','year stability','Vault vs raw advantage reverses direction between seasons; do not deploy a global adjustment',null);
 return {generated:data.generated,sampleMod:data.sampleMod,counts:data.counts,overall:full,playerOnly:players,
  yearly:byYears,majorShapes,playerOnlyShapes,gapGroups,findings,
  guardrails:[
   'Only previously completed trades are sampled; rejected proposals and manager acceptance are unobserved.',
   'No uncontaminated chronological holdout or historical team roster reconstruction is available.',
   'Player-only controls for unverified future pick conversions; do not tune pick prices from this benchmark.',
   'Directional agreement measures relative future market prices, not win probability or actual fantasy outcomes.',
   'Vault uses a nonlinear consolidation adjustment: a negative advantage does not directly establish an error in lineup, roster-fit, or team-specific trade grading.',
   'Check one-for-one trade parity and stratify by price gap before interpreting the broad aggregate.',
   'Do not auto-change live trade value, ranking, Even It Out or Trade Coach from this report.'
  ]};
}
function main(file){
 const data=JSON.parse(decode(fs.readFileSync(path.resolve(file))));
 const report=audit(data);
 console.log('TRADE ACCURACY AUDIT — RESEARCH ONLY');
 console.log('Sample: 1/'+report.sampleMod+' | complete cases: '+report.counts.complete+' | player-only: '+report.counts.playerOnlyComplete);
 for(const f of report.findings)console.log('['+f.severity+'] '+f.scope+': '+f.message+(f.n==null?'':' (n='+f.n+')'));
 console.log('\nMost negative package cohorts (decisive cases, research only):');
 for(const row of report.majorShapes.slice(0,12))console.log(row.shape+
  ' n='+row.n+' advantage='+row.advantage+' pp'+
  ' disagreement='+row.disagree+' Vault-only-right='+row.vaultOnlyRight+' raw-only-right='+row.rawOnlyRight);
 console.log('\nPlayer-only package shapes (no approximated pick follow-up):');
 if(!('playerOnlyShape' in (data.by||{})))console.log('Not available: rerun benchmark with the latest version.');
 else if(!report.playerOnlyShapes.length)console.log('No player-only shapes reached the minimum decisive sample of 1,000.');
 for(const row of report.playerOnlyShapes.slice(0,15))console.log(row.shape+
  ' n='+row.n+' advantage='+row.advantage+' pp'+
  ' disagreement='+row.disagree+' Vault-only-right='+row.vaultOnlyRight+
  ' raw-only-right='+row.rawOnlyRight);
 console.log('\nStarting-price gap cohorts:');
 for(const row of report.gapGroups)console.log(row.gap+' n='+row.n+
  ' advantage='+row.advantage+' pp disagreement rate='+row.disagreementRatePct+'%');
 const oneForOne=report.majorShapes.filter(x=>x.shape.endsWith('|1-for-1'));
 if(oneForOne.length){
  console.log('\nOne-for-one sanity check:');
  for(const row of oneForOne)console.log(row.shape+
   ' disagreement='+row.disagree+
   (row.disagree===0?' PASS':' WARNING — nonlinear adjustment should not change 1-for-1 direction'));
 }
 console.log('\nGuardrails:\n'+report.guardrails.map(x=>'- '+x).join('\n'));
 return report;
}
if(require.main===module)main(process.argv[2]||'trade-cohorts.txt');
module.exports={decode,audit,main};
