'use strict';
// Research-only candidate models. All inputs must have been available before
// the evaluated day. Premiums describe completed trades, not true fair value.
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const sum=xs=>xs.reduce((s,x)=>s+x,0);
const gap=(a,b)=>a+b>0?200*(a-b)/(a+b):null;
const candidates=Object.freeze([
 {id:'raw-ktc',mode:'raw'},
 {id:'archived-vault',mode:'archive'},
 {id:'rolling-full',mode:'full'},
 ...[25,50,100].map(cap=>({id:'cap-'+cap,mode:'cap',cap})),
 ...[10,25,50].map(prior=>({id:'confidence-'+prior,mode:'confidence',prior})),
 ...[7,14,28].map(halfLife=>({id:'recency-'+halfLife,mode:'recency',halfLife})),
 ...[10,25,50].flatMap(prior=>[25,50].map(cap=>({id:'combined-'+prior+'-'+cap,mode:'combined',prior,cap,halfLife:14}))),
 {id:'separate-player-pick',mode:'combined',prior:25,pickPrior:50,cap:50,halfLife:14},
 {id:'combined-no-cross-format',mode:'combined',prior:25,pickPrior:50,cap:50,halfLife:14,exact:true}
]);
function weightedMedian(xs,halfLife=Infinity){
 if(!xs.length)return 0;
 const sorted=xs.map(x=>({v:x.premium,w:Math.pow(2,-x.age/halfLife)})).sort((a,b)=>a.v-b.v);
 let cumulative=0;const mid=sum(sorted.map(x=>x.w))/2;
 for(const x of sorted){cumulative+=x.w;if(cumulative>=mid)return x.v;}
 return sorted.at(-1).v;
}
function evidence(records,day,now,format){
 return records.filter(x=>x.day<day&&day-x.day<=45&&x.value<=now*1.5&&now<=x.value*1.5)
 .map(x=>({...x,age:day-x.day,exact:x.format===format}));
}
function premium(model,records,archive,type){
 if(model.mode==='raw')return 0;
 if(model.mode==='archive')return Number.isFinite(archive)&&archive> -100?archive:0;
 const exact=records.filter(x=>x.exact), pool=model.exact?exact:exact.length>=10?exact:records;
 if(pool.length<5)return 0;
 const halfLife=model.halfLife||Infinity;
 let p=weightedMedian(pool,halfLife);
 if(model.cap)p=clamp(p,-model.cap,model.cap);
 if(model.prior){
  const n=sum(pool.map(x=>Math.pow(2,-x.age/halfLife))), prior=type==='pick'?(model.pickPrior||model.prior):model.prior;
  p*=n/(n+prior);
 }
 return Math.max(-99.99,p);
}
function sidePrice(xs,model){return sum(xs.map(x=>x.now*(1+premium(model,x.records,x.archive,x.type)/100)));}
function row(a,b,meta){
 if(!a.length||!b.length||![...a,...b].every(x=>Number.isFinite(x.now)&&x.now>0))return null;
 const signed=candidates.map(m=>gap(sidePrice(a,m),sidePrice(b,m)));
 const kind=[...a,...b].every(x=>x.type==='player')?'player-only':[...a,...b].every(x=>x.type==='pick')?'pick-only':'mixed';
 const av=a.map(x=>x.now),bv=b.map(x=>x.now);
 // Package pricing is a separate diagnostic; no candidate silently discounts assets.
 const norm=(xs,p)=>sum(xs.map(x=>Math.pow(x,p)))**(1/p);
 return {...meta,kind,signed,gaps:signed.map(Math.abs),packageGaps:[1,1.1,1.2,1.4].map(p=>Math.abs(gap(norm(av,p),norm(bv,p))))};
}
const mean=(xs,i,field='gaps')=>xs.length?sum(xs.map(x=>x[field][i]))/xs.length:null;
function paired(rows,i,j){
 if(!rows.length)return null;
 const n=rows.length,clusters=new Map();let closer=0,farther=0,total=0;
 for(const x of rows){const d=x.gaps[i]-x.gaps[j];total+=d;if(d< -1e-9)closer++;if(d>1e-9)farther++;
 const c=clusters.get(x.league)||{s:0,n:0};c.s+=d;c.n++;clusters.set(x.league,c);}
 const g=clusters.size,delta=total/n,se=g>1?Math.sqrt(g/(g-1)*sum([...clusters.values()].map(c=>(c.s-c.n*delta)**2)))/n:null;
 return {n,leagues:g,delta,closer,farther,approximate95CI:g>=30?[delta-1.96*se,delta+1.96*se]:null};
}
function report(train,test){
 const leagues=new Set(train.map(x=>x.league)).size;
 const sufficient=train.length>=500&&leagues>=50&&train.filter(x=>x.kind==='mixed').length>=100;
 // Archive is a comparator, never eligible for a newly selected model.
 const ranked=candidates.map((m,i)=>({id:m.id,i,trainingMAE:mean(train,i)})).filter(x=>x.i!==1).sort((a,b)=>a.trainingMAE-b.trainingMAE||a.i-b.i);
 const winner=sufficient?ranked[0].i:null;
 const group=rs=>({n:rs.length,models:candidates.map((m,i)=>({id:m.id,mae:mean(rs,i),versusRaw:paired(rs,i,0),versusArchived:paired(rs,i,1)})),
  packageDiagnostic:[1,1.1,1.2,1.4].map((p,i)=>({p,mae:mean(rs,i,'packageGaps')}))});
 const byKind=Object.fromEntries(['player-only','mixed','pick-only'].map(k=>[k,group(test.filter(x=>x.kind===k))]));
 const raw=winner===null?null:paired(test,winner,0), old=winner===null?null:paired(test,winner,1);
 const supported=!!(raw&&old&&test.length>=500&&raw.leagues>=50&&raw.approximate95CI?.[1]<0&&old.approximate95CI?.[1]<0);
 return {training:{n:train.length,leagues,sufficient,ranked},candidate:winner===null?null:candidates[winner],test:group(test),byKind,
 byMonth:Object.fromEntries([...new Set(test.map(x=>x.month))].sort().map(k=>[k,group(test.filter(x=>x.month===k))])),
 comparison:{versusRaw:raw,versusArchived:old},decision:supported?'eligible for prospective shadow validation, not production':'insufficient evidence to promote; keep existing prices',
 caveats:['Completed-trade parity is descriptive, not actual fairness, future return or acceptance probability.','Archived comparator is reconstructed with lag, not the exact historical deployed model.','Rolling evidence is sampled and uses prior-day prices; cross-format fallback within QB format is approximate.','Approximate intervals cluster by league-season only; repeated assets can correlate.']};
}
module.exports={candidates,weightedMedian,evidence,premium,sidePrice,row,report};
