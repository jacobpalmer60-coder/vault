/* ============================================================
   Shared by snapshot-market.js (KTC's feed, daily) and
   summarize-sleeper-trades.js (the Sleeper crawl, priced at each trade's
   own date), so both summarize real trades with exactly the same math.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
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

/* One summary of a group of priced trades. Each trade is { s1, s2 }: what
   each team received, as [{ type: 'player'|'pick', pos, value, id }].
     { n, pct: [17 bin counts, 5% wide, last 80%+], buckets: [fair, lopsided, unfair],
       shapes: { '1-for-2': [n, medianPctOff, medianPaid|null] },
       stars:  { '8000': [n, oneForOne] },
       pos:    { QB: [n, oneForOne, medianPctOff, medianPaid|null] },
       players: { id: [trades, asMainPiece, medianPaid|null, oneForOne] } }
   "Paid": what the side getting fewer pieces (shapes, pos) or getting the
   player as its best piece (players) sent minus what it got, as a % of the
   two sides' average. */
function summarize(Vault, trades, { players: withPlayers = true } = {}) {
  const out = { n: 0, pct: Array(TOP / BIN + 1).fill(0), buckets: [0, 0, 0], shapes: {}, stars: {}, pos: {} };
  const shapes = {}, pos = {}, players = {};
  trades.forEach(({ s1, s2 }) => {
    // Graded on trade value (the site's grade, Vault.tradeSideValues); what a side
    // "paid" stays against KTC's own adjustment (Vault.ktcSideValues), the market's
    // yardstick, so the premiums keep meaning "over or under KTC".
    const g = Vault.tradeSideValues(s1, s2), gAvg = (g.valueA + g.valueB) / 2 || 1, pct = Math.abs(g.valueA - g.valueB) / gAvg * 100;
    const { valueA: v1, valueB: v2 } = (Vault.ktcSideValues || Vault.tradeSideValues)(s1, s2); // what team 1 / team 2 received, KTC's view
    const avg = (v1 + v2) / 2 || 1;
    out.n++;
    out.pct[Math.min(out.pct.length - 1, Math.floor(pct / BIN))]++;
    out.buckets[['Fair', 'Lopsided', 'Unfair'].indexOf(Vault.fairnessBucket(pct, 0, 0))]++;
    const few = Math.min(s1.length, s2.length), many = Math.max(s1.length, s2.length), one = few === 1 && many === 1;
    const consolidator = s1.length < s2.length ? 1 : s2.length < s1.length ? 2 : 0;
    const paid = consolidator === 1 ? (v2 - v1) / avg * 100 : consolidator === 2 ? (v1 - v2) / avg * 100 : null;
    const shape = `${Math.min(few, 3)}-for-${many >= 4 ? '4+' : many}`;
    (shapes[shape] ||= { n: 0, pct: [], paid: [] }).n++;
    shapes[shape].pct.push(pct); if (paid != null) shapes[shape].paid.push(paid);
    const all = [...s1.map(a => ({ ...a, side: 1 })), ...s2.map(a => ({ ...a, side: 2 }))];
    const top = all.reduce((m, a) => (a.value > m.value ? a : m));
    const tier = String(STARS.find(v => top.value >= v));
    const st = (out.stars[tier] ||= [0, 0]); st[0]++; if (one) st[1]++;
    const p = top.type === 'pick' ? 'Pick' : top.pos || 'Pick', topAlone = (top.side === 1 ? s1 : s2).length === 1 && consolidator !== 0;
    const ps = (pos[p] ||= { n: 0, one: 0, pct: [], paid: [] }); ps.n++; if (one) ps.one++; ps.pct.push(pct); if (topAlone && paid != null) ps.paid.push(paid);
    if (!withPlayers) return;
    // Every player in the trade; "main piece" = the best piece on his side.
    all.filter(a => a.type === 'player').forEach(a => {
      const mine = a.side === 1 ? s1 : s2, vMine = a.side === 1 ? v1 : v2, vOther = a.side === 1 ? v2 : v1;
      const pl = (players[a.id] ||= { n: 0, main: 0, paid: [], one: 0 });
      pl.n++; if (one) pl.one++;
      if (mine.every(x => x.value <= a.value)) { pl.main++; pl.paid.push((vOther - vMine) / avg * 100); }
    });
  });
  Object.entries(shapes).forEach(([k, s]) => { out.shapes[k] = [s.n, median(s.pct), median(s.paid)]; });
  Object.entries(pos).forEach(([k, s]) => { out.pos[k] = [s.n, s.one, median(s.pct), median(s.paid)]; });
  if (withPlayers) { out.players = {}; Object.entries(players).forEach(([id, s]) => { out.players[id] = [s.n, s.main, median(s.paid), s.one]; }); }
  return out;
}

module.exports = { loadVault, summarize, median, ROOT };
