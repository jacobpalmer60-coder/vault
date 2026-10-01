/* ============================================================
   REAL TRADES: shared data (Trade Calculator, Player Rankings)
   Loads completed dynasty trades for a league's QB format from two sources that
   never overlap: KTC's trade database (data/ktc-trades.json, its last few
   days, priced at today's KTC values for the league's format) and, for the
   ~90 days before that, completed trades from Sleeper dynasty leagues
   (data/market-history/recent-<sf|oneQB>.json, each priced at KTC values
   from its own day in its own league's format). Only trades where every
   piece has a price. Players are matched across the two by name
   (Vault.normalizeName), the way the site matches KTC to Sleeper; each trade
   keeps its league's settings so pages can match leagues like theirs
   (Vault.tradeFormatTiers).
   ============================================================ */
const MARKET_MIN_COMPS = 5;     // fewer completed trades than this and we say nothing
const MARKET_MIN_NARROW = 10;   // a closer league match needs at least this many, or the broader one is steadier
const Market = { data: null, loading: null };

function marketLoad(league) {
  if (Market.loading) return Market.loading;
  const qbs = Vault.tradeFormatSig(league).qbs; // same QB read as the trade matching (2QB leagues count as Superflex)
  const recentFile = `data/market-history/recent-${qbs === 2 ? 'sf' : 'oneQB'}.json`;
  Market.loading = Promise.all([fetch('data/ktc-trades.json').then(r => r.json()), Vault.fetchKtcValues(), fetch(recentFile).then(r => (r.ok ? r.json() : null)).catch(() => null)]).then(([db, ktc, recent]) => {
    // Each KTC trade is priced in its own league's format: its QB setting and TE
    // premium (KTC's tep code 0-3 -> no premium, TE+, TE++), like the Sleeper
    // trades, so a tight end isn't priced at TE-premium values in a league without it.
    const base = qbs === 2 ? 'sf' : 'oneQB';
    const fieldFor = tep => base + (tep >= 2 ? '_tepp' : tep === 1 ? '_tep' : '');
    const byId = new Map();
    (ktc.players || []).forEach(p => { if (p.ktcId != null) byId.set(String(p.ktcId), { type: 'player', name: p.name, pos: p.pos, row: p }); });
    (ktc.picks || []).forEach(p => { if (p.ktcId != null) byId.set(String(p.ktcId), { type: 'pick', name: `${p.season} R${p.round}`, tier: p.slot, season: +p.season, round: +p.round, row: p }); });
    const priced = (id, field) => {
      const a = byId.get(id), value = a && (a.row[field] ?? a.row[base]);
      if (!(value > 0)) return null;
      const { row, ...rest } = a;
      return { ...rest, id, value };
    };
    // Each trade keyed by its pieces: players by name ('n:' + normalized), picks by id.
    const byPlayer = new Map();
    let first = '9999', last = '';
    const add = (date, s1, s2, fmt) => {
      const key = marketKeyOf;
      const trade = { date, k1: s1.map(key), k2: s2.map(key), s1, s2, fmt };
      if (date < first) first = date; if (date > last) last = date;
      [...trade.k1, ...trade.k2].forEach(k => { if (k) (byPlayer.get(k) || byPlayer.set(k, []).get(k)).push(trade); });
    };
    let ktcFrom = '9999';
    (db.trades || []).forEach(t => {
      if (t.qbs !== qbs || !t.t1.length || !t.t2.length) return;
      const field = fieldFor(t.tep);
      const s1 = t.t1.map(id => priced(id, field)), s2 = t.t2.map(id => priced(id, field));
      if (s1.some(x => !x) || s2.some(x => !x)) return; // a piece KTC no longer prices
      const date = String(t.date).slice(0, 10);
      if (date < ktcFrom) ktcFrom = date;
      add(date, s1, s2, { teams: t.teams, qbs: t.qbs, ppr: t.ppr, tep: t.tep });
    });
    // Sleeper's trades from before KTC's feed starts, so none is counted twice.
    let sleeperCount = 0;
    (recent?.trades || []).forEach(([date, a, b, f]) => {
      if (date >= ktcFrom) return;
      const side = s => s.map(([id, value]) => {
        if (id[0] === 'p') { const [season, round] = id.slice(1).split('-'); return { type: 'pick', id, name: `${season} R${round}`, season: +season, round: +round, value }; }
        const [name, pos] = recent.names[id] || [];
        return { type: 'player', id, name: name || 'Unknown player', pos, value };
      });
      add(date, side(a), side(b), f ? { teams: f[2], qbs, ppr: Vault.ktcPprCode(f[0]), tep: Vault.ktcTepCode(f[1]) } : { qbs });
      sleeperCount++;
    });
    const days = last >= first ? Math.round((new Date(last) - new Date(first)) / 864e5) + 1 : 0;
    Market.data = { byPlayer, isSF: qbs === 2, days, sleeperCount };
    return Market.data;
  }).catch(e => { console.warn('The market unavailable', e); Market.data = { failed: true }; return Market.data; });
  return Market.loading;
}

