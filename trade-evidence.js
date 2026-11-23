/* Shared league-wide evidence, independent of the viewer's saved team. */
(function(root){
 'use strict';
 const id=v=>String(v),finite=x=>typeof x==='number'&&Number.isFinite(x);
 function reliable(g){return !!(g&&g.tx&&g.tx.transaction_id!=null&&!g.anyMissingValue&&
   !g.tx._ownerAttributionUncertain&&finite(g.fairness?.overallPct));}
 function summarize({tradeActivity=[],allGraded=[],weekErrors=[]}={}){
   const activity=new Map();
   for(const tx of Array.isArray(tradeActivity)?tradeActivity:[]){
     if(!tx||tx.transaction_id==null)continue;
     const key=id(tx.transaction_id),old=activity.get(key);
     if(old)activity.set(key,{...old,...tx,_ownerAttributionUncertain:!!(old._ownerAttributionUncertain||tx._ownerAttributionUncertain)});
     else activity.set(key,tx);
   }
   const priceable=new Map();
   for(const g of Array.isArray(allGraded)?allGraded:[]){
     if(reliable(g)&&!activity.get(id(g.tx.transaction_id))?._ownerAttributionUncertain)priceable.set(id(g.tx.transaction_id),g);
   }
   const all=[...activity.values()],total=all.length;
   const graded=all.filter(tx=>priceable.has(id(tx.transaction_id))).length;
   const weekFailures=Array.isArray(weekErrors)?weekErrors:[];
   return {total,graded,ungraded:total-graded,
     ownerUncertain:all.filter(tx=>tx._ownerAttributionUncertain).length,
     missingWeeks:weekFailures.reduce((n,s)=>n+(Array.isArray(s.weeks)?s.weeks.length:0),0),
     weekFailures,pricedIds:new Set(priceable.keys()),
     reliableGrades:[...priceable.values()]};
 }
 function byManager(tradeActivity=[],teams=[]){
   const known=new Set(teams.map(t=>id(t.rosterId))),totals=new Map([...known].map(x=>[x,0]));
   const seen=new Set();
   for(const tx of tradeActivity||[]){
     if(!tx||tx.transaction_id==null||tx._ownerAttributionUncertain)continue;
     const key=id(tx.transaction_id);if(seen.has(key))continue;seen.add(key);
     for(const rid of new Set((tx.roster_ids||[]).filter(x=>x!=null).map(id)))if(known.has(rid))totals.set(rid,totals.get(rid)+1);
   }
   return totals;
 }
 function render(s,{activityHref='activity.html'}={}){
   const n=x=>Number(x).toLocaleString();
   const attr=String(activityHref).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
   const warning=s.missingWeeks>0||s.ungraded>0;
   const entries=[
     [n(s.total),'Recorded trades','Completed Sleeper deals, including ones without a price'],
     [n(s.graded),'Reliable grades','Complete valuation and manager attribution'],
     [n(s.ungraded),'Needs evidence','Deals without a trustworthy grade'],
     [s.missingWeeks?n(s.missingWeeks):'None','Missing weeks','Transaction-week feeds that failed after retry']
   ];
   const note=(s.ungraded?n(s.ungraded)+' completed trade'+(s.ungraded===1?'':'s')+' cannot receive a trustworthy verdict. ':'')+
     (s.ownerUncertain?n(s.ownerUncertain)+' trade'+(s.ownerUncertain===1?' has':'s have')+' uncertain historical ownership. ':'')+
     (s.missingWeeks?n(s.missingWeeks)+' transaction week'+(s.missingWeeks===1?'':'s')+' failed to load; counts may be incomplete.':'No transaction-week fetch failures reported.');
   return '<div class="vault-evidence-header"><span class="vault-kicker">LEAGUE TRADE EVIDENCE</span>'+
     '<a class="vault-link" href="'+attr+'">View all activity</a></div>'+
     '<dl class="vault-evidence-metrics">'+entries.map(([value,label,meaning])=>'<div title="'+meaning+'"><dt>'+label+'</dt><dd>'+value+'</dd></div>').join('')+'</dl>'+
     '<p class="vault-evidence-note'+(warning?' vault-evidence-caution':'')+'">'+note+'</p>';
 }
 const api=Object.freeze({reliable,summarize,byManager,render});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.VaultTradeEvidence=api;
})(typeof globalThis==='undefined'?this:globalThis);
