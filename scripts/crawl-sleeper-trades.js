/* ============================================================
   CRAWL SLEEPER TRADES
   (Also each league-season's completed rookie drafts: fetchRookieDrafts.)
   KTC's trade database only goes back a few days, so this builds a longer
   history from Sleeper, where every league's trades are public by league
   id. Leagues come from two places:
   - Once a day, the Sleeper leagues linked in KTC's public trade feed (the
     same request fetch-ktc-trades.js makes): ~16,000 active dynasty leagues
     from all over, crawled first. Their managers shared those links with
     KTC; the site owner chose to include them (2026-10-01).
   - Walking outward from a seed league: a league's managers -> their other
     dynasty leagues this season -> those leagues' managers.
   Each league's previous seasons (previous_league_id) follow it, and every
   completed two-team trade is saved.

   Sleeper's terms (docs.sleeper.com): free for non-commercial use, and "stay
   under 1000 API calls per minute, otherwise, you risk being IP-blocked."
   This makes at most CALLS_PER_MIN (500, half of that; one call at a time, so
   slow responses can hold it lower), runs for
   RUN_MINUTES (the Action starts a run every hour, so it crawls nearly
   around the clock), never fetches a league twice, and backs off and stops
   on any 429 or server error.

   Privacy: only trades are saved, never usernames or user ids. The crawl's
   to-do list (which managers and leagues to visit next) holds Sleeper ids,
   so it lives in .crawl/ (gitignored; kept between runs by the Action's
   cache), and the committed files only carry a short hash of each league id.

   Writes data/sleeper-trades/<season>.json.gz, gzipped JSON (not committed: at ~35,000 trades
   a day the raw files are kept as assets on the repo's "sleeper-trades"
   GitHub Release instead of in git history):
     { season, leagues: { leagueHash: [qbs, tepBonus, pprRec, teams] },
       trades: { transactionId: [date 'YYYY-MM-DD', leagueHash, sideA, sideB] } }
   where a side is what that team RECEIVED: Sleeper player ids, and picks as
   'p<season>-<round>'. Pricing and summaries happen downstream, at each
   trade's own date (data/history/ has player prices back to 2020, picks to
   2023).

   Also writes data/market-history/crawl-stats.json for the Data status page:
   counts only (leagues seen and queued, managers, trades and leagues per
   season, this run's calls, the last runs), never an id.

   node scripts/crawl-sleeper-trades.js                 one run (RUN_MINUTES)
   RUN_MINUTES=2 node scripts/crawl-sleeper-trades.js   a short test run
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const API = 'https://api.sleeper.app/v1';
const CALLS_PER_MIN = +process.env.CALLS_PER_MIN || 500;
const RUN_MINUTES = +process.env.RUN_MINUTES || 50;
const CALL_BUDGET = Math.floor(RUN_MINUTES * CALLS_PER_MIN);
const MIN_SEASON = 2021;
const SEEDS = ['1313454100225990656'];                  // The League of Gold
const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, '.crawl', 'sleeper-state.json');
const OUT = path.join(ROOT, 'data', 'sleeper-trades');
const UA = 'TheVault-trade-research/1.0 (non-commercial; github.com/jacobpalmer60-coder/vault)';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = id => crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 12);
let calls = 0, lastCall = 0, stopped = '';

async function get(p) {
  if (calls >= CALL_BUDGET || stopped) return null;
  const wait = lastCall + 60000 / CALLS_PER_MIN - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  calls++;
  let res;
  try { res = await fetch(API + p, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); }
  catch (e) { stopped = `network error: ${e.message}`; return null; }
  if (res.status === 429 || res.status >= 500) { stopped = `Sleeper answered ${res.status}; stopping to be safe`; await sleep(60000); return null; }
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function loadJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
// Season files are gzipped: mostly repeated ids and dates, so they shrink several times over.
function loadGz(file, fallback) { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); } catch { return fallback; } }
const seasonFiles = new Map();
function seasonDoc(season) {
  if (!seasonFiles.has(season)) seasonFiles.set(season, loadGz(path.join(OUT, `${season}.json.gz`), { season, leagues: {}, trades: {} }));
  return seasonFiles.get(season);
}

function format(league) {
  const rp = league.roster_positions || [];
  const qbs = rp.includes('SUPER_FLEX') || rp.filter(s => s === 'QB').length >= 2 ? 2 : 1;
  const sc = league.scoring_settings || {};
  return [qbs, +sc.bonus_rec_te || 0, +sc.rec || 0, league.total_rosters || 0];
}

// Two-team trades only: what each team received.
function tradeSides(tx) {
  if (tx.type !== 'trade' || tx.status !== 'complete' || (tx.roster_ids || []).length !== 2) return null;
  const [r1, r2] = tx.roster_ids, side = { [r1]: [], [r2]: [] };
  Object.entries(tx.adds || {}).forEach(([pid, rid]) => { if (side[rid]) side[rid].push(pid); });
  (tx.draft_picks || []).forEach(pk => { if (side[pk.owner_id]) side[pk.owner_id].push(`p${pk.season}-${pk.round}`); });
  if (!side[r1].length || !side[r2].length) return null;
  return [side[r1], side[r2]];
}

async function crawlLeague(state, id, nfl) {
  if (state.seenLeagues[id]) return;
  state.seenLeagues[id] = 1;
  const league = await get(`/league/${id}`);
  if (!league) { if (stopped || calls >= CALL_BUDGET) delete state.seenLeagues[id]; return; }
  const season = +league.season;
  if (league.settings?.type !== 2 || season < MIN_SEASON) return; // dynasty leagues only
  // Previous seasons of the same league go next, so each league's history fills in.
  if (league.previous_league_id && league.previous_league_id !== '0' && !state.seenLeagues[league.previous_league_id]) state.leagues.unshift(league.previous_league_id);
  // This season's managers lead to their other dynasty leagues.
  if (season === nfl.season) {
    const users = await get(`/league/${id}/users`);
    (users || []).forEach(u => { if (u.user_id && !state.seenUsers[u.user_id]) { state.seenUsers[u.user_id] = 1; state.users.push(u.user_id); } });
  }
  seasonDoc(season).leagues[hash(id)] = format(league);
  // No trades after a league's trade deadline (99 = none), so those weeks are skipped.
  const deadline = +league.settings?.trade_deadline || 99;
  const lastWeek = Math.min(deadline, season < nfl.season ? 18 : Math.max(1, Math.min(18, nfl.week)));
  if (!(await fetchWeeks(id, season, 1, lastWeek))) { if (stopped || calls >= CALL_BUDGET) { delete state.seenLeagues[id]; state.leagues.unshift(id); } return; }
  await fetchRookieDrafts(id, season);
  // This season's leagues keep trading: come back for the new weeks (revisitDue).
  if (season === nfl.season && lastWeek < deadline) state.revisit[id] = { week: lastWeek, at: today(), dl: deadline };
}

/* The league's completed rookie drafts that season (ROOKIE_MAX_ROUNDS rounds or
   fewer, so startup drafts are skipped): who went where, for real rookie
   draft prices. Saved in the season file as
     drafts: { draftHash: [date 'YYYY-MM-DD', leagueHash, teams, [[pickNo, round, sleeperId], ...]] }
   Usually 2 calls (the draft list, then its picks). */
