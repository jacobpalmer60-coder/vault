/* ============================================================
   REAL TRADES LIKE THIS (Trade Calculator)
   What real managers paid for the trade's headline player, from two sources
   that never overlap: KTC's trade database (data/ktc-trades.json, its last
   few days, priced at today's KTC values for this league's format) and, for
   the ~90 days before that, real trades from Sleeper dynasty leagues
   (data/market-history/recent-<sf|oneQB>.json, each priced at KTC values from
   its own day in its own league's format). Only trades in this league's QB
   format (1QB or Superflex) where every piece has a price, with the same
   consolidation math as the grade. Players are matched across the two by
   name (Vault.normalizeName), the way the site matches KTC to Sleeper. "Paid over KTC" is from the side that GOT the player:
   what they sent, minus what they got, as a % of the two sides' average.

   Closest comparison with enough trades wins: the same shape (him alone for
   2 pieces, etc.); else the same direction (the team getting him sent more
   pieces, fewer, or the same number), since the market pays a lot more to
   consolidate than to split, with him as the main piece; else any trade where
   he was the main piece. Within each, leagues most like this one first
   (Vault.tradeFormatTiers: exact settings, then any team count, then QB
   format and TE premium, then QB format alone). Shape comes first because
   it moves the price far more than team count or scoring. A 7-for-6 where he was the fourth-best piece says
   little about his price. Informational only: the grade stays KTC-matched.

   Uses the Trade Calculator's globals: league, teamOf.
   ============================================================ */
const MARKET_MIN_COMPS = 5;     // fewer real trades than this and we say nothing
const MARKET_MIN_NARROW = 10;   // a closer league match needs at least this many, or the broader one is steadier
const MARKET_STRIP_RANGE = 60;  // the strip runs from 60% under to 60% over KTC
const Market = { data: null, loading: null };

function marketLoad() {
  if (Market.loading) return Market.loading;
  const isSF = (league.roster_positions || []).includes('SUPER_FLEX');
  const field = (isSF ? 'sf' : 'oneQB') + Vault.ktcTepSuffix(league.scoring_settings?.bonus_rec_te);
  const qbs = Vault.tradeFormatSig(league).qbs; // same QB read as the trade matching (2QB leagues count as Superflex)
  const recentFile = `data/market-history/recent-${qbs === 2 ? 'sf' : 'oneQB'}.json`;
  Market.loading = Promise.all([fetch('data/ktc-trades.json').then(r => r.json()), Vault.fetchKtcValues(), fetch(recentFile).then(r => (r.ok ? r.json() : null)).catch(() => null)]).then(([db, ktc, recent]) => {
    const byId = new Map();
    (ktc.players || []).forEach(p => {
      if (p.ktcId == null || !(p[field] > 0)) return;
      byId.set(String(p.ktcId), { type: 'player', name: p.name, pos: p.pos, value: p[field] });
    });
    (ktc.picks || []).forEach(p => {
      if (p.ktcId == null || !(p[field] > 0)) return;
      byId.set(String(p.ktcId), { type: 'pick', name: `${p.season} R${p.round}`, tier: p.slot, value: p[field] });
    });
    // Each trade keyed by its pieces: players by name ('n:' + normalized), picks by id.
    const byPlayer = new Map();
    let first = '9999', last = '';
    const add = (date, s1, s2, fmt) => {
      const key = a => (a.type === 'player' ? 'n:' + Vault.normalizeName(a.name) : a.id);
      const trade = { date, k1: s1.map(key), k2: s2.map(key), s1, s2, fmt };
      if (date < first) first = date; if (date > last) last = date;
      [...trade.k1, ...trade.k2].forEach(k => { if (k.startsWith('n:')) (byPlayer.get(k) || byPlayer.set(k, []).get(k)).push(trade); });
    };
    let ktcFrom = '9999';
    (db.trades || []).forEach(t => {
      if (t.qbs !== qbs || !t.t1.length || !t.t2.length) return;
      const s1 = t.t1.map(id => byId.get(id) && { ...byId.get(id), id }), s2 = t.t2.map(id => byId.get(id) && { ...byId.get(id), id });
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
        if (id[0] === 'p') { const [season, round] = id.slice(1).split('-'); return { type: 'pick', id, name: `${season} R${round}`, value }; }
        const [name, pos] = recent.names[id] || [];
        return { type: 'player', id, name: name || 'Unknown player', pos, value };
      });
      add(date, side(a), side(b), f ? { teams: f[2], qbs, ppr: Vault.ktcPprCode(f[0]), tep: Vault.ktcTepCode(f[1]) } : { qbs });
      sleeperCount++;
    });
    const days = last >= first ? Math.round((new Date(last) - new Date(first)) / 864e5) + 1 : 0;
    Market.data = { byPlayer, isSF, days, sleeperCount };
    return Market.data;
  }).catch(e => { console.warn('Real trades unavailable', e); Market.data = { failed: true }; return Market.data; });
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

