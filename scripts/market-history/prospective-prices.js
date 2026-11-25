'use strict';
const {normalizeName}=require('./ktc-book');
const {datePlus,hash}=require('./relative-growth');
const {row,GRID,paired}=require('./premium-calibration');
const FORMATS=['sf','sf_tep','sf_tepp','oneQB','oneQB_tep','oneQB_tepp'];
const DAY=86400000;
function capture(ktc,grade,sha,now=new Date().toISOString()){
 const t=Date.parse(now);
 if(!Number.isFinite(t)||!/^[0-9a-f]{40}$/.test(sha))throw Error('Invalid capture provenance');
 for(const source of [ktc,grade]){
  const age=t-Date.parse(source.updated);
  if(!Number.isFinite(age)||age<0||age>48*3600000)throw Error('Source stale or future-dated; do not capture');
 }
 const formats={};
 for(const f of FORMATS){
  if(!grade.formats?.[f]||Object.keys(grade.formats[f]).length<10)throw Error('Missing premium format '+f);
  const prices={},ambiguous=new Set();
  const add=(key,value)=>{
   if(!key||!Number.isFinite(value)||value<=0||ambiguous.has(key))return;
   if(Object.hasOwn(prices,key)){delete prices[key];ambiguous.add(key);return;}
   prices[key]=value;
  };
  for(const p of ktc.players||[])if(['QB','RB','WR','TE'].includes(p.pos)){const name=normalizeName(p.name);if(name)add('n:'+name,p[f]);}
  for(const p of ktc.picks||[])if(p.slot==='mid'&&Number.isInteger(p.season)&&Number.isInteger(p.round)&&p.round>=1&&p.round<=4)add('k:'+p.season+'-'+p.round,p[f]);
  if(Object.keys(prices).length<100)throw Error('Insufficient current prices '+f);
  formats[f]={prices,premiums:grade.formats[f]};
 }
 return {schemaVersion:1,kind:'prospective-price-snapshot',capturedAt:now,sourceCommit:sha,ktcUpdated:ktc.updated,marketUpdated:grade.updated,formats};
}
// Require GitHub release asset creation metadata. Capture date alone is not
// enough. A snapshot must have been published BEFORE the trade UTC date.
// Use the later of creation and update timestamps as the earliest
// verifiable availability; a post-trade update cannot validate that trade.
function eligible(snapshot,asset,tradeDate){
 const cap=Date.parse(snapshot?.capturedAt),published=Date.parse(asset?.created_at),updated=Date.parse(asset?.updated_at);
 const d=Date.parse(tradeDate+'T00:00:00Z');
 if(snapshot?.kind!=='prospective-price-snapshot'||!Number.isFinite(cap)||!Number.isFinite(published)||!Number.isFinite(updated)||!Number.isFinite(d))return false;
 const available=Math.max(published,updated);
 if(updated<published||cap>published||available>=d||d-available>3*DAY||d-cap>3*DAY)return false;
 if(asset.name!=='prices-'+snapshot.capturedAt.slice(0,10)+'.json.gz')return false;
 return true;
}
function snapshotFor(items,date){
 return items.filter(x=>eligible(x.snapshot,x.asset,date)).sort((a,b)=>Date.parse(b.snapshot.capturedAt)-Date.parse(a.snapshot.capturedAt))[0]?.snapshot||null;
}
function tradeRow(snap,format,a,b,metadata,league,date){
 const f=snap?.formats?.[format];if(!f)return null;
 const all=[...a,...b].map(String),players=all.filter(k=>!k.startsWith('p'));
 if(new Set(players).size!==players.length)return null;
 const assets=all.map(k=>{
  let key,type;
  if(k.startsWith('p')){if(!/^p20\d{2}-[1-4]$/.test(k)||Number(k.slice(1,5))<Number(date.slice(0,4)))return null;key='k:'+k.slice(1);type='pick';}
  else {const name=metadata.get(k);if(!name)return null;key='n:'+name;type='player';}
  const now=f.prices[key];return Number.isFinite(now)&&now>0?{name:key,premiumKey:key,type,now}:null;
 });
 if(assets.some(x=>!x))return null;
 return row(assets.slice(0,a.length),assets.slice(a.length),f.premiums,league,date);
}
function summarize(rows){
 // Prespecified scenarios; report all, no automatic winner selection.
 const full=GRID.findIndex(w=>w.player===1&&w.pick===1);
 const group=rs=>({n:rs.length,scenarios:GRID.map((w,i)=>({...w,versusRaw:paired(rs,i,0),versusFull:paired(rs,i,full)}))});
 return {all:group(rows),byKind:Object.fromEntries(['player-only','mixed','pick-only'].map(k=>[k,group(rows.filter(r=>r.kind===k))]))};
}
module.exports={FORMATS,capture,eligible,snapshotFor,tradeRow,summarize};
