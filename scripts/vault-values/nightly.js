/* Vault values, nightly (.github/workflows/vault-values.yml). Production copy of
   the VaultValues research project's src/nightly.js: same model and settings;
   downloads are the workflow's job, and state lives in data/vault-values/.
   Side by side with KTC (user, 2026-10-08): the site shows these only behind the
   hidden switch (?values=vault, Vault.valueSource); KTC stays the default.

   Nightly shadow run: build a track record before anything goes near the site.

   Every night, for every league format:
   1. (The workflow downloads the newest collected trades, the site's
      "sleeper-trades" release, into data/sleeper-trades/; Sleeper players,
      projections and KTC history are the checkout's own data/.)
   2. Score last night's values on the trades that happened after them, which
      they never saw, and KTC on the same trades (its own consolidation
      adjustment, which the site grades with; our consolidation curve on KTC
      values; a plain sum). Saved as running sums in track-<format>.json so
      any stretch of nights pools exactly.
   3. Refit on every trade (settings chosen in run.js's tests) and save the
      values: values-<format>.json (latest, readable) and a line per night
      in history-<format>.jsonl (every asset's log value).
   4. Rewrite track-report.md: the scorecard against the pass bar.
   5. Write values.json, the file the site's switch loads (buildSiteValues).
   All in data/vault-values/.

   First run, or --backfill N: before step 3, replay the last N days (default
   28) by refitting day by day, so the scorecard starts with a track record.
   (The replay uses today's projections for the starting guess, a small look
   ahead for thinly traded players only.)

   node scripts/vault-values/nightly.js [--backfill N] [--formats sf_tep,sf] */
const fs = require('fs');
const path = require('path');
let loadTrades, weekOf, SITE_DATA, Model, buildPrior, ktcPrices, loadVault;
const ROOT = __dirname;

const ALL_FORMATS = ['sf_tep', 'sf', 'sf_tepp', 'oneQB', 'oneQB_tep', 'oneQB_tepp'];
const SET = { p: 1.5, lambda: 1, kappa: 0.1, kappaHalf: 10, minTrades: 3, iters: 200, dailyIters: 60 };
const MIN_SCORE_TRADES = 100; // fewer new trades than this and a night isn't scored
// The pass bar, agreed 2026-10-06.
const BAR = { weeks: 8, rankAgreement: 0.95, dailyMove: 0.015 };

