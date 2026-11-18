#!/usr/bin/env node
'use strict';
/*
 Historical Sleeper rookie draft outcomes, research only.
 - Deduplicate player IDs within each season/league format so a popular
   rookie is not counted as hundreds of independent draws.
 - Report observed one-year KTC prices at draft+365 days, and known missing
   outcomes separately. No missing-as-zero assumption.
 - Compare pick prices before draft to the values of drafted rookies when
   available, but do not claim an exact pick converts into a specific rookie
   across leagues. Only per-round descriptive distributions are reported.
 - Scoring formats: 1QB/SF with TEP variants; never pool them silently.
 Requires data/sleeper-trades/YYYY.json.gz from GitHub release.
 */
const {readSleeperPlayers,seasonFiles,readSeason,ktcPrices,formatOf}=require('./market-history/ktc-book');
const fs=require('node:fs'),path=require('node:path');
const {slotsForDraft}=require('./market-history/rookie-slot');
const players=readSleeperPlayers(),books=new Map();
const book=fmt=>books.get(fmt)||books.set(fmt,ktcPrices(fmt,players)).get(fmt);
const minDrafts=Math.max(1,Number(process.env.MIN_DRAFTS)||10);
const horizonMs=365*864e5;
const data=new Map(),slotSamples=new Map(),counts={
 draftsSeen:0,eligibleDrafts:0,selectionsSeen:0,uniqueRookies:0,conflictingRounds:0,
 rejectedVeterans:0,unverifiableRookieYear:0,rejectedNonFantasy:0,missingSleeperIdentity:0
};
const fantasyPositions=new Set(['QB','RB','WR','TE']);
const {loadDraftIndex,draftYearEvidence}=require('./market-history/rookie-evidence');
const draftIndex=loadDraftIndex(path.join(__dirname,'..','data','research','nfl-draft-years.csv'));
counts.verifiedFromNflverse=0;
counts.verifiedFromSleeper=0;
counts.ambiguousIdentity=0;
counts.slotDraftsValidated=0;
counts.slotDraftsRejected=0;
counts.slotSelectionsVerified=0;
counts.slotDraftsRookieHeavy=0;
counts.slotDraftsNotRookieHeavy=0;
function verifiedRookie(sid,year,track=true){
 const p=players[sid];
 if(!p){if(track)counts.missingSleeperIdentity++;return false}
 if(!fantasyPositions.has(p.position)){if(track)counts.rejectedNonFantasy++;return false}
 const evidence=draftYearEvidence(p,year,draftIndex);
 if(evidence==='sleeper'){if(track)counts.verifiedFromSleeper++;return true}
 if(evidence==='nflverse'){if(track)counts.verifiedFromNflverse++;return true}
 if(evidence==='other-year'){if(track)counts.rejectedVeterans++;return false}
 if(evidence==='ambiguous'){if(track)counts.ambiguousIdentity++;return false}
 if(track)counts.unverifiableRookieYear++;
 return false;
}
function key(fmt,year,sid){return fmt+'|'+year+'|'+sid}
const files=seasonFiles(2022).filter(f=>Number(f.slice(0,4))<=2025);
if(!files.length)throw Error('No Sleeper trade archive seasons found in data/sleeper-trades/');
for(const file of files){
 const doc=readSeason(file);
 for(const [date,leagueKey,,selections] of Object.values(doc.drafts||{})){
  counts.draftsSeen++;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))continue;
  if(!selections||!Array.isArray(selections))continue;
  const league=doc.leagues[leagueKey];if(!league)continue;
  const fmt=formatOf(league),yr=Number(date.slice(0,4));
  if(yr<2022||yr>2025||date<yr+'-03-01'||date>yr+'-08-31')continue;
  const b=book(fmt);
  const follow=new Date(Date.parse(date)+horizonMs).toISOString().slice(0,10);
  if(follow>b.latestDate)continue;
  counts.eligibleDrafts++;
  // Keep slot cohorts separate from the unique-per-rookie round analysis.
  // A given rookie is observed in many league drafts. Per-slot duplicates
  // are collapsed, and across-slot dependence is stated in report warnings.
  const slotData=slotsForDraft(selections);
  if(slotData.reason==='ok')counts.slotDraftsValidated++;
  else counts.slotDraftsRejected++;
  const firstRound=slotData.slots.filter(p=>p.round===1);
  const firstRookieCount=firstRound.filter(p=>verifiedRookie(p.sid,yr,false)).length;
  const rookieHeavy=firstRound.length>=8&&firstRookieCount/firstRound.length>=0.8;
  if(slotData.reason==='ok'){
   if(rookieHeavy)counts.slotDraftsRookieHeavy++;
   else counts.slotDraftsNotRookieHeavy++;
  }
  for(const p of slotData.slots){
   if(!verifiedRookie(p.sid,yr,false))continue;
   counts.slotSelectionsVerified++;
   const k=[fmt,yr,p.round,p.slot,p.draftSize].join('|');
   if(!slotSamples.has(k))slotSamples.set(k,{format:fmt,year:yr,round:p.round,slot:p.slot,draftSize:p.draftSize,
     picks:0,rookieHeavyPicks:0,rosterIds:new Map(),
     // Use trade-day-specific follow-up prices, not the first price observed
     // for a rookie who appears in many different drafts.
     observedPrices:new Map(),rookieHeavyPrices:new Map(),
     missingSelectionCount:0,rookieHeavyMissingSelectionCount:0});
   const g=slotSamples.get(k);
   g.picks++;
   if(rookieHeavy)g.rookieHeavyPicks++;
   if(!g.rosterIds.has(p.sid))g.rosterIds.set(p.sid,{sid:p.sid,follow,date,count:0});
   g.rosterIds.get(p.sid).count++;
   // Each real selection is measured at its own draft date + 365 days;
   // frequency aggregation retains repeated draft choices without
   // materializing millions of independent-looking rows.
   const price=b.at(p.sid,follow);
   if(price==null||!Number.isFinite(Number(price))){
    g.missingSelectionCount++;
    if(rookieHeavy)g.rookieHeavyMissingSelectionCount++;
   }else{
    const value=Number(price);
    g.observedPrices.set(value,(g.observedPrices.get(value)||0)+1);
    if(rookieHeavy)g.rookieHeavyPrices.set(value,(g.rookieHeavyPrices.get(value)||0)+1);
   }
  }
  for(const selection of selections){
   if(!Array.isArray(selection))continue;
   const round=Number(selection[1]),sid=String(selection[2]||'');
   if(!Number.isInteger(round)||round<1||round>4||!sid)continue;
   counts.selectionsSeen++;
   if(!verifiedRookie(sid,yr))continue;
   const k=key(fmt,yr,sid),prior=data.get(k);
   if(prior){
    if(prior.round!==round)counts.conflictingRounds++;
    // Retain earliest eligible draft as reference for each distinct rookie;
    // ignore additional selections, which are not independent observations.
    if(prior.date<=date)continue;
   }
   data.set(k,{format:fmt,year:yr,round,sid,date,follow});
  }
 }
}
const buckets=new Map(),percentile=(v,q)=>{
 if(!v.length)return null;
 const a=[...v].sort((a,b)=>a-b),i=(a.length-1)*q,lo=Math.floor(i),hi=Math.ceil(i);
 return Math.round(a[lo]+(a[hi]-a[lo])*(i-lo));
};
function group(fmt,year,round){
 const k=fmt+'|'+year+'|'+round;
 if(!buckets.has(k))buckets.set(k,{format:fmt,year,round,n:0,known:0,missing:0,
  draftDayKnown:0,draftDayMissing:0,pickPriceKnown:0,followValues:[],dayValues:[],pickPrices:[],pos:{}});
 return buckets.get(k);
}
for(const item of data.values()){
 const {format,year,round,sid,date,follow}=item;
 const b=book(format),g=group(format,year,round);
 g.n++;counts.uniqueRookies++;
 const p=players[sid];const position=p?.position||'UNKNOWN';
 g.pos[position]=(g.pos[position]||0)+1;
 const later=b.at(sid,follow);
 if(later==null||!Number.isFinite(Number(later)))g.missing++;
 else {g.known++;g.followValues.push(Number(later))}
 const draftDay=b.at(sid,date);
 if(draftDay==null)g.draftDayMissing++;else{g.draftDayKnown++;g.dayValues.push(Number(draftDay))}
 // Snapshot is the mid-pick price, before the actual draft. These are
 // illustrative market baselines, not the expected price of a selected rookie.
 const prior=new Date(Date.parse(date)-14*864e5).toISOString().slice(0,10);
 const pickPrice=b.at('p'+year+'-'+round,prior,true);
 if(pickPrice!=null){g.pickPriceKnown++;g.pickPrices.push(pickPrice)}
}
const groups=[...buckets.values()].sort((a,b)=>a.year-b.year||a.format.localeCompare(b.format)||a.round-b.round)
 .map(g=>({format:g.format,year:g.year,round:g.round,n:g.n,known:g.known,missing:g.missing,
  missingRatePct:+(100*g.missing/Math.max(1,g.n)).toFixed(1),
  draftDayKnown:g.draftDayKnown,draftDayMissing:g.draftDayMissing,pickPriceKnown:g.pickPriceKnown,
  followup:{p10:percentile(g.followValues,0.1),p25:percentile(g.followValues,0.25),
   median:percentile(g.followValues,0.5),p75:percentile(g.followValues,0.75),p90:percentile(g.followValues,0.9)},
  draftDayMedian:percentile(g.dayValues,0.5),preDraftPickMidMedian:percentile(g.pickPrices,0.5),
  positions:g.pos})); 
