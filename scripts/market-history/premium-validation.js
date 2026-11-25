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
 const prem=x=>table['n:'+x.name]??0;
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
module.exports={WEIGHTS,snapshot,priceRow,summarize};
