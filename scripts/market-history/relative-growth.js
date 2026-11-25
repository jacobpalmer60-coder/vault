'use strict';
// Research only. All prices are additive, in one format, observed as-of dates.
// Model predicts relative 365-day retention/return, not manager intent.
const DAY=86400000,CUTOFF='2025-08-01',HORIZON=365,TRAIL=90;
const datePlus=(d,n)=>new Date(Date.parse(d)+n*DAY).toISOString().slice(0,10);
const hash=s=>{let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
function cohort(date,league){
 if(!/^202[45]-\d\d-\d\d$/.test(date)||!league||!Number.isFinite(Date.parse(date)))return null;
 const holdout=hash(league)%5===0;
 if(date<'2025-01-01'&&datePlus(date,HORIZON)<CUTOFF&&!holdout)return 'train';
 if(date>=CUTOFF&&date<'2026-01-01'&&holdout)return 'test';
 return null;
}
// Only strictly backward observations within seven CALENDAR days, never
// carry a future observation backward or treat an unlisted asset as zero.
function makeSeries(doc){
 const dates=doc.dates.map(d=>Date.parse(d));
 if(!dates.length||dates.some((d,i)=>!Number.isFinite(d)||(i>0&&d<=dates[i-1])))throw Error('Invalid historical dates');
 const series=new Map();
 for(const [name,row] of Object.entries(doc.players)){
  if(!Array.isArray(row)||row.length<2||!Number.isInteger(row[0])||row[0]<0||row[0]>=dates.length||!Number.isFinite(row[1]))continue;
  const vals=new Float32Array(dates.length);vals.fill(NaN);
  let i=row[0],v=row[1];vals[i]=v;
  for(let k=2;k<row.length;k++){i++;if(i>=dates.length)break;if(row[k]===null)continue;if(!Number.isFinite(row[k]))throw Error('Invalid price delta');v+=row[k];vals[i]=v;}
  series.set(name,vals);
 }
 return {latest:doc.dates.at(-1),at(name,date){
  const vals=series.get(name),d=Date.parse(date);
  if(!vals||!Number.isFinite(d))return null;
  let lo=0,hi=dates.length-1,i=-1;
  while(lo<=hi){const m=(lo+hi)>>1;if(dates[m]<=d){i=m;lo=m+1}else hi=m-1;}
  for(;i>=0&&d-dates[i]<=7*DAY;i--)if(Number.isFinite(vals[i])&&vals[i]>=0)return vals[i];
  return null;
 }};
}
const sum=xs=>xs.reduce((s,x)=>s+x,0);
const clip=x=>Math.max(-1,Math.min(1,x));
function example(a,b){
 if(!a.length||!b.length||![...a,...b].every(p=>Number.isFinite(p.now)&&p.now>0&&Number.isFinite(p.before)&&p.before>0&&Number.isFinite(p.after)&&p.after>=0))return null;
 const measure=xs=>{
  const base=sum(xs.map(p=>p.now)),past=sum(xs.map(p=>p.before)),future=sum(xs.map(p=>p.after));
  return {base,future,trend:clip(Math.log(base/past)),growth:future/base-1};
 };
 const x=measure(a),y=measure(b),den=x.base+y.base;
 return {feature:x.trend-y.trend,target:x.growth-y.growth,initial:2*(x.base-y.base)/den,future:2*(x.future-y.future)/den,
  // Convert predicted relative growth into a gap forecast, without claiming
  // the common market-wide growth component is predicted by this model.
  commonWeight:2*x.base*y.base/(den*den),shape:[a.length,b.length].sort((u,v)=>u-v).map(n=>Math.min(4,n)).join('-for-')};
}
function fit(rows){
 // Fit one odd, orientation-symmetric coefficient. Fixed ridge strength
 // (50 pseudo-observations), no test-label selection, no intercept.
 const n=rows.length,xx=sum(rows.map(r=>r.feature*r.feature)),xy=sum(rows.map(r=>r.feature*r.target));
 return {n,beta:Math.max(-2,Math.min(2,xy/(xx+50)))};
}
function evaluate(rows,beta){
 const result={n:rows.length,decisive:0,baselineGrowthMAE:0,trendGrowthMAE:0,baselineGapMAE:0,trendGapMAE:0,baselineDirectionRight:0,trendDirectionRight:0,trendGrowthRight:0,trendGrowthCalls:0,pairedGrowthBetter:0,pairedGrowthWorse:0};
 for(const r of rows){
  const pred=beta*r.feature, gap=r.initial+2*r.commonWeight*pred;
  const a=Math.abs(r.target),b=Math.abs(r.target-pred);
  result.baselineGrowthMAE+=a;result.trendGrowthMAE+=b;
  result.baselineGapMAE+=Math.abs(r.future-r.initial);result.trendGapMAE+=Math.abs(r.future-gap);
  if(b<a-1e-12)result.pairedGrowthBetter++;if(b>a+1e-12)result.pairedGrowthWorse++;
  if(Math.abs(r.future)>1e-12){result.decisive++;if(Math.sign(r.initial)===Math.sign(r.future))result.baselineDirectionRight++;if(Math.sign(gap)===Math.sign(r.future))result.trendDirectionRight++;}
  if(Math.abs(r.target)>1e-12&&Math.abs(pred)>1e-12){result.trendGrowthCalls++;if(Math.sign(pred)===Math.sign(r.target))result.trendGrowthRight++;}
 }
 for(const k of ['baselineGrowthMAE','trendGrowthMAE','baselineGapMAE','trendGapMAE'])result[k]=rows.length?result[k]/rows.length:null;
 return result;
}
module.exports={CUTOFF,HORIZON,TRAIL,datePlus,hash,cohort,makeSeries,example,fit,evaluate};
