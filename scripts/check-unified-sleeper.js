// Isolated regression test for the two sequential phases of unified Sleeper ingestion.
// No real Sleeper calls, releases, private keys, or existing market files are touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-ingest-'));
const src = path.join(tmp, 'scripts');
fs.mkdirSync(path.join(src, 'keys'), { recursive: true });
const copy = filename => fs.copyFileSync(path.join(root, 'scripts', filename), path.join(src, filename));
copy('crawl-sleeper-trades.js');
copy('pull-league-deltas.js');
copy('keys/league-pull.pub.pem');
const id = '1313454100225990656';
const mock = `
const id = '${id}';
const trade = { transaction_id:'tx-unit-1', type:'trade', status:'complete', roster_ids:[1,2],
  adds:{'mock-player-1':1, 'mock-player-2':2}, draft_picks:[],
  created:1795500000000, status_updated:1795500000000 };
global.fetch = async url => {
  const p = new URL(url).pathname;
  let data;
  if (p === '/dynasty/trade-database/trades') data = [];
  else if (p === '/v1/state/nfl') data = { season:'2026', league_season:'2026', week:1, season_type:'regular' };
  else if (p === '/v1/league/'+id) data = {
    league_id:id, season:'2026', settings:{type:2, trade_deadline:18},
    roster_positions:['QB'], scoring_settings:{rec:0.5}, total_rosters:2, status:'in_season'
  };
  else if (p === '/v1/league/'+id+'/users') data = [{user_id:'mock-user', is_owner:true}];
  else if (p === '/v1/user/mock-user/leagues/nfl/2026') data = [];
  else if (p === '/v1/league/'+id+'/transactions/1') data = [trade];
  else if (p === '/v1/league/'+id+'/rosters') data = [{roster_id:1,players:['mock-player-1']},{roster_id:2,players:['mock-player-2']}];
  else if (p === '/v1/league/'+id+'/traded_picks') data = [];
  else if (p === '/v1/league/'+id+'/matchups/1') data = [];
  else if (p === '/v1/league/'+id+'/drafts') data = [];
  else if (p.endsWith('/winners_bracket') || p.endsWith('/losers_bracket')) data = [];
  else throw Error('Unexpected mock Sleeper endpoint: ' + p);
  return {ok:true, status:200, json:async () => data};
};
`;
const mockFile = path.join(tmp, 'mock-api.cjs');
fs.writeFileSync(mockFile, mock);
function run(script, env) {
  const result = cp.spawnSync(process.execPath, ['--require', mockFile, path.join(src, script)], {
    cwd: tmp, encoding: 'utf8',
    env: { ...process.env, CALLS_PER_MIN:'400', RUN_MINUTES:'1', ...env },
    timeout:20000
  });
  if (result.status !== 0) throw Error(`${script} failed: ${result.stderr}\n${result.stdout}`);
}
try {
  run('crawl-sleeper-trades.js');
  const tradeFile = path.join(tmp, 'data/sleeper-trades/2026.json.gz');
  const trades = JSON.parse(zlib.gunzipSync(fs.readFileSync(tradeFile)));
  assert.equal(Object.keys(trades.trades).length, 1);
  assert.deepEqual(trades.trades['tx-unit-1'][2], ['mock-player-1']);
  assert.deepEqual(trades.trades['tx-unit-1'][3], ['mock-player-2']);
  const crawlState = JSON.parse(fs.readFileSync(path.join(tmp,'.crawl/sleeper-state.json')));
  assert.equal(crawlState.currentLeagues[id], 1);
  const idsFile = path.join(tmp,'league-ids.json');
  fs.writeFileSync(idsFile, JSON.stringify([id]));
  const encrypted = path.join(tmp,'sealed-pull.bin');
  const coverage=path.join(tmp,'coverage.json');
  run('pull-league-deltas.js', { LEAGUE_LIST:idsFile, OUT_FILE:encrypted, COVERAGE_FILE:coverage });
  const receipt=JSON.parse(fs.readFileSync(coverage,'utf8'));assert.equal(receipt.queue,1);assert.equal(receipt.knownAfter,1);assert.equal(receipt.pulled,1);assert.equal(receipt.full,1);assert.equal(receipt.remaining,0);assert.ok(!JSON.stringify(receipt).includes(id));
  const payload = fs.readFileSync(encrypted);
  const wrapped = payload.readUInt32BE(0);
  assert(wrapped > 250 && payload.length > wrapped + 32);
  assert(!payload.toString('utf8').includes('mock-player-1'), 'sealed league data leaked in plaintext');
  console.log('PASS: one real trade persisted; current-league queue recorded; full league data sealed');
} finally {
  fs.rmSync(tmp, {recursive:true,force:true});
}