// % the side getting `pSide` paid over KTC: what they sent minus what they got,
// consolidation-adjusted, as a % of the two sides' average.
function marketPaid(pSide, oSide) {
  const { valueA: vp, valueB: vo } = Vault.tradeSideValues(pSide, oSide);
  const avg = (vp + vo) / 2 || 1;
  return (vo - vp) / avg * 100;
}
const marketShape = n => Math.min(n, 3);
// Days from the oldest to the newest of these trades' dates, both counted.
const spanDays = dates => { const s = [...dates].sort(); return s.length ? Math.round((new Date(s[s.length - 1]) - new Date(s[0])) / 864e5) + 1 : 0; };
const marketQuantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

// Every real trade with this player, from his side: what his side got (ps) and
// sent (os), what the getter paid over KTC, its shape, and whether he was the
// main piece (the best piece on his side).
// Each asset's key in the index: players by name ('n:' + normalized), picks by
// year and round ('k:2027-1'; early/mid/late isn't known for Sleeper trades and
// KTC's feed stores every pick as mid). A key passed in is used as is.
function marketKeyOf(a) {
  if (typeof a === 'string') return /^[nk]:/.test(a) ? a : 'n:' + Vault.normalizeName(a);
  const round = a.round ?? a.ktcRound; // graded trades' picks carry ktcRound
  return a.type === 'pick' ? (a.season && round ? `k:${a.season}-${round}` : '') : 'n:' + Vault.normalizeName(a.name);
}
function marketComps(name) {
  const d = Market.data;
  if (!d || d.failed) return [];
  const id = marketKeyOf(name);
  return (d.byPlayer.get(id) || []).map(t => {
    const inOne = t.k1.includes(id);
    const ps = inOne ? t.s1 : t.s2, os = inOne ? t.s2 : t.s1;
    const him = ps[(inOne ? t.k1 : t.k2).indexOf(id)];
    return { t, ps, os, him, paid: marketPaid(ps, os), shape: `${marketShape(ps.length)}-${marketShape(os.length)}`,
      dir: Math.sign(os.length - ps.length), main: ps.every(a => a.value <= him.value), raw: os.reduce((s, a) => s + a.value, 0) };
  });
}

/* A player's market value: in completed trades where he was the main piece, what
   the team getting him actually paid, scaled to him (what his side cost /
   what it was worth, both consolidation-adjusted, minus 1), as a median with
   the middle half as the usual range. Leagues most like this one first
   (Vault.tradeFormatTiers), needing MARKET_MIN_NARROW trades to narrow.

   even: only trades with the same number of pieces each way. Getting a star
   usually means sending more pieces, and the market pays to consolidate, so
   across all trades nearly every star reads "above KTC"; even trades compare
   like with like. The card uses even trades when there are enough, else all;
   Market highs & lows uses even trades only. */
