'use strict';
const {eligible}=require('./prospective-prices');
const {paired}=require('./premium-calibration');
const FORMATS=['sf','oneQB'];
function eligibleShadow(snap,asset,date){
 if(snap?.kind!=='confidence-shadow-format'||snap.model!=='confidence-25'||snap.evidenceMod!==5||!FORMATS.includes(snap.format))return false;
 const name='confidence-'+snap.format+'-'+snap.capturedAt.slice(0,10)+'.json.gz';
 if(asset.name!==name)return false;
 return eligible({...snap,kind:'prospective-price-snapshot'},{...asset,name:'prices-'+snap.capturedAt.slice(0,10)+'.json.gz'},date);
}
function row(snap,a,b,names,league,date){
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
 return {league:String(league),month:date.slice(0,7),day:date,kind:!picks?'player-only':picks===pieces.length?'pick-only':'mixed',gaps};
}
function report(rows){
 const raw=paired(rows,2,0),old=paired(rows,2,1),days=new Set(rows.map(r=>r.day)).size;
 const group=rs=>({n:rs.length,versusRaw:paired(rs,2,0),versusLive:paired(rs,2,1)});
 const eligible=rows.length>=500&&days>=14&&raw?.leagues>=50&&raw.approximate95CI?.[1]<0&&old.approximate95CI?.[1]<0;
 return {n:rows.length,days,versusRaw:raw,versusLive:old,byKind:Object.fromEntries(['player-only','mixed','pick-only'].map(k=>[k,group(rows.filter(r=>r.kind===k))])),
 decision:eligible?'eligible for manual rollout review; no automatic promotion':'continue shadow testing'};
}
module.exports={FORMATS,eligibleShadow,row,report};