function weightedPercentile(rows,q){
 const sorted=rows.filter(r=>r.weight>0).sort((a,b)=>a.value-b.value);
 const total=sorted.reduce((n,r)=>n+r.weight,0);
 if(!total)return null;
 const target=total*q;let sum=0;
 for(const r of sorted){sum+=r.weight;if(sum>=target)return Math.round(r.value)}
 return Math.round(sorted[sorted.length-1].value);
}
// Slot observations use unique rookie IDs per (season, format, round, slot,
 // draft size). All league draft repeats are exposed via 'selections' but
 // never treated as independent observations for quantile computation.
const slotGroups=[...slotSamples.values()].map(g=>{
 const values=[];let missing=0;
 // Legacy distinct-rookie diagnostic retains one first-seen outcome per
 // player; it must never be confused with the typical selection outcome.
 for(const item of g.rosterIds.values()){
  const price=book(g.format).at(item.sid,item.follow);
  if(price==null||!Number.isFinite(Number(price)))missing++;
  else values.push(Number(price));
 }
 const n=g.rosterIds.size;
 const countEntries=m=>[...m].map(([value,weight])=>({value,weight}));
 const measure=prices=>({
  p25:weightedPercentile(countEntries(prices),.25),
  median:weightedPercentile(countEntries(prices),.5),
  p75:weightedPercentile(countEntries(prices),.75)
 });
 const concentration=Math.max(0,...[...g.rosterIds.values()].map(x=>x.count));
 return {format:g.format,year:g.year,round:g.round,slot:g.slot,draftSize:g.draftSize,
  selections:g.picks,distinctRookies:n,known:values.length,missing,
  verifiedRookieSelectionsInRookieHeavyDrafts:g.rookieHeavyPicks,
  rookieHeavyKnownSelections:g.rookieHeavyPicks-g.rookieHeavyMissingSelectionCount,
  rookieHeavyMissingSelections:g.rookieHeavyMissingSelectionCount,
  rookieHeavySharePct:+(100*g.rookieHeavyPicks/Math.max(1,g.picks)).toFixed(1),
  missingSelectionRatePct:+(100*g.missingSelectionCount/Math.max(1,g.picks)).toFixed(1),
  rookieHeavyMissingSelectionRatePct:+(100*g.rookieHeavyMissingSelectionCount/Math.max(1,g.rookieHeavyPicks)).toFixed(1),
  mostCommonRookieSharePct:+(100*concentration/Math.max(1,g.picks)).toFixed(1),
  missingRatePct:+(100*missing/Math.max(1,n)).toFixed(1),
  followup:{p25:percentile(values,.25),median:percentile(values,.5),p75:percentile(values,.75)},
  // All verifiable rookies from structurally valid drafts, including
  // potentially contaminated startup/supplemental league drafts.
  selectionWeightedFollowup:measure(g.observedPrices),
  // Only complete drafts whose first round is >=80% verifiable rookies.
  // This is a transparent proxy, not an asserted draft-type label.
  rookieHeavySelectionWeightedFollowup:measure(g.rookieHeavyPrices)};
}).sort((a,b)=>a.year-b.year||a.format.localeCompare(b.format)||a.round-b.round||a.draftSize-b.draftSize||a.slot-b.slot);
const result={generated:new Date().toISOString().slice(0,10),horizonDays:365,
 description:'Explicit NFL rookie-year verified picks only: KTC prices 365 days after dynasty drafts, by year, league format and round',
 counts,registryLoaded:!!draftIndex,groups:groups.filter(g=>g.n>=minDrafts),
 slotGroups:slotGroups.filter(g=>g.distinctRookies>=minDrafts),
 warnings:[
 'Research only. This is the future PRICE of rookies actually selected in drafts, not a return forecast for an individual owned draft pick.',
 'One rookie is one observation per season/format, regardless of popularity across drafts. Correlated duplicate selections are not independent samples.',
 'Missing KTC follow-up prices are excluded from percentiles and disclosed separately, never interpreted as certain zero-value outcomes.',
 'Selection alone does not establish rookie status. Verified rookie year must match explicit Sleeper fields or an unambiguous nflverse NFL-draft name and position.',
 'Undrafted rookie free agents are omitted unless Sleeper has their explicit rookie year; name matches cannot establish identity for duplicate names.',
 'League draft types cannot always be validated from the compressed crawl; filtering rookie identities does not establish whether a draft was startup or rookie-only.',
 'Historical pick-value snapshots may not cover the pre-draft years. Missing reference prices remain null; NEVER use a modern pick price for an old draft.',
 'Slot cohorts include only complete 8–16 team rounds with sequential overall pick numbers, and show size (10-team 1.10 differs from 12-team 1.10).',
 'Rookie-heavy diagnostic means at least 80% of the complete first-round selections are verifiable rookies. It is a heuristic and DOES NOT prove league draft type.',
 'Selection-weighted followup reports each real selection priced at its own draft date + 365 days; players repeat across leagues, so it is NOT an independent-player forecast or confidence interval.',
 'Rookie-heavy selection-weighted followup is a separate >=80% verified first-round-players heuristic cohort. Do not treat it as confirmed rookie-only draft type.',
 'Both weighted cohorts exclude missing follow-up prices from quantiles and publish their distinct missing-selection rates.',
 'Distinct-rookie quantiles give a rare player equal weight to a popular player and are inappropriate as stand-alone estimates of typical pick outcomes.',
 'Repeated selections are deduplicated within EACH slot, but a rookie can occur in several different slots across leagues; slot groups are correlated and are not independent player cohorts.',
 'Draft selection frequencies are affected by league participation and draft date; never interpret them as probabilities without calibration.',
 'Draft selections can differ by league. The round-level and slot-level outcomes are research diagnostics, not prices for individual picks.',
 'Only formats and seasons with matured full 365-day horizons are shown. Draft-day price and mid-pick baseline are context, not forecast calibration.',
 'No changes to Vault market values, draft-pick pricing, team grading, or Trade Coach suggestions.'
 ]};
console.log(JSON.stringify(result,null,2));
