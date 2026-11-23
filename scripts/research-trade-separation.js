'use strict';
/*
 * RESEARCH ONLY. No browser imports; cannot change live trade grades.
 *
 * Distinct questions:
 * 1. Market-price fairness: additive current market prices of owned pieces.
 * 2. Consolidation: a separate, contextual adjustment (not extra KTC dollars).
 * 3. Team roster impact: measured roster/lineup effects for BOTH managers,
 *    supplied by the existing roster engine when available.
 * 4. Acceptance: a manager-specific negotiating judgment, not inferred from
 *    price parity, hypothetical historical returns, or roster gains.
 */
const WEIGHTS=Object.freeze([0,0.1,0.25,0.5,0.75,1]);
const sum=items=>items.reduce((n,a)=>n+Number(a.value??a.v??0),0);
const signedPct=(a,b)=>a+b>0?200*(a-b)/(a+b):null;
const ratioPct=ratio=>Number.isFinite(ratio)&&ratio>0?200*(ratio-1)/(ratio+1):null;
function priceSignals(a,b,{tradeValueRatio}={}){
 if(!Array.isArray(a)||!Array.isArray(b)||!a.length||!b.length)throw Error('Both trade sides require pieces');
 if([...a,...b].some(x=>!Number.isFinite(Number(x.value??x.v))||Number(x.value??x.v)<0))throw Error('Invalid market price');
 const va=sum(a),vb=sum(b),market=signedPct(va,vb);
 if(market===null)return {valueA:va,valueB:vb,marketPct:null,packagePct:null,packageAdjustmentPct:null};
 const ratio=typeof tradeValueRatio==='function'?tradeValueRatio(a.map(x=>Number(x.value??x.v)),b.map(x=>Number(x.value??x.v))):null;
 const packagePct=ratio===null?null:ratioPct(ratio);
 return {valueA:va,valueB:vb,marketPct:market,packagePct,
  packageAdjustmentPct:packagePct===null?null:packagePct-market};
}
function weightedSignal(signals,weight){
 if(!WEIGHTS.includes(weight))throw Error('Weight must be a declared research scenario');
 const {marketPct,packagePct}=signals;
 return marketPct===null||packagePct===null?null:marketPct*(1-weight)+packagePct*weight;
}
// Cohorts for the failure mode exposed in the live Boston + Kiner / Kittle
// trade. This classification uses ONLY trade-day values; future returns never
// determine group membership. Only player-only 1-for-2 trades qualify.
function nearPeerConsolidationCohorts(a,b){
 const counts=[a.length,b.length].sort((x,y)=>x-y);
 if(counts[0]!==1||counts[1]!==2)return [];
 const all=[...a,...b];
 if(all.some(x=>x.pos==='PICK'||!Number.isFinite(Number(x.v??x.value))||Number(x.v??x.value)<=0))return [];
 const single=(a.length===1?a:b)[0], bundle=(a.length===2?a:b);
 const prices=bundle.map(x=>Number(x.v??x.value)).sort((x,y)=>y-x);
 const lead=Math.min(Number(single.v??single.value),prices[0])/
   Math.max(Number(single.v??single.value),prices[0]);
 const extra=prices[1]/prices[0];
 const groups=['All player-only 1-for-2'];
 if(lead>=0.95)groups.push('Lead within 5%');
 else if(lead>=0.85)groups.push('Lead 5-15% apart');
 else groups.push('Lead over 15% apart');
 if(lead>=0.95&&extra>=0.25)groups.push('Lead within 5% | second >=25% of lead');
 if(lead>=0.95&&extra>=0.4)groups.push('Lead within 5% | second >=40% of lead');
 if(lead>=0.85&&extra>=0.25)groups.push('Lead within 15% | second >=25% of lead');
 return groups;
}
function assessment(a,b,{tradeValueRatio,rosterImpact=null,acceptance=null}={}){
 const market=priceSignals(a,b,{tradeValueRatio});
 const cleanSides=(source,label)=>{
  if(source===null)return null;
  if(!source||!source.A||!source.B)throw Error(label+' must cover both teams');
  return {A:source.A,B:source.B};
 };
 const impact=cleanSides(rosterImpact,'Roster impact');
 const manager=cleanSides(acceptance,'Manager acceptance');
 return {
  market,consolidation:{deltaPct:market.packageAdjustmentPct,contextOnly:true},
  rosterImpact:impact,acceptance:manager,
  // Do not invent a final recommendation when team impact or acceptance is missing.
  researchRecommendation:impact&&manager?{
   teamA:impact.A,teamB:impact.B,acceptanceA:manager.A,acceptanceB:manager.B,
   caveat:'Scenario for discussion only; not the live calculator verdict.'
  }:null
 };
}
module.exports={WEIGHTS,priceSignals,weightedSignal,assessment,nearPeerConsolidationCohorts,signedPct,ratioPct};
