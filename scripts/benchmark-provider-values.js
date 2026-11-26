#!/usr/bin/env node
'use strict';
// Independent cross-provider benchmark. Never trains or changes production prices.
// Today's cross-section is diagnostic, not historical out-of-sample evidence.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {loadVault,ROOT}=require('./lib-market');
const Vault=loadVault();
const Policy=require('../trade-policy');
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,'data',p),'utf8'));
const median=x=>{const a=[...x].sort((a,b)=>a-b);return a.length?(a[(a.length-1)>>1]+a[a.length>>1])/2:null};
function rank(rows,key){
 const sorted=[...rows].sort((a,b)=>b[key]-a[key]), out=new Map();
 for(let i=0;i<sorted.length;){let j=i+1;while(j<sorted.length&&sorted[j][key]===sorted[i][key])j++;
 const pct=100*(i+j-1)/2/Math.max(1,sorted.length-1);
 for(let k=i;k<j;k++)out.set(sorted[k].id,pct);i=j;}
 return out;
}
function margin(a,b){return a+b>0?200*(b-a)/(a+b):null;} // positive means receiver A wins
function analyze(rows){
 const sources=['vault','ktc','ra','dd'], ranks=Object.fromEntries(sources.map(k=>[k,rank(rows,k)]));
 const result=rows.map(row=>{
 const p=Object.fromEntries(sources.map(k=>[k,ranks[k].get(row.id)]));
 return {...row,ranks:p,delta:p.vault-median([p.ktc,p.ra,p.dd])};
 });
 const summary=Object.fromEntries(sources.slice(1).map(k=>[k,{medianAbsoluteRankGap:median(result.map(r=>Math.abs(r.ranks.vault-r.ranks[k])))}]));
 return {matched:rows.length,summary,byPosition:Object.fromEntries(['QB','RB','WR','TE','Pick'].map(pos=>{
 const sub=result.filter(r=>r.pos===pos);return [pos,{n:sub.length,medianSignedRankGap:median(sub.map(r=>r.delta))}];})),largestGaps:result.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,20)};
}
if(process.argv.includes('--self-test')){
 const rows=[{id:'1',vault:9,ktc:8,ra:7,dd:6},{id:'2',vault:2,ktc:3,ra:4,dd:5},{id:'3',vault:1,ktc:1,ra:1,dd:1}];
 assert.equal(analyze(rows).summary.ra.medianAbsoluteRankGap,0);
 assert.equal(rank([{id:'a',v:5},{id:'b',v:5}], 'v').get('a'),50);
 assert.equal(margin(200,300),-margin(300,200));
 assert.equal(margin(0,0),null);
 console.log('PASS cross-provider comparison arithmetic, tie ranks, receiver symmetry');
 process.exit(0);
}
const ktc=read('ktc-values.json'), dd=read('dynasty-daddy-values.json'), ra=read('roster-audit-values.json'), grade=read('grade-values.json'), players=read('sleeper-players.json');
const report={generatedAt:new Date().toISOString(),sources:{ktc:ktc.updated,dd:dd.updated,ra:ra.fetchedAt,vault:grade.updated},method:'Matched positive player values; rank percentiles on same universe; positive rank gap means Vault ranks lower than external median. KTC and Vault are dependent, so consensus is descriptive only.',formats:{}};
for(const sf of [true,false]){
 const key=sf?'sf':'oneQB', raKey=sf?'sf_ppr':'1qb_ppr', prop=sf?'sf':'1qb';
 Vault.setGradeMarket(grade,sf,0);
 if(!grade.formats?.[key])throw Error('Missing Vault market format '+key);
 const rows=[], unmatched=[], seen=new Set();
 for(const p of ktc.players){
 if(!['QB','RB','WR','TE'].includes(p.pos)||!finite(p[key]))continue;
 const id=Vault.findSleeperId(players,p.name,p.pos,Vault.ktcTeam(p.team));
 if(!id||players[id]?.position!==p.pos||seen.has(id)){unmatched.push(p.name);continue;}
 seen.add(id);
 const asset={type:'player',id,name:p.name,pos:p.pos,value:p[key],ktcPrice:p[key]};
 const vals={vault:Vault.gradeValue(asset),ktc:p[key],ra:ra.formats?.[raKey]?.[id]?.[prop],dd:dd.players?.[id]?.[sf?1:0]};
 if(!Object.values(vals).every(finite)){unmatched.push(p.name);continue;}
 rows.push({id,name:p.name,pos:p.pos,...vals});
 }
 if(rows.length<100)throw Error('Insufficient overlap '+key+': '+rows.length);
 const pickRows=[], missingPicks=[];
 for(const p of ktc.picks||[]){
 const id=p.season+'-'+p.round+'-'+p.slot;
 const a={type:'pick',season:p.season,round:p.round,tier:p.slot,value:p[key]};
 const vals={vault:Vault.gradeValue(a),ktc:p[key],ra:Vault.rosterAuditValue(a,sf,{picks:ra.picks?.picks}),dd:Vault.dynastyDaddyValue(a,sf,dd)};
 if(!Object.values(vals).every(finite)){missingPicks.push(id);continue;}
 pickRows.push({id,name:id,pos:'Pick',...vals});
 }
 report.formats[key]={...analyze(rows),unmatched:unmatched.length,unmatchedExamples:unmatched.slice(0,20),picks:{...analyze(pickRows),unmatched:missingPicks}};

}
// Reconstructed from the reported TurboNutz–Skolir trade, not a verified
// transaction ID. Today's prices cannot reproduce the original historical verdict.
Vault.setGradeMarket(grade,true,0);
const player=name=>{
 const p=ktc.players.find(p=>Vault.normalizeName(p.name)===Vault.normalizeName(name));
 if(!p)throw Error('Regression player missing: '+name);
 const id=Vault.findSleeperId(players,p.name,p.pos,Vault.ktcTeam(p.team));
 if(!id)throw Error('Regression player ID missing: '+name);
 return {id,name:p.name,type:'player',pos:p.pos,value:p.sf,ktcPrice:p.sf};
};
const pk=ktc.picks.find(p=>p.season===2028&&p.round===1&&p.slot==='mid');
if(!pk)throw Error('Regression pick missing');
const A=[player('Geno Smith'),{type:'pick',name:'2028 Mid 1st',season:2028,round:1,tier:'mid',value:pk.sf,ktcPrice:pk.sf}];
const B=[player('Lamar Jackson')];
const audit=Policy.priceAudit(Vault,A,B), reverse=Policy.priceAudit(Vault,B,A);
for(const key of ['listed','market','package','ktc']){
 assert.ok(Math.abs(audit[key].signedPct+reverse[key].signedPct)<1e-7,'A/B symmetry '+key);
}
const raData={players:ra.formats.sf_ppr,picks:ra.picks.picks};
const reads={vault:audit.market,ktc:audit.ktc,ra:Vault.rosterAuditRead(A,B,true,raData),dd:Vault.dynastyDaddyRead(A,B,true,dd)};
report.reportedTrade={teams:{A:'Skolir',B:'TurboNutz'},sentA:A,sentB:B,format:'SF PPR, no TEP assumed',note:'Reconstructed from reported assets; current snapshot only; historical league format and transaction ID unverified. Values are for assets SENT; larger side favors opposite receiver.',reads};
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6);
if(out)fs.writeFileSync(out,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
