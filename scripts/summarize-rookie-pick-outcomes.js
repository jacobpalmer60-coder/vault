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
console.log('Verified rookie selections: nflverse '+fmt(data.counts?.verifiedFromNflverse)+' | Sleeper '+fmt(data.counts?.verifiedFromSleeper)+' | external registry loaded: '+Boolean(data.registryLoaded));
console.log('Excluded selections: veteran NFL draft year '+fmt(data.counts?.rejectedVeterans)+
 ' | unknown rookie year '+fmt(data.counts?.unverifiableRookieYear)+
 ' | nonfantasy '+fmt(data.counts?.rejectedNonFantasy)+
 ' | missing player identity '+fmt(data.counts?.missingSleeperIdentity)+
 ' | ambiguous matches '+fmt(data.counts?.ambiguousIdentity));
if(!data.counts?.uniqueRookies)console.log('WARNING: no verifiable rookies. Run node scripts/fetch-nfl-draft-years.js, then rerun the benchmark.');

for(const g of data.groups||[]){
 console.log([g.year,g.format,'round '+g.round,'players '+g.n,
  'followup-known '+g.known,'missing '+g.missing,
  'one-year p25 '+fmt(g.followup.p25),'median '+fmt(g.followup.median),
  'p75 '+fmt(g.followup.p75),
  'pre-draft mid-pick '+fmt(g.preDraftPickMidMedian)].join(' | '));
}
console.log('\nDRAFT-SLOT RESEARCH (complete 8–16-team drafts; 1.01 differs from 1.12)');
console.log('Valid complete draft records: '+fmt(data.counts?.slotDraftsValidated)+
 ' | rejected: '+fmt(data.counts?.slotDraftsRejected)+
 ' | verified slot selections: '+fmt(data.counts?.slotSelectionsVerified));
console.log('Complete drafts with >=80% verified rookies in first round (heuristic only): '+fmt(data.counts?.slotDraftsRookieHeavy)+' | below threshold: '+fmt(data.counts?.slotDraftsNotRookieHeavy));
for(const g of data.slotGroups||[]){
 console.log([g.year,g.format,g.draftSize+'-team','pick '+g.round+'.'+String(g.slot).padStart(2,'0'),
  'selections '+fmt(g.selections),'distinct rookies '+fmt(g.distinctRookies),
  'known '+fmt(g.known),'missing '+fmt(g.missing)+' ('+g.missingRatePct+'%)',
  'rookie-heavy selection share '+(g.rookieHeavySharePct??'n/a')+'%',
  'top-player selection share '+(g.mostCommonRookieSharePct??'n/a')+'%',
  'distinct-player median '+fmt(g.followup.median),
  'SELECTION-WEIGHTED median '+fmt(g.selectionWeightedFollowup?.median),
  'weighted p25 '+fmt(g.selectionWeightedFollowup?.p25),'weighted p75 '+fmt(g.selectionWeightedFollowup?.p75)].join(' | '));
}
console.log('Slot groups are correlated: a rookie drafted in several league slots can appear once in EACH different slot.');
console.log('Comparing selection-weighted and distinct-player medians diagnoses distortion; rookie-heavy is NOT confirmed draft-type metadata.');
console.log('These are historical selection distributions, NOT pick-value recommendations or independent observations.');
console.log('Missing prices excluded from quantiles; repeated rookies in one format/season deduplicated.');
console.log('League draft TYPE and historical pick prices remain unresolved; use size-matched slot cohorts only.');
