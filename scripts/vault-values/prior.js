/* A starting guess for every player's value, for the ones trades say little
   about. Learned, not hand-set: a regression from a fitted model's well-traded
   players (MIN_TRADES+), predicting each one's log value from
     - position (QB, RB, WR, TE), and per position: age and age squared,
     - projected PPR points per game (Sleeper's weekly projections, the site's
       data/projections.json), as log(1 + ppg),
     - rookie or not (Sleeper's years_exp is 0).
   Picks (pickPrior): what that round actually turned into. In the latest
   completed rookie drafts, the average value of the players taken in each
   round (unrated players count as nothing), in the fitted model's own values;
   each later class discounted by the yearly drop the model shows for 1sts. A
   pick that's a throw-in in most of its trades (3rd round and later) gets
   little say from trades, so without this its value drifted to the middle of
   the scale: a 2027 5th at 2,292 against a 2nd at 3,107 (2026-10-08).
   Returns Map key -> predicted log value, on the fitted model's own scale. */
const fs = require('fs');
const path = require('path');
const { SITE_DATA } = require('./load');

const MIN_TRADES = 150;
const POS = ['QB', 'RB', 'WR', 'TE'];

function projectedPpg() {
  const proj = JSON.parse(fs.readFileSync(path.join(SITE_DATA, 'projections.json'), 'utf8'));
  const out = new Map();
  for (const [id, p] of Object.entries(proj.players || {})) {
    const played = (p.wp || []).filter(x => x > 0);
    if (played.length) { out.set(id, played.reduce((a, b) => a + b, 0) / played.length); continue; }
    const s = p.stats || {}, gp = s.gp || 0;
    if (!gp) continue;
    const pts = (s.pass_yd || 0) * 0.04 + (s.pass_td || 0) * 4 - (s.pass_int || 0) * 2 + (s.rush_yd || 0) * 0.1 + (s.rush_td || 0) * 6
      + (s.rec || 0) + (s.rec_yd || 0) * 0.1 + (s.rec_td || 0) * 6 - (s.fum_lost || 0) * 2;
    out.set(id, pts / gp);
  }
  return out;
}

function features(key, players, ppg) {
  const p = players[key];
  if (!p || !POS.includes(p.position) || !(p.age > 0)) return null;
  const x = new Array(POS.length * 3 + 2).fill(0);
  const i = POS.indexOf(p.position), age = (p.age - 26) / 4;
  x[i * 3] = 1; x[i * 3 + 1] = age; x[i * 3 + 2] = age * age;
  x[POS.length * 3] = Math.log1p(ppg.get(key) || 0);
  x[POS.length * 3 + 1] = p.years_exp === 0 ? 1 : 0;
  return x;
}

// Ridge least squares: solve (X'X + r I) b = X'y by Gaussian elimination.
function solve(X, y, r = 1e-3) {
  const k = X[0].length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((x, n) => { for (let i = 0; i < k; i++) { A[i][k] += x[i] * y[n]; for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; } });
  for (let i = 0; i < k; i++) A[i][i] += r;
  for (let c = 0; c < k; c++) {
    let piv = c; for (let r2 = c + 1; r2 < k; r2++) if (Math.abs(A[r2][c]) > Math.abs(A[piv][c])) piv = r2;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r2 = 0; r2 < k; r2++) if (r2 !== c) { const f = A[r2][c] / A[c][c]; for (let j = c; j <= k; j++) A[r2][j] -= f * A[c][j]; }
  }
  return A.map((row, i) => row[k] / row[i]);
}

/* Pick starting guesses from rookie-draft results: Map 'p<season>-<round>' ->
   log value. drafts: { season, rounds: Map round -> [Sleeper ids] } from the
   latest completed class (loadDrafts). Classes at or before it read as that
   class; each later class one more year of discount. */
function pickPrior(model, keys, drafts) {
  const out = new Map();
  if (!drafts || !drafts.rounds.size) return { prior: out, info: null };
  const last = model.W - 1, lin = id => { const a = model.index.get(id); return a == null ? 0 : Math.exp(model.u[a * model.W + last]); };
  const byRound = new Map();
  for (const [r, ids] of drafts.rounds) if (ids.length >= 50) byRound.set(r, Math.log(Math.max(1e-6, ids.reduce((s, id) => s + lin(id), 0) / ids.length)));
  // Yearly discount from the next two classes' 1sts, when both trade enough; else 0.87.
  const next = drafts.season + 1, u1 = y => { const a = model.index.get(`p${y}-1`); return a == null || model.counts[a] < MIN_TRADES ? null : model.u[a * model.W + last]; };
  const a1 = u1(next), a2 = u1(next + 1);
  const logD = a1 != null && a2 != null ? Math.max(Math.log(0.6), Math.min(0, a2 - a1)) : Math.log(0.87);
  for (const k of keys) {
    if (k[0] !== 'p') continue;
    const [y, r] = k.slice(1).split('-').map(Number), base = byRound.get(Math.min(5, r));
    if (base != null) out.set(k, base + Math.max(0, y - next) * logD);
  }
  return { prior: out, info: { season: drafts.season, rounds: Object.fromEntries([...byRound].map(([r, v]) => [r, v])), discount: Math.exp(logD) } };
}

/* From a fitted model and its latest week: { prior: Map, fit: { n, r2 } }.
   `keys` are every asset to predict (players and picks). */
function buildPrior(model, players, keys, drafts = null) {
  const ppg = projectedPpg();
  const last = model.W - 1, X = [], y = [];
  model.keys.forEach((k, a) => {
    if (k[0] === 'p' || model.counts[a] < MIN_TRADES) return;
    const x = features(k, players, ppg);
    if (x) { X.push(x); y.push(model.u[a * model.W + last]); }
  });
  // Too few well-traded players to learn from (the rarest formats): no starting guess.
  if (X.length < 30) return { prior: new Map(), fit: { n: X.length, r2: null } };
  const b = solve(X, y);
  const predict = x => x.reduce((s, v, i) => s + v * b[i], 0);
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const r2 = 1 - X.reduce((s, x, n) => s + (y[n] - predict(x)) ** 2, 0) / y.reduce((s, v) => s + (v - mean) ** 2, 0);
  // Picks: from draft results (pickPrior) when there are any; else the mean of
  // well-traded picks in the same round.
  const picks = pickPrior(model, keys, drafts);
  const byRound = new Map();
  model.keys.forEach((k, a) => { if (k[0] === 'p' && model.counts[a] >= MIN_TRADES) { const r = k.split('-')[1]; (byRound.get(r) || byRound.set(r, []).get(r)).push(model.u[a * model.W + last]); } });
  const prior = new Map();
  for (const k of keys) {
    if (k[0] === 'p') { if (picks.prior.has(k)) { prior.set(k, picks.prior.get(k)); continue; } const l = byRound.get(k.split('-')[1]); if (l) prior.set(k, l.reduce((s, v) => s + v, 0) / l.length); continue; }
    const x = features(k, players, ppg);
    if (x) prior.set(k, predict(x));
  }
  return { prior, fit: { n: X.length, r2 }, picks: picks.info };
}

module.exports = { buildPrior };
