#!/usr/bin/env node
'use strict';
/*
 Compact historical rookie-slot research summary.
 Usage:
   node scripts/summarize-rookie-pick-outcomes.js rookie-outcomes.json
   node scripts/summarize-rookie-pick-outcomes.js rookie-outcomes.json --format=sf --size=12 --year=2024
   node scripts/summarize-rookie-pick-outcomes.js rookie-outcomes.json --full
 The default surfaces the most decision-relevant standard 12-team slots;
 --full prints every round and slot across all available formats/sizes.
 */
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2);
const input=args.find(s=>!s.startsWith('--'))||'rookie-outcomes.json';
const opt=name=>{
 const prefix='--'+name+'=';
 return args.find(s=>s.startsWith(prefix))?.slice(prefix.length);
};
const full=args.includes('--full')||args.includes('--all-slots');
const wantedFormat=opt('format');
const wantedYear=opt('year')?Number(opt('year')):null;
const wantedSize=opt('size')?Number(opt('size')):null;
if(wantedSize!=null&&(!Number.isInteger(wantedSize)||wantedSize<8||wantedSize>16))throw Error('--size must be 8..16');
if(wantedYear!=null&&(!Number.isInteger(wantedYear)||wantedYear<2020||wantedYear>2035))throw Error('--year must be a valid season');
const buf=fs.readFileSync(path.resolve(input));
const contents=(buf[0]===255&&buf[1]===254)||(buf[0]===123&&buf[1]===0)
 ?buf.toString('utf16le').replace(/^\uFEFF/,'')
 :buf.toString('utf8').replace(/^\uFEFF/,'');
const data=JSON.parse(contents.trim());
if(data.schemaVersion!==2)throw Error('Outdated rookie-outcome JSON: rerun node scripts/benchmark-rookie-pick-outcomes.js after git pull.');
const fmt=n=>n==null?'n/a':Number(n).toLocaleString('en-US',{maximumFractionDigits:1});
const pct=n=>n==null?'n/a':Number(n).toFixed(1)+'%';
console.log('VAULT — HISTORICAL ROOKIE DRAFT RESEARCH (NOT LIVE PICK PRICES)');
console.log('Date of analysis: '+(data.generated||'unknown')+' | outcome: 365-day player KTC price');
console.log('Drafts assessed: '+fmt(data.counts?.eligibleDrafts)+
 ' | distinct season/format/rookie IDs: '+fmt(data.counts?.uniqueRookies));
console.log('Rookie verification: nflverse '+fmt(data.counts?.verifiedFromNflverse)+
 ' selections | Sleeper '+fmt(data.counts?.verifiedFromSleeper)+
 ' | external NFL draft registry: '+(data.registryLoaded?'loaded':'not loaded'));
console.log('Unverifiable selections: '+fmt(data.counts?.unverifiableRookieYear)+
 ' | veteran-year rejects: '+fmt(data.counts?.rejectedVeterans)+
 ' | ambiguous identity: '+fmt(data.counts?.ambiguousIdentity));
console.log('Structurally complete drafts: '+fmt(data.counts?.slotDraftsValidated)+
 ' | incomplete/rejected: '+fmt(data.counts?.slotDraftsRejected));
console.log('Rookie-heavy first round (>=80% verified, HEURISTIC): '+
 fmt(data.counts?.slotDraftsRookieHeavy)+' | below threshold: '+
 fmt(data.counts?.slotDraftsNotRookieHeavy));

const defaultFormats=new Set(['oneQB','sf']);
const defaultSlots=new Set(['1.01','1.04','1.08','1.12',
 '2.01','2.06','2.12','3.01','3.12','4.01','4.12']);
const rowFormat=g=>!wantedFormat?(full||defaultFormats.has(g.format)):g.format===wantedFormat;
const rowYear=g=>wantedYear==null||g.year===wantedYear;
const rowSize=g=>wantedSize==null?(full||g.draftSize===12):g.draftSize===wantedSize;
const roundGroups=(data.groups||[]).filter(g=>rowFormat(g)&&rowYear(g));
const slotGroups=(data.slotGroups||[]).filter(g=>rowFormat(g)&&rowYear(g)&&rowSize(g)&&
 (full||defaultSlots.has(g.round+'.'+String(g.slot).padStart(2,'0'))));
console.log('\nROUND-LEVEL CONTEXT (one distinct rookie per format/year/round)');
for(const g of roundGroups){
 console.log([g.year,g.format,'round '+g.round,'unique '+fmt(g.n),
  'known '+fmt(g.known),'missing '+fmt(g.missing)+' ('+pct(g.missingRatePct)+')',
  'observed median '+fmt(g.followup?.median),
  'pre-draft pick reference '+fmt(g.preDraftPickMidMedian)].join(' | '));
}
console.log('\nEXACT PICK SLOTS — '+(full?'ALL':'selected 12-team standard 1QB/SF')+' cohorts');
console.log('Columns: actual selections; unique rookies; outcome missing among selections;');
console.log('all-draft weighted median; rookie-heavy ONLY weighted median; share from heavy drafts; concentration');
for(const g of slotGroups){
 console.log([g.year,g.format,g.draftSize+'-team',
  g.round+'.'+String(g.slot).padStart(2,'0'),
  'picks '+fmt(g.selections),'unique '+fmt(g.distinctRookies),
  'missing '+pct(g.missingSelectionRatePct),
  'ALL '+fmt(g.selectionWeightedFollowup?.median),
  'ROOKIE-HEAVY '+fmt(g.rookieHeavySelectionWeightedFollowup?.median),
  'heavy n '+fmt(g.verifiedRookieSelectionsInRookieHeavyDrafts),
  'heavy missing '+pct(g.rookieHeavyMissingSelectionRatePct),
  'heavy share '+pct(g.rookieHeavySharePct),
  'top pick share '+pct(g.mostCommonRookieSharePct)
 ].join(' | '));
}
if(!slotGroups.length)console.log('No matching slot cohorts met the distinct-rookie sample threshold.');
console.log('\nInterpretation: weighted price is measured 365 days after EACH actual draft choice.');
console.log('Rookie-heavy is a first-round verification heuristic; it does NOT confirm draft type.');
console.log('Selections repeat players across leagues. Missing future prices are not zeros.');
console.log('Distinct-player and weighted distributions are correlated historical diagnostics.');
console.log('DO NOT use this output to change live pick prices without chronological holdout validation.');
if(!full)console.log('For all slots or specialty formats: add --full, or --full --format=sf_tep --size=12 --year=2024.');