// What players at a given KTC value and position usually go for, as a % over
// or under KTC: the median premium of every main-piece trade (even ones only,
// or all) for players at that position within ±15% of that value, on a
// 100-point grid; where a position has too few trades nearby, all positions.
// Prices aren't symmetric across the board: in like-for-like trades a star's
// partner can only be worth less (almost nobody is above him) and a cheap
// player's tends to be worth more, and whole positions can trade off KTC
// (tight ends go for well under KTC's TE-premium prices), so comparing with
// peers is what singles out a player. Also each position's overall median
// (byPos), for a one-line summary. Cached per kind.
const peerCache = new Map();
function marketPeerBaseline(even) {
  const d = Market.data;
  if (!d || d.failed) return null;
  if (peerCache.has(even)) return peerCache.get(even);
  const events = [];
  d.byPlayer.forEach((trades, key) => marketComps(key).forEach(c => {
    if (!c.main || (even && c.dir !== 0)) return;
    const { valueA: vp, valueB: vo } = Vault.tradeSideValues(c.ps, c.os);
    if (vp) events.push([c.him.value, (vo / vp - 1) * 100, c.him.pos || 'Pick']);
  }));
  const med = list => { const l = [...list].sort((a, b) => a - b); return l[Math.floor((l.length - 1) / 2)]; };
  const gridFor = list => {
    const grid = [];
    for (let v = 0; v <= 10000; v += 100) {
      const near = list.filter(([x]) => x >= v * 0.85 && x <= v * 1.15).map(([, p]) => p);
      grid.push(near.length >= 20 ? med(near) : null);
    }
    return grid;
  };
  const grids = { ALL: gridFor(events) };
  ['QB', 'RB', 'WR', 'TE', 'Pick'].forEach(p => { grids[p] = gridFor(events.filter(e => e[2] === p)); });
  const knownAll = grids.ALL.map((g, i) => (g == null ? null : i)).filter(i => i != null);
  const at = (v, pos) => {
    const i = Math.round(Math.max(0, Math.min(10000, v)) / 100);
    if (grids[pos] && grids[pos][i] != null) return grids[pos][i];
    if (grids.ALL[i] != null) return grids.ALL[i];
    if (!knownAll.length) return 0;
    return grids.ALL[knownAll.reduce((b, j) => (Math.abs(j - i) < Math.abs(b - i) ? j : b), knownAll[0])];
  };
  const byPos = {};
  ['QB', 'RB', 'WR', 'TE', 'Pick'].forEach(p => { const l = events.filter(e => e[2] === p).map(e => e[1]); if (l.length >= 30) byPos[p] = med(l); });
  const out = { at, byPos };
  peerCache.set(even, out);
  return out;
}

function marketValue(league, name, { even = false, min = MARKET_MIN_COMPS } = {}) {
  const main = marketComps(name).filter(c => c.main && (!even || c.dir === 0));
  const tiers = Vault.tradeFormatTiers(Vault.tradeFormatSig(league));
  for (const [i, tier] of tiers.entries()) {
    const pool = main.filter(c => tier.match(c.t.fmt));
    if (pool.length < (i === tiers.length - 1 ? min : Math.max(min, MARKET_MIN_NARROW))) continue;
    const ratio = c => { const { valueA: vp, valueB: vo } = Vault.tradeSideValues(c.ps, c.os); return vp ? vo / vp : 1; };
    const prem = pool.map(c => (ratio(c) - 1) * 100).sort((x, y) => x - y);
    // vsPeers: each trade's premium minus what players at his position and value usually got, as a median.
    const peer = marketPeerBaseline(even);
    const vsPeers = peer ? marketQuantile(pool.map(c => (ratio(c) - 1) * 100 - peer.at(c.him.value, c.him.pos)).sort((x, y) => x - y), 0.5) : null;
    return { n: pool.length, like: tier.label, even, days: spanDays(pool.map(c => c.t.date)),
      premium: marketQuantile(prem, 0.5), low: marketQuantile(prem, 0.25), high: marketQuantile(prem, 0.75), vsPeers };
  }
  return { n: main.length, like: null, even };
}

