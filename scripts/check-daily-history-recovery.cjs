'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'vault-history-'));
try{
 fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'data'));
 fs.copyFileSync(path.join(__dirname,'snapshot-value-history.js'),path.join(root,'scripts','snapshot-value-history.mjs'));
 const write=(n,v)=>fs.writeFileSync(path.join(root,'data',n),JSON.stringify(v));
 write('ktc-values.json',{players:[{name:'New Player',pos:'WR',sf:500,oneQB:400,slug:'new-player'}],picks:[{season:2028,round:1,slot:'mid',sf:4400,oneQB:4000}]});
 write('projections.json',{players:{}});
 write('player-value-history.json',{snapshots:[{date:'2020-01-01',players:{old:{sf:10}}}]});
 write('pick-value-history.json',{snapshots:[{date:'2020-01-01',picks:{'2020-1-mid':{sf:10}}}]});
 fs.writeFileSync(path.join(root,'mock.cjs'),"global.fetch=async url=>{if(!String(url).endsWith('/players/new-player'))throw Error('Unexpected request');return {ok:false,status:503}};");
 const result=cp.spawnSync(process.execPath,['--require',path.join(root,'mock.cjs'),path.join(root,'scripts','snapshot-value-history.mjs')],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);
 const ph=JSON.parse(fs.readFileSync(path.join(root,'data','player-value-history.json'))),pk=JSON.parse(fs.readFileSync(path.join(root,'data','pick-value-history.json')));
 assert.equal(ph.snapshots.length,2);assert.equal(ph.snapshots[0].players.old.sf,10);assert.equal(ph.snapshots[1].players['new player'].sf,500);
 assert.equal(pk.snapshots.length,2);assert.equal(pk.snapshots[1].picks['2028-1-mid'].sf,4400);
 console.log('PASS daily snapshot survives failed optional profile lookup and preserves historical rows');
}finally{fs.rmSync(root,{recursive:true,force:true});}
