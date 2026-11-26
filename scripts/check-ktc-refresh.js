// Exercise KTC's known page embeddings without contacting the upstream site.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-ktc-'));
fs.mkdirSync(path.join(tmp,'scripts'),{recursive:true});
fs.copyFileSync(path.join(root,'scripts/fetch-ktc.js'),path.join(tmp,'scripts/fetch-ktc.js'));
const mock = String.raw`
const value = n => ({blendValue:n,tep:{blendValue:n+3},tepp:{blendValue:n+6}});
const players = Array.from({length:320}, (_,i) => ({
  playerID:i+1,slug:'mock-player-'+i,playerName:'Mock Player '+i,position:'WR',team:'MOCK',
  oneQBValues:value(100+i),superflexValues:value(150+i)
}));
for (const year of [2027,2028,2029,2030])
  for (const round of [1,2])
    for (const slot of ['Early','Mid','Late'])
      players.push({playerID:players.length+1,playerName:year+' '+slot+' '+round+(round===1?'st':'nd'),
        position:'RDP',oneQBValues:value(2000),superflexValues:value(2500)});
global.fetch = async url => {
  if (String(url).includes('/player-pool'))
    return {ok:true,status:200,headers:{get:()=>process.env.KTC_CASE==='mismatch'||process.env.KTC_CASE==='invalid-pool'?'new-pool':null},json:async()=>process.env.KTC_CASE==='invalid-pool'?players.map((p,i)=>i===0?{...p,superflexValues:null}:p):players};
  return {ok:true,status:200,
    text:async () => process.env.KTC_CASE === 'missing'
      ? '<html><body>Incomplete rankings</body></html>'
      : ['versioned','mismatch','invalid-pool'].includes(process.env.KTC_CASE)
        ? '<script>var playersVersion = "abc-123"; var playersArray = [];</script>'
      : process.env.KTC_CASE === 'legacy'
        ? '<script>var playersArray = '+JSON.stringify(players)+';</script>'
        : '<script type="application/json" data-test="1" id="ktc-players">'+JSON.stringify(players)+'</script>'
  };
};
`;
fs.writeFileSync(path.join(tmp,'mock.cjs'),mock);
const file = path.join(tmp,'data/ktc-values.json');
const run = which => cp.spawnSync(process.execPath,['--require',path.join(tmp,'mock.cjs'),path.join(tmp,'scripts/fetch-ktc.js')],{
  cwd:tmp,encoding:'utf8',timeout:10000,
  env:{...process.env,KTC_CASE:which,KTC_RETRY_DELAY_MS:'1'}
});
try {
  for (const scenario of ['island','legacy','versioned','mismatch']) {
    const r=run(scenario);
    assert.equal(r.status,0,scenario+': '+r.stderr);
    const d=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(d.players.length,320);
    assert.equal(d.picks.length,24);
    assert.equal(d.players[0].sf,150);
    assert.equal(d.players[0].slug,'mock-player-0');
    assert.equal(d.valueSource,'blend');
    if(scenario==='mismatch')assert.equal(d.sourceVersion,'new-pool');
  }
  const before=fs.readFileSync(file,'utf8');
  assert.notEqual(run('invalid-pool').status,0);
  assert.equal(fs.readFileSync(file,'utf8'),before,'invalid returned pool must preserve existing data');
  const missing=run('missing');
  assert.notEqual(missing.status,0,'incomplete HTML should not be accepted');
  assert.equal(fs.readFileSync(file,'utf8'),before,'stale source must not overwrite last-good values');
  console.log('PASS: new and legacy KTC payloads, missing-page guard, no history corruption');
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
