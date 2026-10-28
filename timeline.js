/* ============================================================
   CONTEND OR REBUILD? (user, 2026-10-20: "make it be toggle able. Every team
   should see why for all options. So a team can decide what they want to do.")
   Four paths for any team, each worked out on that team's real roster:
   - Push now: buy the player who adds the most to the best lineup from a team
     that's out of the race, paid for with picks first, then bench players.
   - Reload: swap each RB, WR and TE aged 27+ for a player 25 or under at the
     same position and about the same KTC value on another roster.
   - Rebuild: sell those same players for picks at their KTC value.
   - Stay the course: no trades.
   Every path is run through the same season simulation as League Overview and
   the Trade Calculator (Vault.simulateSeason, same seed), the same contention
   window (Vault.contentionWindow), and priced at KTC value (market prices from
   completed trades shown alongside, market-data.js). Evidence is from the
   1.34M crawled Sleeper trades (VaultValues: research-batch, coach-backtest,
   timeline-paths), aggregates only. The Season Report's luck and injury reads
   (season-report.js), when loaded, add context: a record that undersells the
   roster argues against selling.

   A section of the team view (Team Analyzer):
     Timeline.init({ league, slots, teams, remainingWeeks })  once per league
     Timeline.render(mount, team)                              per team shown
     Timeline.setSeason(report)                                Vault.seasonReport's result
   Requires vault-core.js; market-data.js (optional) adds market prices.
   ============================================================ */
