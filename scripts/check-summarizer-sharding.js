#!/usr/bin/env node
'use strict';
// Execute the actual market summarizer on a tiny two-season public-style archive
// in a temporary working directory, without touching production datasets.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const source = path.resolve(__dirname, 'summarize-sleeper-trades.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-market-test-'));
const put = (f, v) => { const p = path.join(root, f);fs.mkdirSync(path.dirname(p), { recursive: true });fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)); };
const pick = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
try {
  put('scripts/summarize-sleeper-trades.js', fs.readFileSync(source, 'utf8'));
  put('scripts/name-aliases.json', fs.readFileSync(path.join(__dirname, 'name-aliases.json'), 'utf8'));
  put('scripts/lib-market.js', [
    "const ROOT=require('node:path').resolve(__dirname,'..');",
    "const Vault={ktcTepSuffix:x=>x>=.75?'_tepp':x>=.25?'_tep':'',ktcPprCode:()=>1,ktcTepCode:()=>0,",
    "tradeSideValues:(a,b)=>({valueA:a.reduce((s,x)=>s+x.value,0),valueB:b.reduce((s,x)=>s+x.value,0)}),",
    "marketSideValues:(a,b)=>({valueA:a.reduce((s,x)=>s+x.value,0),valueB:b.reduce((s,x)=>s+x.value,0)}),",
    "ktcSideValues:(a,b)=>({valueA:a.reduce((s,x)=>s+x.value,0),valueB:b.reduce((s,x)=>s+x.value,0)}),",
    "fairnessBucket:x=>x<14?'Fair':x<41?'Lopsided':'Unfair'};",
    "module.exports={ROOT,loadVault:()=>Vault,summarize:(_,ts)=>({n:ts.length})};"
  ].join('\n'));
  put('data/sleeper-players.json', {
    '1':{first_name:'Alpha',last_name:'One',position:'QB',years_exp:1},
    '2':{first_name:'Beta',last_name:'Two',position:'WR',years_exp:1},
    '3':{first_name:'Gamma',last_name:'Three',position:'RB',years_exp:1}
  });
  put('data/pick-value-history.json', { snapshots:[] });
  put('data/grade-values.json', { formats:{} });
  for(const format of ['sf','sf_tep','oneQB']){
    put('data/history/players-'+format+'.json',{dates:['2025-10-01','2026-10-01','2026-11-21'],players:{
      'alpha one':[0,4000,0,0],'beta two':[0,3000,0,0],'gamma three':[0,2500,0,0]
    }});
  }
  for(const qb of ['sf','oneQB'])put('data/ktc-trades-'+qb+'.json',{dates:['2026-11-23'],trades:[[0]]});
  const doc2025={season:'2025',leagues:{old:[1,0,1,12]},trades:{
    a:['2025-11-21','old',['1'],['2']]
  },drafts:{}};
  const doc2026={season:'2026',leagues:{
    sf:[2,0,1,12],sftep:[2,.5,1,12],oneqb:[1,0,1,12]
  },trades:{
    b:['2026-11-21','sf',['1'],['2']],
    c:['2026-11-21','sftep',['3'],['2']],
    d:['2026-11-21','oneqb',['2'],['3']],
    e:['2026-11-21','sf',['999'],['2']],
    f:['2026-11-21','sf',['p2027-1'],['2']],
    g:['2026-11-21','sf',['p2027-5'],['2']],
    h:['2026-11-21','sf',['999'],['p2027-1']]
  },drafts:{}};
  for (const [year,doc] of [['2025',doc2025],['2026',doc2026]]) {
    const f=path.join(root,'data/sleeper-trades',year+'.json.gz');
    fs.mkdirSync(path.dirname(f),{recursive:true});
    fs.writeFileSync(f,zlib.gzipSync(JSON.stringify(doc)));
  }
  const output=execFileSync(process.execPath,['--expose-gc',path.join(root,'scripts/summarize-sleeper-trades.js')],{
    cwd:root,encoding:'utf8',timeout:30000,env:{...process.env}
  });
  assert.match(fs.readFileSync(source,'utf8'),/const g = Vault\.marketSideValues\(s1, s2, \{ market: table \}\)/,'Glance prices must be additive like live Trade Search');
  assert.match(output,/sharded 2025\.json\.gz/);
  assert.match(output,/sharded 2026\.json\.gz/);
  for(const [format,want] of [['sf',1],['sf_tep',1],['oneQB',2]]){
    const d=pick('data/market-history/'+format+'.json');
    assert.equal(d.trades.crawled,want+(format==='sf'?4:0),format+' raw trade count');
    if(format==='sf') {
      assert.deepEqual(d.coverage.byReason,{missing_player_metadata:1,missing_pick_price:1,empty_non_negligible_side:1,'missing_pick_price+missing_player_metadata':1});
      assert.equal(d.coverage.byYear['2026'].crawled,5);
      assert.equal(d.coverage.byYear['2026'].priced,1);
    } else assert.deepEqual(d.coverage.byReason,{});
    assert.equal(d.trades.priced,want,format+' priced trade count');
    assert.ok(Object.keys(d.weeks).length,format+' weekly pricing');
  }
  assert.equal(pick('data/market-history/recent-sf.json').trades.length,2);
  assert.equal(pick('data/market-history/recent-oneQB.json').trades.length,1);
  assert.ok(pick('data/market-history/glance-sf.json').rows.length>=2);
  assert.ok(pick('data/market-history/daily-sf.json').players['alpha one']);
  assert.ok(pick('data/market-history/rookies-sf.json').seasons);
  console.log('PASS sharded, bounded-memory market summary preserves formats, historical pricing, recent trades, daily values and rookie output');
} finally {fs.rmSync(root,{recursive:true,force:true});}
