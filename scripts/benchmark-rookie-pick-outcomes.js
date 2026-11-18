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
const players=readSleeperPlayers(),books=new Map();
const book=fmt=>books.get(fmt)||books.set(fmt,ktcPrices(fmt,players)).get(fmt);
const minDrafts=Math.max(1,Number(process.env.MIN_DRAFTS)||10);
const horizonMs=365*864e5;
const data=new Map(),counts={
 draftsSeen:0,eligibleDrafts:0,selectionsSeen:0,uniqueRookies:0,conflictingRounds:0,
 rejectedVeterans:0,unverifiableRookieYear:0,rejectedNonFantasy:0,missingSleeperIdentity:0
};
const fantasyPositions=new Set(['QB','RB','WR','TE']);
const {loadDraftIndex,draftYearEvidence}=require('./market-history/rookie-evidence');
const draftIndex=loadDraftIndex(path.join(__dirname,'..','data','research','nfl-draft-years.csv'));
counts.verifiedFromNflverse=0;
counts.verifiedFromSleeper=0;
counts.ambiguousIdentity=0;
function verifiedRookie(sid,year){
 const p=players[sid];
 if(!p){counts.missingSleeperIdentity++;return false}
 if(!fantasyPositions.has(p.position)){counts.rejectedNonFantasy++;return false}
 const evidence=draftYearEvidence(p,year,draftIndex);
 if(evidence==='sleeper'){counts.verifiedFromSleeper++;return true}
 if(evidence==='nflverse'){counts.verifiedFromNflverse++;return true}
 if(evidence==='other-year'){counts.rejectedVeterans++;return false}
 if(evidence==='ambiguous'){counts.ambiguousIdentity++;return false}
 counts.unverifiableRookieYear++;
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
const result={generated:new Date().toISOString().slice(0,10),horizonDays:365,
 description:'Explicit NFL rookie-year verified picks only: KTC prices 365 days after dynasty drafts, by year, league format and round',
 counts,registryLoaded:!!draftIndex,groups:groups.filter(g=>g.n>=minDrafts),
 warnings:[
 'Research only. This is the future PRICE of rookies actually selected in drafts, not a return forecast for an individual owned draft pick.',
 'One rookie is one observation per season/format, regardless of popularity across drafts. Correlated duplicate selections are not independent samples.',
 'Missing KTC follow-up prices are excluded from percentiles and disclosed separately, never interpreted as certain zero-value outcomes.',
 'Selection alone does not establish rookie status. Verified rookie year must match explicit Sleeper fields or an unambiguous nflverse NFL-draft name and position.',
 'Undrafted rookie free agents are omitted unless Sleeper has their explicit rookie year; name matches cannot establish identity for duplicate names.',
 'League draft types cannot always be validated from the compressed crawl; filtering rookie identities does not establish whether a draft was startup or rookie-only.',
 'Historical pick-value snapshots may not cover the pre-draft years. Missing reference prices remain null; NEVER use a modern pick price for an old draft.',
 'Draft selections can differ by league. Round-level distributions are NOT pick-slot distributions; 1.01 and 1.12 must not be treated identically.',
 'Only formats and seasons with matured full 365-day horizons are shown. Draft-day price and mid-pick baseline are context, not forecast calibration.',
 'No changes to Vault market values, draft-pick pricing, team grading, or Trade Coach suggestions.'
 ]};
console.log(JSON.stringify(result,null,2));
