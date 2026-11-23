#!/usr/bin/env node
'use strict';
/*
 * RESEARCH ONLY; reproduces the existing historical 365-day label and sample.
 * No future price is used in any trade-day prediction. Price prediction and
 * roster outcome are NOT interchangeable. No automatically selected weight
 * or changes to live Vault behavior. 2024/2025 are retrospective and can
 * overlap original model calibration. 2025 is NOT a sealed holdout.
 *
 * Run: node --max-old-space-size=6144 scripts/benchmark-separated-trade-pricing.js > separated-pricing.json
 */
const {readSleeperPlayers,seasonFiles,readSeason,ktcPrices,formatOf}=require('./market-history/ktc-book');
const {laterOutcome}=require('./market-history/outcome-values');
const {loadVault}=require('./lib-market');
const {WEIGHTS,priceSignals,weightedSignal,nearPeerConsolidationCohorts}=require('./research-trade-separation');
const sampleMod=Math.max(1,Number(process.env.SAMPLE_MOD)||10),horizon=365*864e5;
const formatFilter=String(process.env.BENCHMARK_FORMAT||'').trim();
const yearFilter=String(process.env.BENCHMARK_YEAR||'').trim();
const nearPeerOnly=process.env.NEAR_PEER_ONLY==='1';
if(formatFilter && !['sf','sf_tep','sf_tepp','oneQB','oneQB_tep','oneQB_tepp'].includes(formatFilter))
  throw Error('BENCHMARK_FORMAT must be sf, sf_tep, sf_tepp, oneQB, oneQB_tep, or oneQB_tepp');
if(yearFilter && !/^202[45]$/.test(yearFilter))throw Error('BENCHMARK_YEAR must be 2024 or 2025');
// All diagnostics go to stderr, keeping stdout valid JSON when redirected.
// An archive file or historical price book can be slow to inflate; identifying
// the step is more useful than a silent command with no progress.
const progress=text=>{
 if(process.stderr?.write)process.stderr.write('[price-benchmark] '+text+'\n');
};
const ram=()=>{
 const m=process.memoryUsage?.();
 return m ? ' rss='+Math.round(m.rss/1048576)+'MB heap='+Math.round(m.heapUsed/1048576)+'MB' : '';
};
progress('Startup: sample 1/'+sampleMod+(formatFilter?' format '+formatFilter:' all formats')+
 (yearFilter?' year '+yearFilter:' 2024–2025')+(nearPeerOnly?' player-only 1-for-2 only':''));
const Vault=loadVault();
progress('Loading Sleeper player metadata…');
const players=readSleeperPlayers();
progress('Player metadata ready'+ram());
const bookCache=new Map(),book=f=>{
 if(bookCache.has(f))return bookCache.get(f);
 progress('Loading historical price book '+f+'…'+ram());
 const result=ktcPrices(f,players);
 bookCache.set(f,result);
 progress('Historical price book ready '+f+ram());
 return result;
};
const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0};
const SKIP=new Set(['K','DEF']);
const side=(keys,b,date)=>{
 const out=[];
 for(const k of keys){
  if(k[0]==='p'){if(Number(k.split('-')[1])>=5)continue}
  else if(SKIP.has(players[k]?.position))continue;
  const v=b.at(k,date);
  if(!(v>0))return null;
  out.push({k,v,pos:k[0]==='p'?'PICK':players[k]?.position||'UNKNOWN'});
 }
 return out.length?out:null;
};
const shape=(a,b)=>{
 const n=Math.min(a,b),m=Math.max(a,b);
 return Math.min(n,4)+'-for-'+(m>=4?'4+':m);
};
const init=()=>({eligible:0,decisive:0,missing:0,zeroSignal:0,
 weights:Object.fromEntries(WEIGHTS.map(w=>[String(w),{right:0,wrong:0,tie:0}]))});
const groups={all:init(),playerOnly:init(),byYear:{},playerOnlyYear:{},playerOnlyShape:{},
 nearPeer:{},nearPeerByYear:{}};
