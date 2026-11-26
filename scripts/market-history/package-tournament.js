'use strict';
// Package research: same assets, same prior-only prices, distinct pricing models.
// No roster strategy, acceptance probability or production pricing changes.
const T=require('./valuation-tournament');
const {power}=require('../../package-pricing');
const sum=xs=>xs.reduce((n,v)=>n+v,0);
const signed=(a,b)=>200*(a-b)/(a+b);
const models=Object.freeze([
 {id:'raw-additive',basis:'raw',p:1},
 {id:'estimated-vba',basis:'vba'},
 {id:'archived-vault-additive',basis:'archive',p:1},
 {id:'confidence-25-additive',basis:'confidence',p:1},
 ...['raw','confidence'].flatMap(basis=>[1.1,1.25,1.5,2].map(p=>({id:basis+'-power-'+p,basis,p}))),
 ...[0.1,0.25,0.5].map(weight=>({id:'confidence-concentration-'+weight,basis:'confidence',weight}))
]);
const confidence=T.candidates.find(m=>m.id==='confidence-25');
function concentration(xs,w){
 // Only discount secondary pieces, never the largest piece or a 1-for-1.
 const best=Math.max(...xs);return best+(sum(xs)-best)*(1-w);
}
function values(xs,basis){
 const m=basis==='archive'?T.candidates[1]:basis==='confidence'?confidence:T.candidates[0];
 return xs.map(x=>x.now*(1+T.premium(m,x.records,x.archive,x.type)/100));
}
function row(a,b,meta,vba){
 if(!a.length||!b.length||![...a,...b].every(x=>Number.isFinite(x.now)&&x.now>0))return null;
 const prices=Object.fromEntries(['raw','archive','confidence'].map(k=>[k,[values(a,k),values(b,k)]]));
 if(!Object.values(prices).flat(2).every(v=>Number.isFinite(v)&&v>0))return null;
 const gaps=models.map(m=>{
  if(m.basis==='vba')return Math.abs(vba(...prices.raw));
  const [x,y]=prices[m.basis],f=m.weight?v=>concentration(v,m.weight):v=>power(v,m.p);
  return Math.abs(signed(f(x),f(y)));
 });
 if(!gaps.every(Number.isFinite))return null;
 const pieces=[...a,...b],pickCount=pieces.filter(x=>x.type==='pick').length,top=Math.max(...pieces.map(x=>x.now));
 const shape=[a.length,b.length].sort((x,y)=>x-y).map(n=>n>=4?'4+':String(n)).join('-for-');
 const kind=pickCount===0?'player-only':pickCount===pieces.length?'pick-only':'mixed';
 const starBand=top>=8000?'8000+':top>=5000?'5000-7999':'under-5000';
 return {...meta,shape,kind,starBand,gaps};
}
const mean=(rows,i)=>rows.length?sum(rows.map(r=>r.gaps[i]))/rows.length:null;
function paired(rows,i,j){
 if(!rows.length)return null;
 const n=rows.length,clusters=new Map();let total=0,better=0,worse=0;
 for(const r of rows){const d=r.gaps[i]-r.gaps[j];total+=d;if(d< -1e-9)better++;if(d>1e-9)worse++;const c=clusters.get(r.league)||{sum:0,n:0};c.sum+=d;c.n++;clusters.set(r.league,c);}
 const delta=total/n,g=clusters.size,se=g>=30?Math.sqrt(g/(g-1)*sum([...clusters.values()].map(c=>(c.sum-c.n*delta)**2)))/n:null;
 return {n,leagues:g,delta,better,worse,approximate95CI:se===null?null:[delta-1.96*se,delta+1.96*se]};
}
function report(train,test){
 const nLeagues=rs=>new Set(rs.map(r=>r.league)).size;
 const ready=train.length>=500&&nLeagues(train)>=50&&train.filter(r=>r.kind==='mixed').length>=100&&train.filter(r=>r.shape!=='1-for-1').length>=100;
 // Candidate may be additive. Include 1-for-1s in training; do not cherry pick.
 const ranked=models.map((m,i)=>({id:m.id,i,mae:mean(train,i)})).filter(x=>x.i>=3).sort((a,b)=>a.mae-b.mae||a.i-b.i);
 const winner=ready?ranked[0].i:null;
 const baselineIds=[0,1,2,3];
 const comparisons=winner===null?null:Object.fromEntries(baselineIds.map(i=>[models[i].id,paired(test,winner,i)]));
 const group=rs=>({n:rs.length,models:models.map((m,i)=>({id:m.id,mae:mean(rs,i)})),candidateVsVba:winner===null?null:paired(rs,winner,1),candidateVsConfidence:winner===null?null:paired(rs,winner,3)});
 const breakdown=k=>Object.fromEntries([...new Set(test.map(r=>r[k]))].sort().map(v=>[v,group(test.filter(r=>r[k]===v))]));
 const supported=winner!==null&&winner!==3&&test.length>=500&&nLeagues(test)>=50&&Object.values(comparisons).every(c=>c?.approximate95CI?.[1]<0);
 return {training:{n:train.length,leagues:nLeagues(train),ready,ranked},candidate:winner===null?null:models[winner],test:group(test),comparisons,byShape:breakdown('shape'),byKind:breakdown('kind'),byStarBand:breakdown('starBand'),byMonth:breakdown('month'),
 decision:supported?'eligible for new prospective package shadow test; no production change':'no sufficient evidence to add package adjustment',
 caveats:['VBA is Vault local approximation on historical prior-day prices, not an official KTC quote.','Completed-trade balance is not fair value, future utility or offer acceptance.','The 2026 retrospective period has been studied by other Vault models; this is not a globally untouched holdout.','League-season clusters are approximate; repeats of assets and managers may correlate.','Power and concentration are generic package candidates without actual roster slot costs.']};
}
module.exports={models,power,concentration,row,report};