const ROOKIE_MAX_ROUNDS = 6;
async function fetchRookieDrafts(id, season) {
  const doc = seasonDoc(season), lh = hash(id);
  doc.drafts ||= {};
  const drafts = await get(`/league/${id}/drafts`);
  for (const d of drafts || []) {
    const dh = hash(d.draft_id);
    if (d.status !== 'complete' || !(+d.settings?.rounds <= ROOKIE_MAX_ROUNDS) || doc.drafts[dh]) continue;
    const picks = await get(`/draft/${d.draft_id}/picks`);
    if (!picks) return;
    const when = d.last_picked || d.start_time;
    const rows = picks.filter(p => p.player_id && p.pick_no && p.round).map(p => [p.pick_no, p.round, String(p.player_id)]);
    if (rows.length && when) doc.drafts[dh] = [new Date(when).toISOString().slice(0, 10), lh, +d.settings?.teams || rows.filter(r => r[1] === 1).length, rows];
  }
}

// One league's trades for weeks from..to; false if a call failed partway.
async function fetchWeeks(id, season, from, to) {
  const doc = seasonDoc(season), lh = hash(id);
  for (let week = from; week <= to; week++) {
    const txs = await get(`/league/${id}/transactions/${week}`);
    if (txs == null) return false;
    txs.forEach(tx => {
      const sides = tradeSides(tx);
      if (sides) doc.trades[tx.transaction_id] = [new Date(tx.status_updated || tx.created).toISOString().slice(0, 10), lh, ...sides];
    });
  }
  return true;
}

// This season's leagues crawled REVISIT_DAYS or more ago: fetch from the last
// week seen (it may have been partial) through this week. Up to a fifth of a run.
const REVISIT_DAYS = 7;
const today = () => new Date().toISOString().slice(0, 10);
async function revisitDue(state, nfl) {
  const cutoff = new Date(Date.now() - REVISIT_DAYS * 864e5).toISOString().slice(0, 10);
  const stopAt = calls + Math.floor(CALL_BUDGET / 5);
  for (const [id, r] of Object.entries(state.revisit)) {
    if (calls >= stopAt || stopped) break;
    if (r.at > cutoff) continue;
    const dl = r.dl || 99, to = Math.min(dl, Math.max(1, Math.min(18, nfl.week)));
    if (!(await fetchWeeks(id, nfl.season, r.week, to))) continue;
    if (to >= dl) delete state.revisit[id]; // past its trade deadline: done until next season
    else state.revisit[id] = { week: to, at: today(), dl };
  }
}

async function expandUser(state, uid, nfl) {
  const leagues = await get(`/user/${uid}/leagues/nfl/${nfl.season}`);
  if (leagues == null) { if (stopped || calls >= CALL_BUDGET) state.users.unshift(uid); return; }
  // The list carries each league's settings, so non-dynasty leagues are skipped for free.
  leagues.filter(l => l.settings?.type === 2 && !state.seenLeagues[l.league_id]).forEach(l => state.leagues.push(l.league_id));
}