// The read for one trade: the headline player (the most valuable player in it
// with enough real trades), what the market paid for him, and where this trade sits.
function marketRead(aAssets, bAssets) {
  const d = Market.data;
  if (!d || d.failed) return null;
  const players = [...aAssets, ...bAssets].filter(a => a.type === 'player').sort((x, y) => y.value - x.value).slice(0, 2);
  const formats = Vault.tradeFormatTiers(Vault.tradeFormatSig(league)); // this league's settings, narrowest first
  for (const p of players) {
    const id = 'n:' + Vault.normalizeName(p.name);
    const all = d.byPlayer.get(id);
    if (!all || all.length < MARKET_MIN_COMPS) continue;
    const youGet = bAssets.includes(p);
    const pSide = youGet ? bAssets : aAssets, oSide = youGet ? aAssets : bAssets;
    const shape = `${marketShape(pSide.length)}-${marketShape(oSide.length)}`;
    const dir = Math.sign(oSide.length - pSide.length); // 1: the team getting him sends more pieces
    const comps = all.map(t => {
      const inOne = t.k1.includes(id);
      const ps = inOne ? t.s1 : t.s2, os = inOne ? t.s2 : t.s1;
      const him = ps[(inOne ? t.k1 : t.k2).indexOf(id)];
      return { t, ps, os, paid: marketPaid(ps, os), shape: `${marketShape(ps.length)}-${marketShape(os.length)}`,
        dir: Math.sign(os.length - ps.length), main: ps.every(a => a.value <= him.value), raw: os.reduce((s, a) => s + a.value, 0) };
    });
    const pieces = n => n >= 3 ? '3 or more pieces' : `${n} piece${n === 1 ? '' : 's'}`;
    // Finishes "N trades had {name}…".
    const exact = pSide.length === 1 && oSide.length === 1 ? ' in a 1-for-1, like this one'
      : ` ${pSide.length === 1 ? 'alone' : pSide.length >= 3 ? 'plus 2 or more' : 'plus 1 more'} for ${pieces(oSide.length)}, like this one`;
    const shapes = [
      [c => c.shape === shape, exact],
      [c => c.main && c.dir === dir, ` as the main piece, ${dir > 0 ? 'for more pieces back' : dir < 0 ? 'for fewer pieces back' : 'with the same number of pieces each way'}`],
      [c => c.main, ' as the main piece']
    ];
    let pool = null, qual = '', like = '';
    for (const [f, q] of shapes) {
      for (const [i, tier] of formats.entries()) {
        const hit = comps.filter(c => f(c) && tier.match(c.t.fmt));
        if (hit.length >= (i === formats.length - 1 ? MARKET_MIN_COMPS : MARKET_MIN_NARROW)) { pool = hit; qual = q; like = tier.label; break; }
      }
      if (pool) break;
    }
    if (!pool) continue;
    const sorted = pool.map(c => c.paid).sort((x, y) => x - y);
    const ours = marketPaid(pSide, oSide);
    const ourRaw = oSide.reduce((s, a) => s + a.value, 0) || 1;
    // The real trades most like this one: closest return in size, the same
    // trade made more than once shown once with a count.
    const seen = new Map();
    [...pool].sort((x, y) => Math.abs(x.raw - ourRaw) - Math.abs(y.raw - ourRaw)).forEach(c => {
      const key = [c.t.k1.slice().sort().join(','), c.t.k2.slice().sort().join(',')].sort().join('|');
      if (seen.has(key)) seen.get(key).times++; else seen.set(key, { ...c, times: 1 });
    });
    const examples = [...seen.values()].slice(0, 3);
    return { player: p, youGet, pSide, oSide, qual, like, n: pool.length, sorted, ours, examples,
      low: marketQuantile(sorted, 0.25), med: marketQuantile(sorted, 0.5), high: marketQuantile(sorted, 0.75), days: spanDays(pool.map(c => c.t.date)), isSF: d.isSF, sleeper: d.sleeperCount > 0 };
  }
  return null;
}

const marketPct = v => `${Math.abs(Math.round(v))}%`;
const marketSigned = v => Math.round(v) === 0 ? 'right at KTC value' : `${marketPct(v)} ${v > 0 ? 'over' : 'under'} KTC`;
function marketRange(lo, hi) {
  const r = v => Math.round(v);
  if (r(lo) === r(hi)) return marketSigned(lo);
  if (r(lo) >= 0) return `${r(lo)}–${r(hi)}% over KTC`;
  if (r(hi) <= 0) return `${-r(hi)}–${-r(lo)}% under KTC`;
  return `${marketPct(lo)} under to ${marketPct(hi)} over KTC`;
}