const get=(group,key)=>(group[key]||=init());
const record=(r,signals,winner)=>{
 r.eligible++;
 if(!winner){r.zeroSignal++;return}
 r.decisive++;
 for(const weight of WEIGHTS){
  const signal=weightedSignal(signals,weight),entry=r.weights[String(weight)];
  const sign=Math.sign(signal??0);
  if(!sign)entry.tie++;
  else if(sign===winner)entry.right++;
  else entry.wrong++;
 }
};
const seen=new Set(),files=seasonFiles(2024).filter(f=>+f.slice(0,4)<=2025&&(!yearFilter||f.startsWith(yearFilter)));
if(!files.length)throw Error('Missing historical data/sleeper-trades archive for selected years');
let sampled=0,priced=0,mature=0,complete=0,missing=0,scanned=0,lastProgress=Date.now();
for(const file of files){
 progress('Reading and decompressing '+file+'…'+ram());
 const doc=readSeason(file);
 progress('Decompressed '+file+'; scanning trade entries…'+ram());
 // Object.entries() duplicates huge 2024/2025 trade indexes. Iterate the
 // existing dictionary directly and deduplicate only the sampled 1/N subset.
 for(const id in doc.trades){
  if(!Object.prototype.hasOwnProperty.call(doc.trades,id))continue;
  scanned++;
  if(scanned%10000===0&&Date.now()-lastProgress>15000){
    lastProgress=Date.now();
    progress('scanned='+scanned+' sampled='+sampled+' priced='+priced+
      ' complete='+complete+ram());
  }
  if(hash(id)%sampleMod!==0)continue;
  if(seen.has(id))continue;seen.add(id);
  const t=doc.trades[id];
  const [date,leagueKey,aKeys,bKeys]=t;
  if(!date||!doc.leagues[leagueKey]||!aKeys||!bKeys)continue;
  // Optional targeted mode skips most costly lookups before price books load:
  // identify the trade shape and participant format from the trade-day record.
  if(nearPeerOnly){
    if(!((aKeys.length===1&&bKeys.length===2)||(aKeys.length===2&&bKeys.length===1)))continue;
    if([...aKeys,...bKeys].some(k=>k[0]==='p'||SKIP.has(players[k]?.position)))continue;
  }
  const format=formatOf(doc.leagues[leagueKey]);
  if(formatFilter&&format!==formatFilter)continue;
  sampled++;
  const b=book(format),a=side(aKeys,b,date),c=side(bKeys,b,date);
  if(!a||!c)continue;priced++;
  const later=new Date(Date.parse(date)+horizon).toISOString().slice(0,10);
  if(later>b.latestDate)continue;mature++;
  const out=laterOutcome(a,c,later,b);
  if(!out.complete){missing++;continue}
  complete++;
  const signal=priceSignals(a,c,{tradeValueRatio:(x,y)=>Vault.tradeValueRatio(x,y)});
  const year=date.slice(0,4),winner=Math.sign(out.pct??0),isPlayerOnly=[...a,...c].every(p=>p.pos!=='PICK');
  record(groups.all,signal,winner);
  record(get(groups.byYear,year),signal,winner);
  if(isPlayerOnly){
   record(groups.playerOnly,signal,winner);
   record(get(groups.playerOnlyYear,year),signal,winner);
   record(get(groups.playerOnlyShape,year+'|'+shape(a.length,c.length)),signal,winner);
   // Classify only by trade-day values; compare outcomes independently.
   for(const cohort of nearPeerConsolidationCohorts(a,c)){
    record(get(groups.nearPeer,cohort),signal,winner);
    record(get(groups.nearPeerByYear,year+'|'+cohort),signal,winner);
   }
  }
 }
 progress('Finished '+file+': scanned='+scanned+' sampled='+sampled+
   ' complete='+complete+ram());
}
progress('Finished trade pass; writing JSON report…'+ram());
const rates=r=>({
 eligible:r.eligible,decisive:r.decisive,zeroSignal:r.zeroSignal,
 weights:Object.fromEntries(Object.entries(r.weights).map(([w,v])=>[w,{
  ...v,accuracyPct:r.decisive?+(100*v.right/r.decisive).toFixed(2):null
 }]))
});
const maps=m=>Object.fromEntries(Object.entries(m).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,rates(v)]));
console.log(JSON.stringify({
 schemaVersion:1,kind:'research-price-separation',sampleMod,
 filters:{year:yearFilter||null,format:formatFilter||null,playerOnlyOneForTwo:nearPeerOnly},
 dateGenerated:new Date().toISOString().slice(0,10),horizonDays:365,
 caveats:[
  'Future label is the one-year change in additive KTC market prices, not roster value, wins, titles, or manager acceptance.',
  'These are already completed trades; unaccepted offers are absent and no independent manager-level holdout exists.',
  'This reuses a consolidation curve that may have been fitted to overlapping historical trades. Neither 2024 nor 2025 is a sealed holdout.',
  'Trades involving draft picks rely on round-average future pick proxies; use playerOnlyYear and playerOnlyShape for cleaner comparisons.',
  'Weights are predeclared sensitivity scenarios, NOT automatically selected coefficients or deployed changes.'
 ],counts:{sampled,priced,mature,complete,missing},
 all:rates(groups.all),playerOnly:rates(groups.playerOnly),
 byYear:maps(groups.byYear),playerOnlyYear:maps(groups.playerOnlyYear),
 playerOnlyShape:maps(groups.playerOnlyShape),
 nearPeer:maps(groups.nearPeer),nearPeerByYear:maps(groups.nearPeerByYear)
},null,2));
