#!/usr/bin/env node
'use strict';
/* Print a compact diagnostic from the two research result files.
 * PowerShell 5.1 writes redirects as UTF-16LE; accept that and UTF-8.
 * Run after trade-cohorts.txt and rebuild-horizons.txt are generated.
 */
const fs=require('node:fs'),path=require('node:path');
const cwd=process.cwd();
function load(file){
 const bytes=fs.readFileSync(path.resolve(cwd,file));
 let str;
 if(bytes[0]===255&&bytes[1]===254)str=bytes.toString('utf16le').replace(/^\uFEFF/,'');
 else if(bytes[0]===254&&bytes[1]===255)throw Error('Big-endian UTF-16 output not supported');
 else if(bytes[0]===123&&bytes[1]===0)str=bytes.toString('utf16le');
 else str=bytes.toString('utf8').replace(/^\uFEFF/,'');
 return JSON.parse(str.trim());
}
const trades=load(process.argv[2]||'trade-cohorts.txt');
if(trades.schemaVersion!==2)throw Error('Outdated trade-cohorts benchmark: rerun scripts/benchmark-trade-value-outcomes.js. Older outcome labels used Vault pricing and are not an independent test.');
const forecast=load(process.argv[3]||'rebuild-horizons.txt');
const num=n=>typeof n==='number'?n.toLocaleString('en-US'):'n/a';
const pp=n=>typeof n==='number'?(n>=0?'+':'')+n.toFixed(2):'n/a';
const fmt=x=>`${num(x?.n)} decisions; Vault ${num(x?.vaultAgreementPct)}%, raw ${num(x?.rawAgreementPct)}%, advantage ${pp(x?.vaultAdvantagePoints)} pp`;
const rows=Object.entries(trades.by?.year||{}).sort(([a],[b])=>a.localeCompare(b));
console.log('=== HISTORICAL TRADE PRICE DIRECTION (STRICT COMPLETE CASES) ===');
console.log('Sampled:',num(trades.counts?.sampled),'Mature:',num(trades.counts?.mature),
  'Complete:',num(trades.counts?.complete),'Missing:',num(trades.counts?.missing));
for(const [year,x] of rows)console.log(year,fmt(x.strict));
console.log('\n=== PLAYER-ONLY TRADES (STRICT, NO ROOKIE PICK CONVERSION) ===');
console.log('Mature player-only trades:',num(trades.counts?.playerOnlyMature),
 'Complete:',num(trades.counts?.playerOnlyComplete));
for(const [year,x] of Object.entries(trades.by?.playerOnlyYear||{}).sort(([a],[b])=>a.localeCompare(b)))
 console.log(year,fmt(x.strict));
console.log('The future label is an independent additive price-sum comparison, NOT the Vault trade formula.');
console.log('Player-only removes the estimated future value of draft picks; still retrospective and not a sealed holdout.');
console.log('\n=== QUARTERS (STRICT) ===');
for(const [k,x] of Object.entries(trades.by?.yearQuarter||{}))if(x.strict.n>=100)console.log(k,fmt(x.strict));
console.log('\n=== MATERIAL PACKAGE SHAPES BY YEAR (>= 1000 COMPLETE DECISIONS) ===');
for(const [k,x] of Object.entries(trades.by?.shape||{}))if(x.strict.matched>=1000)console.log(k,fmt(x.strict));
console.log('\n=== REBUILD-ORIENTED FORECAST ERRORS (LOWER IS BETTER) ===');
for(const h of forecast.horizons||[]){
 if(!h.completeCase){console.log(h.years+'y:',h.error);continue;}
 const m=h.completeCase;
 console.log(h.years+'y',`train=${(h.trainYears||[]).join(',')} test=${h.testYear} n=${m.unmodified.n} missing=${h.missing}`,
  `unchanged MAE=${m.unmodified.mae}`,`trained MAE=${m.priorYearsTrained.mae}`,
  `current curve (LEAKY reference) MAE=${m.currentCurveRetrospective.mae}`);
 const coverage=Object.entries(h.trainingCoverage||{});
 if(coverage.length) {
  const first=coverage[0],last=coverage[coverage.length-1];
  console.log(' As-of known training observations:',first[0]+'='+first[1].eligible, 'to',last[0]+'='+last[1].eligible);
  if(first[1].eligible<100)console.log('  WARNING: Early prediction months have too little prior matured history for reliable forecasts');
 }
 for(const [label,field] of [['Positions','position'],['League formats','format'],['Position by format','formatAndPosition']]){
  console.log(' '+label+' (complete-case MAE; lower is better):');
  for(const [key,group] of Object.entries(h.groups?.[field]||{}).sort(([a],[b])=>a.localeCompare(b))){
   const c=group.completeCase,n=group.known;
   if(n<30)continue;
   const base=c.unmodified.mae,trained=c.priorYearsTrained.mae;
   console.log('  '+key+' n='+n+' baseline='+base+' trained='+trained+' '+(trained>base?'REGRESSION':''));
  }
 }
 console.log(' Age proxies (under24 = young core, 30plus = veteran):');
 for(const [k,x] of Object.entries(h.groups?.age||{})){
  const n=x.known,models=x.completeCase;
  if(n<20)continue;
  console.log('  ',k,'n='+n,'unchanged='+models.unmodified.mae,
    'trained='+models.priorYearsTrained.mae);
 }
}
console.log('\nTrade outcome labels were corrected in schema v2; do not compare raw 2024/2025 agreement numbers from old schema.');
console.log('Research only. No rebuild roster reconstruction, independent price-curve holdout, or live grading change.');
