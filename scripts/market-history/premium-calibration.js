'use strict';
// Fixed research grid. Selection is based exclusively on older training rows.
// This is transaction-price agreement, not willingness or future returns.
const {WEIGHTS}=require('./premium-validation');
const GRID=WEIGHTS.flatMap(player=>WEIGHTS.map(pick=>({player,pick,key:player+'|'+pick})));
const FULL=GRID.findIndex(x=>x.player===1&&x.pick===1),RAW=0;
function row(a,b,table,league,date){
 if(!table||!a.length||!b.length||!league||!date)return null;
 const prem=x=>table[x.premiumKey??('n:'+x.name)]??0;
 if(![...a,...b].every(x=>Number.isFinite(x.now)&&x.now>0&&Number.isFinite(prem(x))&&prem(x)>-100))return null;
 const totals=xs=>xs.reduce((o,x)=>{o.base+=x.now;o[x.type==='pick'?'pick':'player']+=x.now*prem(x)/100;return o;},{base:0,player:0,pick:0});
 const x=totals(a),y=totals(b);
 const gaps=GRID.map(w=>{const u=x.base+w.player*x.player+w.pick*x.pick,v=y.base+w.player*y.player+w.pick*y.pick;return 200*Math.abs(u-v)/(u+v)});
 const all=[...a,...b],picks=all.filter(x=>x.type==='pick');
 return {league:String(league),month:date.slice(0,7),kind:!picks.length?'player-only':picks.length===all.length?'pick-only':'mixed',gaps};
}
const mean=(rows,i)=>rows.length?rows.reduce((s,r)=>s+r.gaps[i],0)/rows.length:null;
function select(rows){
 // Require enough mixed transactions and distinct league keys to identify
 // both weights. Prefer the lower total adjustment on exact ties.
 const mixed=rows.filter(r=>r.kind==='mixed');
 const leagues=new Set(rows.map(r=>r.league)).size;
 if(rows.length<200||mixed.length<100||leagues<30)return {index:null,n:rows.length,mixed:mixed.length,leagues};
 const ranked=GRID.map((w,i)=>({i,gap:mean(rows,i),weight:w.player+w.pick})).sort((a,b)=>a.gap-b.gap||a.weight-b.weight||a.i-b.i);
 return {index:ranked[0].i,n:rows.length,mixed:mixed.length,leagues,trainingMean:ranked[0].gap};
}
function paired(rows,index,reference){
 if(index===null||!rows.length)return null;
 const clusters=new Map();let sum=0,closer=0,farther=0;
 for(const r of rows){
  const d=r.gaps[index]-r.gaps[reference];sum+=d;if(d< -1e-9)closer++;if(d>1e-9)farther++;
  const c=clusters.get(r.league)||{sum:0,n:0};c.sum+=d;c.n++;clusters.set(r.league,c);
 }
 const n=rows.length,g=clusters.size,delta=sum/n;
 // Cluster-robust standard error for a paired mean, not independent trades.
 // League-season keys are imperfect clusters; shared players remain correlated.
 const se=g>1?Math.sqrt(g/(g-1)*[...clusters.values()].reduce((s,c)=>s+(c.sum-c.n*delta)**2,0))/n:null;
 return {n,leagues:g,meanGap:mean(rows,index),referenceGap:mean(rows,reference),delta,closer,farther,
  approximate95CI:g>=30?[delta-1.96*se,delta+1.96*se]:null};
}
function report(train,test){
 const selected=select(train),i=selected.index;
 const evaluate=rs=>({versusRaw:paired(rs,i,RAW),versusFull:paired(rs,i,FULL)});
 const keys=['player-only','mixed','pick-only'];
 return {training:{...selected,grid:GRID.map((w,i)=>({...w,meanGap:mean(train,i)}))},candidate:i===null?null:GRID[i],
  test:evaluate(test),byKind:Object.fromEntries(keys.map(k=>[k,evaluate(test.filter(r=>r.kind===k))])),
  byMonth:Object.fromEntries([...new Set(test.map(r=>r.month))].sort().map(k=>[k,evaluate(test.filter(r=>r.month===k))])),
  testRows:test.length,decision:'research only; no live rollout',caveats:['Selection on earlier rows only. Historical premiums are reconstructed and may overlap calibration; not a sealed prospective test.','Intervals cluster by league-season key only, not repeated players or cross-season leagues. Approximate exploratory intervals, not proof of significance.','Price agreement among completed trades is not acceptance accuracy, roster utility or actual rookie outcomes.']};
}
module.exports={GRID,row,select,paired,report};
