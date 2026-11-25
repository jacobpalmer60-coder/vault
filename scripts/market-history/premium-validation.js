'use strict';
// Archived premiums are reconstructed, not sealed contemporaneous forecasts.
// Lag snapshot dates 16 calendar days to avoid same-half-month leakage from
// snapshots whose actual publication timestamps are not recorded.
const {datePlus}=require('./relative-growth');
const WEIGHTS=[0,.25,.5,.75,1];
function snapshot(history,date){
 const cutoff=datePlus(date,-16);
 let i=history.dates.length-1;
 while(i>=0&&history.dates[i]>cutoff)i--;
 return i>=0?history.tables[i]:null;
}
const pct=(a,b)=>a+b>0?200*(a-b)/(a+b):null;
function priceRow(a,b,table){
 if(!table||!a.length||!b.length||![...a,...b].every(x=>Number.isFinite(x.now)&&x.now>0&&typeof x.name==='string'))return null;
 const prem=x=>table[x.premiumKey??('n:'+x.name)]??0;
 if(![...a,...b].every(x=>Number.isFinite(prem(x))&&prem(x)>-100))return null;
 const val=(xs,w)=>xs.reduce((s,x)=>s+x.now*(1+w*prem(x)/100),0);
 const gaps=WEIGHTS.map(w=>pct(val(a,w),val(b,w)));
 return {gaps,adjusted:[...a,...b].some(x=>prem(x)!==0)};
}
function summarize(rows){
 const n=rows.length;
 return {n,adjusted:rows.filter(r=>r.adjusted).length,weights:Object.fromEntries(WEIGHTS.map((w,i)=>{
 const gaps=rows.map(r=>Math.abs(r.gaps[i]));
 const paired=rows.map(r=>Math.abs(r.gaps[i])-Math.abs(r.gaps[0]));
 return [String(w),{meanAbsoluteGap:n?gaps.reduce((s,x)=>s+x,0)/n:null,fairUnder14:gaps.filter(x=>x<14).length,closerToEven:paired.filter(x=>x< -1e-9).length,fartherFromEven:paired.filter(x=>x>1e-9).length}];
 }))};
}
// Compact archives encode picks as pYEAR-ROUND and lack pick ownership/slot.
// A duplicated pick token can represent two different picks of the same round.
// Do not replace unavailable years, use present-day draft slots, or cross formats.
function pickAt(snaps,key,date,format){
 const m=/^p(20\d{2})-([1-4])$/.exec(key);
 if(!m||Number(m[1])<Number(date.slice(0,4)))return null;
 const target=m[1]+'-'+m[2]+'-mid',cutoff=datePlus(date,-7);
 for(let i=snaps.length-1;i>=0;i--){
  const s=snaps[i];if(s.date>date)continue;if(s.date<cutoff)break;
  const v=s.picks?.[target]?.[format];
  if(Number.isFinite(v)&&v>0)return {name:key,premiumKey:'k:'+m[1]+'-'+m[2],now:v,type:'pick',round:Number(m[2]),yearsOut:Number(m[1])-Number(date.slice(0,4))};
 }
 return null;
}
function pickGroups(a,b){
 const all=[...a,...b],picks=all.filter(x=>x.type==='pick');
 if(!picks.length)return [];
 const groups=[picks.length===all.length?'pick-only':'mixed-player-pick'];
 if(picks.some(x=>x.round===1))groups.push('first-round-included');
 if(picks.every(x=>x.round>1))groups.push('later-rounds-only');
 if(picks.some(x=>x.yearsOut>=2))groups.push('two-plus-draft-years-out');
 return groups;
}
module.exports={WEIGHTS,snapshot,priceRow,summarize,pickAt,pickGroups};
