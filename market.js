/* ============================================================
   REAL TRADES LIKE THIS (Trade Calculator)
   What real managers paid for the trade's headline player, from KTC's trade
   database (data/ktc-trades.json, the last few days of real dynasty trades,
   refreshed daily). Only trades in this league's QB format (1QB or
   Superflex), and only ones where every piece has a KTC price, all priced at
   today's KTC values for this league's format, with the same consolidation
   math as the grade. "Paid over KTC" is from the side that GOT the player:
   what they sent, minus what they got, as a % of the two sides' average.

   Closest comparison with enough trades wins: the same shape (him alone for
   2 pieces, etc.); else the same direction (the team getting him sent more
   pieces, fewer, or the same number), since the market pays a lot more to
   consolidate than to split, with him as the main piece; else any trade where
   he was the main piece. A 7-for-6 where he was the fourth-best piece says
   little about his price. Informational only: the grade stays KTC-matched.

   Uses the Trade Calculator's globals: league, teamOf.
   ============================================================ */
const MARKET_MIN_COMPS = 5;     // fewer real trades than this and we say nothing
const MARKET_STRIP_RANGE = 60;  // the strip runs from 60% under to 60% over KTC
const Market = { data: null, loading: null };

function marketLoad() {
  if (Market.loading) return Market.loading;
  const isSF = (league.roster_positions || []).includes('SUPER_FLEX');
  const field = (isSF ? 'sf' : 'oneQB') + Vault.ktcTepSuffix(league.scoring_settings?.bonus_rec_te);
  Market.loading = Promise.all([fetch('data/ktc-trades.json').then(r => r.json()), Vault.fetchKtcValues()]).then(([db, ktc]) => {
    const byId = new Map(), idOfName = new Map();
    (ktc.players || []).forEach(p => {
      if (p.ktcId == null || !(p[field] > 0)) return;
      byId.set(String(p.ktcId), { type: 'player', name: p.name, pos: p.pos, value: p[field] });
      idOfName.set(Vault.normalizeName(p.name), String(p.ktcId));
    });
    (ktc.picks || []).forEach(p => {
      if (p.ktcId == null || !(p[field] > 0)) return;
      byId.set(String(p.ktcId), { type: 'pick', name: `${p.season} R${p.round}`, tier: p.slot, value: p[field] });
    });
    const qbs = isSF ? 2 : 1, byPlayer = new Map();
    let first = Infinity, last = 0;
    (db.trades || []).forEach(t => {
      if (t.qbs !== qbs || !t.t1.length || !t.t2.length) return;
      const s1 = t.t1.map(id => byId.get(id)), s2 = t.t2.map(id => byId.get(id));
      if (s1.some(x => !x) || s2.some(x => !x)) return; // a piece KTC no longer prices
      const trade = { date: t.date, t1: t.t1, t2: t.t2, s1, s2 };
      const time = new Date(t.date).getTime();
      first = Math.min(first, time); last = Math.max(last, time);
      [...t.t1, ...t.t2].forEach(id => { if (byId.get(id).type === 'player') (byPlayer.get(id) || byPlayer.set(id, []).get(id)).push(trade); });
    });
    const days = last >= first ? Math.round((last - first) / 864e5) + 1 : 0;
    Market.data = { byPlayer, idOfName, isSF, days };
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
const marketQuantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

// The read for one trade: the headline player (the most valuable player in it
// with enough real trades), what the market paid for him, and where this trade sits.
function marketRead(aAssets, bAssets) {
  const d = Market.data;
  if (!d || d.failed) return null;
  const players = [...aAssets, ...bAssets].filter(a => a.type === 'player').sort((x, y) => y.value - x.value).slice(0, 2);
  for (const p of players) {
    const id = d.idOfName.get(Vault.normalizeName(p.name));
    const all = id && d.byPlayer.get(id);
    if (!all || all.length < MARKET_MIN_COMPS) continue;
    const youGet = bAssets.includes(p);
    const pSide = youGet ? bAssets : aAssets, oSide = youGet ? aAssets : bAssets;
    const shape = `${marketShape(pSide.length)}-${marketShape(oSide.length)}`;
    const dir = Math.sign(oSide.length - pSide.length); // 1: the team getting him sends more pieces
    const comps = all.map(t => {
      const inOne = t.t1.includes(id);
      const ps = inOne ? t.s1 : t.s2, os = inOne ? t.s2 : t.s1;
      const him = ps[(inOne ? t.t1 : t.t2).indexOf(id)];
      return { t, ps, os, paid: marketPaid(ps, os), shape: `${marketShape(ps.length)}-${marketShape(os.length)}`,
        dir: Math.sign(os.length - ps.length), main: ps.every(a => a.value <= him.value), raw: os.reduce((s, a) => s + a.value, 0) };
    });
    const pieces = n => n >= 3 ? '3 or more pieces' : `${n} piece${n === 1 ? '' : 's'}`;
    // Finishes "N trades had {name}…".
    const exact = pSide.length === 1 && oSide.length === 1 ? ' in a 1-for-1, like this one'
      : ` ${pSide.length === 1 ? 'alone' : pSide.length >= 3 ? 'plus 2 or more' : 'plus 1 more'} for ${pieces(oSide.length)}, like this one`;
    const tiers = [
      [c => c.shape === shape, exact],
      [c => c.main && c.dir === dir, ` as the main piece, ${dir > 0 ? 'for more pieces back' : dir < 0 ? 'for fewer pieces back' : 'with the same number of pieces each way'}`],
      [c => c.main, ' as the main piece']
    ];
    const tier = tiers.find(([f]) => comps.filter(f).length >= MARKET_MIN_COMPS);
    if (!tier) continue;
    const pool = comps.filter(tier[0]), qual = tier[1];
    const sorted = pool.map(c => c.paid).sort((x, y) => x - y);
    const ours = marketPaid(pSide, oSide);
    const ourRaw = oSide.reduce((s, a) => s + a.value, 0) || 1;
    // The real trades most like this one: closest return in size, the same
    // trade made more than once shown once with a count.
    const seen = new Map();
    [...pool].sort((x, y) => Math.abs(x.raw - ourRaw) - Math.abs(y.raw - ourRaw)).forEach(c => {
      const key = [c.t.t1.slice().sort().join(','), c.t.t2.slice().sort().join(',')].sort().join('|');
      if (seen.has(key)) seen.get(key).times++; else seen.set(key, { ...c, times: 1 });
    });
    const examples = [...seen.values()].slice(0, 3);
    return { player: p, youGet, pSide, oSide, qual, n: pool.length, sorted, ours, examples,
      low: marketQuantile(sorted, 0.25), med: marketQuantile(sorted, 0.5), high: marketQuantile(sorted, 0.75), days: d.days, isSF: d.isSF };
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
  const fmt = m.isSF ? 'Superflex' : '1QB';
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
  const day = s => new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const examples = m.examples.map(c => `<div class="flex items-baseline justify-between gap-3 py-1.5 border-t border-white/5 first:border-t-0">
      <span class="min-w-0 text-zinc-300"><span class="text-zinc-100">${c.ps.map(chip).join(', ')}</span> <span class="text-zinc-500">for</span> ${c.os.map(chip).join(', ')}</span>
      <span class="shrink-0 mono text-[11px] text-zinc-400" title="${day(c.t.date)}">${c.times > 1 ? `<span class="text-zinc-500">×${c.times}</span> ` : ''}${marketSigned(c.paid)}</span>
    </div>`).join('');
  box.innerHTML = `<details class="group rounded-xl border border-white/5 bg-black/20">
      <summary class="list-none [&::-webkit-details-marker]:hidden cursor-pointer px-3 py-2.5 text-[12px] leading-relaxed text-zinc-400 hover:text-zinc-300">
        <span class="text-[11px] uppercase tracking-wider text-zinc-500 mr-1">Real trades</span>
        ${m.n} ${fmt} trades in the last ${m.days} day${m.days === 1 ? '' : 's'} had ${name}${m.qual}. The team getting him usually paid ${marketRange(m.low, m.high)}.
        Here ${payer} pay ${marketSigned(m.ours)}: <span class="font-medium ${verdict.cls}">${verdict.text}</span>.
        <span class="text-amber-300/80 whitespace-nowrap"><span class="group-open:hidden">See them ▾</span><span class="hidden group-open:inline">Hide ▴</span></span>
      </summary>
      <div class="px-3 pb-3 text-[12px]">
        ${strip}
        <div class="text-[11px] uppercase tracking-wider text-zinc-500 mt-3 mb-0.5">Most like this one</div>
        ${examples}
        <div class="text-[11px] text-zinc-500 mt-2">From KTC's trade database, priced at today's KTC values for your league. The grade above doesn't use these.</div>
      </div>
    </details>`;
}
