'use strict';
/* Explicit NFL-draft year evidence only. Source: nflverse/nfldata draft_picks.csv.
 * An ambiguous name+season+position is never resolved by guessing.
 */
const fs=require('node:fs'),path=require('node:path');
const normalize=s=>String(s||'').toLowerCase().replace(/\./g,'').replace(/'/g,'').replace(/ jr$| sr$| ii$| iii$| iv$| v$/,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
function csvRows(raw){
 const rows=[],row=[];let cell='',quoted=false;
 for(let i=0;i<raw.length;i++){
  const c=raw[i];
  if(c==='"'){
   if(quoted&&raw[i+1]==='"'){cell+='"';i++}else quoted=!quoted;
  }else if(c===','&&!quoted){row.push(cell);cell=''}
  else if((c==='\n'||c==='\r')&&!quoted){
   if(c==='\r'&&raw[i+1]==='\n')i++;
   row.push(cell);if(row.some(x=>x.length))rows.push([...row]);row.length=0;cell='';
  }else cell+=c;
 }
 if(cell.length||row.length){row.push(cell);rows.push([...row])}
 if(quoted)throw Error('Malformed quoted CSV');
 return rows;
}
function loadDraftIndex(file){
 if(!fs.existsSync(file))return null;
 const rows=csvRows(fs.readFileSync(file,'utf8'));
 const header=rows.shift().map(x=>x.trim().toLowerCase());
 for(const key of ['season','pfr_name','position'])if(!header.includes(key))throw Error('NFL draft CSV missing column '+key);
 const at=key=>header.indexOf(key),index=new Map();
 for(const row of rows){
  const year=Number(row[at('season')]),pos=row[at('position')],name=normalize(row[at('pfr_name')]);
  if(year<2020||year>2030||!name||!['QB','RB','WR','TE'].includes(pos))continue;
  const key=[year,pos,name].join('|');
  index.set(key,(index.get(key)||0)+1);
 }
 return index;
}
function draftYearEvidence(player,year,index){
 const explicit=[player?.draft_year,player?.rookie_year,player?.rookie_season,player?.nfl_draft_year]
  .filter(v=>v!==null&&v!==undefined&&v!=='').map(Number).filter(v=>Number.isInteger(v)&&v>=1990&&v<=2030);
 if(explicit.length) return explicit.includes(year)?'sleeper':'other-year';
 if(!index)return 'unverified';
 const key=[year,player?.position,normalize((player?.first_name||'')+' '+(player?.last_name||''))].join('|');
 const candidates=index.get(key)||0;
 return candidates===1?'nflverse':candidates>1?'ambiguous':'unverified';
}
module.exports={normalize,csvRows,loadDraftIndex,draftYearEvidence};