const args = process.argv.slice(2);
const arg = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const FORMATS = (arg('--formats', '') || ALL_FORMATS.join(',')).split(',');
const SITE_ROOT = path.join(ROOT, '..', '..');
const OUT = path.join(SITE_ROOT, 'data', 'vault-values');
const RAW = path.join(SITE_ROOT, 'data', 'sleeper-trades');
fs.mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const logFile = path.join(OUT, 'nightly.log');
const log = s => { const line = `${new Date().toISOString().slice(0, 19)} ${s}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const lse = (xs, p) => { const m = Math.max(...xs.map(x => p * x)); return (m + Math.log(xs.reduce((s, x) => s + Math.exp(p * x - m), 0))) / p; };

// The NFL season a date falls in (March on is the new one).
const nflSeason = () => { const d = new Date(); return d.getUTCMonth() >= 2 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; };

// ---------- Scoring helpers: running sums, so nights pool exactly ----------
const emptyMoments = () => ({ n: 0, r: 0, r2: 0, m: 0, m2: 0 });
const addPair = (mo, a, b) => { const r = a - b, m = (a + b) / 2; mo.n++; mo.r += r; mo.r2 += r * r; mo.m += m; mo.m2 += m * m; };
const relErr = mo => { if (mo.n < 2) return null; const vr = mo.r2 / mo.n - (mo.r / mo.n) ** 2, vm = mo.m2 / mo.n - (mo.m / mo.n) ** 2; return vr / vm; };
const pool = list => list.reduce((acc, mo) => { for (const k of Object.keys(acc)) acc[k] += mo[k]; return acc; }, emptyMoments());

// Score trades with a side-value function per system; only trades every system can price.
function scoreTrades(list, ours, ktc, Vault, ktcP) {
  const sys = { ours: emptyMoments(), ktcAdj: emptyMoments(), ktcCurve: emptyMoments(), ktcSum: emptyMoments() };
  let oursCan = 0, ktcCan = 0;
  const asPick = (keys, vals) => keys.map((k, i) => ({ type: k[0] === 'p' ? 'pick' : 'player', value: vals[i] }));
  for (const t of list) {
    const o = ours(t);
    const ka = t.a.map(k => ktc.at(k, t.date)), kb = t.b.map(k => ktc.at(k, t.date));
    const kOk = [...ka, ...kb].every(v => v > 0);
    if (o) oursCan++;
    if (kOk) ktcCan++;
    if (!o || !kOk) continue;
    addPair(sys.ours, o[0], o[1]);
    const { valueA, valueB } = (Vault.ktcSideValues || Vault.tradeSideValues)(asPick(t.a, ka), asPick(t.b, kb));
    addPair(sys.ktcAdj, Math.log(valueA), Math.log(valueB));
    addPair(sys.ktcCurve, lse(ka.map(Math.log), ktcP), lse(kb.map(Math.log), ktcP));
    addPair(sys.ktcSum, Math.log(ka.reduce((s, v) => s + v, 0)), Math.log(kb.reduce((s, v) => s + v, 0)));
  }
  return { n: list.length, oursCan, ktcCan, sys };
}

// Fit with the chosen settings: base fit, then the starting guess.
function fitAll(trades, players, warm = null, iters = SET.iters) {
  const base = new Model(trades, { p: SET.p, lambda: SET.lambda });
  if (warm) base.warmFrom(warm.base);
  base.fit({ iters, lr: warm ? 0.02 : 0.05 });
  const counts = new Map();
  trades.forEach(t => [...t.a, ...t.b].forEach(k => counts.set(k, (counts.get(k) || 0) + 1)));
  const keys = [...counts].filter(([, n]) => n >= SET.minTrades).map(([k]) => k);
  const prior = warm && warm.prior ? warm.prior : buildPrior(base, players, keys).prior;
  const model = new Model(trades, { p: SET.p, lambda: SET.lambda, prior, kappa: SET.kappa, kappaHalf: SET.kappaHalf, minTrades: SET.minTrades });
  model.warmFrom(warm ? warm.model : base).fit({ iters, lr: warm ? 0.02 : 0.05 });
  return { base, model, prior };
}
const lastWeekValues = m => { const u = {}; m.keys.forEach((k, a) => { u[k] = Math.round(m.u[a * m.W + m.W - 1] * 1e4) / 1e4; }); return u; };

// KTC with our curve: p tuned on the last 8 weeks before a date.
function tuneKtcP(trades, ktc, before) {
  const from = new Date(Date.parse(before) - 56 * 864e5).toISOString().slice(0, 10);
  const sample = trades.filter(t => t.date >= from && t.date < before).filter((_, i) => i % 3 === 0);
  let best = null;
  for (const p of [1, 1.5, 2, 3, 4]) {
    const mo = emptyMoments();
    for (const t of sample) { const ka = t.a.map(k => ktc.at(k, t.date)), kb = t.b.map(k => ktc.at(k, t.date)); if ([...ka, ...kb].every(v => v > 0)) addPair(mo, lse(ka.map(Math.log), p), lse(kb.map(Math.log), p)); }
    const e = relErr(mo);
    if (e != null && (!best || e < best.e)) best = { p, e };
  }
  return best ? best.p : 2;
}

// Spearman rank agreement with KTC today within KTC's top 200 players.
function rankAgreement(u, ktc, date, players) {
  const rows = Object.entries(u).filter(([k]) => k[0] !== 'p').map(([k, v]) => ({ k, v, kv: ktc.at(k, date) })).filter(x => x.kv > 0);
  rows.sort((a, b) => b.kv - a.kv);
  const top = rows.slice(0, 200), n = top.length;
  const rv = new Map([...top].sort((a, b) => b.v - a.v).map((x, i) => [x.k, i]));
  return n > 10 ? 1 - 6 * top.reduce((s, x, i) => s + (rv.get(x.k) - i) ** 2, 0) / (n * (n * n - 1)) : null;
}
// Median day-to-day move of the top 200 (after removing any shift of the whole scale).
function dailyMove(prevU, u) {
  if (!prevU) return null;
  const keys = Object.keys(u).filter(k => prevU[k] != null).sort((a, b) => u[b] - u[a]).slice(0, 200);
  if (keys.length < 20) return null;
  const d = keys.map(k => u[k] - prevU[k]), shift = d.slice().sort((a, b) => a - b)[Math.floor(d.length / 2)];
  const moves = d.map(x => Math.abs(Math.exp(x - shift) - 1)).sort((a, b) => a - b);
  return moves[Math.floor(moves.length / 2)];
}

// ---------- Per format ----------
async function runFormat(format, seasons, Vault) {
  const t0 = Date.now();
  const { trades, players } = loadTrades(format, seasons);
  if (trades.length < 2000) { log(`${format}: only ${trades.length} trades, skipped`); return; }
  const ktc = ktcPrices(format, players);
  const trackFile = path.join(OUT, `track-${format}.json`), stateFile = path.join(OUT, `state-${format}.json`), histFile = path.join(OUT, `history-${format}.jsonl`);
  const track = readJson(trackFile, { format, nights: [] });
  const state = readJson(stateFile);
  const lastDate = trades[trades.length - 1].date;
  const record = (night) => { track.nights = track.nights.filter(x => x.date !== night.date); track.nights.push(night); track.nights.sort((a, b) => (a.date < b.date ? -1 : 1)); };
  const appendHist = (date, u) => fs.appendFileSync(histFile, JSON.stringify({ date, u }) + '\n');

  // 2a. Backfill: replay recent days with daily refits.
  const backfill = +(arg('--backfill', state ? 0 : 28));
  if (backfill > 0) {
    const days = [...new Set(trades.map(t => t.date))].sort().filter(d => d < lastDate).slice(-backfill);
    let warm = null, prevU = null;
    for (const d of days) {
      const before = trades.filter(t => t.date < d);
      const fit = fitAll(before, players, warm, warm ? SET.dailyIters : SET.iters);
      const m = fit.model;
      const sc = scoreTrades(trades.filter(t => t.date === d), t => m.sides(t, t.week), ktc, Vault, tuneKtcP(trades, ktc, d));
      const u = lastWeekValues(m);
      record({ date: d, replay: true, ...sc, rank: rankAgreement(u, ktc, d, players), move: dailyMove(prevU, u) });
      prevU = u; warm = fit;
    }
    log(`${format}: replayed ${days.length} days`);
  }

  // 2b. Score last night's values on trades after them.
  if (state && state.u) {
    const fresh = trades.filter(t => t.date > state.fitThrough);
    const side = keys => { const xs = keys.map(k => state.u[k]); return xs.some(x => x == null) ? null : lse(xs, state.p); };
    const sc = scoreTrades(fresh, t => { const a = side(t.a), b = side(t.b); return a == null || b == null ? null : [a, b]; }, ktc, Vault, tuneKtcP(trades, ktc, state.fitThrough));
    if (sc.sys.ours.n >= MIN_SCORE_TRADES) record({ date: lastDate, since: state.fitThrough, ...sc });
    else log(`${format}: ${sc.sys.ours.n} new trades since ${state.fitThrough}, not scored yet`);
  }

  // 3. Refit on everything; save values and history.
  const fit = fitAll(trades, players);
  const m = fit.model, u = lastWeekValues(m);
  const rank = rankAgreement(u, ktc, lastDate, players), move = dailyMove(state ? state.u : null, u);
  const last = track.nights[track.nights.length - 1];
  if (last && last.date === lastDate) Object.assign(last, { rank, move });
  else if (rank != null) record({ date: lastDate, rank, move, n: 0, sys: null });
  fs.writeFileSync(stateFile, JSON.stringify({ format, built: new Date().toISOString(), fitThrough: lastDate, p: SET.p, u }));
  appendHist(lastDate, u);
  const top = Math.max(...Object.values(u));
  const nameOf = k => { if (k[0] === 'p') { const [s, r] = k.slice(1).split('-'); return `${s} ${['', '1st', '2nd', '3rd', '4th'][+r]}`; } const p = players[k] || {}; return `${p.first_name || ''} ${p.last_name || ''}`.trim(); };
  const values = Object.entries(u).map(([k, x]) => ({ key: k, name: nameOf(k), pos: k[0] === 'p' ? 'Pick' : (players[k] || {}).position || '', value: Math.round(9999 * Math.exp(x - top)), ktc: ktc.at(k, lastDate), trades: m.counts[m.index.get(k)] })).sort((a, b) => b.value - a.value);
  fs.writeFileSync(path.join(OUT, `values-${format}.json`), JSON.stringify({ format, built: new Date().toISOString(), through: lastDate, settings: SET, trades: trades.length, values }));
  fs.writeFileSync(trackFile, JSON.stringify(track));
  log(`${format}: ${trades.length.toLocaleString()} trades through ${lastDate}, ${m.A} rated, rank agreement ${rank == null ? '—' : rank.toFixed(3)} [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
}

// ---------- 5. The file the site's switch loads ----------
// data/vault-values/values.json, in the same shape as data/ktc-values.json so
// every page works unchanged: each player's six format fields are our values
// where we rate him (vsrc: 'vault'), KTC's where we don't yet (vsrc: 'ktc').
// Players we rate that KTC doesn't list are added when 30+ trades back the value
// (fewer leans on the starting guess) and Sleeper still projects him (so retired
// or released players traded as throw-ins stay out: on an NFL team). Picks: our value per year and
// round is "mid"; early and late keep KTC's spread around mid until pick tiers
// are learned from real trades. Only picks KTC still lists, so drafted classes
// drop off. Same 0-9,999 scale (our best piece in each format is 9,999).
function buildSiteValues() {
  const ktcData = readJson(path.join(SITE_ROOT, 'data', 'ktc-values.json'));
  const players = readJson(path.join(SITE_ROOT, 'data', 'sleeper-players.json'), {});
  const projected = new Set(Object.entries((readJson(path.join(SITE_ROOT, 'data', 'projections.json'), {}) || {}).players || {}).filter(([, p]) => p.team).map(([k]) => k));
  if (!ktcData) { log('no ktc-values.json; site values not built'); return; }
  const norm = s => !s ? '' : s.toString().toLowerCase().replace(/\./g, '').replace(/'/g, '').replace(/ jr$| sr$| ii$| iii$| iv$| v$/, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const ours = {}; // format -> Map(norm name -> value), Map('p<season>-<round>' -> value)
  const extra = new Map();
  for (const f of ALL_FORMATS) {
    const v = readJson(path.join(OUT, `values-${f}.json`));
    ours[f] = { byName: new Map(), picks: new Map() };
    if (!v) continue;
    for (const x of v.values) {
      if (x.key[0] === 'p') { ours[f].picks.set(x.key, x.value); continue; }
      const p = players[x.key];
      if (!p) continue;
      const n = norm(`${p.first_name || ''} ${p.last_name || ''}`);
      ours[f].byName.set(n, x.value);
      if (!extra.has(n) && x.trades >= 30 && projected.has(x.key)) extra.set(n, { name: `${p.first_name || ''} ${p.last_name || ''}`.trim(), pos: p.position, age: p.age || null });
    }
  }
  let rated = 0;
  const outPlayers = (ktcData.players || []).map(p => {
    const n = norm(p.name), o = { ...p, vsrc: 'ktc' };
    let any = false;
    for (const f of ALL_FORMATS) { const v = ours[f].byName.get(n); if (v != null) { o[f] = v; any = true; } }
    if (any) { o.vsrc = 'vault'; rated++; }
    extra.delete(n);
    return o;
  });
  for (const [n, x] of extra) {
    const o = { name: x.name, pos: x.pos, team: null, age: x.age, rookie: false, vsrc: 'vault' };
    let any = false;
    for (const f of ALL_FORMATS) { const v = ours[f].byName.get(n); o[f] = v || 0; if (v) any = true; }
    if (any && o[ALL_FORMATS[0]] + o.sf > 0) outPlayers.push(o);
  }
  const mids = new Map((ktcData.picks || []).filter(p => p.slot === 'mid').map(p => [`${p.season}-${p.round}`, p]));
  const outPicks = (ktcData.picks || []).map(p => {
    const mid = mids.get(`${p.season}-${p.round}`), o = { ...p, vsrc: 'ktc' };
    let any = false;
    for (const f of ALL_FORMATS) {
      const v = ours[f].picks.get(`p${p.season}-${p.round}`);
      if (v == null || !mid || !mid[f]) continue;
      o[f] = Math.round(v * p[f] / mid[f]);
      any = true;
    }
    if (any) o.vsrc = 'vault';
    return o;
  });
  outPlayers.sort((a, b) => (b.sf || 0) - (a.sf || 0));
  fs.writeFileSync(path.join(OUT, 'values.json'), JSON.stringify({ source: 'vault-values', updated: new Date().toISOString(), count: outPlayers.length, rated, players: outPlayers, picks: outPicks }));
  log(`site values: ${outPlayers.length} players (${rated} of KTC's rated by us, ${outPlayers.length - (ktcData.players || []).length} added), ${outPicks.length} picks`);
}

// ---------- 4. Scorecard ----------
function report() {
  const pct = x => (x == null ? '—' : `${(100 * x).toFixed(1)}%`);
  const f3 = x => (x == null ? '—' : x.toFixed(3));
  const md = ['# VaultValues track record', '', `Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Each night's values are scored on trades made after them, which they never saw, next to KTC on the same trades. **Relative error**: each trade's imbalance against how spread out the values are (lower is better; a flatter value set can't game it). "Replay" nights were rebuilt afterwards by refitting day by day.`, ''];
  md.push('## The pass bar', '', `Over ${BAR.weeks} weeks: beat KTC's own consolidation adjustment every week · rank agreement with KTC's top 200 of ${BAR.rankAgreement}+ · top-200 median daily move under ${pct(BAR.dailyMove)} · price at least as many trades as KTC.`, '');
  md.push('| Format | Weeks scored | Weeks beating KTC (its own adjustment) | Weeks beating KTC + curve | Rank agreement (latest) | Median daily move | Trades priced: ours / KTC | Status |', '|---|---|---|---|---|---|---|---|');
  const detail = [];
  for (const format of ALL_FORMATS) {
    const t = readJson(path.join(OUT, `track-${format}.json`));
    if (!t || !t.nights.length) continue;
    const scored = t.nights.filter(x => x.sys);
    const weeks = new Map();
    scored.forEach(x => { const w = weekOf(x.date); (weeks.get(w) || weeks.set(w, []).get(w)).push(x); });
    const rows = [...weeks].sort((a, b) => a[0] - b[0]).map(([w, list]) => {
      const sys = {}; for (const k of ['ours', 'ktcAdj', 'ktcCurve', 'ktcSum']) sys[k] = relErr(pool(list.map(x => x.sys[k])));
      return { w, from: list[0].date, to: list[list.length - 1].date, n: list.reduce((s, x) => s + x.sys.ours.n, 0), sys, oursCan: list.reduce((s, x) => s + x.oursCan, 0), ktcCan: list.reduce((s, x) => s + x.ktcCan, 0), total: list.reduce((s, x) => s + x.n, 0), replay: list.every(x => x.replay) };
    }).filter(r => r.n >= MIN_SCORE_TRADES && r.sys.ours != null);
    const beat = rows.filter(r => r.sys.ours < r.sys.ktcAdj).length, beatCurve = rows.filter(r => r.sys.ours < r.sys.ktcCurve).length;
    const latest = [...t.nights].reverse().find(x => x.rank != null);
    const moves = t.nights.map(x => x.move).filter(x => x != null).slice(-14).sort((a, b) => a - b);
    const move = moves.length ? moves[Math.floor(moves.length / 2)] : null;
    const oursCan = rows.reduce((s, r) => s + r.oursCan, 0), ktcCan = rows.reduce((s, r) => s + r.ktcCan, 0), total = rows.reduce((s, r) => s + r.total, 0);
    const pass = rows.length >= BAR.weeks && beat === rows.length && latest && latest.rank >= BAR.rankAgreement && move != null && move < BAR.dailyMove && oursCan >= ktcCan;
    const status = pass ? 'Passing' : rows.length < BAR.weeks ? `Building (${rows.length}/${BAR.weeks} weeks)` : 'Not passing';
    md.push(`| ${format} | ${rows.length} | ${beat}/${rows.length} | ${beatCurve}/${rows.length} | ${latest ? f3(latest.rank) : '—'} | ${pct(move)} | ${pct(oursCan / (total || 1))} / ${pct(ktcCan / (total || 1))} | ${status} |`);
    detail.push(`### ${format}`, '', '| Week | Trades | Ours | KTC, its own adjustment | KTC + our curve | KTC plain sum |', '|---|---|---|---|---|---|');
    rows.slice(-12).forEach(r => detail.push(`| ${r.from.slice(5)} to ${r.to.slice(5)}${r.replay ? ' (replay)' : ''} | ${r.n.toLocaleString()} | **${f3(r.sys.ours)}** | ${f3(r.sys.ktcAdj)} | ${f3(r.sys.ktcCurve)} | ${f3(r.sys.ktcSum)} |`));
    detail.push('');
  }
  md.push('', '## Week by week', '', ...detail);
  fs.writeFileSync(path.join(OUT, 'track-report.md'), md.join('\n'));
}

(async () => {
  const lockFile = path.join(OUT, 'nightly.lock');
  if (fs.existsSync(lockFile) && Date.now() - fs.statSync(lockFile).mtimeMs < 6 * 3600e3) { log('another run is going; stopping'); return; }
  fs.writeFileSync(lockFile, String(process.pid));
  try {
    log(`start (${FORMATS.join(', ')})`);
    const seasons = [nflSeason() - 1, nflSeason()];
    ({ loadTrades, weekOf, SITE_DATA } = require('./load'));
    ({ Model } = require('./model'));
    ({ buildPrior } = require('./prior'));
    ({ ktcPrices, loadVault } = require('./ktc'));
    log(`data from ${path.relative(ROOT, SITE_DATA) || SITE_DATA}`);
    const Vault = loadVault();
    for (const format of FORMATS) {
      try { await runFormat(format, seasons.filter(s => fs.existsSync(path.join(RAW, `${s}.json.gz`))), Vault); }
      catch (e) { log(`${format}: failed: ${e.stack || e.message}`); }
    }
    report();
    buildSiteValues();
    log('done');
  } finally { fs.unlinkSync(lockFile); }
})();
