/* ============================================================
   SNAPSHOT MARKET
   Runs in the daily Action right after fetch-ktc.js and fetch-ktc-trades.js.
   data/ktc-trades.json only ever holds KTC's latest ~25,000 trades (about
   4-5 days), so this keeps a small daily SUMMARY of each day's real trades
   before they roll off. Raw trades would be ~0.6 MB a day; a summary is a few
   KB per format.

   Writes data/market/<format>-<YYYY-MM>.json, format = 'sf' or 'oneQB' (KTC's
   QB setting; every PPR/TE setting pooled), one entry per day:
     { days: { 'YYYY-MM-DD': {
         n,                 priced trades that day (every piece has a KTC price)
         pct: [17 counts],  % off on KTC value in 5%-wide bins, the last 80%+
         buckets: [fair, lopsided, unfair],
         shapes: { '1-for-2': [n, medianPctOff, medianPaid|null] },
         stars:  { '8000': [n, oneForOne] },   best piece 8,000+, 6,000+, ...
         pos:    { QB: [n, oneForOne, medianPctOff, medianPaid|null] },
         players: { ktcId: [trades, asMainPiece, medianPaid|null, oneForOne] }
       } } }
   "Paid" is from the side getting fewer pieces (shapes, pos) or the side
   getting the player as the main piece (players): what they sent minus what
   they got, as a % of the two sides' average. All of it uses the site's own
   math (Vault.tradeSideValues, Vault.fairnessBucket from vault-core.js, run
   in a sandbox here), priced at that run's KTC values in plain sf/oneQB.

   Each run re-summarizes every day in the current window and keeps whichever
   version of a day saw more trades: the window's first and last days are
   partial, and the next run fills the last one in.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(DATA, 'market');
const BIN = 5, TOP = 80;
const STARS = [8000, 6000, 4000, 2000, 0];

// vault-core.js expects a browser; give it just enough to load, then use its math.
function loadVault() {
  const noop = () => {};
  const el = { addEventListener: noop, querySelectorAll: () => [], getElementById: () => null };
  function HTMLSelectElement() {}
  ['value', 'selectedIndex'].forEach(k => Object.defineProperty(HTMLSelectElement.prototype, k, { get: noop, set: noop, configurable: true }));
  const sandbox = {
    console, Math, Date, JSON, Map, Set, WeakMap, Number, String, Array, Object, Promise, setTimeout, clearTimeout,
    window: {}, document: el, location: { search: '', pathname: '/', href: '' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, sessionStorage: { getItem: () => null, setItem: noop },
    MutationObserver: class { observe() {} }, HTMLSelectElement, navigator: {}, fetch: () => Promise.reject(new Error('no fetch'))
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'vault-core.js'), 'utf8') + '\n;this.Vault = Vault;', sandbox);
  return sandbox.Vault;
}

const median = list => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return Math.round(s[Math.floor((s.length - 1) / 2)]); };

function summarize(Vault, trades, price) {
  const day = { n: 0, pct: Array(TOP / BIN + 1).fill(0), buckets: [0, 0, 0], shapes: {}, stars: {}, pos: {}, players: {} };
  const shapes = {}, pos = {}, players = {};
  trades.forEach(t => {
    const s1 = t.t1.map(id => price.get(id)), s2 = t.t2.map(id => price.get(id));
    if (!s1.length || !s2.length || [...s1, ...s2].some(a => !a)) return;
    const { valueA: v1, valueB: v2 } = Vault.tradeSideValues(s1, s2); // what team 1 / team 2 received
    const avg = (v1 + v2) / 2 || 1, pct = Math.abs(v1 - v2) / avg * 100;
    day.n++;
    day.pct[Math.min(day.pct.length - 1, Math.floor(pct / BIN))]++;
    day.buckets[['Fair', 'Lopsided', 'Unfair'].indexOf(Vault.fairnessBucket(pct, 0, 0))]++;
    const few = Math.min(s1.length, s2.length), many = Math.max(s1.length, s2.length), one = few === 1 && many === 1;
    const consolidator = s1.length < s2.length ? 1 : s2.length < s1.length ? 2 : 0;
    const paid = consolidator === 1 ? (v2 - v1) / avg * 100 : consolidator === 2 ? (v1 - v2) / avg * 100 : null;
    const shape = `${Math.min(few, 3)}-for-${many >= 4 ? '4+' : many}`;
    (shapes[shape] ||= { n: 0, pct: [], paid: [] }).n++;
    shapes[shape].pct.push(pct); if (paid != null) shapes[shape].paid.push(paid);
    const all = [...s1.map((a, i) => ({ ...a, side: 1, id: t.t1[i] })), ...s2.map((a, i) => ({ ...a, side: 2, id: t.t2[i] }))];
    const top = all.reduce((m, a) => (a.value > m.value ? a : m));
    const tier = String(STARS.find(v => top.value >= v));
    const st = (day.stars[tier] ||= [0, 0]); st[0]++; if (one) st[1]++;
    const p = top.pos || 'Pick', topAlone = (top.side === 1 ? s1 : s2).length === 1 && consolidator !== 0;
    const ps = (pos[p] ||= { n: 0, one: 0, pct: [], paid: [] }); ps.n++; if (one) ps.one++; ps.pct.push(pct); if (topAlone && paid != null) ps.paid.push(paid);
    // Every player in the trade; "main piece" = the best piece on his side.
    all.filter(a => a.type === 'player').forEach(a => {
      const mine = a.side === 1 ? s1 : s2, vMine = a.side === 1 ? v1 : v2, vOther = a.side === 1 ? v2 : v1;
      const pl = (players[a.id] ||= { n: 0, main: 0, paid: [], one: 0 });
      pl.n++; if (one) pl.one++;
      if (mine.every(x => x.value <= a.value)) { pl.main++; pl.paid.push((vOther - vMine) / avg * 100); }
    });
  });
  Object.entries(shapes).forEach(([k, s]) => { day.shapes[k] = [s.n, median(s.pct), median(s.paid)]; });
  Object.entries(pos).forEach(([k, s]) => { day.pos[k] = [s.n, s.one, median(s.pct), median(s.paid)]; });
  Object.entries(players).forEach(([id, s]) => { day.players[id] = [s.n, s.main, median(s.paid), s.one]; });
  return day;
}

function main() {
  const Vault = loadVault();
  const ktc = JSON.parse(fs.readFileSync(path.join(DATA, 'ktc-values.json'), 'utf8'));
  const db = JSON.parse(fs.readFileSync(path.join(DATA, 'ktc-trades.json'), 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  const formats = [['sf', 2], ['oneQB', 1]];
  // The consolidation math scales to today's single most valuable player (see vault-core.js).
  let written = 0;
  formats.forEach(([field, qbs]) => {
    Vault._globalMaxValue = Math.max(...(ktc.players || []).map(p => p[field] || 0));
    const price = new Map();
    (ktc.players || []).forEach(p => { if (p.ktcId != null && p[field] > 0) price.set(String(p.ktcId), { type: 'player', pos: p.pos, value: p[field] }); });
    (ktc.picks || []).forEach(p => { if (p.ktcId != null && p[field] > 0) price.set(String(p.ktcId), { type: 'pick', pos: null, value: p[field] }); });
    const byDay = new Map();
    (db.trades || []).filter(t => t.qbs === qbs && t.t1.length && t.t2.length).forEach(t => {
      const d = String(t.date).slice(0, 10);
      (byDay.get(d) || byDay.set(d, []).get(d)).push(t);
    });
    byDay.forEach((trades, d) => {
      const file = path.join(OUT, `${field}-${d.slice(0, 7)}.json`);
      const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { format: field, days: {} };
      const summary = summarize(Vault, trades, price);
      if (doc.days[d] && doc.days[d].n >= summary.n) return; // an earlier run saw more of this day
      doc.days[d] = summary;
      doc.days = Object.fromEntries(Object.entries(doc.days).sort(([a], [b]) => a.localeCompare(b)));
      fs.writeFileSync(file, JSON.stringify(doc));
      written++;
      console.log(`${field} ${d}: ${summary.n} priced trades`);
    });
  });
  console.log(`Market snapshot: ${written} day summaries written`);
}

main();
