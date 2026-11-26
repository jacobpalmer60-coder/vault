#!/usr/bin/env node
// Independent benchmark only. Values by https://rosteraudit.com/
// Public rankings/picks; secret used only for optional authenticated smoke test.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base='https://rosteraudit.com/wp-json/ra/v1';
const out=fileURLToPath(new URL('../data/roster-audit-values.json',import.meta.url));
const headers={'User-Agent':'TheVault/1.0 (daily valuation benchmark)','Accept':'application/json'};
async function request(endpoint,opts={}){
 const res=await fetch(base+endpoint,{...opts,headers:{...headers,...opts.headers},signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!res.ok) throw new Error('Roster Audit HTTP '+res.status+' for '+endpoint);
 return res.json();
}
const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
function normalize(raw){
 const result={};
 for(const [id,row] of Object.entries(raw)){
  if(/^\d+$/.test(id)&&valid(row?.sf)&&valid(row?.['1qb'])) result[id]={sf:row.sf,'1qb':row['1qb']};
 }
 if(Object.keys(result).length<200) throw new Error('Incomplete rankings: '+Object.keys(result).length);
 return result;
}
async function main(){
 const formats={};
 for(const format of ['sf_ppr','1qb_ppr','sf_ppr_tep']){
  formats[format]=normalize(await request('/rankings/values?format_key='+format));
 }
 const picks=await request('/picks');
 if(!picks||typeof picks!=='object'||Object.keys(picks).length===0) throw new Error('Missing pick response');
 const snapshot={source:'Roster Audit',attribution:'https://rosteraudit.com/',fetchedAt:new Date().toISOString(),formats,picks};
 const tmp=out+'.tmp';
 await fs.mkdir(path.dirname(out),{recursive:true});
 await fs.writeFile(tmp,JSON.stringify(snapshot));
 await fs.rename(tmp,out);
 console.log('Roster Audit: '+Object.keys(formats.sf_ppr).length+' player values; 3 format queries; pick response saved.');
}
if(process.argv.includes('--check-auth')){
 const key=process.env.ROSTER_AUDIT_API;
 if(!key) throw new Error('ROSTER_AUDIT_API not configured');
 const result=await request('/trade/calculate',{method:'POST',headers:{'X-RA-Key':key,'Content-Type':'application/json'},body:JSON.stringify({side_a:[{type:'player',id:'7564'}],side_b:[{type:'player',id:'9509'}],settings:{is_superflex:true}})});
 if(!valid(result?.side_a?.total_value)||!valid(result?.side_b?.total_value)) throw new Error('Unexpected calculator response');
 console.log('Roster Audit authenticated calculator: OK');
}else await main();
