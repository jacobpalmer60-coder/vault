'use strict';
const {eligible}=require('./prospective-prices');
const {paired}=require('./premium-calibration');
const {compare}=require('../../package-pricing');
const FORMATS=['sf','oneQB'];
function eligibleShadow(snap,asset,date){
 if(snap?.kind!=='confidence-shadow-format'||snap.model!=='confidence-25'||snap.evidenceMod!==5||!FORMATS.includes(snap.format))return false;
 const name='confidence-'+snap.format+'-'+snap.capturedAt.slice(0,10)+'.json.gz';
 if(asset.name!==name)return false;
 return eligible({...snap,kind:'prospective-price-snapshot'},{...asset,name:'prices-'+snap.capturedAt.slice(0,10)+'.json.gz'},date);
}
function row(snap,a,b,names,league,date,vbaVault=null){
 if(!a?.length||!b?.length)return null;
 const ids=[...a,...b].map(String),players=ids.filter(id=>!id.startsWith('p'));
 if(new Set(players).size!==players.length)return null;
 const pieces=ids.map(id=>{
  let key;
  if(id.startsWith('p')){if(!/^p20\d{2}-[1-4]$/.test(id)||+id.slice(1,5)<+date.slice(0,4))return null;key='k:'+id.slice(1);}
  else {const name=names.get(id);if(!name)return null;key='n:'+name;}
  const v=snap.prices[key],old=snap.archivedPremiums[key]??0,candidate=snap.candidatePremiums[key];
  return [v,old,candidate].every(Number.isFinite)&&v>0&&old> -100&&candidate> -100?{v,old,candidate,key}:null;
 });
 if(pieces.some(x=>!x))return null;
 const sum=(xs,k)=>xs.reduce((n,x)=>n+x.v*(1+(k?x[k]:0)/100),0),left=pieces.slice(0,a.length),right=pieces.slice(a.length);
 const gaps=[null,'old','candidate'].map(k=>{const x=sum(left,k),y=sum(right,k);return 200*Math.abs(x-y)/(x+y)});
 const picks=pieces.filter(x=>x.key.startsWith('k:')).length;
 const packageGaps=(()=>{
  // Only observations after model selection on November 26, not backfilled results.
  if(date<'2026-11-27'||!vbaVault)return null;
  const vals=(xs,k)=>xs.map(x=>x.v*(1+(k?x[k]:0)/100));
  const x=vals(left),y=vals(right);
  vbaVault._globalMaxValue=Math.max(0,...Object.entries(snap.prices).filter(([k,v])=>k.startsWith('n:')&&Number.isFinite(v)).map(([,v])=>v));
  const vba=vbaVault.ktcVerdict(x.map(value=>({value})),y.map(value=>({value}))).signed;
  const raw=compare(x,y),candidate=compare(vals(left,'candidate'),vals(right,'candidate'));
  const g=[...gaps,Math.abs(vba),Math.abs(raw.signedPct),Math.abs(candidate.signedPct)];
  return g.every(Number.isFinite)?g:null;
 })();
 return {league:String(league),month:date.slice(0,7),day:date,kind:!picks?'player-only':picks===pieces.length?'pick-only':'mixed',gaps,packageGaps};
}
function packageReport(rows){
 const rs=rows.filter(r=>r.packageGaps).map(r=>({...r,gaps:r.packageGaps}));
 const names=['raw-additive','archived-vault-additive','confidence-additive','estimated-vba','raw-power-2','confidence-power-2'];
 const mean=i=>rs.length?rs.reduce((n,r)=>n+r.gaps[i],0)/rs.length:null;
 const comparisons=Object.fromEntries(names.slice(0,5).map((name,i)=>[name,paired(rs,5,i)]));
 const days=new Set(rs.map(r=>r.day)).size,leagues=new Set(rs.map(r=>r.league)).size;
 const ready=rs.length>=500&&days>=14&&leagues>=50&&Object.values(comparisons).every(c=>c?.approximate95CI?.[1]<0);
 return {n:rs.length,days,leagues,models:names.map((id,i)=>({id,mae:mean(i)})),comparisons,
 decision:ready?'eligible for further outcome review, not production':'continue package shadow testing',
 note:'Frozen confidence-25 inputs and fixed power-2 curve; VBA local approximation on frozen inputs. No claim of causality or acceptance probability.'};
}
function report(rows){
 const raw=paired(rows,2,0),old=paired(rows,2,1),days=new Set(rows.map(r=>r.day)).size;
 const group=rs=>({n:rs.length,versusRaw:paired(rs,2,0),versusLive:paired(rs,2,1)});
 const eligible=rows.length>=500&&days>=14&&raw?.leagues>=50&&raw.approximate95CI?.[1]<0&&old.approximate95CI?.[1]<0;
 return {n:rows.length,days,versusRaw:raw,versusLive:old,byKind:Object.fromEntries(['player-only','mixed','pick-only'].map(k=>[k,group(rows.filter(r=>r.kind===k))])),
 decision:eligible?'eligible for manual rollout review; no automatic promotion':'continue shadow testing'};
}
module.exports={FORMATS,eligibleShadow,row,report,packageReport};