/* ---------- A player's market value (everywhere on the site) ----------
   What managers paid for him against KTC: the median, over every completed
   trade he headlined (any shape), of what the team getting him sent over
   what his side was worth, both with KTC's consolidation adjustment (the
   same math as the grade). Market value = KTC value x (1 + that %).

   Every shape, not just like-for-like (2026-10-01): across all trades each
   KTC value level comes out about even with KTC (2k +2%, 5k 0%, 7k +2%, 9k+
   0%), so the median carries no built-in bias. Like-for-like trades alone
   read every star low (a star's partner can only be worth less: 9k+ -17%)
   and consolidation trades alone read cheap players high (2k +69%); getting
   a star for more pieces costs only ~6% beyond KTC's own consolidation bonus.

   Picks count by year and round ('k:2027-1', every tier together). Anything
   with fewer than MARKET_MIN_COMPS such trades gets no read (0). Clamped to ±MARKET_ADJ_CAP so one noisy read can't swing a
   trade. Cached per name, since Trade Coach judges thousands of trades. Used
   by the player card, the Player Market page, "At market prices" and Trade
   Coach; the grade never uses it. */
const MARKET_ADJ_CAP = 25;
const marketAdjCache = new Map();
// { adj, read } for a player (read = the marketValue read it came from), or { adj: 0, read: null }.
function marketPlayer(league, name, pos) {
  const none = { adj: 0, read: null };
  if (!name || !Market.data || Market.data.failed) return none;
  const key = marketKeyOf(name);
  if (marketAdjCache.has(key)) return marketAdjCache.get(key);
  const read = marketValue(league, name);
  const out = read.like ? { adj: Math.max(-MARKET_ADJ_CAP, Math.min(MARKET_ADJ_CAP, read.premium)), read } : none;
  marketAdjCache.set(key, out);
  return out;
}
function marketAdj(league, a) {
  if (!a) return 0;
  if (a.type === 'pick') { const k = marketKeyOf(a); return k ? marketPlayer(league, k, 'Pick').adj : 0; }
  return marketPlayer(league, a.name, a.pos).adj;
}
// A trade at market prices vs KTC, from the side that gives `give` and gets `get`:
// ktc / market = % in that side's favor (consolidation-adjusted, as the grade
// measures), delta = market - ktc, and the pieces that moved it most.
function marketEdge(league, give, get) {
  // KTC's consolidation adjustment stays as the grade computes it; each side is
  // then scaled by its own pieces' market prices. Re-running the adjustment on
  // market prices could flip which side holds the best piece and swing the
  // bonus from one side to the other, which is KTC's math, not the market.
  const { valueA, valueB } = Vault.tradeSideValues(give, get);
  const sum = list => list.reduce((t, a) => t + a.value, 0);
  const mkt = list => list.reduce((t, a) => t + a.value * (1 + marketAdj(league, a) / 100), 0);
  const vG = valueA * (sum(give) ? mkt(give) / sum(give) : 1), vR = valueB * (sum(get) ? mkt(get) / sum(get) : 1);
  const pct = (g, r) => (r - g) / (((g + r) / 2) || 1) * 100;
  const ktc = pct(valueA, valueB), market = pct(vG, vR);
  const movers = [...give.map(a => ({ a, gets: false })), ...get.map(a => ({ a, gets: true }))]
    .map(x => ({ ...x, adj: marketAdj(league, x.a), weight: Math.abs(marketAdj(league, x.a) * x.a.value) }))
    .filter(x => Math.abs(x.adj) >= 3).sort((x, y) => y.weight - x.weight);
  return { ktc, market, delta: market - ktc, movers };
}
// Net value of a trade for the side giving `give` and getting `get`, in KTC
// points: on KTC (consolidation-adjusted, as the grade measures) and at market
// prices (each side scaled by its pieces' market values, the adjustment held).
function marketNet(league, give, get) {
  const { valueA, valueB } = Vault.tradeSideValues(give, get);
  const mult = list => { const s = list.reduce((t, a) => t + a.value, 0); return s ? list.reduce((t, a) => t + a.value * (1 + marketAdj(league, a) / 100), 0) / s : 1; };
  return { ktc: valueB - valueA, market: valueB * mult(get) - valueA * mult(give) };
}
// "Rashee Rice trades about 13% above his KTC value", for the piece that moved a trade most.
function marketMoverText(m) {
  return `${Vault.escapeHtml(m.a.name)} trades about ${Math.abs(Math.round(m.adj))}% ${m.adj > 0 ? 'above' : 'below'} his KTC value`;
}
