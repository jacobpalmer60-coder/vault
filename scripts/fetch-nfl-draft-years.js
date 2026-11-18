#!/usr/bin/env node
'use strict';
/* Download the public nflverse NFL draft registry for local validation.
 * Source: https://github.com/nflverse/nfldata/blob/master/data/draft_picks.csv
 * Data source attribution: nflverse (see repo for license).
 * This is research input, not a live price feed; no upload to the website.
 */
const https=require('node:https'),fs=require('node:fs'),path=require('node:path');
const url='https://raw.githubusercontent.com/nflverse/nfldata/master/data/draft_picks.csv';
const out=path.join(__dirname,'..','data','research','nfl-draft-years.csv');
function fetchText(target,redirects=0){
 if(redirects>4)throw Error('Too many redirects');
 return new Promise((resolve,reject)=>{
  https.get(target,{headers:{'User-Agent':'Vault-research/1.0'}},r=>{
   if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){
    r.resume();resolve(fetchText(new URL(r.headers.location,target).href,redirects+1));return;
   }
   if(r.statusCode!==200){r.resume();reject(Error('HTTP '+r.statusCode));return}
   let data='';r.setEncoding('utf8');r.on('data',s=>data+=s);r.on('end',()=>resolve(data));r.on('error',reject);
  }).on('error',reject)
 })
}
(async()=>{
 const data=await fetchText(url);
 if(!data.startsWith('season,')||!data.includes(',pfr_name,')||!data.includes(',position'))throw Error('Unexpected draft registry format; refusing to overwrite local data');
 const {csvRows}=require('./market-history/rookie-evidence');
 const rows=csvRows(data);
 const selected=rows.filter((row,i)=>i===0||Number(row[0])===2024||Number(row[0])===2025);
 if(selected.length<300)throw Error('Insufficient confirmed 2024-2025 draft records: '+selected.length);
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,selected.map(row=>row.map(c=>/[",\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c).join(',')).join('\n')+'\n');
 console.log('Saved '+(selected.length-1)+' NFL draft identities from nflverse to '+out);
 console.log('Use these identities ONLY to verify draft-year eligibility, not future value or pick return.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