let marketToken = 0;
function renderMarketRead(aAssets, bAssets) {
  const box = document.getElementById('marketRead');
  if (!box) return;
  const token = ++marketToken;
  if (!aAssets.length || !bAssets.length) { box.innerHTML = ''; return; }
  if (!Market.data) {
    box.innerHTML = '';
    marketLoad().then(() => { if (token === marketToken) renderMarketRead(aAssets, bAssets); });
    return;
  }
  const m = marketRead(aAssets, bAssets);
  if (!m) { box.innerHTML = ''; return; }
  const name = Vault.escapeHtml(m.player.name);
  const payer = m.youGet ? 'you' : 'they';
  // Where this trade's price sits against the middle half of real trades,
  // read from your side: paying less than most (you're getting him) or being
  // paid more than most (you're sending him) is the good end.
  const where = m.ours < m.low ? 'below' : m.ours > m.high ? 'above' : 'within';
  const goodForYou = (where === 'below' && m.youGet) || (where === 'above' && !m.youGet);
  const verdict = where === 'within' ? { text: 'about what the market pays', cls: 'text-zinc-200' }
    : goodForYou ? { text: m.youGet ? 'less than most pay' : 'more than most get for him', cls: 'text-emerald-300' }
    : { text: m.youGet ? 'more than most pay' : 'less than most get for him', cls: 'text-amber-300' };
  // The strip: every real trade's price as a dot, the middle half shaded, this trade marked.
  const x = v => ((Math.max(-MARKET_STRIP_RANGE, Math.min(MARKET_STRIP_RANGE, v)) + MARKET_STRIP_RANGE) / (2 * MARKET_STRIP_RANGE) * 100).toFixed(2);
  const strip = `<div class="relative h-9 mt-1" role="img" aria-label="${m.n} real trades from ${marketSigned(m.sorted[0])} to ${marketSigned(m.sorted[m.sorted.length - 1])}; this trade: ${marketSigned(m.ours)}">
      <div class="absolute inset-x-0 top-4 h-px bg-white/10"></div>
      <div class="absolute top-[13px] h-[7px] rounded-full bg-white/10" style="left:${x(m.low)}%;width:${Math.max(0.5, x(m.high) - x(m.low))}%"></div>
      <div class="absolute top-2.5 h-3.5 w-px bg-zinc-500" style="left:50%"></div>
      ${m.sorted.map(v => `<span class="absolute top-[14px] size-[5px] -ml-[2.5px] rounded-full bg-zinc-300/50" style="left:${x(v)}%"></span>`).join('')}
      <span class="absolute top-[9px] size-[15px] -ml-[7.5px] rounded-full bg-amber-400 ring-2 ring-black/60" style="left:${x(m.ours)}%" title="This trade: ${marketSigned(m.ours)}"></span>
      <div class="absolute inset-x-0 bottom-0 flex justify-between text-[10px] text-zinc-500 leading-none"><span>Paid under KTC</span><span>KTC value</span><span>Paid over KTC</span></div>
    </div>`;
  const chip = a => `${Vault.escapeHtml(a.name)}${a.type === 'pick' && a.tier ? ` <span class="text-zinc-500">(${a.tier})</span>` : ''}`;
  const day = s => new Date(String(s).slice(0, 10) + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const examples = m.examples.map(c => `<div class="flex items-baseline justify-between gap-3 py-1.5 border-t border-white/5 first:border-t-0">
      <span class="min-w-0 text-zinc-300"><span class="text-zinc-100">${c.ps.map(chip).join(', ')}</span> <span class="text-zinc-500">for</span> ${c.os.map(chip).join(', ')}</span>
      <span class="shrink-0 mono text-[11px] text-zinc-400" title="${day(c.t.date)}">${c.times > 1 ? `<span class="text-zinc-500">×${c.times}</span> ` : ''}${marketSigned(c.paid)}</span>
    </div>`).join('');
  box.innerHTML = `<details class="group rounded-xl border border-white/5 bg-black/20">
      <summary class="list-none [&::-webkit-details-marker]:hidden cursor-pointer px-3 py-2.5 text-[12px] leading-relaxed text-zinc-400 hover:text-zinc-300">
        <span class="text-[11px] uppercase tracking-wider text-zinc-500 mr-1">Real trades</span>
        ${m.n} trades from leagues like yours (${m.like}) in the last ${m.days} day${m.days === 1 ? '' : 's'} had ${name}${m.qual}. The team getting him usually paid ${marketRange(m.low, m.high)}.
        Here ${payer} pay ${marketSigned(m.ours)}: <span class="font-medium ${verdict.cls}">${verdict.text}</span>.
        <span class="text-amber-300/80 whitespace-nowrap"><span class="group-open:hidden">See them ▾</span><span class="hidden group-open:inline">Hide ▴</span></span>
      </summary>
      <div class="px-3 pb-3 text-[12px]">
        ${strip}
        <div class="text-[11px] uppercase tracking-wider text-zinc-500 mt-3 mb-0.5">Most like this one</div>
        ${examples}
        <div class="text-[11px] text-zinc-500 mt-2">${m.sleeper ? "From KTC's trade database (priced at today's KTC values for your league) and, before that, Sleeper dynasty leagues (priced at KTC values from each trade's day)" : "From KTC's trade database, priced at today's KTC values for your league"}. The grade above doesn't use these.</div>
      </div>
    </details>`;
}
