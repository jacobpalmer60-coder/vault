#!/usr/bin/env node
'use strict';
/* Compact text summary of the historical research-only rookie outcome JSON.
 * Input accepts UTF-8 and PowerShell 5.1 UTF-16LE output.
 */
const fs=require('node:fs'),path=require('node:path');
const input=process.argv[2]||'rookie-outcomes.json';
const bytes=fs.readFileSync(path.resolve(input));
const text=(bytes[0]===255&&bytes[1]===254)||(bytes[0]===123&&bytes[1]===0)
 ?bytes.toString('utf16le').replace(/^\uFEFF/,'')
 :bytes.toString('utf8').replace(/^\uFEFF/,'');
const data=JSON.parse(text.trim());
const fmt=x=>x==null?'n/a':Math.round(x).toLocaleString('en-US');
console.log('UNIQUE ROOKIE HISTORICAL KTC OUTCOMES (365 DAYS AFTER DRAFT)');
console.log('Research only; drafted-player prices, NOT precise pick forecasts');
console.log('Drafts assessed: '+fmt(data.counts?.eligibleDrafts)+
 ' | Unique rookies by season/format: '+fmt(data.counts?.uniqueRookies));
for(const g of data.groups||[]){
 console.log([g.year,g.format,'round '+g.round,'players '+g.n,
  'followup-known '+g.known,'missing '+g.missing,
  'one-year p25 '+fmt(g.followup.p25),'median '+fmt(g.followup.median),
  'p75 '+fmt(g.followup.p75),
  'pre-draft mid-pick '+fmt(g.preDraftPickMidMedian)].join(' | '));
}
console.log('Missing prices excluded from quantiles; repeated rookies in one format/season deduplicated.');
console.log('Selection position (1.01 vs 1.12), league draft order and unknown outcomes remain unresolved.');
