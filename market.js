/* ============================================================
   REAL TRADES LIKE THIS (Trade Calculator)
   What managers paid for the trade's headline player, from two sources
   that never overlap: KTC's trade database (data/ktc-trades.json, its last
   few days, priced at today's KTC values for this league's format) and, for
   the ~40 days before that (45 in all), completed trades from Sleeper dynasty leagues
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

   Uses market-data.js (the trades) and the Trade Calculator's globals: league, teamOf.
   ============================================================ */
const MARKET_STRIP_RANGE = 60;  // the strip runs from 60% under to 60% over KTC

// The read for one trade: the headline player (the most valuable player in it
// with enough completed trades), what the market paid for him, and where this trade sits.
function marketRead(aAssets, bAssets) {
  const d = Market.data;
  if (!d || d.failed) return null;
  const players = [...aAssets, ...bAssets].filter(a => a.type === 'player').sort((x, y) => y.value - x.value).slice(0, 2);
  for (const p of players) {
    const youGet = bAssets.includes(p);
    const pSide = youGet ? bAssets : aAssets, oSide = youGet ? aAssets : bAssets;
    // The same trades the acceptable read uses (marketPiecePool), so both quote one range.
    const hit = marketPiecePool(league, p, pSide, oSide);
    if (!hit) continue;
    const { pool, like, dir } = hit;
    const pieces = n => n >= 3 ? '3 or more pieces' : `${n} piece${n === 1 ? '' : 's'}`;
    // Finishes "N trades had {name}…".
    const qual = hit.level === 0 ? (pSide.length === 1 && oSide.length === 1 ? ' in a 1-for-1, like this one'
      : ` ${pSide.length === 1 ? 'alone' : pSide.length >= 3 ? 'plus 2 or more' : 'plus 1 more'} for ${pieces(oSide.length)}, like this one`)
      : hit.level === 1 ? ` as the main piece, ${dir > 0 ? 'for more pieces back' : dir < 0 ? 'for fewer pieces back' : 'with the same number of pieces each way'}`
      : ' as the main piece';
    const sorted = pool.map(c => c.paid).sort((x, y) => x - y);
    const ours = marketPaid(pSide, oSide);
    const ourRaw = oSide.reduce((s, a) => s + a.value, 0) || 1;
    // The completed trades most like this one: closest return in size, the same
    // trade made more than once shown once with a count.
    // Same piece counts first, then closest return in size; trades of 6+ pieces a
    // side or 50%+ off KTC aren't shown as "like this one" (a 6-for-6 at 116% under
    // came up as most like a 1-for-2; 2026-10-09).
    const seen = new Map();
    const shapeGap = c => Math.abs(c.ps.length - pSide.length) + Math.abs(c.os.length - oSide.length);
    [...pool].filter(c => c.ps.length <= 5 && c.os.length <= 5 && Math.abs(c.paid) < 50)
      .sort((x, y) => shapeGap(x) - shapeGap(y) || Math.abs(x.raw - ourRaw) - Math.abs(y.raw - ourRaw)).forEach(c => {
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
    // Once loaded, redraw the whole card: the acceptable read uses market prices too.
    marketLoad(league).then(() => { if (token === marketToken) { if (typeof updateTrade === 'function') updateTrade(); else renderMarketRead(aAssets, bAssets); } });
    return;
  }
  // At market prices: every player at what he goes for in completed trades
  // (market-data.js), the whole trade measured the way the grade measures value.
  // Shown when that moves the trade at least 2 points from KTC; never the grade.
  const mk = marketEdge(league, aAssets, bAssets);
  // The market price is in the verdict above; this names who moves it away from KTC.
  const check = mk.movers.length && Math.abs(mk.delta) >= 2 ? `<div class="mt-2 text-[12px] leading-relaxed text-zinc-400"><span class="text-zinc-500">Market vs KTC:</span> ${mk.movers.slice(0, 2).map(marketMoverText).join(', and ')}. Trade value, the grade, uses these prices.</div>` : '';
  const m = marketRead(aAssets, bAssets);
  if (!m) { box.innerHTML = check; return; }
  const name = Vault.escapeHtml(m.player.name);
  const payer = Vault.escapeHtml((m.youGet ? teamOf('A') : teamOf('B'))?.teamName || (m.youGet ? 'you' : 'they'));
  // Where this trade's price sits against the middle half of completed trades,
  // read from your side: paying less than most (you're getting him) or being
  // paid more than most (you're sending him) is the good end.
  const where = m.ours < m.low ? 'below' : m.ours > m.high ? 'above' : 'within';
  const goodForYou = (where === 'below' && m.youGet) || (where === 'above' && !m.youGet);
  const verdict = where === 'within' ? { text: 'about what the market pays', cls: 'text-zinc-200' }
    : { text: where === 'below' ? 'less than most pay for him' : 'more than most pay for him', cls: goodForYou ? 'text-emerald-300' : 'text-orange-300' };
  // The strip: every real trade's price as a dot, the middle half shaded, this trade marked.
  const x = v => ((Math.max(-MARKET_STRIP_RANGE, Math.min(MARKET_STRIP_RANGE, v)) + MARKET_STRIP_RANGE) / (2 * MARKET_STRIP_RANGE) * 100).toFixed(2);
  const strip = `<div class="relative h-9 mt-1" role="img" aria-label="${m.n} completed trades from ${marketSigned(m.sorted[0])} to ${marketSigned(m.sorted[m.sorted.length - 1])}; this trade: ${marketSigned(m.ours)}">
      <div class="absolute inset-x-0 top-4 h-px bg-white/10"></div>
      <div class="absolute top-[13px] h-[7px] rounded-full bg-white/10" style="left:${x(m.low)}%;width:${Math.max(0.5, x(m.high) - x(m.low))}%"></div>
      <div class="absolute top-2.5 h-3.5 w-px bg-zinc-500" style="left:50%"></div>
      ${m.sorted.map(v => `<span class="absolute top-[14px] size-[5px] -ml-[2.5px] rounded-full bg-zinc-300/50" style="left:${x(v)}%"></span>`).join('')}
      <span class="absolute top-[9px] size-[15px] -ml-[7.5px] rounded-full bg-zinc-100 ring-2 ring-black/60" style="left:${x(m.ours)}%" title="This trade: ${marketSigned(m.ours)}"></span>
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
        <span class="text-[11px] uppercase tracking-wider text-zinc-500 mr-1">The market</span>
        ${m.n} trades from leagues like yours (${m.like}) in the last ${m.days} day${m.days === 1 ? '' : 's'} had ${name}${m.qual}. The team getting him usually paid ${marketRange(m.low, m.high)}.
        Here ${payer} pays ${marketSigned(m.ours)}: <span class="font-medium ${verdict.cls}">${verdict.text}</span>.
        <span class="text-zinc-300 whitespace-nowrap"><span class="group-open:hidden">See them ▾</span><span class="hidden group-open:inline">Hide ▴</span></span>
      </summary>
      <div class="px-3 pb-3 text-[12px]">
        ${strip}
        <div class="text-[11px] uppercase tracking-wider text-zinc-500 mt-3 mb-0.5">Most like this one</div>
        ${examples}
        <div class="text-[11px] text-zinc-500 mt-2">${m.sleeper ? "From KTC's trade database (priced at today's KTC values, in each trade's own format) and, before that, Sleeper dynasty leagues (priced at KTC values from each trade's day)" : "From KTC's trade database, priced at today's KTC values in each trade's own format"}. Over and under KTC here count extra pieces and the best piece the way trade value does, on KTC's numbers, so they differ from KTC's calculator. Trade value, the grade, then prices each player at what he goes for in trades like these.</div>
      </div>
    </details>${check}`;
}