function save(state) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state));
  fs.mkdirSync(OUT, { recursive: true });
  seasonFiles.forEach((doc, season) => fs.writeFileSync(path.join(OUT, `${season}.json.gz`), zlib.gzipSync(JSON.stringify(doc), { level: 9 })));
}

// Once a day: the Sleeper leagues behind this week's trades in KTC's feed go to the front.
const KTC_FEED = 'https://keeptradecut.com/dynasty/trade-database/trades';
async function seedFromKtc(state) {
  if (state.ktcSeeded === today()) return;
  try {
    const res = await fetch(KTC_FEED, {
      method: 'POST', body: '{}',
      headers: { 'Content-Type': 'application/json;', Accept: 'application/json', Origin: 'https://keeptradecut.com', Referer: 'https://keeptradecut.com/dynasty/trade-database',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' }
    });
    if (!res.ok) throw new Error(`KTC answered ${res.status}`);
    const ids = new Set();
    (await res.json()).forEach(t => { const m = String(t.settings?.leagueUrl || '').match(/sleeper\.app\/leagues\/(\d+)/); if (m) ids.add(m[1]); });
    const fresh = [...ids].filter(id => !state.seenLeagues[id]);
    state.leagues = [...fresh, ...state.leagues.filter(id => !ids.has(id))];
    state.ktcSeeded = today();
    console.log(`KTC feed: ${ids.size} Sleeper leagues, ${fresh.length} new to the crawl`);
  } catch (e) { console.log(`KTC seeding skipped: ${e.message}`); }
}

async function main() {
  const state = loadJson(STATE, null) || { leagues: [...SEEDS], users: [], seenLeagues: {}, seenUsers: {} };
  const st = await get('/state/nfl');
  if (!st) throw new Error('Could not read the NFL state from Sleeper: ' + stopped);
  const nfl = { season: +st.league_season || +st.season, week: +st.week || 1 };
  state.revisit ||= {};
  // New season: every manager seen so far gets looked up again (their leagues
  // roll over to new ids), and last season's leagues are done changing.
  if (state.season && state.season !== nfl.season) { state.users = Object.keys(state.seenUsers); state.revisit = {}; }
  state.season = nfl.season;
  const start = Date.now();
  await seedFromKtc(state);
  await revisitDue(state, nfl);
  let lastSave = calls;
  while (calls < CALL_BUDGET && !stopped) {
    if (state.leagues.length) await crawlLeague(state, state.leagues.shift(), nfl);
    else if (state.users.length) await expandUser(state, state.users.shift(), nfl);
    else break;
    if (calls - lastSave >= 200) { save(state); lastSave = calls; } // survive a timeout mid-run
  }
  save(state);
  writeStats(state, { calls, seconds: Math.round((Date.now() - start) / 1000), stopped, startedAt: new Date(start).toISOString() });
  const counts = [...seasonFiles.values()].map(d => `${d.season}: ${Object.keys(d.trades).length} trades / ${Object.keys(d.leagues).length} leagues`);
  console.log(`${calls} calls in ${Math.round((Date.now() - start) / 1000)}s${stopped ? ` (stopped: ${stopped})` : ''}`);
  console.log(`Queue: ${state.leagues.length} leagues, ${state.users.length} managers; ${Object.keys(state.seenLeagues).length} leagues seen`);
  counts.forEach(c => console.log(c));
}

// Public crawl stats: counts only, never an id. Every season file on disk (the
// job downloads them all from the release first), plus this run and the last runs.
function writeStats(state, run) {
  const file = path.join(ROOT, 'data', 'market-history', 'crawl-stats.json');
  const prev = loadJson(file, { runs: [] });
  const seasons = {};
  let trades = 0, leagues = 0;
  (fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(f => f.endsWith('.json.gz')) : []).forEach(f => {
    const doc = seasonFiles.get(+f.slice(0, 4)) || loadGz(path.join(OUT, f), null);
    if (!doc) return;
    const t = Object.keys(doc.trades).length, l = Object.keys(doc.leagues).length;
    seasons[doc.season] = { trades: t, leagues: l, rookieDrafts: Object.keys(doc.drafts || {}).length };
    trades += t; leagues += l;
  });
  const newTrades = trades - (prev.totals?.trades || 0);
  const out = {
    updated: new Date().toISOString(),
    totals: { trades, leagueSeasons: leagues, leaguesSeen: Object.keys(state.seenLeagues).length, managersSeen: Object.keys(state.seenUsers).length },
    queue: { leagues: state.leagues.length, managers: state.users.length, revisits: Object.keys(state.revisit || {}).length },
    seasons,
    settings: { callsPerMinute: CALLS_PER_MIN, runMinutes: RUN_MINUTES, minSeason: MIN_SEASON },
    ktcSeeded: state.ktcSeeded || null,
    runs: [{ at: run.startedAt, calls: run.calls, seconds: run.seconds, newTrades: Math.max(0, newTrades), stopped: run.stopped || '' }, ...(prev.runs || [])].slice(0, 72)
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
}

main().catch(e => { console.error(e); process.exit(1); });
