/* ============================================================
   PULL LEAGUE DELTAS
   Whole-league data for judging trades: rosters, records, matchups, picks, which contending
   status and team archetypes come from. The crawl only keeps trades, so this fills the gap
   from GitHub Actions, with no computer left on (user, 2026-11-04).

   Only what changed: each NFL week it reads every league with trades for the weeks since
   the last pass, plus current rosters and picks, about 10 calls a league instead of 44. A
   league it hasn't seen in full gets everything once, with or without trades on file.

   Team data is never published (user, 2026-10-08), and a public repo can't keep a secret, so
   each run's output is sealed to a public key before it leaves this job: AES-256-GCM with a
   fresh key, that key wrapped with RSA-OAEP to scripts/keys/league-pull.pub.pem. The private key
   exists only on the research computer, which downloads and merges these (VaultValues
   apply-league-pulls.js). Logs carry counts only, never an id.

   Reads .crawl/sleeper-state.json (the crawl's list, restored from its cache) and
   data/sleeper-trades/<season>.json.gz (to put leagues with trades first). Progress is hashes
   only, in .league-pull/state.json (its own cache).
     node scripts/pull-league-deltas.js                  one run (RUN_MINUTES)
     LEAGUE_LIST=ids.json OUT_FILE=x.bin ...             a test on a few leagues
   ============================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const API = 'https://api.sleeper.app/v1';
const CALLS_PER_MIN = +process.env.CALLS_PER_MIN || 450;
const RUN_MINUTES = +process.env.RUN_MINUTES || 42;
const DEADLINE = Date.now() + RUN_MINUTES * 60000;
const FIRST_WEEK = +process.env.FIRST_WEEK || 6; // the last full pull ended around week 7
const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, '.league-pull', 'state.json');
const KNOWN = path.join(ROOT, 'data', 'league-pull-known.txt.gz');
const OUT = process.env.OUT_FILE || path.join(ROOT, '.league-pull', 'pull.bin');
const UA = 'TheVault-trade-research/1.0 (non-commercial; github.com/jacobpalmer60-coder/vault)';

const hash = id => crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 12);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const loadJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
let calls = 0, lastCall = 0, stopped = '';
const outOfTime = () => Date.now() >= DEADLINE || !!stopped;

async function get(p, retry = true) {
  if (outOfTime()) return null;
  const wait = lastCall + 60000 / CALLS_PER_MIN - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  calls++;
  let res, problem = '';
  try { res = await fetch(API + p, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); } catch { problem = 'network error'; }
  if (res?.status === 429) { stopped = 'Sleeper answered 429; stopping to be safe'; return null; }
  if (!problem && res.status >= 500) problem = `Sleeper answered ${res.status}`;
  if (problem) {
    await sleep(60000);
    if (retry) return get(p, false);
    stopped = `${problem} after a retry; stopping to be safe`;
    return null;
  }
  return res.ok ? res.json().catch(() => null) : null;
}

// Null unless every part of the league arrived, so a half-read league is tried again next run.
async function pullLeague(id, from, week, full) {
  const league = await get(`/league/${id}`);
  if (!league) return null;
  if (league.settings?.type !== 2) return { skip: true };
  const rosters = await get(`/league/${id}/rosters`);
  const traded = await get(`/league/${id}/traded_picks`);
  if (!rosters || !traded) return null;
  const start = full ? 1 : from, transactions = [], matchups = {};
  for (let w = start; w <= Math.min(18, week); w++) {
    const t = await get(`/league/${id}/transactions/${w}`);
    if (t == null) return null;
    t.forEach(x => transactions.push({ ...x, leg: x.leg || w }));
  }
  for (let w = start; w <= Math.min(17, week); w++) {
    const m = await get(`/league/${id}/matchups/${w}`);
    if (m == null) return null;
    matchups[w] = m;
  }
  const out = { h: hash(id), full, from: start, league, rosters, traded_picks: traded, transactions, matchups };
  if (full || league.status === 'post_season' || league.status === 'complete') {
    out.winners_bracket = await get(`/league/${id}/winners_bracket`) || [];
    out.losers_bracket = await get(`/league/${id}/losers_bracket`) || [];
  }
  if (full) {
    const users = await get(`/league/${id}/users`), drafts = await get(`/league/${id}/drafts`);
    if (!users || !drafts) return null;
    out.users = users.map(u => ({ user_id: u.user_id, is_owner: u.is_owner }));
    out.drafts = drafts;
    out.draft_picks = {};
    for (const d of drafts) { const p = await get(`/draft/${d.draft_id}/picks`); if (p) out.draft_picks[d.draft_id] = p; }
  }
  return outOfTime() && stopped ? null : out;
}

function seal(plain, pubPem) {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const wrapped = crypto.publicEncrypt({ key: pubPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(wrapped.length);
  return Buffer.concat([len, wrapped, iv, cipher.getAuthTag(), body]);
}

(async () => {
  const nfl = await get('/state/nfl');
  if (!nfl) throw new Error('no NFL state from Sleeper');
  const season = +nfl.league_season || +nfl.season, week = +nfl.week || 0;
  if (!(week >= 1) || nfl.season_type === 'off') return console.log('Offseason: nothing to pull');
  const test = process.env.LEAGUE_LIST ? loadJson(process.env.LEAGUE_LIST, []) : null;
  const state = test ? { done: [], known: [] } : loadJson(STATE, { done: [], known: [] });
  const cycle = `${season}-w${week}`;
  // A new NFL week starts a new pass, from the week before the last one ended (it may have been partial).
  if (state.cycle !== cycle) Object.assign(state, { from: Math.max(1, state.week ? state.week - 1 : FIRST_WEEK), cycle, week, done: [] });
  const done = new Set(state.done);
  const known = new Set(state.known);
  if (fs.existsSync(KNOWN)) zlib.gunzipSync(fs.readFileSync(KNOWN)).toString('utf8').split('\n').filter(Boolean).forEach(h => known.add(h));

  let ids = test;
  if (!ids) {
    const crawl = loadJson(path.join(ROOT, '.crawl', 'sleeper-state.json'), null);
    if (!crawl) throw new Error('no crawl list in the cache');
    const trades = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'data', 'sleeper-trades', `${season}.json.gz`))).toString('utf8')).trades;
    const traded = new Set(Object.values(trades).map(t => t[1]));
    // A league the crawl knows but this pull has never read in full goes last, once: the 2026-11-04 loss
    // took the earlier trades of about 30,000 leagues, and the crawl only revisits their new weeks.
    const all = Object.keys(crawl.revisit || {});
    ids = [...all.filter(id => traded.has(hash(id))), ...all.filter(id => !traded.has(hash(id)) && !known.has(hash(id)))];
  }
  const todo = ids.filter(id => !done.has(hash(id)));
  const pulled = [];
  let fulls = 0;
  for (const id of todo) {
    if (outOfTime()) break;
    const h = hash(id), r = await pullLeague(id, state.from, week, !known.has(h));
    if (!r) continue;
    done.add(h);
    if (r.skip) continue;
    known.add(h);
    if (r.full) fulls++;
    pulled.push(r);
  }
  const left = ids.filter(id => !done.has(hash(id))).length;
  if (pulled.length) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const pub = fs.readFileSync(path.join(ROOT, 'scripts', 'keys', 'league-pull.pub.pem'), 'utf8');
    fs.writeFileSync(OUT, seal(zlib.gzipSync(JSON.stringify({ cycle, season, week, leagues: pulled }), { level: 9 }), pub));
  }
  if (!test) {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({ ...state, done: [...done], known: [...known] }));
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `more=${left && !stopped ? 'yes' : 'no'}\nfile=${pulled.length ? OUT : ''}\ncycle=${cycle}\n`);
  }
  console.log(`${cycle}: from week ${state.from}, ${pulled.length} leagues (${fulls} in full), ${calls} calls, ${left} left${stopped ? `, ${stopped}` : ''}`);
})().catch(e => { console.error(e.message); process.exit(1); });
