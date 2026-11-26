'use strict';
// Archive the previously published price table, never a reconstructed/backdated one.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','data'),[commit,recordedAt]=process.argv.slice(2);
const data=JSON.parse(fs.readFileSync(path.join(root,'grade-values.json'),'utf8'));
if(!/^[0-9a-f]{40}$/.test(commit||'')||!Number.isFinite(Date.parse(recordedAt))||!Number.isFinite(Date.parse(data.updated))||Date.parse(data.updated)>Date.parse(recordedAt))throw Error('Invalid recorded market provenance');
for(const [format,premiums] of Object.entries(data.formats||{})){
 if(!['sf','sf_tep','sf_tepp','oneQB','oneQB_tep','oneQB_tepp'].includes(format)||!Object.keys(premiums).length)throw Error('Invalid market format');
 const file=path.join(root,'grade-values-history','recorded-'+format+'.json');
 const rows=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
 if(rows.some(r=>r.updated===data.updated))continue;
 rows.push({updated:data.updated,recordedAt,sourceCommit:commit,premiums});
 rows.sort((a,b)=>Date.parse(a.updated)-Date.parse(b.updated));
 fs.writeFileSync(file,JSON.stringify(rows.slice(-90)));
}