(function () {
const $ = s => document.querySelector(s);
const esc = s => Vault.escapeHtml(s);
const n0 = v => Math.round(v).toLocaleString();
const pct = v => (v > 0 && v < 1 ? '<1' : v > 99 && v < 100 ? '>99' : Math.round(v)) + '%';
const SEED = 20260929, TRIALS = 4000; // the calculator's and League Overview's, so "Stay" matches their odds
const CLIFF_POS = new Set(['RB', 'WR', 'TE']), CLIFF_AGE = 27; // research batch: the age-27 cliff, both seasons
const SELL_FLOOR = 1000;     // a 27+ player worth less than this isn't worth a trade on its own
const YOUNG_MAX = 25;        // Reload's replacements
const OUT_PCT = 10;          // "out of the race": the coach backtest's under-10% sellers
const IN_PCT = 50;           // contending this season (contention window's first year)
const PATHS = [
  { key: 'push', label: 'Push now', short: 'Buy starters with picks and bench players.' },
  { key: 'reload', label: 'Reload', short: 'Swap aging starters for younger ones at the same price.' },
  { key: 'rebuild', label: 'Rebuild', short: 'Sell aging starters for picks.' },
  { key: 'stay', label: 'Stay the course', short: 'No trades.' }
];
let ctx = null;          // { league, slots, teams, remainingWeeks, inSeason }
const cache = new Map(); // rosterId -> worked-out paths
let shown = null, pathKey = null;
let seasonReport = null; // Vault.seasonReport's result (Timeline.setSeason)

/* ---------- Study numbers (aggregates only) ----------
   VaultValues out/timeline-paths.json (2026-10-20): teams followed into the next
   season in the same league, same owner; path read from the team's trades that
   season (net lineup points a week, ages, picks); 2024 seasons into 2025. */
const NEXT = {
  losing: { push: [43, 6, 9762], reload: [41, 5, 8923], rebuild: [32, 4, 33628], stay: [39, 5, 25746] },
  middle: { push: [60, 11, 24582], reload: [57, 9, 11925], rebuild: [47, 7, 15707], stay: [53, 8, 46098] },
  winning: { push: [72, 15, 34271], reload: [71, 15, 9527], rebuild: [64, 13, 6888], stay: [65, 12, 40179] }
};
const BAND_LABEL = { losing: 'a losing record (under 40% wins)', middle: 'a record in the middle (40-60% wins)', winning: 'a winning record (60%+ wins)' };
const PATH_PAST = { push: 'bought', reload: 'got younger at about the same points', rebuild: 'sold', stay: 'stood pat' };

/* ---------- Roster math ---------- */
const sum = (xs, f = x => x) => xs.reduce((s, x) => s + (f(x) || 0), 0);
const pk = p => `${p.season}-${p.round}-${p.original}`;
const ord = r => r + ({ 1: 'st', 2: 'nd', 3: 'rd' }[r] || 'th');
const pickName = p => `${p.season} ${ord(p.round)}`;
// A team with players and picks moved in or out: the same fields buildLeagueTeams
// and simulateTrade set, recomputed (lineup by week, value, age, picks).
function modTeam(team, { out = [], add = [], outPicks = [], addPicks = [] }) {
  const ids = new Set(out.map(p => p.id));
  const plist = [...team.plist.filter(p => !ids.has(p.id)), ...add];
  const total = sum(plist, p => p.value);
  const vAge = plist.filter(p => p.value > 0 && p.age > 0), sumV = sum(vAge, p => p.value);
  const age = sumV ? sum(vAge, p => p.value * p.age) / sumV : 0;
  const { total: opt, starters: lineup, byWeek: optByWeek } = Vault.seasonLineupDetail(plist, ctx.slots);
  const outKeys = new Set(outPicks.map(pk));
  const picks = [...team.picks.filter(p => !outKeys.has(pk(p))), ...addPicks];
  return { ...team, plist, total, age, opt, optByWeek, lineup, picks, picksValue: sum(picks, p => p.value) };
}
// Share of the team's player value in RBs, WRs and TEs aged 27+.
function cliffOf(team) {
  const list = team.plist.filter(p => CLIFF_POS.has(p.pos) && p.age >= CLIFF_AGE && p.value > 0).sort((a, b) => b.value - a.value);
  const v = sum(list, p => p.value);
  return { list, value: v, share: team.total ? v / team.total * 100 : 0 };
}
const inLineup = (team, p) => team.lineup.some(s => s.id === p.id);
const weekly = (bef, aft) => {
  const dep = Vault.depthShift('contend', bef, aft, ctx.slots).perWeek, line = aft.opt - bef.opt;
  if (!bef.optByWeek || !aft.optByWeek) return line + dep;
  return { flat: dep, avg: line, byWeek: new Map([...aft.optByWeek].map(([w, v]) => [w, v - (bef.optByWeek.get(w) ?? v)])) };
};
const ptsOf = (bef, aft) => aft.opt - bef.opt + Vault.depthShift('contend', bef, aft, ctx.slots).perWeek;
// The season re-run with these teams changed (same seed as the calculator).
function seasonWith(changed) {
  if (!ctx.inSeason) return null;
  const deltas = new Map(changed.map(([bef, aft]) => [bef.rosterId, weekly(bef, aft)]));
  return Vault.simulateSeason(ctx.teams, ctx.league, ctx.remainingWeeks, { trials: TRIALS, seed: SEED, strengthDelta: deltas });
}
// Contention window with this team swapped in, and where each year ranks in the league.
function windowOf(team) {
  const pool = ctx.teams.map(t => (t.rosterId === team.rosterId ? team : t));
  const win = Vault.contentionWindow(team, pool);
  const rankAt = y => 1 + ctx.teams.filter(t => t.rosterId !== team.rosterId && ctx.base.get(t.rosterId).proj[y] > win.proj[y]).length;
  return { ...win, rankAt };
}
const isOut = t => (ctx.inSeason ? t.playoffPct != null && t.playoffPct < OUT_PCT : Vault.teamMode(t) === 'rebuild');
const isContender = t => (ctx.inSeason ? t.playoffPct != null && t.playoffPct >= IN_PCT : Vault.teamMode(t) === 'contend');
// Market price (completed trades) against KTC value, once market-data has loaded.
const marketPct = p => (typeof marketPlayer === 'function' && Market.data && !Market.data.failed ? marketPlayer(ctx.league, p.name, p.pos).adj : null);

/* ---------- The four paths ---------- */
function workOut(me) {
  if (cache.has(me.rosterId)) return cache.get(me.rosterId);
  const others = ctx.teams.filter(t => t.rosterId !== me.rosterId);
  const cliff = cliffOf(me);
  const sell = cliff.list.filter(p => p.value >= SELL_FLOOR);
  const nextDraft = Math.min(...ctx.teams.flatMap(t => t.picks.map(p => p.season)).filter(Number.isFinite));
  const out = { me, cliff, sell, paths: {} };

  // Who'd buy each player sold: contenders whose best lineup gains a point a week or more with him.
  const buyersOf = p => others.filter(t => isContender(t) && Vault.seasonLineupDetail([...t.plist, p], ctx.slots).total - t.opt >= 1);
  const buyers = new Map(sell.map(p => [p.id, buyersOf(p)]));

  // Stay
  out.paths.stay = { team: me, moves: [], changed: [] };

  // Rebuild: each 27+ RB/WR/TE worth SELL_FLOOR+ for picks in the next draft at his KTC value.
  {
    const addPicks = sell.map(p => ({ season: nextDraft, round: 1, original: -1, value: p.value, synthetic: true }));
    const team = modTeam(me, { out: sell, addPicks });
    out.paths.rebuild = { team, changed: [[me, team]], moves: sell.map(p => ({ out: [p], inText: `picks worth about ${n0(p.value)}`, buyers: buyers.get(p.id) })) };
  }

  // Reload: each one swapped for the closest-valued player 25 or under at his position on another roster.
  {
    const used = new Set(), adds = [], moves = [];
    sell.forEach(p => {
      const cands = others.flatMap(t => t.plist.filter(x => x.pos === p.pos && x.age > 0 && x.age <= YOUNG_MAX && x.value >= p.value * 0.8 && x.value <= p.value * 1.25).map(x => ({ x, t })));
      const pick = cands.filter(c => !used.has(c.x.id)).sort((a, b) => Math.abs(a.x.value - p.value) - Math.abs(b.x.value - p.value))[0];
      if (pick) { used.add(pick.x.id); adds.push(pick.x); }
      moves.push({ out: [p], get: pick ? pick.x : null, from: pick ? pick.t : null, options: cands.length, buyers: buyers.get(p.id) });
    });
    const swapped = moves.filter(m => m.get);
    const team = modTeam(me, { out: swapped.map(m => m.out[0]), add: adds });
    out.paths.reload = { team, changed: [[me, team]], moves };
  }

  // Push now: the player on a team out of the race who adds the most to the best
  // lineup, paid at his KTC value with picks (most valuable first), then bench players.
  {
    const bench = me.plist.filter(p => p.value > 0 && !inLineup(me, p)).sort((a, b) => a.value - b.value);
    const picks = [...me.picks].filter(p => p.value > 0).sort((a, b) => b.value - a.value);
    const budget = sum(picks, p => p.value) + sum(bench, p => p.value);
    // As close to the price as the pieces allow: the biggest pieces that still fit
    // under it (picks before bench players at the same value), then the smallest
    // one that finishes it.
    const pay = price => {
      const pool = [...picks.map(p => ({ p, pick: true })), ...bench.map(p => ({ p, pick: false }))].sort((a, b) => b.p.value - a.p.value || b.pick - a.pick);
      const took = []; let paid = 0;
      pool.forEach(x => { if (paid + x.p.value <= price) { took.push(x); paid += x.p.value; } });
      while (paid < price) {
        const left = pool.filter(x => !took.includes(x));
        if (!left.length) return null;
        const fin = left.filter(x => paid + x.p.value >= price).sort((a, b) => a.p.value - b.p.value)[0] || left[0];
        took.push(fin); paid += fin.p.value;
      }
      return { outPicks: took.filter(x => x.pick).map(x => x.p), out: took.filter(x => !x.pick).map(x => x.p), paid };
    };
    const weakest = Math.min(...me.lineup.filter(s => s.id).map(s => s.ppg), Infinity); // a buy has to out-score someone in the lineup
    const gainOf = (t, x) => Vault.seasonLineupDetail([...me.plist, x], ctx.slots).total - me.opt;
    const scan = pool => pool.flatMap(t => t.plist.filter(x => x.value > 0 && x.value <= budget && x.ppg > weakest).map(x => ({ t, x })))
      .sort((a, b) => b.x.ppg - a.x.ppg).slice(0, 30)
      .map(c => ({ ...c, gain: gainOf(c.t, c.x) })).filter(c => c.gain >= 0.5)
      .sort((a, b) => b.gain - a.gain || a.x.value - b.x.value);
    const sellers = others.filter(isOut);
    let found = scan(sellers), fromSeller = true;
    if (!found.length) { found = scan(others.filter(t => !isContender(t))); fromSeller = false; }
    const sellersWith = new Set(scan(sellers).map(c => c.t.rosterId)).size;
    const best = found[0];
    if (best) {
      const paid = pay(best.x.value);
      const team = modTeam(me, { out: paid.out, outPicks: paid.outPicks, add: [best.x] });
      const seller = modTeam(best.t, { out: [best.x], add: paid.out, addPicks: paid.outPicks });
      out.paths.push = { team, changed: [[me, team], [best.t, seller]], moves: [{ get: best.x, from: best.t, give: paid, fromSeller }], alts: found.slice(1, 4), budget, sellersWith, nSellers: sellers.length };
    } else {
      out.paths.push = { team: me, changed: [], moves: [], none: true, budget, sellersWith: 0, nSellers: sellers.length };
    }
  }

  // Every path's numbers on the same footing.
  for (const k of Object.keys(out.paths)) {
    const P = out.paths[k];
    P.pts = P.team === me ? 0 : ptsOf(me, P.team);
    P.season = P.changed.length ? seasonWith(P.changed) : ctx.baseSeason;
    P.odds = P.season ? P.season.get(me.rosterId) : null;
    P.win = P.team === me ? ctx.baseWin.get(me.rosterId) : windowOf(P.team);
    P.cliff = cliffOf(P.team);
    P.picksRank = 1 + others.filter(t => t.picksValue > P.team.picksValue).length;
  }
  out.suggest = suggest(out);
  cache.set(me.rosterId, out);
  return out;
}

/* ---------- The suggested path: a few stated rules, never the only answer ---------- */
function bandOf(t) {
  const g = (t.record?.wins || 0) + (t.record?.losses || 0) + (t.record?.ties || 0);
  if (g >= 3) { const ws = (t.record.wins + t.record.ties / 2) / g; return { band: ws < 0.4 ? 'losing' : ws < 0.6 ? 'middle' : 'winning', projected: false }; }
  // Before the season: where the roster ranks now (best lineup and value).
  const rank = 1 + ctx.teams.filter(x => x.contendScore > t.contendScore).length, n = ctx.teams.length;
  return { band: rank <= n / 3 ? 'winning' : rank > n * 2 / 3 ? 'losing' : 'middle', projected: true };
}
function suggest(o) {
  const me = o.me, base = o.paths.stay, w = base.win, y1 = w.inWindow[1], y2 = w.inWindow[2];
  const odds = ctx.inSeason ? me.playoffPct : null, cliff = o.cliff.share;
  const now = odds != null ? odds >= IN_PCT : w.inWindow[0];
  const later = y1 || y2;
  if (now) return { key: 'push', why: odds != null ? `${pct(odds)} playoff odds: the title is the payoff this season, and contenders who added points won it more often than their odds said.` : 'The roster is in its window now: this season is the one to play for.' };
  if (odds != null && odds < OUT_PCT) {
    if (later && cliff < 30) return { key: 'stay', why: `${pct(odds)} playoff odds, but the roster projects back in the window by ${w.startYear + (y1 ? 1 : 2)} with little tied up in players past 27.` };
    if (later) return { key: 'reload', why: `${pct(odds)} playoff odds and ${Math.round(cliff)}% of the team's value in RBs, WRs and TEs 27 or older, but the window comes back by ${w.startYear + (y1 ? 1 : 2)}: get younger without starting over.` };
    return { key: 'rebuild', why: `${pct(odds)} playoff odds and no contention window in the next two seasons: sell players past 27 while they still hold value.` };
  }
  if (later) return { key: cliff >= 30 ? 'reload' : 'stay', why: cliff >= 30 ? `Not a contender this season, ${Math.round(cliff)}% of the team's value is in RBs, WRs and TEs 27 or older, and the window projects back by ${w.startYear + (y1 ? 1 : 2)}.` : `Not a contender this season, but the roster is young enough to project into the window by ${w.startYear + (y1 ? 1 : 2)}.` };
  return { key: cliff >= 30 ? 'rebuild' : 'reload', why: cliff >= 30 ? `Stuck in the middle with no window in the next two seasons and ${Math.round(cliff)}% of the team's value in players past the age-27 cliff.` : 'Stuck in the middle with no window in the next two seasons: picking a lane beat staying in the middle in real leagues.' };
}

/* ---------- Rendering ---------- */
const chg = (b, a, fmt = v => Math.round(v), better = 1) => {
  const d = fmt(a) - fmt(b);
  if (!d) return '<span class="text-zinc-500">same</span>';
  return `<span class="${d * better > 0 ? 'text-emerald-400' : 'text-orange-300'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</span>`;
};
const winCell = (P, y) => {
  const w = P.win, yr = w.startYear + y, inW = w.inWindow[y];
  return `<span class="${inW ? 'text-emerald-300' : 'text-zinc-400'}">${inW ? 'In window' : 'Out'}</span> <span class="text-zinc-500">· #${w.rankAt ? w.rankAt(y) : rankAtBase(P.team, y)}</span>`;
};
const rankAtBase = (team, y) => 1 + ctx.teams.filter(t => t.rosterId !== team.rosterId && ctx.base.get(t.rosterId).proj[y] > ctx.base.get(team.rosterId).proj[y]).length;
// How hard each path is in this league: Easier / Harder / Hard, with the count behind it.
function difficulty(o, k) {
  const P = o.paths[k], name = esc(o.me.teamName);
  if (k === 'stay') return { level: 'Easiest', cls: 'text-emerald-300', text: 'Nothing to negotiate. The cost is waiting: players past 27 keep losing value while the team decides.' };
  if (k === 'push') {
    if (P.none) return { level: 'Hard', cls: 'text-orange-300', text: `No team outside the playoff race has a player who'd start for ${name} at a price its picks and bench can cover (${n0(P.budget)} in all).` };
    const m = P.moves[0];
    const lvl = !m.fromSeller ? 'Hard' : P.sellersWith >= 3 ? 'Easier' : 'Harder';
    return { level: lvl, cls: lvl === 'Easier' ? 'text-emerald-300' : 'text-orange-300', text: `${P.sellersWith} of ${P.nSellers} team${P.nSellers === 1 ? '' : 's'} out of the race (${ctx.inSeason ? `under ${OUT_PCT}% playoff odds` : 'rebuilding'}) ${P.sellersWith === 1 ? 'has' : 'have'} a player who'd start for ${name}${m.fromSeller ? '' : '; the best one is on a team still in the race, and contenders rarely sell starters'}. Picks and bench to spend: ${n0(P.budget)} of KTC value.` };
  }
  const nSell = o.sell.length;
  if (!nSell) return { level: 'Not needed', cls: 'text-zinc-400', text: `${name} has no RB, WR or TE aged 27+ worth ${n0(SELL_FLOOR)} or more to move.` };
  const avgBuyers = sum(o.sell, p => (o.paths.rebuild.moves.find(m => m.out[0].id === p.id)?.buyers || []).length) / nSell;
  const swaps = k === 'reload' ? P.moves.filter(m => m.get).length : nSell;
  const lvl = avgBuyers >= 3 && swaps === nSell ? 'Easier' : avgBuyers >= 1 ? 'Harder' : 'Hard';
  const extra = k === 'reload' ? ` Younger players at the same price were found for ${swaps} of ${nSell}, and each swap is two trades' worth of negotiating (sell, then buy).` : '';
  return { level: lvl, cls: lvl === 'Easier' ? 'text-emerald-300' : 'text-orange-300', text: `On average ${avgBuyers.toFixed(1)} contender${avgBuyers === 1 ? '' : 's'} would start each player ${name} sells (their best lineup gains a point a week or more).${extra}` };
}
function marketLine(list) {
  const priced = list.map(p => ({ p, m: marketPct(p) })).filter(x => x.m != null);
  if (!priced.length) return '';
  const ktc = sum(priced, x => x.p.value), mkt = sum(priced, x => x.p.value * (1 + x.m / 100)), d = (mkt / ktc - 1) * 100;
  return `At market prices (completed trades) they go for about ${n0(mkt)}, ${Math.abs(d) < 1 ? 'even with' : `${Math.abs(Math.round(d))}% ${d > 0 ? 'over' : 'under'}`} KTC value (${n0(ktc)}).`;
}

/* ---------- This season so far (season-report.js), when it has loaded ----------
   Luck: wins against what its weekly scores earn against every team (all-play);
   injuries: points a week its best lineup lost to players out. Same tag lines
   as the Season Report. */
function signalsOf(me) {
  const R = seasonReport, t = R && !R.error && !R.empty && R.teams ? R.teams.find(x => x.rosterId === me.rosterId) : null;
  if (!t) return null;
  const cfg = R.config || {}, bar = Math.max(cfg.LUCK_MIN_WINS || 1, t.luckSd || 0);
  const wins = v => (Math.round(v * 2) / 2).toString();
  return {
    unlucky: t.luck <= -bar, lucky: t.luck >= bar, expWins: wins(t.expWins), luck: t.luck,
    injured: t.injury && t.injury.pct >= (cfg.INJURY_TAG_PCT || 3.5), injuryPerWeek: t.injury ? t.injury.perWeek : 0
  };
}
function signalText(me) {
  const s = signalsOf(me), name = esc(me.teamName);
  if (!s) return '';
  const parts = [];
  if (s.unlucky) parts.push(`${name}'s scores earn about ${s.expWins} wins, ${Math.abs(s.luck).toFixed(1)} more than its record: the record undersells the roster.`);
  if (s.lucky) parts.push(`${name}'s scores earn about ${s.expWins} wins, ${s.luck.toFixed(1)} fewer than its record: the record flatters the roster.`);
  if (s.injured) parts.push(`Injuries have cost its best lineup ${s.injuryPerWeek.toFixed(1)} points a week.`);
  return parts.join(' ');
}

function renderSummary(o) {
  const me = o.me, P = o.paths.stay, w = P.win;
  const tile = (label, val, sub) => `<div class="stat-tile"><div class="stat-label">${label}</div><div class="stat-value">${val}</div>${sub ? `<div class="text-[12px] text-zinc-400 mt-0.5">${sub}</div>` : ''}</div>`;
  const sig = signalText(me);
  $('#tlSummary').innerHTML = `
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3"><h3 class="display text-[22px] text-zinc-100">Contend or rebuild?</h3><div class="text-[12px] text-zinc-400">Four paths for ${esc(me.teamName)}, each with the case for and against</div></div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${tile('Title odds', P.odds ? pct(P.odds.championshipPct) : '—', P.odds ? `${pct(P.odds.playoffPct)} playoff odds` : 'once the schedule is out')}
      ${tile('Window', w.hasWindow ? Vault.windowYearsText(w) : 'None', `in the next ${w.years} seasons`)}
      ${tile('Age-27 cliff', `${Math.round(o.cliff.share)}%`, 'of player value in RB/WR/TE 27+')}
      ${tile('Picks', n0(me.picksValue), `#${P.picksRank} of ${ctx.teams.length}`)}
    </div>
    ${extraHtml}
    ${sig ? `<div class="text-[13px] text-zinc-300 mt-3">This season so far: ${sig}</div>` : ''}
    <div class="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span class="text-[12px] uppercase tracking-wider text-zinc-500">Suggested for ${esc(me.teamName)}</span>
      <button type="button" onclick="Timeline.show('${o.suggest.key}')" class="num text-[26px] text-amber-200 hover:text-amber-100">${PATHS.find(p => p.key === o.suggest.key).label}</button>
    </div>
    <div class="text-[14px] text-zinc-200 mt-0.5 max-w-[760px]">${esc(o.suggest.why)} Every path is below, with the case for and against: pick the one that fits.</div>`;
}

function renderCompare(o) {
  const me = o.me, base = o.paths.stay, y1 = base.win.startYear + 1, y2 = base.win.startYear + 2;
  const head = `<tr class="text-[11px] uppercase tracking-wider text-zinc-500 text-left">
      <th class="py-2 pr-3 font-medium">Path</th>
      <th class="py-2 px-3 font-medium">${ctx.inSeason ? 'Title odds' : 'This season'}</th>
      <th class="py-2 px-3 font-medium">${y1}</th><th class="py-2 px-3 font-medium">${y2}</th>
      <th class="py-2 px-3 font-medium">27+ share</th><th class="py-2 px-3 font-medium">Picks</th><th class="py-2 pl-3 font-medium">How hard</th></tr>`;
  const row = p => {
    const P = o.paths[p.key], d = difficulty(o, p.key), active = p.key === pathKey;
    const now = P.odds ? `${pct(P.odds.championshipPct)} ${p.key === 'stay' ? '' : chg(base.odds.championshipPct, P.odds.championshipPct)}` : `${P.pts ? (P.pts > 0 ? '+' : '−') + Math.abs(P.pts).toFixed(1) + ' pts/wk' : 'as is'}`;
    return `<tr onclick="Timeline.show('${p.key}')" class="cursor-pointer border-t border-white/[0.06] ${active ? 'bg-amber-400/[0.06]' : 'hover:bg-white/[0.03]'}">
      <td class="py-2.5 pr-3 whitespace-nowrap"><span class="${active ? 'text-amber-100' : 'text-zinc-100'} font-medium">${p.label}</span>${p.key === o.suggest.key ? ' <span class="ml-1 text-[11px] px-1.5 py-px rounded border border-amber-400/30 text-amber-200">Suggested</span>' : ''}</td>
      <td class="py-2.5 px-3 mono whitespace-nowrap">${now}</td>
      <td class="py-2.5 px-3 whitespace-nowrap">${winCell(P, 1)}</td>
      <td class="py-2.5 px-3 whitespace-nowrap">${winCell(P, 2)}</td>
      <td class="py-2.5 px-3 mono whitespace-nowrap">${Math.round(P.cliff.share)}%</td>
      <td class="py-2.5 px-3 mono whitespace-nowrap">#${P.picksRank}</td>
      <td class="py-2.5 pl-3 whitespace-nowrap ${d.cls}">${d.level}</td></tr>`;
  };
  $('#tlCompare').innerHTML = `
    <div role="tablist" aria-label="Paths" class="flex flex-wrap gap-1.5 mb-3">${PATHS.map(p => `<button type="button" role="tab" aria-selected="${p.key === pathKey}" onclick="Timeline.show('${p.key}')"
      class="px-3.5 py-2 rounded-lg text-[13px] font-medium border ${p.key === pathKey ? 'border-amber-400/50 bg-amber-400/10 text-amber-100' : 'border-white/10 text-zinc-300 hover:text-white hover:bg-white/[0.04]'}">${p.label}${p.key === o.suggest.key ? ' <span class="text-amber-300/80">★</span>' : ''}</button>`).join('')}</div>
    <div class="overflow-x-auto scrollbar"><table class="w-full text-[13px]">${head}${PATHS.map(row).join('')}</table></div>
    <div class="text-[12px] text-zinc-500 mt-1.5">${y1} and ${y2}: in the contention window or not, and where the projected roster value ranks in the league. 27+ share: player value in RBs, WRs and TEs aged 27 or older. Tap a path for the details.</div>`;
}

function movesHtml(o, k) {
  const P = o.paths[k], name = esc(o.me.teamName), nm = p => `${esc(p.name)} <span class="text-zinc-500">${p.pos}, ${p.age ? Math.floor(p.age) : '?'}</span>`;
  if (k === 'stay') return `<div class="text-[14px] text-zinc-200">Keep the roster as it is. ${o.sell.length ? `${o.sell.length} player${o.sell.length === 1 ? '' : 's'} past the age-27 cliff stay: ${o.sell.slice(0, 4).map(nm).join(', ')}${o.sell.length > 4 ? '…' : ''}.` : ''}</div>`;
  if (k === 'push') {
    if (P.none) return `<div class="text-[14px] text-zinc-200">No upgrade found within ${name}'s picks and bench.</div>`;
    const m = P.moves[0], give = [...m.give.outPicks.map(pickName), ...m.give.out.map(p => esc(p.name))];
    const mp = marketPct(m.get);
    return `<div class="text-[14px] text-zinc-200">For example: ${name} gets ${nm(m.get)} from ${esc(m.from.teamName)}${m.from.playoffPct != null ? ` <span class="text-zinc-500">(${pct(m.from.playoffPct)} playoff odds)</span>` : ''} for ${give.join(', ')}, about ${n0(m.give.paid)} for his ${n0(m.get.value)} KTC value.${mp != null ? ` He goes for ${Math.abs(mp) < 1 ? 'about even with' : `${Math.abs(Math.round(mp))}% ${mp > 0 ? 'over' : 'under'}`} KTC value in completed trades.` : ''}</div>
      ${P.alts.length ? `<div class="text-[12px] text-zinc-400 mt-1">Other starters within reach: ${P.alts.map(c => `${esc(c.x.name)} (${esc(c.t.teamName)}, +${c.gain.toFixed(1)} pts/wk)`).join(' · ')}</div>` : ''}`;
  }
  if (!o.sell.length) return `<div class="text-[14px] text-zinc-200">Nothing to move: ${name} has no RB, WR or TE aged 27+ worth ${n0(SELL_FLOOR)} or more.</div>`;
  const rows = P.moves.map(m => `<li class="flex flex-wrap gap-x-2"><span>${nm(m.out[0])}</span><span class="text-zinc-500">→</span>${k === 'reload'
    ? (m.get ? `<span>${nm(m.get)} <span class="text-zinc-500">from ${esc(m.from.teamName)}</span></span>` : '<span class="text-zinc-500">no player 25 or under at about his value</span>')
    : `<span>${m.inText}</span>`}<span class="text-[12px] text-zinc-500">· ${m.buyers.length} contender${m.buyers.length === 1 ? '' : 's'} would start him</span></li>`).join('');
  return `<ul class="space-y-1 text-[14px] text-zinc-200">${rows}</ul><div class="text-[12px] text-zinc-400 mt-1.5">${marketLine(o.sell)}</div>`;
}

// Pros and cons with this team's own numbers.
function prosCons(o, k) {
  const me = o.me, P = o.paths[k], S = o.paths.stay, name = esc(me.teamName), pros = [], cons = [];
  const y1 = S.win.startYear + 1, y2 = S.win.startYear + 2;
  const titleTxt = P.odds && S.odds ? `title odds ${pct(S.odds.championshipPct)} → ${pct(P.odds.championshipPct)}, playoff odds ${pct(S.odds.playoffPct)} → ${pct(P.odds.playoffPct)}` : '';
  const ptsTxt = `${Math.abs(P.pts).toFixed(1)} points a week`;
  const winTxt = y => `${y === 1 ? y1 : y2}: ${P.win.inWindow[y] ? 'in the window' : 'out of the window'}, #${P.win.rankAt ? P.win.rankAt(y) : rankAtBase(P.team, y)} in projected value (was #${rankAtBase(me, y)})`;
  // Positive = worse that year: dropping out of the window (or coming into it) decides first, then the rank.
  const winBetter = y => (P.win.inWindow[y] !== S.win.inWindow[y] ? (S.win.inWindow[y] ? 1 : -1) : (P.win.rankAt ? P.win.rankAt(y) : rankAtBase(P.team, y)) - rankAtBase(me, y));
  const cliffValueYr = Math.round(o.cliff.value * 0.05);
  if (k === 'push' && !P.none) {
    pros.push(`Adds ${ptsTxt} to ${name}'s best lineup this season${titleTxt ? ` (${titleTxt})` : ''}.`);
    if (P.odds && S.odds && P.odds.championshipPct - S.odds.championshipPct < 2) cons.push(`At ${pct(S.odds.playoffPct)} playoff odds, the points barely move this season's title odds.`);
    if (P.cliff.share - o.cliff.share >= 3) cons.push(`More tied up past the age-27 cliff: ${Math.round(o.cliff.share)}% → ${Math.round(P.cliff.share)}% of player value. At the same KTC price, RBs, WRs and TEs that age lost value afterward.`);
    cons.push(`Pick capital drops from #${S.picksRank} to #${P.picksRank} in the league.`);
    [1, 2].forEach(y => { const d = winBetter(y); if (d > 0) cons.push(`${winTxt(y)}.`); else if (d < 0) pros.push(`${winTxt(y)}.`); });
  }
  if (k === 'push' && P.none) cons.push('Nothing to buy at a price the picks and bench can cover.');
  if (k === 'reload' || k === 'rebuild') {
    if (!o.sell.length) cons.push('Nothing past the cliff to move, so this path changes little.');
    else {
      pros.push(`Less tied up past the age-27 cliff: ${Math.round(o.cliff.share)}% → ${Math.round(P.cliff.share)}% of player value.`);
      if (P.pts <= -0.3) cons.push(`Costs ${ptsTxt} this season${titleTxt ? ` (${titleTxt})` : ''}.`);
      else if (P.pts >= 0.3) pros.push(`Adds ${ptsTxt} this season${titleTxt ? ` (${titleTxt})` : ''}.`);
      else pros.push(`About the same lineup this season${titleTxt ? ` (${titleTxt})` : ''}.`);
      if (k === 'rebuild') pros.push(`Pick capital rises from #${S.picksRank} to #${P.picksRank}.`);
      [1, 2].forEach(y => { const d = winBetter(y); if (d < 0) pros.push(`${winTxt(y)}.`); else if (d > 0) cons.push(`${winTxt(y)}.`); });
      if (k === 'reload') cons.push('Twice the deals: every player sold needs a younger one bought back at the same price.');
      if (k === 'rebuild') cons.push('Rebuilds usually take more than a year: the payoff comes when the picks turn into starters.');
    }
  }
  if (k === 'stay') {
    pros.push(`Keeps ${name}'s lineup and picks exactly as they are${S.odds ? ` (title odds ${pct(S.odds.championshipPct)})` : ''}.`);
    if (S.win.hasWindow) pros.push(`The contention window as it stands: ${Vault.windowYearsText(S.win)}.`);
    if (o.cliff.value > 0) cons.push(`${name}'s RBs, WRs and TEs aged 27+ (${n0(o.cliff.value)} of KTC value) lose about 5% a year at the same price: roughly ${n0(cliffValueYr)} a year.`);
    if (!S.win.inWindow[1] && !S.win.inWindow[2]) cons.push(`No contention window in ${y1} or ${y2} as the roster stands.`);
  }
  // This season so far (Season Report): a record that undersells the roster argues
  // for playing on, one that flatters it argues for caution.
  const s = signalsOf(me);
  if (s && s.unlucky) {
    const t = `The record undersells the roster: its scores earn about ${s.expWins} wins, ${Math.abs(s.luck).toFixed(1)} more than it has.`;
    (k === 'rebuild' || k === 'reload' ? cons : pros).push(t);
  }
  if (s && s.lucky && k === 'push') cons.push(`The record flatters the roster: its scores earn about ${s.expWins} wins, ${s.luck.toFixed(1)} fewer than it has.`);
  if (s && s.injured && (k === 'stay' || k === 'push')) pros.push(`Injuries have cost the best lineup ${s.injuryPerWeek.toFixed(1)} points a week, so it's stronger healthy than its record shows.`);
  return { pros, cons };
}

// Evidence from real trades: the study rows for this team's spot, then the findings behind the path.
function evidence(o, k) {
  const { band, projected } = bandOf(o.me), row = NEXT[band], name = esc(o.me.teamName);
  const r = row[k], st = row.stay;
  const spot = `Teams with ${BAND_LABEL[band]}${projected ? ' (where ' + name + "'s roster ranks now)" : ''} that ${PATH_PAST[k]} that season made the next season's playoffs <span class="num">${r[0]}%</span> of the time and won <span class="num">${r[1]}%</span> of titles${k === 'stay' ? '' : ` (stood pat: ${st[0]}% and ${st[1]}%)`}, ${r[2].toLocaleString()} teams.`;
  const lines = [spot];
  if (k === 'push') {
    lines.push('Contenders with 85%+ playoff odds won the title <span class="num">1.35</span> times as often as their odds said after trades adding 6+ points a week, and <span class="num">1.12</span> times after trades adding about none.');
    lines.push("No deadline premium: what contenders paid stayed within 1% of an even price in every month of the season.");
    lines.push('Buying RBs and WRs 27 or older: only 33-40% of those trades were ahead on value later, even good ones.');
  }
  if (k === 'reload') {
    lines.push('The age-27 cliff: at the same KTC price, RBs aged 27-28 lost 5% of value in a year and 10% in two; WRs and TEs lost 5-8%. Held in both 2024 and 2025.');
    lines.push('Trading helps teams that need it: among teams with a losing record, those that made 15+ trades won <span class="num">8%</span> of titles, against <span class="num">3%</span> for those that made none.');
  }
  if (k === 'rebuild') {
    lines.push('Selling is normal for teams out of it: teams under 10% playoff odds gave up 5+ points a week in <span class="num">22%</span> of their trades, playoff contenders in only <span class="num">2.2%</span>. The buyers are the contenders.');
    lines.push("Rebuilds take more than a year: losing teams that sold made the next season's playoffs 32% of the time, against 39% for those that stood pat. After a selling season, teams that bought the next season made the playoffs <span class=\"num\">53%</span> of the time and won <span class=\"num\">8%</span> of titles.");
    lines.push("Picking a lane beats the middle: teams whose trades were mostly rebuilding moves made the next season's playoffs <span class=\"num\">40%</span> of the time, against <span class=\"num\">35%</span> for teams in between.");
    lines.push('Picks gain on players over time: bought at an even price, picks were ahead <span class="num">59%</span> of the time a year later and <span class="num">77%</span> two years on.');
  }
  if (k === 'stay') {
    lines.push('Teams that never traded did worst at every record level: among losing teams, those with no trades won the title 3% of the time and made the playoffs 34%.');
    lines.push('Players past 27 lose value at the same price: RBs 5-10%, WRs and TEs 5-8% over one to two years.');
  }
  return lines;
}

function coachButton(o, k) {
  const mine = Vault.myTeam(ctx.teams) === o.me;
  const base = Vault.linkTo('trade.html');
  if (!mine) return `<a href="${base}&coach=team&with=${o.me.rosterId}" class="btn-ghost inline-block text-[13px] px-4 py-2">Start a trade with ${esc(o.me.teamName)}</a>
    <div class="text-[12px] text-zinc-500 mt-1.5">Trade Coach works from your own team. Switch to it above to act on a path.</div>`;
  // The Coach builds trades step by step (2026-10-27): reload can start by moving the player to sell.
  const link = (k === 'reload' || !['push', 'rebuild', 'stay'].includes(k)) && o.sell[0] ? [`${base}&coach=shop&player=p_${o.sell[0].id}`, `Move ${esc(o.sell[0].name)} in Trade Coach`] : [`${base}&coach=open`, 'Build a trade in Trade Coach'];
  return `<a href="${link[0]}" class="btn-gold-solid inline-block text-[13px] px-4 py-2">${link[1]}</a>`;
}

function renderDetail(o) {
  const k = pathKey, path = PATHS.find(p => p.key === k), d = difficulty(o, k), { pros, cons } = prosCons(o, k);
  const li = (xs, dot) => xs.map(x => `<li class="flex gap-2"><span class="${dot} shrink-0">•</span><span>${x}</span></li>`).join('');
  $('#tlDetail').innerHTML = `
    <div class="mt-5 pt-5 border-t border-white/[0.07]">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 class="display text-[20px] text-zinc-100">${path.label}${k === o.suggest.key ? ' <span class="align-middle ml-1 text-[11px] px-1.5 py-px rounded border border-amber-400/30 text-amber-200 font-sans">Suggested</span>' : ''}</h4>
        <div class="text-[13px] text-zinc-400">${path.short}</div>
      </div>
      <div class="mt-3">${movesHtml(o, k)}</div>
      <div class="grid md:grid-cols-2 gap-x-8 gap-y-4 mt-5">
        <div><div class="text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">For it</div><ul class="space-y-1.5 text-[13px] text-zinc-200">${li(pros, 'text-emerald-400') || '<li class="text-zinc-500">Nothing notable</li>'}</ul></div>
        <div><div class="text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">Against it</div><ul class="space-y-1.5 text-[13px] text-zinc-200">${li(cons, 'text-orange-400') || '<li class="text-zinc-500">Nothing notable</li>'}</ul></div>
      </div>
      <div class="mt-5 pt-4 border-t border-white/[0.07]">
        <div class="text-[11px] uppercase tracking-widest text-zinc-500 mb-1">How hard in this league: <span class="${d.cls} normal-case tracking-normal text-[13px] font-medium">${d.level}</span></div>
        <div class="text-[13px] text-zinc-300">${d.text}</div>
      </div>
      <div class="mt-5 pt-4 border-t border-white/[0.07]">
        <div class="text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">What happened in real leagues</div>
        <ul class="space-y-1.5 text-[13px] text-zinc-300">${li(evidence(o, k), 'text-zinc-500')}</ul>
        <div class="text-[12px] text-zinc-500 mt-2">From 1.34 million trades in 64,898 Sleeper dynasty leagues, 2024-2025; teams followed into the next season in the same league. Teams choose their path, so part of each gap is the kind of team that chooses it. <a href="how_we_grade.html#facts" class="underline underline-offset-2 decoration-white/20 hover:text-zinc-300">More on How We Grade</a></div>
      </div>
      <div class="mt-5">${coachButton(o, k)}</div>
    </div>`;
}

/* ---------- The section's API ---------- */
function show(k) {
  if (!shown || !PATHS.some(p => p.key === k)) return;
  pathKey = k;
  const u = new URL(location.href); u.searchParams.set('path', k); history.replaceState(null, '', u);
  renderCompare(shown); renderDetail(shown);
}
function init({ league, slots, teams, remainingWeeks }) {
  const inSeason = !!(remainingWeeks && remainingWeeks.length && teams.some(t => t.playoffPct != null));
  ctx = { league, slots, teams, remainingWeeks: remainingWeeks || [], inSeason };
  ctx.baseSeason = inSeason ? Vault.simulateSeason(teams, league, ctx.remainingWeeks, { trials: TRIALS, seed: SEED }) : null;
  ctx.base = new Map(teams.map(t => [t.rosterId, Vault.contentionWindow(t, teams)]));
  ctx.baseWin = new Map(teams.map(t => [t.rosterId, { ...ctx.base.get(t.rosterId), rankAt: y => rankAtBase(t, y) }]));
  cache.clear(); shown = null; pathKey = null;
  // Market prices (completed trades) fill in when they arrive.
  if (typeof marketLoad === 'function') marketLoad(league).then(() => { if (shown) renderDetail(shown); }).catch(() => {});
}
// opts.extraHtml: shown under the summary tiles (the Teams page's five-year
// contention window, 2026-10-23).
let extraHtml = '';
function render(mount, team, opts = {}) {
  if (!mount || !ctx || !team) return;
  extraHtml = opts.extraHtml || '';
  // A different team opens on its own suggested path (a ?path= link only applies to the team it came with).
  if (shown && shown.me.rosterId !== team.rosterId) {
    pathKey = null;
    const u = new URL(location.href); u.searchParams.delete('path'); history.replaceState(null, '', u);
  }
  mount.innerHTML = '<div id="tlSummary"><div class="text-[13px] text-zinc-400">Working out the four paths…</div></div><div id="tlCompare" class="mt-5"></div><div id="tlDetail"></div>';
  // After the team card has painted: each team's paths take a few season simulations.
  setTimeout(() => {
    if (!mount.querySelector('#tlSummary')) return;
    shown = workOut(team);
    const asked = new URLSearchParams(location.search).get('path');
    if (pathKey === null) pathKey = PATHS.some(p => p.key === asked) ? asked : shown.suggest.key;
    renderSummary(shown); renderCompare(shown); renderDetail(shown);
  }, 0);
}
function setSeason(report) {
  seasonReport = report;
  if (shown && $('#tlSummary')) { renderSummary(shown); renderDetail(shown); }
}
// The suggested path for a team, for a one-line summary elsewhere (the Teams page's Overview).
function suggestFor(team) {
  if (!ctx || !team) return null;
  const o = workOut(team);
  return { key: o.suggest.key, label: PATHS.find(p => p.key === o.suggest.key).label, why: o.suggest.why };
}
window.Timeline = { init, render, show, setSeason, suggestFor };
})();
