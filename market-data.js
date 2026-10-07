/* ============================================================
   REAL TRADES: shared data (Trade Calculator, Player Rankings)
   Loads completed dynasty trades for a league's QB format from two sources that
   never overlap: KTC's trade database (data/ktc-trades-<sf|oneQB>.json, its last few
   days, priced at today's KTC values for the league's format) and, for the
   ~40 days before that (45 in all), completed trades from Sleeper dynasty leagues
   (data/market-history/recent-<sf|oneQB>.json, each priced at KTC values
   from its own day in its own league's format). Only trades where every
   piece has a price. Players are matched across the two by name
   (Vault.normalizeName), the way the site matches KTC to Sleeper; each trade
   keeps its league's settings so pages can match leagues like theirs
   (Vault.tradeFormatTiers).
   Sides are valued on trade value (Vault.tradeSideValues: pieces combined the
   way real trades combine them), like every grade, so a market price shows how a
   player is priced beyond the normal premium for consolidating, and the
   calculator's market figure agrees with its grade.
   ============================================================ */
const MARKET_MIN_COMPS = 5;     // fewer completed trades than this and we say nothing
const MARKET_MIN_NARROW = 10;   // a closer league match needs at least this many, or the broader one is steadier
const Market = { data: null, loading: null };

function marketLoad(league) {
  if (Market.loading) return Market.loading;
  const qbs = Vault.tradeFormatSig(league).qbs; // same QB read as the trade matching (2QB leagues count as Superflex)
  const recentFile = `data/market-history/recent-${qbs === 2 ? 'sf' : 'oneQB'}.json`;
  Market.loading = Promise.all([Vault.fetchKtcTrades(qbs), Vault.fetchKtcValues(), fetch(recentFile).then(r => (r.ok ? r.json() : null)).catch(() => null)]).then(([db, ktc, recent]) => {
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
    const add = (date, s1, s2, fmt, src) => {
      const key = marketKeyOf;
      const trade = { date, k1: s1.map(key), k2: s2.map(key), s1, s2, fmt, src };
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
      add(date, s1, s2, { teams: t.teams, qbs: t.qbs, ppr: t.ppr, tep: t.tep }, 'ktc');
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
      add(date, side(a), side(b), f ? { teams: f[2], qbs, ppr: Vault.ktcPprCode(f[0]), tep: Vault.ktcTepCode(f[1]) } : { qbs }, 'sleeper');
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

// The completed trades a market value is read from: the ones he headlined, in
// the closest league match with enough of them ({ like, pool }), else { like: null, pool: [] , n }.
function marketPool(league, name, { even = false, min = MARKET_MIN_COMPS } = {}) {
  const main = marketComps(name).filter(c => c.main && (!even || c.dir === 0));
  const tiers = Vault.tradeFormatTiers(Vault.tradeFormatSig(league));
  for (const [i, tier] of tiers.entries()) {
    const pool = main.filter(c => tier.match(c.t.fmt));
    if (pool.length >= (i === tiers.length - 1 ? min : Math.max(min, MARKET_MIN_NARROW))) return { like: tier.label, pool };
  }
  return { like: null, pool: [], n: main.length };
}
// Each comp's premium: what the getter sent / what his side was worth, both consolidation-adjusted, minus 1, in %.
function marketPremium(c) {
  const { valueA: vp, valueB: vo } = Vault.tradeSideValues(c.ps, c.os);
  return vp ? (vo / vp - 1) * 100 : 0;
}

function marketValue(league, name, { even = false, min = MARKET_MIN_COMPS } = {}) {
  const { like, pool, n } = marketPool(league, name, { even, min });
  if (!like) return { n, like: null, even };
  const prem = pool.map(marketPremium).sort((x, y) => x - y);
  // vsPeers: each trade's premium minus what players at his position and value usually got, as a median.
  const peer = marketPeerBaseline(even);
  const vsPeers = peer ? marketQuantile(pool.map(c => marketPremium(c) - peer.at(c.him.value, c.him.pos)).sort((x, y) => x - y), 0.5) : null;
  return { n: pool.length, like, even, days: spanDays(pool.map(c => c.t.date)),
    premium: marketQuantile(prem, 0.5), low: marketQuantile(prem, 0.25), high: marketQuantile(prem, 0.75),
    p10: marketQuantile(prem, 0.1), p90: marketQuantile(prem, 0.9), vsPeers };
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
// A market read said as a price against KTC, for display: "13% over", "8% under",
// "even", or "25%+ over" when the read is past MARKET_ADJ_CAP. The trade math
// keeps the cap (one noisy read can't swing a trade); pages show that the real
// read is further out, and sort by it (mp.read.premium).
function marketAdjText(mp) {
  if (!mp || !mp.read) return '';
  const raw = mp.read.premium, capped = Math.abs(raw) > MARKET_ADJ_CAP;
  if (!capped && Math.abs(raw) < 0.5) return 'even';
  return `${capped ? MARKET_ADJ_CAP : Math.abs(Math.round(raw))}%${capped ? '+' : ''} ${raw > 0 ? 'over' : 'under'}`;
}
/* Over or under against similar players: how his market price compares with
   players at his position and KTC value (marketValue's vsPeers: the median of
   each of his trades' premium minus what players like him usually got). This
   is the over/under shown next to a market price, and what Sell high, Buy low,
   Your market and the Market column rank by. Below about 2,000 KTC nearly
   every player goes for more than KTC (KTC's low end is squeezed: the
   cheapest piece you can send back is usually worth more), so "over KTC"
   said little about the player himself. The price stays the real one (KTC x
   (1 + premium)), and the trade math ("At market prices", Trade Coach's
   edges, Managers) keeps using it. */
const MARKET_PEER_TIP = 'Against players at the same position and KTC value (within about 15%), in completed trades they headlined. The price is what he actually goes for.';
function marketPeerPct(mp) { const v = mp && mp.read ? mp.read.vsPeers : null; return Number.isFinite(v) ? v : null; }
// "12% over", "8% under", "even", or "25%+ over" past MARKET_ADJ_CAP; '' without a read.
function marketPeerText(mp) {
  const v = marketPeerPct(mp);
  if (v == null) return '';
  const capped = Math.abs(v) > MARKET_ADJ_CAP;
  if (!capped && Math.abs(v) < 0.5) return 'even';
  return `${capped ? MARKET_ADJ_CAP : Math.abs(Math.round(v))}%${capped ? '+' : ''} ${v > 0 ? 'over' : 'under'}`;
}
// The same as a phrase: "12% over similar players", "in line with similar players".
function marketPeerPhrase(mp) { const t = marketPeerText(mp); return !t ? '' : t === 'even' ? 'in line with similar players' : `${t} similar players`; }
// For a trade piece, capped like marketAdj; 0 without a read.
function marketPeerAdj(league, a) {
  if (!a) return 0;
  const mp = a.type === 'pick' ? (marketKeyOf(a) ? marketPlayer(league, marketKeyOf(a), 'Pick') : null) : marketPlayer(league, a.name, a.pos);
  const v = marketPeerPct(mp);
  return v == null ? 0 : Math.max(-MARKET_ADJ_CAP, Math.min(MARKET_ADJ_CAP, v));
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
/* The completed trades a piece's price is read from: every trade he headlined
   (the main piece on his side), in leagues most like this one first
   (Vault.tradeFormatTiers). Not just trades shaped like this one: on trade value
   every shape comes out about even at every KTC level, but a single shape is a
   biased slice for stars (they almost never move 1-for-1, and the few that do
   are mostly discounts: Puka Nacua's 14 recent Superflex 1-for-1s ran 30% under
   to 6% over KTC, which made Chris Olave for Puka read "acceptable" at 16% off).
   { pool, level: 2 (main piece), like, shape, dir } or null. Shared by the
   Market box (market.js) and the acceptable read, so both quote one range. */
function marketPiecePool(league, a, pSide, oSide) {
  const key = a.type === 'pick' ? marketKeyOf(a) : a.name;
  if (!key || !Market.data || Market.data.failed) return null;
  const comps = marketComps(key);
  if (comps.length < MARKET_MIN_COMPS) return null;
  const shape = `${marketShape(pSide.length)}-${marketShape(oSide.length)}`, dir = Math.sign(oSide.length - pSide.length);
  const tiers = Vault.tradeFormatTiers(Vault.tradeFormatSig(league));
  for (const [i, tier] of tiers.entries()) {
    const hit = comps.filter(c => c.main && tier.match(c.t.fmt));
    if (hit.length >= (i === tiers.length - 1 ? MARKET_MIN_COMPS : MARKET_MIN_NARROW)) return { pool: hit, level: 2, like: tier.label, shape, dir };
  }
  return null;
}

/* ---------- Acceptable: what managers pay, low to high ----------
   Fair is about value; acceptable is about what the market tolerates. Every
   player has a range managers have paid for him in trades like this one
   (marketPiecePool, the same trades the Market box quotes: the middle half,
   25th-75th percentile, and the outer range, 10th-90th, of what the team
   getting him paid over KTC, measured like the grade). A trade is acceptable when some price inside
   the usual range of every piece makes it even; a stretch when only the outer
   range does; rarely accepted when not even that. Pieces without enough trades
   of their own get the typical player's range (MARKET_RANGE_FALLBACK).
   Tested 2026-10-06 on 9,000 Superflex Sleeper trades the ranges never saw
   (ranges from the 21,000 before 9/20): 81% fit the usual ranges, 97% the
   outer ones (1QB: 80% / 97%). Never changes the grade. */
const MARKET_RANGE_FALLBACK = { usual: [-10, 10], outer: [-20, 20] };
const MARKET_RANGE_CAP = 50; // one cheap throw-in's odd trades can't stretch a range past this
// A piece's range in this trade: shown (what the team getting him paid over KTC,
// as % of the two sides' average, the Market box's measure) and, for the math,
// as a multiplier on his value (paid p -> his price is (1 + p/2) / (1 - p/2) x KTC).
function marketPriceRange(league, a, pSide, oSide) {
  const hit = marketPiecePool(league, a, pSide, oSide);
  if (!hit || hit.pool.length < MARKET_MIN_NARROW) return { own: false, ...MARKET_RANGE_FALLBACK, show: MARKET_RANGE_FALLBACK };
  const s = hit.pool.map(c => c.paid).sort((x, y) => x - y), q = p => Math.max(-MARKET_RANGE_CAP, Math.min(MARKET_RANGE_CAP, marketQuantile(s, p)));
  const prem = p => ((1 + p / 200) / (1 - p / 200) - 1) * 100;
  const show = { usual: [q(0.25), q(0.75)], outer: [q(0.1), q(0.9)] };
  return { own: true, usual: show.usual.map(prem), outer: show.outer.map(prem), show, n: s.length };
}
// The acceptable read for the team sending `send` and getting `get`:
// { level, edges: { usual: [lo, hi], outer: [lo, hi] } in signed % off (+ = the
// sender sends more, like the fairness bar), payer ('send' | 'get' | null), key }.
// Falls back to Vault.acceptability (how lopsided accepted trades of the kind get)
// while the market hasn't loaded.
function marketAcceptable(league, send, get) {
  if (!send.length || !get.length) return null;
  const { valueA: S, valueB: G } = Vault.tradeSideValues(send, get);
  const f = r => 200 * (r - 1) / (r + 1), s = f(S / G);
  if (!Market.data || Market.data.failed) {
    const a = Vault.acceptability(send, get, Math.abs(s));
    return a && { ...a, payer: a.level === 'acceptable' ? null : s > 0 ? 'send' : 'get', basis: 'kind' };
  }
  const sum = l => l.reduce((t, a) => t + a.value, 0);
  const ranges = new Map([...send.map(a => [a, marketPriceRange(league, a, send, get)]), ...get.map(a => [a, marketPriceRange(league, a, get, send)])]);
  const mult = (list, which, k) => list.reduce((t, a) => t + a.value * (1 + ranges.get(a)[which][k] / 100), 0) / (sum(list) || 1);
  const edge = which => [f(mult(get, which, 0) / mult(send, which, 1)), f(mult(get, which, 1) / mult(send, which, 0))];
  const usual = edge('usual'), outer = edge('outer');
  const inside = e => s >= e[0] && s <= e[1];
  const level = inside(usual) ? 'acceptable' : inside(outer) ? 'stretch' : 'rare';
  // The piece that sets the price: the best piece the paying side gets.
  const payer = level === 'acceptable' ? null : s > usual[1] ? 'send' : 'get';
  const pool = (payer === 'get' ? send : get).filter(a => ranges.get(a).own);
  const key = pool.length ? pool.reduce((m, a) => (a.value > m.value ? a : m), pool[0]) : null;
  return { level, edges: { usual, outer }, payer, key: key && { name: key.name, ...ranges.get(key) }, basis: 'market' };
}
// One line: "A stretch · Skat Happens pays more than managers usually do for these
// players (Brock Bowers usually goes for 6% under to 12% over KTC, at most 22% over)."
function marketAcceptText(r, sendTeam, getTeam, short = false) {
  if (!r) return null;
  const label = { acceptable: 'Acceptable', stretch: 'A stretch', rare: 'Rarely accepted' }[r.level];
  if (r.basis !== 'market') return { label, text: Vault.acceptabilityText(r).split(': ').slice(1).join(': ') };
  const pct = v => (Math.abs(v) < 1 ? 'even' : `${Math.round(Math.abs(v))}% ${v > 0 ? 'over' : 'under'}`);
  const usual = k => `${Vault.escapeHtml(k.name)} usually goes for ${pct(k.show.usual[0])} to ${pct(k.show.usual[1])} KTC value`;
  const payer = Vault.escapeHtml(r.payer === 'send' ? sendTeam : getTeam);
  if (short) return { label, text: r.level === 'acceptable' ? 'inside what managers usually pay' : r.level === 'stretch' ? `${payer} pays more than managers usually do` : `${payer} pays more than managers have paid` };
  if (r.level === 'acceptable') return { label, text: `inside what managers usually pay for these players${r.key ? ` (${usual(r.key)})` : ''}.` };
  // The key piece is the best one the paying team gets, so its ceiling is what matters.
  const k = r.key, detail = k ? ` (${usual(k)}, rarely more than ${pct(k.show.outer[1])})` : '';
  return r.level === 'stretch'
    ? { label, text: `${payer} pays more than managers usually do for these players, though some have paid this much${detail}.` }
    : { label, text: `${payer} pays more than managers have paid for these players, even at the top of their range${detail}.` };
}
function marketAcceptHtml(r, sendTeam, getTeam, cls = 'mt-1.5', short = false) {
  const t = marketAcceptText(r, sendTeam, getTeam, short);
  if (!t) return '';
  const tone = r.level === 'acceptable' ? 'text-emerald-300' : r.level === 'stretch' ? 'text-amber-300' : 'text-orange-300';
  const tip = r.basis === 'market'
    ? 'Not the grade: whether this trade fits what managers have paid for these players in completed trades like this one over the last 45 days (the middle half of their prices for Acceptable, the 10th to 90th percentile for A stretch). A trade can be unfair and still get accepted.'
    : 'Not the grade: how often accepted trades like this one are at least this lopsided on trade value. A trade can be unfair and still get accepted.';
  return `<div class="text-[12px] text-zinc-400 ${cls}" title="${tip}"><span class="${tone} font-medium">${t.label}</span> <span class="text-zinc-500">·</span> ${t.text}</div>`;
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
  return `${Vault.escapeHtml(m.a.name)} trades about ${Math.abs(Math.round(m.adj))}% ${m.adj > 0 ? 'above' : 'below'} ${m.a.type === 'pick' ? 'its' : 'his'} KTC value`;
}

/* ---------- How often a player changes hands ----------
   Completed trades he was part of (either side, any role) over the last
   LIQ_DAYS days of the market data, next to the median of the LIQ_PEERS
   players at his position closest to his KTC value. `universe` is every player the page
   prices ({ name, pos, value }), so players nobody traded count as 0. KTC's
   feed (its last few days) is denser than the Sleeper crawl before it, but
   every player gets the same mix, so the comparison holds. Moves often: 1.5x
   his peers' count or more; harder to move: two-thirds of it or less. Not
   for picks: they're tracked by year and round, every tier together. It's
   how often, not how easily: stars change hands less than players near their
   value because their owners rarely sell, not because nobody's buying. */
const LIQ_DAYS = 30, LIQ_PEERS = 10;
let liqCounts = null;
function marketTradeCounts() {
  if (liqCounts) return liqCounts;
  const d = Market.data;
  if (!d || d.failed) return null;
  let last = '';
  d.byPlayer.forEach(ts => ts.forEach(t => { if (t.date > last) last = t.date; }));
  const from = new Date(new Date(last) - (LIQ_DAYS - 1) * 864e5).toISOString().slice(0, 10);
  liqCounts = { from, to: last, counts: new Map() };
  d.byPlayer.forEach((ts, k) => liqCounts.counts.set(k, ts.filter(t => t.date >= from).length));
  return liqCounts;
}
// { n, typical, label: 'often' | 'average' | 'rarely' | null, days } for one player, or null before the market loads.
function marketLiquidity(name, pos, value, universe) {
  const c = marketTradeCounts();
  if (!c || !(value > 0) || pos === 'Pick') return null;
  const key = marketKeyOf(name), n = c.counts.get(key) || 0;
  const peers = universe.filter(p => p.pos === pos && p.value > 0 && marketKeyOf(p.name) !== key)
    .sort((x, y) => Math.abs(Math.log(x.value / value)) - Math.abs(Math.log(y.value / value))).slice(0, LIQ_PEERS)
    .map(p => c.counts.get(marketKeyOf(p.name)) || 0).sort((x, y) => x - y);
  if (peers.length < LIQ_PEERS) return { n, typical: null, label: null, days: LIQ_DAYS };
  const typical = peers[Math.floor((peers.length - 1) / 2)];
  const label = typical === 0 ? (n >= 3 ? 'often' : null) : n >= typical * 1.5 ? 'often' : n <= typical / 1.5 ? 'rarely' : 'average';
  return { n, typical, label, days: LIQ_DAYS };
}
// One plain line for a player card or lookup ('' when there's nothing to say).
function marketLiquidityText(l, pos) {
  if (!l) return '';
  const plural = `the ${LIQ_PEERS} ${pos}s closest to his value`;
  const head = { often: 'Changes hands often', average: 'Changes hands about as often as most', rarely: 'Changes hands less often' }[l.label];
  const count = `in ${l.n} completed trade${l.n === 1 ? '' : 's'} from the last ${l.days} days`;
  if (!head) return `He was ${count}.`;
  return `<span class="text-zinc-200">${head}:</span> he was ${count}; ${plural} were typically in ${l.typical}.`;
}

/* ---------- Market trend line (player card, Player Market, Compare) ----------
   A smooth read through the day-by-day market points (data/market-history/
   daily-<sf|oneQB>.json, [daysSinceFrom, pct, trades]): for each date, the
   median paid over KTC in the TREND_DAYS days ending that day, weighted by
   trades, when there are at least TREND_MIN of them. Returns Map(date -> pct);
   multiply a day's KTC value by (1 + pct / 100) for the line. */
const TREND_DAYS = 30, TREND_MIN = 5;
function marketTrend(daily, key, dates) {
  const pts = daily?.players?.[key];
  const out = new Map();
  if (!pts || !pts.length || !daily.from) return out;
  const start = new Date(daily.from + 'T00:00:00Z').getTime();
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  let lo = 0, hi = 0;
  dates.forEach(date => {
    const day = Math.round((new Date(date + 'T00:00:00Z').getTime() - start) / 864e5);
    while (hi < sorted.length && sorted[hi][0] <= day) hi++;
    while (lo < hi && sorted[lo][0] <= day - TREND_DAYS) lo++;
    const win = sorted.slice(lo, hi), total = win.reduce((t, p) => t + p[2], 0);
    if (total < TREND_MIN) return;
    const byPct = [...win].sort((a, b) => a[1] - b[1]);
    let seen = 0;
    for (const p of byPct) { seen += p[2]; if (seen >= total / 2) { out.set(date, p[1]); break; } }
  });
  return out;
}

/* ---------- Who pays up, by position (Managers, Trade Coach's Sell high) ----------
   For every completed trade in a league (Vault.fetchAndGradeAllTrades), how
   much each manager paid over market for what they got: their side's %
   behind at market prices (marketEdge on today's values, consolidation
   held; + = paid more than it's worth), filed under the position of the best
   piece they got ('Pick' for picks). Map(rosterId -> { pos: { n, avg } }).
   Today's market read applied to every trade, not the market on its day. */
function marketOverpay(league, allGraded) {
  const out = new Map();
  const top = list => list.reduce((m, a) => (a.value > m.value ? a : m));
  const posOf = a => (a.type === 'pick' ? 'Pick' : a.pos);
  (allGraded || []).forEach(g => {
    if (!g.toAToday?.length || !g.toBToday?.length) return;
    const aEdge = marketEdge(league, g.toBToday, g.toAToday).market; // + = team A came out ahead at market
    [[g.teamA.rosterId, g.toAToday, -aEdge], [g.teamB.rosterId, g.toBToday, aEdge]].forEach(([id, got, paid]) => {
      const pos = posOf(top(got)), row = out.get(id) || out.set(id, {}).get(id), cell = (row[pos] ||= { n: 0, sum: 0 });
      cell.n++; cell.sum += paid; cell.avg = cell.sum / cell.n;
    });
  });
  return out;
}

/* ---------- Market points for charts ----------
   data/market-history/daily-<sf|oneQB>.json holds the last ~400 days day by
   day; monthly-<sf|oneQB>.json holds everything older by month (so the daily
   file stays small as the history grows). Merged here into the daily file's
   shape, { from, players: { key: [[daysSinceFrom, pct, trades]] } }, each
   month placed on its 15th. Loaded once per page. */
const marketDailyCache = new Map();
function fetchMarketDaily(qbs, { history = true } = {}) {
  const qb = qbs === 2 ? 'sf' : 'oneQB', cacheKey = qb + (history ? '+' : '');
  if (!marketDailyCache.has(cacheKey)) marketDailyCache.set(cacheKey, (async () => {
    const load = f => fetch(`data/market-history/${f}-${qb}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const [daily, monthly] = await Promise.all([load('daily'), history ? load('monthly') : null]);
    if (!daily?.from) return null;
    const monthKeys = Object.values(monthly?.players || {}).flat().map(m => m[0]).sort();
    if (!monthKeys.length) return daily;
    const from = `${monthKeys[0]}-15` < daily.from ? `${monthKeys[0]}-15` : daily.from;
    const off = d => Math.round((new Date(d + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 864e5);
    const shift = off(daily.from), players = {};
    Object.entries(monthly.players).forEach(([k, pts]) => { players[k] = pts.map(([m, pct, n]) => [off(`${m}-15`), pct, n]); });
    Object.entries(daily.players || {}).forEach(([k, pts]) => { players[k] = [...(players[k] || []), ...pts.map(([d, pct, n]) => [d + shift, pct, n])]; });
    return { from, players };
  })());
  return marketDailyCache.get(cacheKey);
}
