/* ============================================================
   TRADE COACH (Trade Calculator)
   A pop-up, one decision a screen: what you want to trade around, your plan
   for it, the best fits, then the trade itself with a live read, each change
   checked against the other manager (negJudgeFor: value plus their lineup,
   timeline, needs and trading style). Negotiate answers round by round
   (negotiation.js).

   Uses the Trade Calculator's globals (teams, slots, teamOf, selectedA/B,
   assetsFor) and negotiation.js (negJudgeFor, negContextFor, negLean,
   negNames, negKeys, negLoad, negOffer, negPreloadStyles, sumValue).
   ============================================================ */
const Coach = { option: 'best', step: 'type', shopKey: null, targetKey: null, wantPos: null, wantKind: 'starter', upKey: null, teamId: null, downKey: null, downSame: false, pos: null, results: {}, busy: false, mine: { must: [], keep: [], never: [], groups: [] }, theirs: { must: [], keep: [], never: [], groups: [] }, benchOnly: false, maxPieces: 0, picker: { open: false, q: '', pos: 'ALL' } };

// A breather between steps of a search, so the page stays responsive. A message,
// not setTimeout: browsers stretch timers to a second or more in a background tab,
// so switching tabs mid-search made it crawl (2026-10-23).
const coachTick = (() => {
  if (typeof MessageChannel === 'undefined') return () => new Promise(r => setTimeout(r, 0));
  const ch = new MessageChannel(), waiting = [];
  ch.port1.onmessage = () => { const r = waiting.shift(); if (r) r(); };
  return () => new Promise(r => { waiting.push(r); ch.port2.postMessage(0); });
})();

const coachSetPlan = mode => setTeamTimeline(coachMe().rosterId, mode);
const coachMe = () => teamOf('A'); // the calculator's left side is always your team
// How every list ranks trades (2026-10-07): Fair both ways first (within
// FAIR_PCT either way), then by how much each improves your team: the
// calculator's verdict score (improvementOf in trade.html, Vault.tradeImprovement),
// best first. Only trades that make your team better are listed (coachImproves).
// Before, the coach ranked closest to even, and before that the most in your
// favor that they'd still take.
const coachScoreMemo = new Map();
// o: a judge result (has .an) or an offer { partner, give, get }.
function coachScore(o) {
  if (o.an) return improvementOf(o.an, 'A').score;
  if (o.score != null) return o.score;
  const id = `${o.partner.rosterId}:${negKeys(o.give).join()}>${negKeys(o.get).join()}:${Vault.planOverride[coachMe().rosterId] || ''}`;
  if (!coachScoreMemo.has(id)) coachScoreMemo.set(id, improvementOf(coachJudged(coachMe(), o.partner, o.give, o.get).an, 'A').score);
  return coachScoreMemo.get(id);
}
// For ORDER only, value beyond about 4% your way earns no extra credit, so the
// list leads with trades that improve your team on the field and fit, not the
// ones squeezing the most out of the other manager (those read as a stretch;
// 2026-10-06 the user asked for closer trades). Labels and the filter use the
// true score, so a card's verdict matches the calculator's.
const COACH_VALUE_CREDIT = 4;
function coachRankScore(o) {
  const imp = o.an ? improvementOf(o.an, 'A') : null;
  if (imp) return Vault.tradeImprovement({ ...imp, valuePct: Math.min(imp.valuePct, COACH_VALUE_CREDIT) }).score;
  const id = `rank:${o.partner.rosterId}:${negKeys(o.give).join()}>${negKeys(o.get).join()}:${Vault.planOverride[coachMe().rosterId] || ''}`;
  if (!coachScoreMemo.has(id)) {
    const i2 = improvementOf(coachJudged(coachMe(), o.partner, o.give, o.get).an, 'A');
    coachScoreMemo.set(id, Vault.tradeImprovement({ ...i2, valuePct: Math.min(i2.valuePct, COACH_VALUE_CREDIT) }).score);
  }
  return coachScoreMemo.get(id);
}
const coachKey = o => (Math.abs(o.edge) < VAULT_CONFIG.FAIR_PCT ? 0 : 1000) - coachRankScore(o);
// Slight edge or better (VAULT_CONFIG.VERDICT_TIERS): below that, real trades
// scored the same way came out a coin flip.
const coachImproves = o => Vault.verdictTier(coachScore(o)).level === 'good';
// A suggestion has to make sense for both teams (user, 2026-10-09):
// - the other manager has a reason to take it: at least a Toss-up for them;
// - it doesn't hurt either roster (roster fit not meaningfully negative, -1 or better, for either side);
// - no throw-ins: every piece is worth at least COACH_MIN_PIECE of its side's best;
// - you don't give up value (COACH_VALUE_FLOOR);
// - the price is Fair on trade value and not Unfair on KTC's calculator (coachPriceFair).
// Best trades then lists them best for you first (Good trade or better at the
// top), down to Slight edge.
const COACH_THEIR_MIN = -6, COACH_MIN_PIECE = 0.2;
// Go all-in and Fix a position may pay a premium, but not hand the other team a
// Bad trade or worse (2026-10-20: Go all-in offered Kenneth Walker out of a
// 100%-odds contender, Terrible for them). In accepted 2024-2025 in-season trades
// (VaultValues contender-sellers.js), contenders at 85%+ playoff odds gave up 5+
// points a week in 2.2% of their trades, and not for extra value (same median
// price as their other trades); Bad or worse for them in 5%, Terrible in 0.5%.
const COACH_UPGRADE_THEIR_MIN = -15;
// A price both managers would take: Fair on trade value (under FAIR_PCT off either way),
// and not Unfair on KTC's own calculator (under LOPSIDED_PCT), since most managers check
// an offer there. Go all-in may still overpay (that's its point), but not short the
// other team. Sell high, Buy low and Shop a player are exempt: their point is the gap
// between KTC and what players actually trade for, priced at market.
// History: from 2026-10-09 (user: "they'd never accept", "doesn't match KTC") this was
// Fair on KTC (under 14%). KTC's consolidation adjustment is so steep that only 25% of
// real accepted trades read Fair there (12-17% of 2-for-1s and 3-for-1s), so with the
// other team's verdict it let through 18% of trades managers actually made. This rule
// lets through 40% (2026-10-24, user's choice; VaultValues acceptance-check.js).
const coachKtcPct = (give, get) => { const k = Vault.ktcSideValues(give, get); return (k.valueB - k.valueA) / (((k.valueA + k.valueB) / 2) || 1) * 100; };
const coachTvPct = (give, get) => { const v = Vault.tradeSideValues(give, get); return (v.valueB - v.valueA) / (((v.valueA + v.valueB) / 2) || 1) * 100; };
const coachPriceFair = (give, get, option) => {
  const within = (p, lim) => p < lim && (option === 'contend' || p > -lim);
  return within(coachTvPct(give, get), VAULT_CONFIG.FAIR_PCT) && within(coachKtcPct(give, get), VAULT_CONFIG.LOPSIDED_PCT);
};
// Not asking for the other team's cornerstone (Vault.cornerstone: its best
// player, or a contender's top 3): managers rarely trade them at any fair price.
// Get a player (you name the target) and the price plays you start from your
// own player skip this.
const coachAsksCornerstone = (partner, get) => get.some(a => Vault.cornerstone(partner, a));
const COACH_CORNERSTONE_OK = new Set(['target', 'shop', 'sellhigh']);
// Options that are about the price: these keep Toss-ups too.
const COACH_PRICE_PLAYS = new Set(['shop', 'sellhigh', 'buylow']);
// Don't give value away (user, 2026-10-08): a contender's verdict weighs this
// season's points heavily, so Coach kept finding trades that buy points with
// value (Ja'Marr Chase for McCaffrey + Irving at 13% over, for Lamb + Adams at
// 2% over). Every list but Go all-in (whose point is spending future value to
// win now) needs you even or ahead on trade value: at most COACH_VALUE_FLOOR %
// behind, about the noise in a trade's price.
const COACH_VALUE_FLOOR = 2;
const coachValuePct = o => { const tv = Vault.tradeSideValues(o.give, o.get); return (tv.valueB - tv.valueA) / (((tv.valueA + tv.valueB) / 2) || 1) * 100; };
// Get a player and Fix a position may pay a little over value for the player or the
// help you're after (user, 2026-10-24: "if you're wanting to fix aren't you expecting
// to pay over a little?"); the card shows how much.
// Trades with one team too when you're the buyer, getting the best piece in the deal
// (user, 2026-10-24: "The buyer doesn't set the price. Seller does").
const COACH_PREMIUM_OK = new Set(['target', 'position', 'want', 'upgrade']), COACH_TARGET_PREMIUM = 6;
const coachBuyer = o => Math.max(...o.get.map(a => a.value)) > Math.max(...o.give.map(a => a.value));
// Only when the trade is still Slight edge or better for you (2026-10-24, user, after the
// backtest: Toss-ups that also paid 2-6% over were the weakest group, 38% ahead later).
const coachPremiumOK = (o, option) => (COACH_PREMIUM_OK.has(option) || (option === 'team' && coachBuyer(o))) && Vault.verdictTier(coachScore(o)).level === 'good';
const coachKeepsValue = (o, option) => option === 'contend' || coachValuePct(o) >= -(coachPremiumOK(o, option) ? COACH_TARGET_PREMIUM : COACH_VALUE_FLOOR);
// Lists where you picked the player, the team or the position (user, 2026-10-24): a
// fair price there usually reads Toss-up for you (two contenders rarely both win a
// trade), so Toss-ups show too, after the better trades and labeled. Get a player
// listed nothing for Josh Allen, Puka Nacua or Fernando Mendoza, three teams had no
// trades, and every RB depth add was a Toss-up.
const COACH_TOSSUP_OK = new Set(['target', 'team', 'position', 'want', 'upgrade']);
// The other team's verdict score for the same trade (memoized like coachScore).
function coachTheirScore(o) {
  const id = `them:${o.partner.rosterId}:${negKeys(o.give).join()}>${negKeys(o.get).join()}:${Vault.planOverride[coachMe().rosterId] || ''}`;
  if (!coachScoreMemo.has(id)) coachScoreMemo.set(id, improvementOf(coachJudged(coachMe(), o.partner, o.give, o.get).an, 'B').score);
  return coachScoreMemo.get(id);
}
// They have to come out fine too: the same verdict score from their side (their
// value, roster fit, timeline, and this season's points if they're playing to
// win now) can't be negative. The accept guess alone let through trades that
// were a Bad trade for nearly every partner (2026-10-07: Walker's contender
// handing over Kenneth Walker for picks mid-season), so a manager would say no.
// Would they take it? The market's read only (2026-10-08): inside what managers
// usually pay for every piece (marketAcceptable: each piece's middle-half price
// range), which fit 81% of real trades it never saw. Not the manager's own trade
// history (the user's call), and not their verdict score: on 27,327 real 2025
// trades only 18% left both teams "not worse", so that rule threw out most real deals.
const coachMarketOK = (give, get) => typeof marketAcceptable !== 'function' || !Market.data || Market.data.failed || marketAcceptable(league, give, get)?.level === 'acceptable';
// Same-position 1-for-1 swaps rarely happen at even value (the two players are
// usually worth different amounts), so they're skipped unless something's going
// on with one of them: hurt, or sliding (COACH_FALLING of his KTC value lost over
// the trend window, 90 days), like Justin Herbert in October 2026 (Chargers 0-4,
// down 22%). User, 2026-10-07.
const COACH_FALLING = 0.15;
const coachFalling = a => a.type === 'player' && a.trend != null && a.value - a.trend > 0 && -a.trend / (a.value - a.trend) >= COACH_FALLING;
const coachSameSpotSwap = o => o.give.length === 1 && o.get.length === 1 && (o.give[0].type === 'pick' ? o.get[0].type === 'pick' : o.give[0].pos === o.get[0].pos)
  && !Vault.injuryText(o.give[0]) && !Vault.injuryText(o.get[0]) && !coachFalling(o.give[0]) && !coachFalling(o.get[0]);

// Your team after a trade, for lineup gains.
function coachAfter(meId, partnerId, give, get) {
  const { pool } = Vault.simulateTrade(teams, slots, meId, partnerId, give, get);
  return pool.find(t => t.rosterId === meId);
}

// Your side (the "Your side" box): pieces every suggestion must include,
// pieces to keep, and whole groups (a position, or picks) never to trade.
// Must-include wins over a group toggle, and over protecting your starters.
const coachGroup = a => (a.type === 'pick' ? 'PICK' : a.pos);
const coachMust = me => Coach.mine.must.map(k => me.assets.find(a => a.key === k)).filter(Boolean);
function coachOffLimits(me) {
  const off = new Set(Coach.mine.keep);
  me.assets.forEach(a => { if (Coach.mine.never.includes(coachGroup(a))) off.add(a.key); });
  // Quick filter "Pay with: Picks and bench": none of your starters go out.
  if (Coach.benchOnly) (me.lineup || []).forEach(s => { if (s.id) off.add('p_' + s.id); });
  Coach.mine.must.forEach(k => off.delete(k));
  return off;
}
// "Must include a" (Your side) / "Must get a" (Their side): every suggestion
// sends at least one of each chosen group (a position, or a pick) and brings
// back at least one of each of theirs.
const coachGroupsOK = (give, get) => Coach.mine.groups.every(g => give.some(a => coachGroup(a) === g)) && Coach.theirs.groups.every(g => get.some(a => coachGroup(a) === g));
// Their side (the "Their side" box): pieces a trade must bring back (which
// limits it to the teams that own them), pieces you don't want, and groups
// you'll never take. Must-get wins over a group toggle.
const coachTheirMust = t => Coach.theirs.must.map(k => t.assets.find(a => a.key === k)).filter(Boolean);
const coachPartnerOK = t => !Coach.theirs.must.length || coachTheirMust(t).length > 0;
const coachTheirOff = a => !Coach.theirs.must.includes(a.key) && (Coach.theirs.keep.includes(a.key) || Coach.theirs.never.includes(coachGroup(a)));

// Packages of your pieces for `get` that `partner` would accept, best for you
// first, at most `perLead` per lead piece so the list isn't the same offer
// with different filler. Every package includes your must-include pieces and
// nothing off limits. When they'd take a package that overpays them, they add
// one of their smaller pieces (not one you ruled out) to bring it back to Fair.
function coachOffers(me, partner, get, { protect = new Set(), ceiling = VAULT_CONFIG.FAIR_PCT, limit = 1, perLead = 1, option = null } = {}) {
  if (!coachPartnerOK(partner)) return [];
  get = [...get, ...coachTheirMust(partner).filter(a => !get.includes(a))];
  const want = sumValue(get);
  const must = coachMust(me), mustVal = sumValue(must), mustKeys = new Set(negKeys(must)), off = coachOffLimits(me);
  const pool = me.assets.filter(a => !protect.has(a.key) && !off.has(a.key) && !mustKeys.has(a.key) && a.value >= want * 0.08 && a.value + mustVal <= want * 1.4)
    .sort((x, y) => y.value - x.value).slice(0, 14);
  const packs = must.length ? [[...must]] : [];
  pool.forEach((a, i) => {
    packs.push([...must, a]);
    pool.slice(i + 1).forEach(b => { const s = mustVal + a.value + b.value; if (s >= want * 0.7 && s <= want * 1.7) packs.push([...must, a, b]); });
  });
  // A package's edge is never closer to even than its plain value gap (Vault.
  // blendedFairness; with the factor cap at 60 a fit can't flip its sign either),
  // so one that overpays by the ceiling or more can't be taken as is. Those are
  // only graded below if they could be among the closest overpays to balance
  // back (2026-10-23, faster first search: same offers, far fewer gradings).
  const valueEdge = give => {
    const { valueA, valueB } = Vault.tradeSideValues(give, get), avg = (valueA + valueB) / 2 || 1;
    return Math.sign((valueA - valueB) || 1) * (Math.abs(valueA - valueB) / avg * 100);
  };
  const deferred = [];
  let seq = 0; // each package's place in the original order, for ties
  const judge = list => list.filter(give => coachMarketOK(give, get)).flatMap(give => {
    const i = seq++, v = valueEdge(give);
    if (v >= ceiling) { deferred.push({ give, v, i }); return []; }
    return [{ give, j: coachJudged(me, partner, give, get), i }];
  });
  const offer = x => ({ partner, give: x.give, get, edge: x.j.edge, score: coachScore(x.j) });
  // Only offers the other team would take (option: the list's own check, coachTheyTake),
  // before keeping the best for you: the best-for-you ones were lowballs they'd turn
  // down, so Get a player listed nothing (2026-10-24: Josh Allen's 8 offers all -13 to
  // -24 for his team, under the -6 the list needs, with fair offers cut before the check).
  const takes = o => !option || coachTheyTake(o, option);
  let taken = judge(packs);
  let found = taken.filter(x => x.j.edge < ceiling).map(offer).filter(takes);
  if (found.length < limit) {
    const top = pool.slice(0, 10), triples = [];
    top.forEach((a, i) => top.slice(i + 1).forEach((b, k) => top.slice(i + k + 2).forEach(c => {
      const s = mustVal + a.value + b.value + c.value;
      if (s >= want * 0.9 && s <= want * 2.2) triples.push([...must, a, b, c]);
    })));
    const t3 = judge(triples);
    taken = taken.concat(t3);
    found = found.concat(t3.filter(x => x.j.edge < ceiling).map(offer).filter(takes));
  }
  // Balance it back: the closest overpays, each with the one piece of theirs
  // that brings it to Fair while leaving you best off.
  const closest = () => taken.filter(x => x.j.edge >= VAULT_CONFIG.FAIR_PCT).sort((x, y) => x.j.edge - y.j.edge || x.i - y.i).slice(0, 12);
  let over = closest();
  // Overpays set aside above, smallest gap first, until none left can beat the 12th.
  for (const d of deferred.sort((x, y) => x.v - y.v)) {
    if (over.length >= 12 && d.v > over[11].j.edge) break;
    taken.push({ give: d.give, j: coachJudged(me, partner, d.give, get), i: d.i });
    over = closest();
  }
  if (over.length) {
    const inGet = new Set(negKeys(get));
    const fillers = partner.assets.filter(a => !inGet.has(a.key) && !coachTheirOff(a) && a.value >= want * 0.05 && a.value <= want * 0.6)
      .sort((x, y) => y.value - x.value).slice(0, 12);
    over.forEach(x => {
      let best = null;
      fillers.forEach(fl => {
        const g2 = [...get, fl];
        const j = coachJudged(me, partner, x.give, g2);
        if (coachMarketOK(x.give, g2) && j.edge < VAULT_CONFIG.FAIR_PCT && (!best || coachKey({ edge: j.edge, an: j.an }) < coachKey(best)) && takes({ partner, give: x.give, get: g2 })) best = { partner, give: x.give, get: g2, edge: j.edge, score: coachScore(j), note: `They add ${Vault.escapeHtml(fl.name)} to even it out.` };
      });
      if (best) found.push(best);
    });
  }
  const count = new Map();
  return found.filter(o => coachGroupsOK(o.give, o.get)).sort((x, y) => coachKey(x) - coachKey(y)).filter(o => {
    const lead = ([...o.give].filter(a => !mustKeys.has(a.key)).sort((x, y) => y.value - x.value)[0] || { key: 'must' }).key;
    const n = count.get(lead) || 0;
    if (n >= perLead) return false;
    count.set(lead, n + 1);
    return true;
  }).slice(0, limit);
}

// Sell high goes to the managers who pay up first: a partner whose league trades
// show them paying PAYS_UP_AT % or more over market for a position (in PAYS_UP_MIN
// trades or more, market-data.js marketOverpay) ranks that much higher for it
// (up to PAYS_UP_MAX points), and the card says so.
const PAYS_UP_AT = 8, PAYS_UP_MIN = 2, PAYS_UP_MAX = 15;
// Best trades' candidates and their grades, kept for the same team, timeline and
// rosters (2026-10-23, "Faster Coach"): building them takes about 3 seconds and
// grading about 1.5, and a filter change or Search again doesn't change either.
// `me` is a new object whenever the league's rosters reload, which starts over.
const coachCache = { me: null, plan: null, pool: null, judged: new Map() };
function coachCacheFor(me) {
  // Either team's timeline changes the grades (Vault.planOverride), so any change starts over.
  const plan = JSON.stringify(Vault.planOverride);
  if (coachCache.me !== me || coachCache.plan !== plan) Object.assign(coachCache, { me, plan, pool: null, judged: new Map() });
  return coachCache;
}
function coachJudged(me, partner, give, get) {
  const c = coachCacheFor(me), id = `${partner.rosterId}:${negKeys(give).join()}>${negKeys(get).join()}`;
  if (!c.judged.has(id)) c.judged.set(id, negJudgeFor(me, give, partner, get, negContextFor(partner)));
  return c.judged.get(id);
}

// Every list's last check: good enough for you (price plays: anything but a
// losing trade), no value given up, not bad for them (Fix a position and Go
// all-in: COACH_UPGRADE_THEIR_MIN, as their search uses), a fair price
// (coachPriceFair), no cornerstone, no same-spot swap. coachUpgrades runs it while
// picking each target's offers (2026-10-23: it kept the first offer per target
// and only then filtered, so James Cook was dropped for a package KTC calls
// off while his third package passed everything).
// The other team's side of coachListOK: their verdict at least the list's minimum,
// and a fair price (coachPriceFair) where that applies. coachOffers checks it too.
function coachTheyTake(o, option) {
  const theirMin = option === 'position' || option === 'contend' ? COACH_UPGRADE_THEIR_MIN : COACH_THEIR_MIN;
  return coachTheirScore(o) >= theirMin && (COACH_PRICE_PLAYS.has(option) || option === 'downtier' || coachPriceFair(o.give, o.get, option));
}
function coachListOK(o, option) {
  if (!coachPiecesOK(o.give, o.get)) return false;
  return (COACH_PRICE_PLAYS.has(option) || COACH_TOSSUP_OK.has(option) ? Vault.verdictTier(coachScore(o)).level !== 'bad' : coachImproves(o)) && coachKeepsValue(o, option) && coachTheyTake(o, option)
    && (COACH_CORNERSTONE_OK.has(option) || !coachAsksCornerstone(o.partner, o.get)) && !coachSameSpotSwap(o);
}

/* ---------- Why it works, and who to call ----------
   (2026-10-23, user: "I wanna be wowed by how awesome these trades are"; picked all
   four: lead with the best move, cut the filler, sell the why, read the other
   manager.) coachExplain works out each listed trade's lineup gain, title odds,
   who starts over whom, the other team's situation, and how that manager trades
   (Trade Grades history: Negotiation.styles, marketOverpay). coachShape then, for
   a contender in season, ranks by title odds gained, drops trades that barely
   move the team, and puts managers who've never traded after the rest. */
// Filler: under 2 pts a week and under 2 points of title odds (1 is within the simulation's wobble).
const COACH_FILLER_PTS = 2, COACH_FILLER_TITLE = 2, COACH_CONTENDER_PCT = 50;
let coachPays = null, coachPaysFor = null;
function coachManagerRead(partner, give) {
  const st = Negotiation.styles && Negotiation.styles.get ? Negotiation.styles.get(partner.rosterId) : null;
  if (!st) return null;
  const all = [...Negotiation.styles.values()], avg = all.reduce((t, s) => t + (s.trades || 0), 0) / (all.length || 1);
  const name = Vault.escapeHtml(partner.teamName), n = st.trades || 0;
  if (Negotiation.graded && coachPaysFor !== Negotiation.graded && typeof marketOverpay === 'function') { coachPays = marketOverpay(league, Negotiation.graded); coachPaysFor = Negotiation.graded; }
  const top = give.length ? give.reduce((m, a) => (a.value > m.value ? a : m)) : null, pos = top ? (top.type === 'pick' ? 'Pick' : top.pos) : null;
  const pay = pos && coachPays ? coachPays.get(partner.rosterId)?.[pos] : null;
  const paysUp = pay && pay.n >= PAYS_UP_MIN && pay.avg >= PAYS_UP_AT ? `${name} has paid about ${Math.round(pay.avg)}% over market for ${pos === 'Pick' ? 'picks' : pos + 's'} in your league (${pay.n} trades).` : '';
  if (!n) return { never: true, tone: 'text-orange-300', text: `${name} hasn't made a trade in your league yet, so this is a long shot.` };
  const active = n >= Math.max(3, avg * 1.5);
  // Only when it says something: an ordinary trade count doesn't.
  if (!paysUp && !active) return null;
  return { never: false, tone: 'text-emerald-300', text: paysUp || `${name} trades a lot (${n} trades, league average ${avg.toFixed(1)}).` };
}
function coachExplain(me, o) {
  const aft = coachAfter(me.rosterId, o.partner.rosterId, o.give, o.get);
  const gain = aft.opt - me.opt, title = coachTitleOdds(o);
  // Who starts over whom: new starters from the trade, and who they push out of the lineup.
  const before = new Set((me.lineup || []).map(s => s.id).filter(Boolean)), after = new Set((aft.lineup || []).map(s => s.id).filter(Boolean));
  const gave = new Set(o.give.map(a => a.key));
  const inn = o.get.filter(a => a.type === 'player' && after.has(a.key.slice(2)));
  const out = (me.lineup || []).filter(s => s.id && !after.has(s.id) && !gave.has('p_' + s.id)).map(s => s.name);
  const starts = inn.map((a, i) => out[i] ? `${Vault.escapeHtml(a.name)} starts over ${Vault.escapeHtml(out[i])}` : `${Vault.escapeHtml(a.name)} starts for you`);
  const p = o.partner, name = Vault.escapeHtml(p.teamName), rec = p.record ? `${p.record.wins}-${p.record.losses}${p.record.ties ? '-' + p.record.ties : ''}` : '';
  const pc = v => (v < 1 && v > 0 ? 'under 1' : v > 99 && v < 100 ? 'over 99' : Math.round(v)) + '%';
  let situation = '';
  if (remainingWeeks.length && Number.isFinite(p.playoffPct)) {
    if (p.playoffPct < VAULT_CONFIG.OUT_OF_RACE_PCT) situation = `${name} is ${rec} and out of the race (${pc(p.playoffPct)} playoff odds): teams that far out sell starters.`;
    else if (p.playoffPct >= 85) situation = `${name} is a contender too (${pc(p.playoffPct)} playoff odds): contenders rarely sell starters.`;
  }
  if (!situation && Vault.teamMode(p) === 'rebuild') situation = `${name} is building for later, so picks and young players appeal to them.`;
  return { gain, title, starts, situation, manager: coachManagerRead(p, o.give) };
}
// Contender in season: playing for this year's title, so that's the headline and the order.
const coachContending = me => remainingWeeks.length > 0 && Number.isFinite(me.playoffPct) && me.playoffPct >= COACH_CONTENDER_PCT && Vault.teamMode(me) !== 'rebuild';
function coachShape(me, list, option) {
  // The same player twice (Fix a position and Go all-in keep two ways to pay for
  // each): one card, the second way to pay shown on it, so more players fit the list.
  if (option === 'contend' || option === 'position') {
    const first = new Map();
    list = list.filter(o => { const k = o.partner.rosterId + '<' + negKeys(o.get).join(); const f = first.get(k); if (f) { (f.alts ||= []).push(o); return false; } first.set(k, o); return true; });
    // Up to 10 players, then Fix a position's depth adds after them (coachDepthAdds);
    // the first COACH_SLOT_FIRST new #1s always make the 10 (coachSlotFor).
    if (option === 'position') list.forEach(o => { o.slot = coachSlotFor(me, o, Coach.pos); });
    const nd = list.filter(o => !o.depth), ones = nd.filter(o => o.slot && o.slot.group === 0).slice(0, COACH_SLOT_FIRST);
    list = [...ones, ...nd.filter(o => !ones.includes(o)).slice(0, 10 - ones.length), ...list.filter(o => o.depth)];
  }
  list.forEach(o => { o.ctx = coachExplain(me, o); });
  if (!coachContending(me) || !['best', 'team', 'contend', 'position'].includes(option)) return list;
  const tGain = o => (o.ctx.title ? o.ctx.title.after - o.ctx.title.before : 0);
  const real = list.filter(o => o.depth || o.ctx.gain >= COACH_FILLER_PTS || tGain(o) >= COACH_FILLER_TITLE);
  const kept = real.length >= 3 ? real : list;
  return kept.sort((x, y) => (x.depth ? 1 : 0) - (y.depth ? 1 : 0) || (x.ctx.manager?.never ? 1 : 0) - (y.ctx.manager?.never ? 1 : 0) || tGain(y) - tGain(x) || y.ctx.gain - x.ctx.gain);
}
/* ---------- Quick filters ----------
   Above the results (2026-10-23, user picked "Steer Coach searches"): pay with
   picks and bench only (coachOffLimits), at most N pieces each way, and a
   position to get back (the Positions step's "Must get a", Coach.theirs.groups).
   Each change searches again. */
const coachPiecesOK = (give, get) => !Coach.maxPieces || (give.length <= Coach.maxPieces && get.length <= Coach.maxPieces);
/* ---------- Closest deals ----------
   When a list comes up empty (2026-10-23, user picked "Closest deals when
   empty"): the offers it built that failed coachListOK, each with why, and for
   one that's bad for the other team, the smallest of your other pieces that makes
   it at least a Toss-up for them. Up to COACH_NEAR_SHOW, fixable ones first. */
const COACH_NEAR_SHOW = 3, COACH_NEAR_LOOK = 12;
/* ---------- Panel ---------- */

// option: 'negotiate' (the trade loaded in the builder), or anything else for the
// step-by-step Coach. It picks up where you left off, so closing the pop-up costs
// nothing; Start on the rail begins again.
function openCoach(option) {
  Coach.option = option === 'negotiate' ? 'negotiate' : 'coach';
  setView('coach');
  renderCoach();
}
// Called when the workspace opens on your team: fresh results, back to step 1.
function coachStart() {
  Coach.results = {};
  Coach.pos = coachDefaultPos();
  Coach.targetKey = null;
  Coach.teamId = null;
  Coach.downKey = null;
  Coach.upKey = null;
  Coach.wantPos = Coach.pos;
  Coach.work = null;
  Coach.flow = null;
  Coach.shownStep = null;
  if (Coach.option !== 'negotiate') Coach.option = 'coach';
  negPreloadStyles();
  renderCoach();
}
const coachOpen = () => view === 'coach' && !document.getElementById('workspace').classList.contains('hidden');
function coachSync() {
  const neg = document.getElementById('negotiation');
  if (neg) neg.classList.toggle('hidden', !(Coach.option === 'negotiate' && Negotiation.rounds.length));
}
// Something the read depends on changed (a timeline, trade history): drop cached judgments and redraw.
function coachReset() { coachScoreMemo.clear(); if (Coach.work) Coach.work.tweaks = null; if (coachOpen()) { renderCoach(); if (Coach.work) coachWorkTweaks(); } }
// From a roster row: Shop (your piece: what to do with it) or Get (their player: build it).
function coachFresh() { Coach.option = 'coach'; Coach.flow = null; Coach.work = null; }
function coachShopFor(key) { coachFresh(); setView('coach'); coachPickAny(key); }
function coachGetFor(key) { coachFresh(); coachPickPlayer(key); }

function coachDefaultPos() {
  const { posPct, needs } = Vault.positionalProfile(coachMe(), teams);
  const order = Object.keys(posPct).sort((x, y) => posPct[x] - posPct[y]);
  return (order.find(p => needs.includes(p)) || order[0] || 'rb').toUpperCase();
}

function coachLoadTrade(o) {
  if (!o) return;
  const selB = document.getElementById('teamB');
  if (selB.value !== String(o.partner.rosterId)) { selB.value = String(o.partner.rosterId); selB.onchange(); }
  negLoad(negKeys(o.give), negKeys(o.get));
}

/* ---------- Your side / Their side ---------- */

// Yes is the list's own test (coachTheyTake: their verdict, a Fair price on trade value,
// not Unfair on KTC) and their manager's (negJudgeFor accepts), so Work it out never
// says yes to something the list wouldn't show. Room: how much more you could ask
// before either one turns, about % of trade value (their will over what they ask, and
// the price's distance to Lopsided).
function coachWorkRead(me, w, give = w.give, get = w.get) {
  const j = coachJudged(me, w.partner, give, get), o = { partner: w.partner, give, get }, you = coachValuePct(o);
  const yes = j.accepts && coachTheyTake(o, w.option);
  const room = yes ? Math.min(j.will - j.ask, VAULT_CONFIG.FAIR_PCT - you) : j.will - j.ask;
  return { j, o, score: coachScore(o), yes, room, you, them: improvementOf(j.an, 'B'), consensus: give.length && get.length ? tradeConsensus(me, w.partner, give, get) : null };
}
// Among trades that work, the ones that read fair across the sites come first: both
// managers can check those (user, 2026-11-03). Never changes who'd say yes.
const coachConsensusBand = r => r.consensus?.band ?? 0;
const coachByConsensus = (x, y) => coachConsensusBand(x) - coachConsensusBand(y) || y.score - x.score;
// Good for you, then Toss-ups, then the ones that lean bad (user, 2026-11-04: selling Ja'Marr
// Chase listed two Leans bad deals first). Consensus only orders trades within those.
const COACH_LEVEL_ORDER = { good: 0, tossup: 1, bad: 2 };
const coachLevelRank = r => COACH_LEVEL_ORDER[Vault.verdictTier(r.score).level] ?? 1;
// Among those, 2-for-1s before 1-for-1s, anything bigger after (user, 2026-11-04). In the 2.15M
// trades of Trade Lab, 2-for-1s are the most common deal (27.8%, 1-for-1s 26.5%) and land closer:
// typically 6.3% apart against 14.4%. Which way depends on you: at an even price the side
// that got fewer pieces was ahead later only 37% of the time, though consolidating helped
// contenders win titles. So contenders send two first, rebuilders get two first, and flexible
// teams either. Selling or down-tiering, you're the one getting more, so adding a piece of your
// own to it goes last: that's paying to sell.
const coachShapeRank = (give, get, goal) => {
  const sendTwo = give.length === 2 && get.length === 1, getTwo = give.length === 1 && get.length === 2, even = give.length === 1 && get.length === 1;
  const mode = Vault.teamMode(coachMe());
  const order = goal === 'sell' || goal === 'downtier' ? [getTwo, even, sendTwo]
    : mode === 'contend' ? [sendTwo, getTwo, even]
    : mode === 'rebuild' ? [getTwo, sendTwo, even]
    : [sendTwo || getTwo, even];
  const at = order.indexOf(true);
  return at < 0 ? order.length : at;
};
const coachConsensusText = r => (r.consensus ? `Consensus: ${r.consensus.text}` : '');
// You've named who you want: what of yours would get him, so the next step isn't
// picking one of your own players blind (user, 2026-11-03). Packages their manager
// would take that aren't bad for you, ones that read fair across the sites first.
const COACH_PACKAGES_SHOW = 5;
const COACH_TWO_LOOK = 20, COACH_TWO_SHOW = 3;
const coachStarterKeys = me => new Set((me.lineup || []).filter(s => s.id).map(s => 'p_' + s.id));
async function coachWorkPackages(w, seq, me) {
  w.packages = null;
  if (coachOpen()) renderCoach();
  await coachTick();
  if (Coach.work !== w || w.seq !== seq) return;
  const offers = coachOffers(me, w.partner, w.get, { limit: COACH_PACKAGES_SHOW * 3, perLead: 2, option: 'build' });
  w.packages = offers.map(o => ({ give: o.give, get: o.get, r: coachWorkRead(me, w, o.give, o.get) })).filter(p => p.r.yes && Vault.verdictTier(p.r.score).level !== 'bad')
    .sort((x, y) => coachLevelRank(x.r) - coachLevelRank(y.r) || coachShapeRank(x.give, x.get, w.goal) - coachShapeRank(y.give, y.get, w.goal) || coachByConsensus(x.r, y.r)).slice(0, COACH_PACKAGES_SHOW);
}
function coachWorkUsePackage(k) {
  const w = Coach.work, p = w?.packages?.[k]; if (!p) return;
  coachPush();
  w.give = [...p.give]; w.get = [...p.get]; w.packages = null;
  renderCoach(); coachWorkTweaks();
}
async function coachWorkTweaks() {
  const w = Coach.work, me = coachMe(); if (!w) return;
  const seq = ++w.seq; w.tweaks = null; w.season = null;
  // Nothing to judge until both sides have something.
  if (!w.give.length || !w.get.length) {
    w.tweaks = { more: [], less: [], yes: [], closer: [], two: [] };
    if (w.get.length) await coachWorkPackages(w, seq, me);
    if (coachOpen()) renderCoach();
    return;
  }
  // The season first: it's a moment of simulation, and it shows before the suggestions.
  await coachTick();
  if (Coach.work !== w || w.seq !== seq) return;
  w.season = coachSeasonRead(me, w);
  if (coachOpen()) renderCoach();
  await coachTick();
  if (Coach.work !== w || w.seq !== seq) return;
  const base = coachWorkRead(me, w), off = coachOffLimits(me), inGive = new Set(negKeys(w.give)), inGet = new Set(negKeys(w.get));
  const getVal = sumValue(w.get), giveVal = sumValue(w.give);
  // Never suggest dropping a Must go piece, or the pieces this trade is about.
  const locked = new Set([...Coach.mine.must, ...w.lock]);
  const mine = me.assets.filter(a => !inGive.has(a.key) && !off.has(a.key) && a.value >= 150);
  const cands = [];
  // Ask for one more of theirs.
  w.partner.assets.filter(a => !inGet.has(a.key) && !coachTheirOff(a) && a.value >= 150 && a.value <= Math.max(1500, 0.7 * getVal)).sort((x, y) => y.value - x.value).slice(0, 14)
    .forEach(a => cands.push({ kind: 'more', text: `Ask for their ${Vault.escapeHtml(a.name)} too`, give: w.give, get: [...w.get, a] }));
  // Send less: drop one of yours (not a Must go piece), or swap one for something cheaper.
  if (w.give.length > 1) w.give.filter(a => !locked.has(a.key)).forEach(a => cands.push({ kind: 'less', text: `Keep your ${Vault.escapeHtml(a.name)}`, give: w.give.filter(x => x !== a), get: w.get }));
  w.give.filter(a => !locked.has(a.key)).forEach(g => mine.filter(a => a.value < g.value * 0.97 && a.value >= g.value * 0.35).sort((x, y) => y.value - x.value).slice(0, 5)
    .forEach(a => cands.push({ kind: 'less', text: `Send your ${Vault.escapeHtml(a.name)} instead of ${Vault.escapeHtml(g.name)}`, give: w.give.map(x => (x === g ? a : x)), get: w.get })));
  // At a no: add one of yours, swap one up, or ask for one less of theirs.
  if (!base.yes) {
    // Every piece, not just ones near the gap: extra pieces count for less, so the piece that
    // gets to yes is often much bigger than the gap (Rashee Rice, 4,410, on a gap of 1,150).
    mine.filter(a => a.value >= 300)
      .forEach(a => cands.push({ kind: 'yes', add: true, text: `Add your ${Vault.escapeHtml(a.name)}`, give: [...w.give, a], get: w.get }));
    w.give.filter(a => !locked.has(a.key)).forEach(g => mine.filter(a => a.value > g.value * 1.03 && a.value <= g.value * 1.6).sort((x, y) => x.value - y.value).slice(0, 4)
      .forEach(a => cands.push({ kind: 'yes', text: `Send your ${Vault.escapeHtml(a.name)} instead of ${Vault.escapeHtml(g.name)}`, give: w.give.map(x => (x === g ? a : x)), get: w.get })));
    if (w.get.length > 1) w.get.filter(a => !Coach.theirs.must.includes(a.key) && !w.lockGet.includes(a.key)).forEach(a => cands.push({ kind: 'yes', text: `Don't ask for ${Vault.escapeHtml(a.name)}`, give: w.give, get: w.get.filter(x => x !== a) }));
  }
  const out = [], closer = [];
  for (let k = 0; k < cands.length; k++) {
    if (k % 12 === 11) { await coachTick(); if (Coach.work !== w || w.seq !== seq) return; }
    const c = cands[k], r = coachWorkRead(me, w, c.give, c.get), badForYou = Vault.verdictTier(r.score).level === 'bad';
    // At a no, a piece that gets them closest without reaching yes is still worth showing.
    if (!r.yes && c.add && !badForYou && r.room > base.room + 1) closer.push({ ...c, r });
    if (!r.yes || badForYou || !coachPiecesOK(c.give, c.get)) continue;
    if (c.kind !== 'yes' && r.score <= base.score + 0.5) continue; // only changes that help you
    out.push({ ...c, r });
  }
  const top = kind => out.filter(c => c.kind === kind).sort((x, y) => coachLevelRank(x.r) - coachLevelRank(y.r) || coachShapeRank(x.give, x.get, w.goal) - coachShapeRank(y.give, y.get, w.goal) || coachByConsensus(x.r, y.r)).slice(0, 4);
  // 7. Two of your bench pieces or picks that get to yes (user, 2026-11-04), when no one piece
  // does it and leaves you ahead. Starters never, like Even it out. Each piece aims well over
  // half the gap, since extra pieces count for less. Not bad for you, and a piece shows up
  // twice at most, so it isn't one player's list.
  const two = [];
  if (!base.yes && !top('yes').some(c => coachLevelRank(c.r) === 0)) {
    const tv = Vault.tradeSideValues(w.give, w.get), needVal = Math.max(-base.room, base.you - VAULT_CONFIG.FAIR_PCT + 0.5) / 100 * (tv.valueA + tv.valueB) / 2;
    // A piece that gets a yes alone doesn't need a partner: that's just paying more.
    const alone = new Set(out.filter(c => c.add).map(c => c.give[c.give.length - 1].key));
    const aim = needVal * 2.5, near = mine.filter(a => a.value >= 300 && !coachStarterKeys(me).has(a.key) && !alone.has(a.key)).sort((x, y) => Math.abs(x.value - aim) - Math.abs(y.value - aim)).slice(0, COACH_TWO_LOOK);
    if (needVal > 0) {
      let n = 0;
      for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
        if (++n % 24 === 0) { await coachTick(); if (Coach.work !== w || w.seq !== seq) return; }
        const give = [...w.give, near[i], near[j]], r = coachWorkRead(me, w, give, w.get);
        if (r.yes && coachPiecesOK(give, w.get) && Vault.verdictTier(r.score).level !== 'bad') two.push({ kind: 'two', text: `Add your ${Vault.escapeHtml(near[i].name)} and ${Vault.escapeHtml(near[j].name)}`, give, get: w.get, r, pair: [near[i].key, near[j].key] });
      }
    }
  }
  const seen = new Map(), twoShown = [];
  for (const c of two.sort((x, y) => coachLevelRank(x.r) - coachLevelRank(y.r) || coachByConsensus(x.r, y.r))) {
    if (twoShown.length >= COACH_TWO_SHOW || c.pair.some(k => (seen.get(k) || 0) >= 2)) continue;
    c.pair.forEach(k => seen.set(k, (seen.get(k) || 0) + 1));
    twoShown.push(c);
  }
  w.tweaks = { more: top('more'), less: top('less'), yes: top('yes'), closer: closer.sort((x, y) => y.r.room - x.r.room).slice(0, 4), two: twoShown };
  if (coachOpen()) renderCoach();
}
function coachWorkApply(kind, k) {
  const w = Coach.work, c = w && w.tweaks && w.tweaks[kind][k];
  if (!c) return;
  coachPush();
  w.give = [...c.give]; w.get = [...c.get];
  renderCoach(); coachWorkTweaks();
}
function coachWorkEdit(side, key, add) {
  const w = Coach.work, me = coachMe(); if (!w) return;
  const pool = side === 'give' ? me.assets : w.partner.assets, a = pool.find(x => x.key === key);
  if (!a) return;
  coachPush();
  if (add) { if (!w[side].includes(a)) w[side] = [...w[side], a]; }
  else w[side] = w[side].filter(x => x !== a);
  renderCoach(); coachWorkTweaks();
}
// The trade as it stands, into the builder (your team as Team A).
const coachWorkToBuilder = () => { const w = Coach.work; if (w) coachLoadTrade({ partner: w.partner, give: w.give, get: w.get }); };
// Done with the Coach: the pop-up closes on the trade in the builder, and the next open starts fresh.
function coachWorkLoad() {
  coachWorkToBuilder();
  coachFresh();
  coachToTrade();
}
function coachWorkNegotiate(btn) {
  coachWorkToBuilder();
  Coach.option = 'negotiate';
  renderCoach();
  negOffer(btn);
}
function coachNegBack() { Coach.option = 'coach'; renderCoach(); coachWorkTweaks(); }
function coachWorkShare(btn) { coachWorkToBuilder(); shareTrade(btn); }
// The two sides, each with its add box.
function coachSlipHtml(me, w) {
  const n = v => Math.round(v).toLocaleString(), off = coachOffLimits(me), inGive = new Set(negKeys(w.give)), inGet = new Set(negKeys(w.get));
  const piece = (a, side) => `<div class="flex items-center justify-between gap-2 py-1.5 border-t border-white/[0.05] first:border-t-0">
      <span class="min-w-0 truncate text-[13px] text-zinc-100">${coachEsc(a.name)} <span class="text-[11px] text-zinc-500">${a.type === 'pick' ? (a.tier || 'pick') : a.pos}</span></span>
      <span class="flex items-center gap-2 shrink-0"><span class="text-[11px] mono text-zinc-500">${n(a.value)}</span><button onclick="coachWorkEdit('${side}', '${a.key}', false)" aria-label="Take ${coachEsc(a.name)} off" class="px-1 text-zinc-500 hover:text-white">×</button></span>
    </div>`;
  const addSel = (side, list, label) => `<select data-search="+ Type a player or pick…" onchange="coachWorkEdit('${side}', this.value, true)" aria-label="${label}" class="mt-2 w-full text-[12px] px-2 py-1 rounded-lg border border-white/10 text-zinc-400 bg-black/40"><option value="">${label}</option>${list.sort((x, y) => y.value - x.value).map(a => `<option value="${a.key}">${coachEsc(a.name)}${a.type === 'player' ? ` (${a.pos})` : ''} · ${n(a.value)}</option>`).join('')}</select>`;
  const side = (word, list, key, add) => `<div class="p-3 rounded-lg bg-black/30 border border-white/5 min-w-0"><div class="text-[11px] text-zinc-400 uppercase tracking-wider mb-1 truncate">${word}</div>${list.map(a => piece(a, key)).join('') || '<div class="py-2 text-[12px] text-zinc-500">Nothing yet.</div>'}${add}</div>`;
  return `<div class="grid gap-3 sm:grid-cols-2">
      ${side(`${coachEsc(me.teamName)} sends`, w.give, 'give', addSel('give', me.assets.filter(a => !inGive.has(a.key) && !off.has(a.key) && a.value >= 100), '+ Add one of yours…'))}
      ${side(`${coachEsc(me.teamName)} gets`, w.get, 'get', addSel('get', w.partner.assets.filter(a => !inGet.has(a.key) && !coachTheirOff(a) && a.value >= 100), '+ Ask for one of theirs…'))}
    </div>`;
}
function coachWorkHtml(me) {
  const w = Coach.work, esc = Vault.escapeHtml;
  // One side still empty: what's next, and offers or hints; no read yet.
  if (!w.give.length || !w.get.length) { w.read = null; return coachBuildStartHtml(me, w); }
  const r = coachWorkRead(me, w);
  w.read = r;
  const tier = Vault.verdictTier(r.score), pc = v => `${Math.round(Math.abs(v))}%`;
  const why = r.yes
    ? (r.room >= 2 && !(w.tweaks && !w.tweaks.more.length && !w.tweaks.less.length) ? `You likely have room to ask for about ${pc(r.room)} more value.` : 'That\'s about as far as they\'d go.')
    : (() => {
        // How far off: their will against what they ask, or the price past Fair in your favor.
        const need = Math.max(-r.room, r.you - VAULT_CONFIG.FAIR_PCT + 0.5), worry = r.j.concerns.filter(c => c.w < 0).sort((a, b) => a.w - b.w)[0];
        const reason = worry ? `: ${esc(worry.text.replace(/<[^>]+>/g, '').replace(/\.$/, ''))}` : '';
        return need > 0 ? `They'd want about ${pc(need)} more value, or less to worry about${reason}.` : `The value works, but it reads as a bad trade for their team or too lopsided on KTC's calculator${reason}.`;
      })();
  // The read pulses for a moment when the trade changes; a redraw partway through (the
  // ways to make it better arriving) carries on from the same point.
  const key = [...negKeys(w.give), '|', ...negKeys(w.get)].join(), now = Date.now();
  if (Coach.readKey !== key) { if (Coach.readKey) Coach.readAt = now; Coach.readKey = key; }
  const age = now - (Coach.readAt || 0), pulse = age < 700 ? ` coach-pulse" style="animation-delay:-${age}ms` : '';
  const tweakRows = (kind, title) => {
    const list = w.tweaks ? w.tweaks[kind] : [];
    if (!list.length) return '';
    return `<div class="mt-5"><div class="text-[12px] text-zinc-400 mb-2">${title}</div><div class="grid gap-2">${list.map((c, k) => { const t = Vault.verdictTier(c.r.score); return coachChoice(`coachWorkApply('${kind}', ${k})`, c.text,
        `for you <span class="font-medium ${Vault.VERDICT_TIER_TEXT[t.key]}">${t.label}</span>, ${esc(coachMe().teamName)} pays ${pc(c.r.you)} ${c.r.you >= 0 ? 'under' : 'over'} trade value${c.r.consensus ? `, consensus: ${c.r.consensus.text}` : ''}${kind === 'yes' || kind === 'two' ? '' : kind === 'closer' ? `, they'd still want about ${pc(Math.max(-c.r.room, c.r.you - VAULT_CONFIG.FAIR_PCT + 0.5))} more` : `, room left ${c.r.room >= 2 ? `about ${pc(c.r.room)}` : 'about none'}`}`,
        '<span class="shrink-0 text-[12px] text-amber-200">Apply</span>', false); }).join('')}</div></div>`;
  };
  const oneRows = tweakRows('yes', 'One piece that gets them to yes, best for you first');
  const noRows = oneRows + tweakRows('two', oneRows ? 'Or two pieces, keeping your starters' : 'No single piece gets them to yes. Two pieces do') || tweakRows('closer', 'No single piece gets them to yes. These get them closest');
  const tweaks = w.tweaks == null ? '<div class="text-[12px] text-zinc-500 mt-5">Looking for ways to make it better…</div>'
    : (r.yes ? tweakRows('more', 'Ask for more (they\'d still say yes)') + tweakRows('less', 'Send less (they\'d still say yes)') : noRows)
      || `<div class="text-[12px] text-zinc-500 mt-5">${r.yes ? 'No one-step change helps you and keeps them at yes: this one is as good as it gets.' : 'No single piece of yours moves them much. Try a bigger piece, or ask for less.'}</div>`;
  return `<div class="p-4 rounded-xl mb-4 ${r.yes ? 'bg-emerald-500/[0.07] border border-emerald-500/25' : 'bg-orange-500/[0.07] border border-orange-500/25'}${pulse}">
      <div class="display text-[24px] leading-tight ${r.yes ? 'text-emerald-300' : 'text-orange-300'}">${esc(w.partner.teamName)} would likely say ${r.yes ? 'yes' : 'no'}</div>
      <div class="text-[13px] text-zinc-300 mt-1">${why}</div>
    </div>
    ${coachSlipHtml(me, w)}
    <div class="grid gap-3 grid-cols-2 sm:grid-cols-3 mt-4">
      <div class="min-w-0"><div class="text-[11px] text-zinc-500 truncate">For ${esc(me.teamName)}</div><div class="text-[18px] font-semibold ${Vault.VERDICT_TIER_TEXT[tier.key]}">${tier.label}</div></div>
      <div class="min-w-0"><div class="text-[11px] text-zinc-500 truncate">For ${esc(w.partner.teamName)}</div><div class="text-[18px] font-semibold ${Vault.VERDICT_TIER_TEXT[r.them.tier]}">${r.them.label}</div></div>
      <div class="min-w-0 col-span-2 sm:col-span-1"><div class="text-[11px] text-zinc-500 truncate">${esc(me.teamName)} pays</div><div class="text-[18px] font-semibold text-zinc-100">${Math.abs(r.you) < 1 ? 'even' : `${pc(r.you)} ${r.you > 0 ? 'under' : 'over'}`} <span class="text-[12px] font-normal text-zinc-500">trade value</span></div></div>
      ${r.consensus ? `<div class="col-span-2 sm:col-span-3 text-[12px] text-zinc-400">Consensus: <span class="text-zinc-200">${r.consensus.text}</span></div>` : ''}
    </div>
    ${coachSeasonHtml(w.season)}
    ${tweaks}`;
}

/* ---------- Target picker ---------- */

/* ---------- Render ---------- */

// One Trade Coach option. Leads with the price you'd pay, said the way people talk about prices:
// "5% under trade value" (you'd get more value than you send; over = you'd overpay), and, when
// the pieces have market reads, the same against what managers actually pay ("31% under market
// price"). Then the pieces, one line of why, and the button.
// Your title odds before → after, in season (the calculator's This season box,
// same simulation): for a team already headed to the playoffs, the title is where
// a trade shows up. In accepted 2024-2025 trades (VaultValues coach-backtest.js),
// contenders at 85%+ playoff odds won the title 1.35x as often as their odds said
// after trades adding 6+ points a week, 1.12x (the same as any team that traded)
// after ones adding about none. Hidden when both are under 1%.
function coachTitleOdds(o) {
  const s = coachSeasonOdds(o);
  return s && !(s.before < 1 && s.after < 1) ? s : null;
}
function coachSeasonOdds(o) {
  if (!remainingWeeks.length || typeof tradeSeasonOdds !== 'function') return null;
  const me = coachMe(), { next } = tradeSeasonOdds(me, o.partner, o.give, o.get);
  const was = seasonBase?.get(me.rosterId), now = next.get(me.rosterId);
  if (was?.championshipPct == null || now?.championshipPct == null) return null;
  return { before: was.championshipPct, after: now.championshipPct, playoffsBefore: was.playoffPct, playoffsAfter: now.playoffPct };
}
// What the trade does to your season: odds (the calculator's simulation), and who comes
// into your best lineup for whom, same position first, and points a week.
function coachSeasonRead(me, w) {
  const aft = coachAfter(me.rosterId, w.partner.rosterId, w.give, w.get), ids = l => new Set((l || []).map(s => s.id).filter(Boolean));
  const was = ids(me.lineup), now = ids(aft.lineup);
  const out = (me.lineup || []).filter(s => s.id && !now.has(s.id)), swaps = [];
  (aft.lineup || []).filter(s => s.id && !was.has(s.id)).forEach(s => {
    const i = Math.max(out.findIndex(x => x.pos === s.pos), 0), gone = out.splice(i, 1)[0];
    swaps.push(gone ? `${coachEsc(s.name)} replaces ${coachEsc(gone.name)}` : `${coachEsc(s.name)} starts`);
  });
  out.forEach(s => swaps.push(`${coachEsc(s.name)} leaves your lineup`));
  return { odds: coachSeasonOdds({ partner: w.partner, give: w.give, get: w.get }), gain: aft.opt - me.opt, swaps };
}
function coachSeasonHtml(s) {
  if (!s) return '<div class="text-[12px] text-zinc-500 mt-3">Working out what it does to your season…</div>';
  const pc = v => (v > 0 && v < 1 ? '<1' : v > 99 && v < 100 ? '>99' : Math.round(v)) + '%';
  const move = (label, a, b) => {
    const d = Math.round(b) - Math.round(a);
    return `<div class="min-w-0"><div class="text-[11px] text-zinc-500">${label}</div><div class="text-[18px] font-semibold text-zinc-100">${pc(a)} <span class="text-zinc-500" aria-hidden="true">→</span><span class="sr-only">to</span> ${pc(b)} <span class="text-[12px] font-medium ${d > 0 ? 'text-emerald-300' : d < 0 ? 'text-orange-300' : 'text-zinc-500'}">${d ? `${d > 0 ? '+' : '−'}${Math.abs(d)}` : 'no change'}</span></div></div>`;
  };
  const o = s.odds, cells = !o ? [] : [
    o.before >= 1 || o.after >= 1 ? move('Your title odds', o.before, o.after) : '',
    (o.playoffsBefore < 99.5 || o.playoffsAfter < 99.5) && (o.playoffsBefore >= 0.5 || o.playoffsAfter >= 0.5) ? move('Your playoff odds', o.playoffsBefore, o.playoffsAfter) : '',
  ].filter(Boolean);
  const pts = Math.abs(s.gain) < 0.05 ? 'no change in points a week' : `${s.gain > 0 ? '+' : '−'}${Math.abs(s.gain).toFixed(1)} pts a week`;
  return `<div class="mt-3 pt-3 border-t border-white/[0.06]">
      ${cells.length ? `<div class="grid gap-3 grid-cols-2 sm:grid-cols-3 mb-2">${cells.join('')}</div>` : ''}
      <div class="text-[12px] text-zinc-400">${s.swaps.length ? `<span class="text-zinc-200">${s.swaps.join(', ')}</span> · ${pts}` : 'Your starting lineup stays the same.'}</div>
    </div>`;
}
// Negotiate option: a prompt to offer the loaded trade. Once rounds exist
// they render below and this stays empty.
function coachNegotiateHtml() {
  if (Negotiation.rounds.length) return '';
  const ready = selectedA.size && selectedB.size;
  return `<div class="p-3 rounded-xl bg-black/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <span class="text-[12px] text-zinc-300">${ready ? `Ready: ${negNames(negAssets('A', [...selectedA]))} for ${negNames(negAssets('B', [...selectedB]))}.` : 'Add pieces to both sides of the calculator below, then offer it here.'}</span>
      ${ready ? `<button onclick="negOffer(this)" class="self-start sm:self-auto shrink-0 text-[12px] px-4 py-1.5 rounded-lg btn-gold-solid">Offer to ${Vault.escapeHtml(teamOf(negOther(negOfferingSide())).teamName)}</button>` : ''}
    </div>`;
}

// What to do with one of your own players, and with a position.
const COACH_GOALS = { upgrade: 'Upgrade', downtier: 'Down-tier', sell: 'Sell' };
const coachFlow = () => (Coach.flow ||= { step: 'what', what: null, pos: 'RB', sort: 'points', myKey: null, goal: null, posGoal: 'upgrade' });
const coachEsc = s => Vault.escapeHtml(s);
const coachPosNeed = (team, pos) => !!pos && Vault.positionalProfile(team, teams).needs.includes(String(pos).toLowerCase());
const coachChip = (on, label, onclick, extra = '') => `<button onclick="${onclick}" class="text-[12px] px-3 py-1.5 rounded-lg border transition-colors ${on ? 'bg-white/[0.08] border-white/25 text-white' : 'border-white/10 text-zinc-400 hover:text-white hover:border-white/20'}">${label}${extra}</button>`;
// One choice on a step: the whole row is the button, and clicking it moves on.
const coachChoice = (onclick, title, sub = '', right = '', arrow = true) => `<button onclick="${onclick}" class="w-full flex items-center gap-3 px-3.5 py-2.5 text-left rounded-xl border border-white/[0.08] bg-white/[0.02] hover:border-amber-400/40 hover:bg-amber-400/[0.04] focus-visible:border-amber-400/60 outline-none transition-colors">
    <span class="min-w-0 flex-1"><span class="block text-[14px] text-zinc-100">${title}</span>${sub ? `<span class="block text-[12px] text-zinc-400 mt-0.5">${sub}</span>` : ''}</span>
    ${right}${arrow ? '<span class="shrink-0 text-zinc-500" aria-hidden="true">›</span>' : ''}
  </button>`;
const coachAsk = (text, sub = '') => `<div class="mb-4"><h3 class="display text-[26px] leading-tight text-zinc-100">${text}</h3>${sub ? `<p class="text-[13px] text-zinc-400 mt-1">${sub}</p>` : ''}</div>`;

/* ---------- Steps ----------
   (User, 2026-11-04: "visually change the coach? maybe make it a pop up window? and every
   decision updates and takes to next step?") One decision a screen. Each decision saves where
   you were (coachPush), so Back undoes exactly one, trade edits included, and each fills in
   its stop on the rail. Steps: what → goal → send (a position's who) → pick → build. A
   player or team named at the start goes straight to build. */
const coachSnap = () => ({ f: { ...coachFlow(), trail: null }, work: Coach.work && { ...Coach.work } });
function coachPush() { const s = coachSnap(), f = coachFlow(); (f.trail ||= []).push(s); }
// One decision: save, change, show the next step.
function coachGo(step, change) {
  coachPush();
  const f = coachFlow();
  change?.(f);
  f.step = step;
  Coach.option = 'coach';
  renderCoach();
}
function coachRestore(i) {
  const trail = coachFlow().trail || [], s = trail[i];
  if (!s) return;
  // A list still being worked out when it was saved is worked out again.
  Coach.flow = { ...s.f, trail: trail.slice(0, i), recs: s.f.recs?.list ? s.f.recs : null, aimRun: s.f.aimRun?.list ? s.f.aimRun : null };
  // A new object, so anything still running for the trade you left stops.
  Coach.work = s.work && { ...s.work, tweaks: null, packages: null, season: null, seq: 0 };
  Coach.option = 'coach';
  renderCoach();
  if (Coach.work && Coach.flow.step === 'build') coachWorkTweaks();
}
function coachBack() { coachRestore((coachFlow().trail || []).length - 1); }
function coachRewind(step) {
  const trail = coachFlow().trail || [];
  for (let i = trail.length - 1; i >= 0; i--) if (trail[i].f.step === step) return coachRestore(i);
}
function coachFlowSet(k, v) { coachFlow()[k] = v; renderCoach(); }
// Into Build it with a starting trade.
// goal: what you're doing with your own player (upgrade, downtier, sell), for the hints.
// lock: the pieces of yours this trade is about (the player you're upgrading, down-tiering
// or selling). They and whoever you came for stay put in the suggestions; you can still take
// them off by hand. (The old rule read Coach.upKey, which nothing has set since the rebuild,
// so upgrading Jonathan Taylor could suggest sending Trey McBride instead of him.)
function coachBuildFrom(partner, give, get, goal = null, lock = give) {
  if (!partner) return;
  coachPush();
  Coach.option = 'coach';
  Coach.work = { partner, give: [...give], get: [...get], option: 'build', goal, lock: goal ? negKeys(lock) : [], lockGet: negKeys(get), tweaks: null, seq: 0 };
  coachFlow().step = 'build';
  if (!coachOpen()) setView('coach');
  renderCoach();
  coachWorkTweaks();
}
const coachOwner = key => teams.find(t => t !== coachMe() && t.assets.some(a => a.key === key));
function coachPickPlayer(key) {
  const t = coachOwner(key), a = t?.assets.find(x => x.key === key);
  if (!t) return;
  Object.assign(coachFlow(), { what: 'target', startName: a.name });
  coachBuildFrom(t, [], [a]);
}
function coachPickTeam(id) {
  const t = teams.find(x => String(x.rosterId) === String(id));
  if (!t) return;
  Object.assign(coachFlow(), { what: 'team', startName: t.teamName });
  coachBuildFrom(t, [], []);
}
function coachPickDepth(key) { const t = coachOwner(key); if (t) coachBuildFrom(t, [], [t.assets.find(a => a.key === key)]); }
// A player from the one list: another team's goes straight to building; yours asks what to
// do next (a pick can only be sold, so that's skipped).
function coachPickAny(key) {
  if (!key) return;
  const a = coachMe().assets.find(x => x.key === key);
  if (!a) return coachPickPlayer(key);
  const pick = a.type === 'pick';
  coachGo(pick ? 'pick' : 'goal', f => Object.assign(f, { what: 'player', myKey: key, startName: a.name, upKeys: [key], goal: pick ? 'sell' : null, recs: null }));
}
// Upgrade, Down-tier, Sell or Add depth.
function coachChooseGoal(k) {
  const f = coachFlow();
  if (f.what === 'player') return coachGo('pick', x => { x.goal = k; x.recs = null; });
  coachGo(k === 'depth' ? 'pick' : 'send', x => { x.posGoal = k; x.upKeys = []; x.recs = null; });
}
// At a position: which of yours. One click moves on; the next step can add more.
function coachChooseSend(key) { if (key) coachGo('pick', f => { f.upKeys = [key]; f.recs = null; }); }
function coachPickMoveTeam(id) {
  const f = coachFlow(), t = teams.find(x => String(x.rosterId) === String(id)), a = coachMe().assets.find(x => x.key === f.myKey);
  if (t && a) coachBuildFrom(t, f.goal === 'upgrade' ? coachUpAssets() : [a], [], f.goal);
}
// Upgrade (user: "select a player or players that you are wanting to upgrade"): the players of
// yours being upgraded, sent together for one better player.
// Any of them can be unticked, the first one too (user, 2026-10-27: having to select another
// option to deselect the first was annoying).
function coachUpToggle(key) {
  const f = coachFlow(), l = f.upKeys || [];
  f.upKeys = l.includes(key) ? l.filter(k => k !== key) : [...l, key];
  renderCoach();
}
const coachUpAssets = () => (coachFlow().upKeys || []).map(k => coachMe().assets.find(a => a.key === k)).filter(Boolean);
// From the position list: your selected players there for the one you picked.
function coachPickUpgrade(key) {
  const t = coachOwner(key), give = coachUpAssets();
  if (t) coachBuildFrom(t, give, [t.assets.find(a => a.key === key)], give.length ? 'upgrade' : null);
}
// Your players to tick: only the ones ticked, each with ×, and a box to add another (the
// players in `list`, e.g. your others at the position, first). It listed every player you have
// there as buttons (user, 2026-10-28: cleaner, shorter).
function coachUpPickerHtml(me, list) {
  const up = new Set(coachFlow().upKeys || []), n = v => Math.round(v).toLocaleString();
  const chips = coachUpAssets().map(a => `<span class="inline-flex items-center gap-1 text-[12px] pl-2.5 pr-1 py-1 rounded-lg border bg-amber-400/10 border-amber-400/40 text-amber-100">${coachEsc(a.name)} <span class="opacity-60">${a.type === 'pick' ? 'pick' : a.pos} · ${n(a.value)}</span><button onclick="coachUpToggle('${a.key}')" aria-label="Take ${coachEsc(a.name)} off" class="px-1 text-amber-200/70 hover:text-white">×</button></span>`).join('');
  const rest = [...list, ...me.assets.filter(a => !list.includes(a)).sort((x, y) => y.value - x.value)].filter(a => a.value >= 300 && !up.has(a.key));
  return `<div class="flex flex-wrap items-center gap-1.5 mb-3"><span class="text-[12px] text-zinc-500 mr-1">Sending</span>${chips || '<span class="text-[12px] text-zinc-500">nobody yet</span>'}<select data-search="+ Add another of yours…" onchange="if (this.value) coachUpToggle(this.value)" aria-label="Add another of your players" class="text-[12px] px-2 py-1 rounded-lg border border-white/10 text-zinc-400 bg-black/40 max-w-[220px]"><option value="">+ Add another of yours…</option>${rest.map(a => `<option value="${a.key}">${coachEsc(a.name)}${a.type === 'player' ? ` (${a.pos})` : ''} · ${n(a.value)}</option>`).join('')}</select></div>`;
}

/* ---------- Recommended fits ----------
   (2026-10-27, user: "i want the coach to recommend options for building based on who i
   select, not just list everyone".) For what you've selected (players to upgrade, one to
   down-tier or sell), every realistic target is read as a one-for-the-selection trade with
   the same read as Build it (coachWorkRead: their manager's yes/no and room, your verdict):
     upgrade   better players at those positions (more value than the best you send, a point
               a game more from the position list), within reach of what you send
     downtier  lesser players at his position (40-92% of his value): room left = the extras
               you can ask for
     sell      picks and players 24 or younger worth 50-130% of him
   Likely yeses first, best for you first; then the closest noes. Each one's Build starts it. */
const COACH_REC_CANDS = 40, COACH_REC_SHOW = 8;
/* Superflex: does this trade leave them under two QBs worth starting (KTC 3,000+)? (User,
   2026-11-04: "they wouldnt do that if they dont have many back ups right?") Measured on 630,481
   judged 2025 Superflex trades (VaultValues qb-hole.js): a contender with exactly two sold one
   in 1.0% of its trades, against 5.5% with three and 18% with four or more, and 8% of
   contenders' QB sales left them short. Rebuilders did it in 31% of theirs, and teams out of
   the race in 48%. So goal lists skip these for a contender only; for anyone else the row
   says so. A trade you name yourself isn't touched. */
const COACH_QB_START = 3000;
function coachLeavesShort(t, give, get) {
  if (!slots.includes('SUPER_FLEX')) return false;
  const start = a => a.type === 'player' && a.pos === 'QB' && a.value >= COACH_QB_START;
  const sold = get.filter(start).length, back = give.filter(start).length;
  return sold > back && t.assets.filter(start).length - sold + back < 2;
}
// Their side of a fit, for selling it: their verdict and what they'd be getting that they need.
function coachForThem(t, give, r) {
  const thin = [...new Set(give.filter(a => a.type === 'player' && coachPosNeed(t, a.pos)).map(a => a.pos))];
  const later = !thin.length && Vault.teamMode(t) === 'rebuild' && give.some(a => a.type === 'pick' || (a.age > 0 && a.age <= 24));
  const why = thin.length ? `, they're thin at ${thin.join(' and ')}` : later ? `, they're building for later` : '';
  const short = coachLeavesShort(t, give, r.o.get) ? ', <span class="text-orange-300">leaves them short at QB</span>' : '';
  return `<span class="${Vault.VERDICT_TIER_TEXT[r.them.tier]}">${r.them.label}</span> for them${why}${short}`;
}
function coachRecSpec(me) {
  const f = coachFlow(), others = teams.filter(t => t !== me);
  // Cornerstones stay in, tagged (user, 2026-11-04: "dont hide the big boys"): you picked the
  // player, so the stars are the point of an upgrade. Goal lists skip them, because there you
  // named no one. A contender's last starting QBs sit under Left out, one click away.
  const players = filt => others.flatMap(t => t.assets.filter(a => !coachTheirOff(a) && filt(a)).map(a => ({ a, t })));
  let give, goal, cands;
  if (f.what === 'player') {
    const a = me.assets.find(x => x.key === f.myKey);
    if (!a || !f.goal) return null;
    goal = f.goal; give = goal === 'upgrade' ? coachUpAssets() : [a];
    if (!give.length) return null;
    const best = Math.max(...give.map(x => x.value)), reach = Math.max(best * 2.2, sumValue(give) * 1.3), pos = new Set(give.map(x => x.pos));
    cands = goal === 'upgrade' ? players(x => x.type === 'player' && pos.has(x.pos) && x.value > best * 1.05 && x.value <= reach).sort((x, y) => (y.a.ppg || 0) - (x.a.ppg || 0))
      : goal === 'downtier' ? players(x => x.type === 'player' && x.pos === a.pos && x.value >= a.value * 0.4 && x.value <= a.value * 0.92).sort((x, y) => y.a.value - x.a.value)
      : players(x => (x.type === 'pick' || (x.age > 0 && x.age <= 24)) && x.value >= a.value * 0.5 && x.value <= a.value * 1.3).sort((x, y) => Math.abs(x.a.value - a.value) - Math.abs(y.a.value - a.value));
  } else if (f.what === 'position' && (f.posGoal || 'upgrade') !== 'depth') {
    // The players you ticked at the position, for whichever of the three you chose.
    give = coachUpAssets(); goal = f.posGoal || 'upgrade';
    if (!give.length) return null;
    const best = Math.max(...give.map(x => x.value)), sum = sumValue(give), floor = Math.max(...give.map(x => x.ppg || 0)), reach = Math.max(best * 2.2, sum * 1.3);
    cands = goal === 'upgrade' ? players(x => x.type === 'player' && x.pos === f.pos && (x.ppg || 0) >= floor + 1 && x.value <= reach).sort((x, y) => (y.a.ppg || 0) - (x.a.ppg || 0))
      : goal === 'downtier' ? players(x => x.type === 'player' && x.pos === f.pos && x.value >= best * 0.4 && x.value <= best * 0.92).sort((x, y) => y.a.value - x.a.value)
      : players(x => (x.type === 'pick' || (x.age > 0 && x.age <= 24)) && x.value >= sum * 0.5 && x.value <= sum * 1.3).sort((x, y) => Math.abs(x.a.value - sum) - Math.abs(y.a.value - sum));
  } else return null;
  const lastQb = c => coachLeavesShort(c.t, give, [c.a]) && Vault.teamMode(c.t) === 'contend';
  const held = cands.filter(lastQb).sort((x, y) => y.a.value - x.a.value).slice(0, COACH_REC_SHOW);
  cands = cands.filter(c => !lastQb(c));
  return { key: JSON.stringify([f.what, goal, f.pos, negKeys(give)]), give, goal, cands: cands.slice(0, COACH_REC_CANDS), held };
}
async function coachRecsRun(spec) {
  const f = coachFlow(), me = coachMe(), out = [];
  f.recs = { key: spec.key, list: null };
  // Never finish inside the render that started it (a short list did, and the screen kept
  // "Checking the best fits…" over the results).
  await coachTick();
  const stale = () => coachFlow().recs?.key !== spec.key;
  if (stale()) return;
  for (let i = 0; i < spec.cands.length; i++) {
    if (i % 4 === 3) { await coachTick(); if (stale()) return; }
    const { a, t } = spec.cands[i];
    out.push({ a, t, r: coachWorkRead(me, { partner: t, give: spec.give, get: [a], option: 'build' }) });
  }
  if (stale()) return;
  // Down-tier and sell: their manager would take it but you'd be paying past Fair, so the
  // fit is real and the gap is the extras to ask for (it read "they'd want 70% more").
  out.forEach(x => { x.extras = spec.goal !== 'upgrade' && !x.r.yes && x.r.j.accepts && x.r.you <= -VAULT_CONFIG.FAIR_PCT; });
  const fit = x => x.r.yes || x.extras;
  const yes = out.filter(fit).sort(spec.goal === 'downtier' ? (x, y) => (y.r.yes ? 1 : 0) - (x.r.yes ? 1 : 0) || coachLevelRank(x.r) - coachLevelRank(y.r) || coachConsensusBand(x.r) - coachConsensusBand(y.r) || y.a.value - x.a.value : (x, y) => coachLevelRank(x.r) - coachLevelRank(y.r) || coachByConsensus(x.r, y.r));
  const no = out.filter(x => !fit(x)).sort((x, y) => y.r.room - x.r.room);
  // Close the gap (user, 2026-10-28): for the closest noes, the one piece of yours that gets
  // them to yes and leaves you best off (sized to what's missing on trade value), so a fit
  // that "wants 2% more" comes with what to add.
  const off = coachOffLimits(me), inGive = new Set(negKeys(spec.give));
  const pool = me.assets.filter(p => !inGive.has(p.key) && !off.has(p.key) && p.value >= 150);
  for (const x of no.slice(0, COACH_REC_SHOW)) {
    await coachTick(); if (stale()) return;
    for (const p of pool) {
      const r = coachWorkRead(me, { partner: x.t, give: [...spec.give, p], get: [x.a], option: 'build' });
      if (r.yes && coachLevelRank(r) < 2 && (!x.fix || (coachLevelRank(r) - coachLevelRank(x.fix.r) || coachByConsensus(r, x.fix.r)) < 0)) x.fix = { p, r };
    }
  }
  const fixed = no.filter(x => x.fix).sort((x, y) => coachLevelRank(x.fix.r) - coachLevelRank(y.fix.r) || coachByConsensus(x.fix.r, y.fix.r)), rest = no.filter(x => !x.fix);
  // The trade each fit would really be: with its added piece, or with the extras to ask for.
  const read = x => (x.fix && !x.r.yes ? x.fix.r : x.r), shape = x => (x.extras ? 0 : coachShapeRank(x.fix && !x.r.yes ? [...spec.give, x.fix.p] : spec.give, [x.a], spec.goal));
  const best = [...yes, ...fixed].sort((x, y) => coachLevelRank(read(x)) - coachLevelRank(read(y)) || shape(x) - shape(y));
  coachFlow().recs = { key: spec.key, list: [...best, ...rest].slice(0, COACH_REC_SHOW), yes: yes.length, fixed: fixed.length, total: out.length, give: negKeys(spec.give), goal: spec.goal };
  if (coachOpen() && coachFlow().step === 'pick') renderCoach();
}
// One from Left out: what you selected for him, to work out from there.
function coachHeldBuild(key) {
  const spec = coachRecSpec(coachMe()), x = spec?.held.find(h => h.a.key === key);
  if (x) coachBuildFrom(x.t, spec.give, [x.a], spec.goal);
}
// Build a fit: what you selected, plus its gap-closing piece if it has one, for him.
function coachRecBuild(i) {
  const rec = coachFlow().recs, x = rec && rec.list && rec.list[i], me = coachMe();
  if (!x) return;
  const give = rec.give.map(k => me.assets.find(a => a.key === k)).filter(Boolean);
  coachBuildFrom(x.t, x.fix && !x.r.yes ? [...give, x.fix.p] : give, [x.a], rec.goal, give);
}
function coachRecsHtml(me, spec) {
  const f = coachFlow(), n = v => Math.round(v).toLocaleString(), pc = v => `${Math.round(Math.abs(v))}%`;
  // Who you'd expect here but isn't, one click from trying anyway. Open when it's all there is.
  const n0 = v => Math.round(v).toLocaleString();
  const heldHtml = open => !spec.held.length ? '' : `<details class="mt-4"${open ? ' open' : ''}><summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-[12px] text-zinc-400 hover:text-zinc-200">Left out: contenders' last starting QBs (${spec.held.length})</summary><div class="grid gap-2 mt-2">${spec.held.map(({ a, t }) => coachChoice(`coachHeldBuild('${a.key}')`, `${coachEsc(a.name)} <span class="text-[12px] text-zinc-500">${a.pos} · ${coachEsc(t.teamName)} · ${n0(a.value)}</span>`)).join('')}</div></details>`;
  if (!spec.cands.length) {
    if (spec.held.length) return heldHtml(true);
    // Upgrading someone nobody out-scores: say that, not just "nobody fits".
    const top = spec.goal === 'upgrade' ? [...spec.give].sort((x, y) => (y.ppg || 0) - (x.ppg || 0))[0] : null;
    return `<div class="text-[12px] text-zinc-500 py-2">${top && top.ppg ? `No ${coachEsc(top.pos)} on another team scores more than ${coachEsc(top.name)} (${top.ppg.toFixed(1)} pts/game) within reach of what you'd send. ${coachEsc(top.name)} is already the upgrade.` : 'Nobody on another team fits that. Try different players.'}</div>`;
  }
  if (!f.recs || f.recs.key !== spec.key) { coachRecsRun(spec); return '<div class="text-[12px] text-zinc-400 py-2">Finding the best fits…</div>'; }
  if (!f.recs.list) return '<div class="text-[12px] text-zinc-400 py-2">Finding the best fits…</div>';
  const best = Math.max(...spec.give.map(x => x.ppg || 0));
  const rows = f.recs.list.map(({ a, t, r, extras, fix }, i) => {
    const use = fix && !r.yes ? fix.r : r, tier = Vault.verdictTier(use.score), gain = a.type === 'player' && a.ppg && best ? a.ppg - best : null;
    const status = r.yes ? `<span class="text-emerald-300">Likely yes</span>${r.room >= 2 ? ` · room for about ${pc(r.room)} more${spec.goal === 'downtier' ? ' in extras' : ''}` : ''}`
      : extras ? `<span class="text-emerald-300">They'd take it</span> · ask for about ${pc(-r.you)} more in extras`
      : fix ? `Add your <span class="text-zinc-100">${coachEsc(fix.p.name)}</span> <span class="text-zinc-500">(${n(fix.p.value)})</span> → <span class="text-emerald-300">likely yes</span>`
      : `<span class="text-orange-300">They'd want about ${pc(Math.max(-r.room, r.you - VAULT_CONFIG.FAIR_PCT + 0.5))} more</span>`;
    return coachChoice(`coachRecBuild(${i})`, `${coachEsc(a.name)} <span class="text-[12px] text-zinc-500">${a.type === 'pick' ? 'pick' : a.pos} · ${coachEsc(t.teamName)} · ${n(a.value)}</span>`,
      `${status} · <span class="${Vault.VERDICT_TIER_TEXT[tier.key]}">${tier.label}</span> for you${gain != null ? ` · ${gain >= 0 ? '+' : '−'}${Math.abs(gain).toFixed(1)} pts/game` : ''}<br>${coachForThem(t, fix && !r.yes ? [...spec.give, fix.p] : spec.give, use)}${coachAsksCornerstone(t, [a]) ? ' · <span class="text-amber-200/90">their cornerstone, rarely traded</span>' : ''}${use.consensus ? ` · ${coachConsensusText(use)}` : ''}`);
  }).join('');
  const word = spec.goal === 'upgrade' ? 'would likely say yes' : 'would take it';
  const summary = f.recs.yes || f.recs.fixed ? [f.recs.yes ? `${f.recs.yes} ${word}` : '', f.recs.fixed ? `${f.recs.fixed}${f.recs.yes ? ' more' : ''} with one piece added` : ''].filter(Boolean).join(', ') : 'none would say yes yet; these are the closest';
  return `<div class="text-[12px] text-zinc-400 mb-2">${summary[0].toUpperCase()}${summary.slice(1)}.</div>
    <div class="grid gap-2">${rows}</div>${heldHtml(false)}`;
}

/* ---------- One line about your team (2026-10-28, user: "cleaner and flow more easily"):
   your record, odds, thin and deep spots and timeline (a small dropdown). ---------- */
function coachTeamLineHtml(me) {
  const { needs, surpluses } = Vault.positionalProfile(me, teams), P = l => l.map(x => x.toUpperCase()).join(', ');
  const rec = me.record && (me.record.wins + me.record.losses) ? `${me.record.wins}-${me.record.losses}${me.record.ties ? '-' + me.record.ties : ''}` : '';
  const title = seasonBase?.get(me.rosterId)?.championshipPct, pc = v => (v < 1 && v > 0 ? '<1' : Math.round(v)) + '%';
  const odds = remainingWeeks.length && Number.isFinite(me.playoffPct) ? `${pc(me.playoffPct)} playoffs${title != null ? `, ${pc(title)} title` : ''}` : '';
  const chosen = Vault.planOverride[me.rosterId] || 'auto', auto = Vault.MODE_LABEL[autoTimeline(me)];
  const opt = (v, l) => `<option value="${v}" ${chosen === v ? 'selected' : ''}>${l}</option>`;
  const bits = [rec, odds, needs.length ? `thin at <span class="text-rose-300">${P(needs)}</span>` : '', surpluses.length ? `deep at <span class="text-emerald-300">${P(surpluses)}</span>` : ''].filter(Boolean);
  return `<div class="text-[12px] text-zinc-400 flex flex-wrap items-center gap-x-2 gap-y-1">${bits.join(' · ')}${bits.length ? ' ·' : ''}
      <label class="inline-flex items-center gap-1">Timeline <select onchange="coachSetPlan(this.value)" aria-label="Your timeline" class="bg-black/40 border border-white/10 rounded-md px-1.5 py-0.5 text-[12px] text-zinc-200">${opt('auto', `Auto (${auto})`)}${opt('contend', 'Contending')}${opt('rebuild', 'Rebuilding')}</select></label></div>`;
}
// The rail: where you are, and each decision so far. A stop you've passed goes back to it.
const COACH_RAIL_AT = { what: 0, aims: 0, goal: 1, send: 1, pick: 2, build: 3 };
function coachRailHtml(me, neg) {
  const f = coachFlow(), w = Coach.work, at = neg ? 3 : COACH_RAIL_AT[f.step] ?? 0, trail = f.trail || [];
  const goal = f.what === 'player' ? (COACH_GOALS[f.goal] || '') : f.what === 'position' && f.posGoal ? (f.posGoal === 'depth' ? 'Add depth' : COACH_GOALS[f.posGoal]) : '';
  const sending = f.what === 'position' && f.posGoal !== 'depth' ? coachUpAssets().map(a => a.name).join(' + ') : '';
  const read = neg ? 'Negotiating' : w?.read ? (w.read.yes ? 'Likely yes' : 'Likely no') : '';
  const stops = [['Start', 'what', f.startName], ['Plan', 'goal', [goal, sending].filter(Boolean).join(' ')], ['Match', 'pick', f.what === 'team' ? '' : w?.partner.teamName], ['Trade', 'build', read]];
  return `<div class="grid grid-cols-4 gap-2 mt-3">${stops.map(([label, step, value], i) => {
    const now = i === at, shown = i <= at && value ? coachEsc(value) : '';
    const body = `<span class="block h-1 rounded-full ${now ? 'bg-amber-400' : i < at ? 'bg-amber-400/40' : 'bg-white/10'}"></span>
      <span class="block mt-1.5 text-[11px] uppercase tracking-wider ${now ? 'text-amber-200' : 'text-zinc-500'}">${label}</span>
      <span class="block min-h-[18px] text-[12px] truncate ${i === 3 && read === 'Likely yes' ? 'text-emerald-300' : i === 3 && read === 'Likely no' ? 'text-orange-300' : 'text-zinc-200'}" title="${shown}">${shown}</span>`;
    return i < at && trail.some(s => s.f.step === step) ? `<button onclick="coachRewind('${step}')" title="Back to ${label}" class="min-w-0 text-left hover:opacity-80 transition-opacity">${body}</button>` : `<div class="min-w-0"${now ? ' aria-current="step"' : ''}>${body}</div>`;
  }).join('')}</div>`;
}
function coachFootHtml(neg) {
  const f = coachFlow(), w = Coach.work, quiet = 'whitespace-nowrap text-[12px] sm:text-[13px] px-2.5 sm:px-3.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/20 transition-colors';
  const back = neg ? (w ? `<button onclick="coachNegBack()" class="${quiet}">← Back to the trade</button>` : '') : f.trail?.length ? `<button onclick="coachBack()" class="${quiet}">← Back</button>` : '';
  // One row on a phone too: the short words there.
  const done = !neg && f.step === 'build' && w?.give.length && w.get.length ? `<div class="flex items-center gap-1.5 sm:gap-2 ml-auto">
      <button onclick="coachWorkShare(this)" class="${quiet}">Copy<span class="hidden sm:inline"> offer</span> link</button>
      <button onclick="coachWorkLoad()" class="${quiet}"><span class="hidden sm:inline">Open in </span><span class="sm:hidden">B</span><span class="hidden sm:inline">b</span>uilder</button>
      <button onclick="coachWorkNegotiate(this)" class="whitespace-nowrap text-[12px] sm:text-[13px] px-3 sm:px-4 py-2 rounded-lg btn-gold-solid">Negotiate<span class="hidden sm:inline"> it</span></button>
    </div>` : '';
  return back || done ? `<div class="flex items-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-3 border-t border-white/[0.06]">${back}${done}</div>` : '';
}

/* ---------- Step 1: one search box ----------
   Type a player (yours or theirs), a position or a team. One of yours asks Upgrade / Down-tier
   / Sell next; a position goes to its page; their player or a team goes straight to building. */
function coachWhatHtml(me) {
  const n = v => Math.round(v).toLocaleString(), others = teams.filter(t => t !== me);
  const mine = me.assets.filter(a => a.value >= 300).sort((x, y) => y.value - x.value);
  const theirs = others.flatMap(t => t.assets.filter(a => a.type === 'player' && a.value >= 300).map(a => ({ a, t }))).sort((x, y) => y.a.value - x.a.value);
  const posOpt = p => `<option value="pos:${p}">${p}: upgrade, down-tier, sell or add depth${coachPosNeed(me, p) ? ' (you\'re thin here)' : ''}</option>`;
  const teamOpt = t => { const { needs } = Vault.positionalProfile(t, teams); return `<option value="team:${t.rosterId}">${coachEsc(t.teamName)} · ${Vault.MODE_LABEL[Vault.teamMode(t)] || ''}${needs.length ? ` · thin at ${needs.map(x => x.toUpperCase()).join(', ')}` : ''}</option>`; };
  return `${coachAsk('Who or what do you want to trade around?')}
    <select data-search="Type a player, a position (RB) or a team…" onchange="coachStartFrom(this.value)" aria-label="Start from a player, a position or a team" class="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[14px] outline-none focus:border-amber-400/40">
      <option value="">Type a player, a position (RB) or a team…</option>
      <optgroup label="Your players and picks">${mine.map(a => `<option value="${a.key}">${coachEsc(a.name)}${a.type === 'player' ? ` (${a.pos})` : ''} · yours · ${n(a.value)}</option>`).join('')}</optgroup>
      <optgroup label="Positions">${['QB', 'RB', 'WR', 'TE'].map(posOpt).join('')}</optgroup>
      <optgroup label="Teams">${others.map(teamOpt).join('')}</optgroup>
      <optgroup label="Other teams' players">${theirs.map(({ a, t }) => `<option value="${a.key}">${coachEsc(a.name)} (${a.pos}) · ${coachEsc(t.teamName)} · ${n(a.value)}</option>`).join('')}</optgroup>
    </select>
    <div class="text-[12px] text-zinc-500 mt-5 mb-2">Or start from a position</div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">${['QB', 'RB', 'WR', 'TE'].map(p => coachChoice(`coachStartFrom('pos:${p}')`, p, coachPosNeed(me, p) ? '<span class="text-rose-300">You\'re thin here</span>' : '')).join('')}</div>
    <div class="mt-5">${coachChoice("coachGo('aims')", 'Not sure? Start from a goal', 'More points, your title odds, rebuilding, selling high and more.')}</div>
    <div class="mt-6 pt-4 border-t border-white/[0.06]">${coachTeamLineHtml(me)}</div>`;
}
function coachStartFrom(v) {
  if (!v) return;
  if (v.startsWith('pos:')) { const pos = v.slice(4); return coachGo('goal', f => Object.assign(f, { what: 'position', pos, startName: pos, posGoal: null, upKeys: [], recs: null })); }
  if (v.startsWith('team:')) return coachPickTeam(v.slice(5));
  coachPickAny(v);
}

/* ---------- A goal instead of a name ----------
   (User, 2026-11-04: "what if the user doesnt know what they specifically want or the position,
   what about the other options? points, rebuilding etc".) This is the one place the Coach
   finds whole trades on its own, which it stopped doing on 2026-10-27 because a third of those
   lists failed the manager model. So every trade here has passed that model: each is read with
   coachWorkRead, the same read as the Trade step, and has to be a likely yes that isn't bad
   for you. Good for you first, then what the goal is after. One row per player, so it's a
   spread of ideas, and a row opens that trade on the Trade step to change as you like. */
const COACH_AIMS = {
  points: { label: 'Score more points', sub: 'Trades that add the most to your lineup.', ask: 'Trades that add the most points', blurb: 'Their players who would start for you, with what it could take.', none: 'No trade their manager would likely take adds a point a week or more to your lineup.' },
  title: { label: 'Win the title', sub: 'Trades that raise your title odds the most.', ask: 'Trades that raise your title odds', blurb: 'The trades that add the most points, run through the rest of the season.', none: 'No trade their manager would likely take raises your title odds.' },
  playoffs: { label: 'Make the playoffs', sub: 'Trades that raise your playoff odds the most.', ask: 'Trades that raise your playoff odds', blurb: 'The trades that add the most points, run through the rest of the season.', none: 'No trade their manager would likely take raises your playoff odds.' },
  strength: { label: 'Trade from your strength', sub: 'Your deep spots for help where you\'re thin.', ask: 'Trades from your strength', blurb: '', none: 'No team would likely take a trade like this right now.' },
  consolidate: { label: 'Turn depth into a star', sub: 'Two or more of yours for one better player.', ask: 'Trades that turn depth into a star', blurb: 'Your bench and picks for one player better than any of them.', none: 'No team would likely take several of yours for a better player right now.' },
  depth: { label: 'Add depth', sub: 'Cheap backups at your thinnest spot.' },
  future: { label: 'Build for the future', sub: 'Turn older players into picks and young players.', ask: 'Trades that build for the future', blurb: 'Your older players for picks and players 24 or younger.', none: 'No team would take a trade like this right now.' },
  younger: { label: 'Get younger, keep your points', sub: 'A younger player at the same spot.', ask: 'Trades that get younger without losing points', blurb: 'Your older players for younger ones at their position, your lineup about the same.', none: 'No trade their manager would likely take gets younger without costing you points.' },
  sellhigh: { label: 'Sell high', sub: 'Your players going for more than similar players.', ask: 'Sell high', blurb: 'Yours that go for more than similar players, sold above their KTC value.', none: 'None of your players is going for 8% or more over similar players with a deal that beats KTC value.' },
  buylow: { label: 'Buy low', sub: 'Their players going for less than similar players.', ask: 'Buy low', blurb: 'Theirs that go for less than similar players, bought below their KTC value.', none: 'No player going for 8% or more under similar players has a deal that beats KTC value.' },
  timing: { label: 'Buy before prices rise', sub: '', ask: 'Buy before prices rise', blurb: '', none: 'No trade their manager would likely take fits this right now.' },
};
const COACH_AIM_GROUPS = { now: ['Win now', ['points', 'title', 'playoffs']], shape: ['Reshape your roster', ['strength', 'consolidate', 'depth']], later: ['Build for later', ['future', 'younger']], market: ['Play the market', ['sellhigh', 'buylow', 'timing']] };
// Past where value starts sliding, by position (the age-27 cliff; QBs hold longer).
const COACH_AIM_AGE = { QB: 31, RB: 26, WR: 27, TE: 28 };
const COACH_AIM_SHOW = 8, COACH_AIM_TARGETS = 24, COACH_AIM_SELLERS = 6, COACH_AIM_ODDS = 12, COACH_AIM_MARKET = 8, COACH_AIM_KTC = 3;
// Season goals: whichever you're playing for, none once you're out of it or it's over.
function coachOddsAim(me) {
  if (!remainingWeeks.length || !Number.isFinite(me.playoffPct) || me.playoffPct < VAULT_CONFIG.OUT_OF_RACE_PCT) return null;
  return me.playoffPct >= COACH_CONTENDER_PCT ? 'title' : 'playoffs';
}
/* Positions that usually beat the rest of the market over the next three months from now
   (findings.json timing: KTC value, median, 2020-2026, against the median position; KTC's
   scale is relative, so most players drift down). 2+ points or it isn't shown. */
const COACH_TIMING_MIN = 2;
let coachTimingRead = null;
function coachTimingLoad() {
  if (coachTimingRead) return;
  coachTimingRead = { pos: [] };
  fetch('data/market-history/findings.json').then(r => (r.ok ? r.json() : null)).catch(() => null).then(f => {
    const rows = f?.timing?.byMonth, month = new Date().toLocaleDateString('en-US', { month: 'short' });
    if (!rows) return;
    const now = rows.map(r => ({ pos: r.pos, median: r.months.find(m => m.month === month)?.median })).filter(r => Number.isFinite(r.median));
    const mid = [...now].sort((a, b) => a.median - b.median)[(now.length - 1) >> 1]?.median ?? 0;
    coachTimingRead = { pos: now.filter(r => r.median - mid >= COACH_TIMING_MIN).map(r => ({ pos: r.pos, gain: Math.round(r.median - mid) })) };
    if (coachOpen() && coachFlow().step === 'aims') renderCoach();
  });
}
const coachTimingText = () => (coachTimingRead?.pos || []).map(p => `${p.pos}s`).join(' and ');
function coachStartAim(k) {
  if (k === 'depth') {
    const pos = coachDefaultPos();
    return coachGo('pick', f => Object.assign(f, { what: 'position', pos, startName: pos, posGoal: 'depth', upKeys: [], recs: null }));
  }
  coachGo('pick', f => Object.assign(f, { what: 'aim', aim: k, startName: COACH_AIMS[k].label, aimRun: null, recs: null }));
}
// The goals, one group after another, the ones that fit your timeline first.
function coachAimsHtml(me) {
  coachTimingLoad();
  const odds = coachOddsAim(me), mode = Vault.teamMode(me);
  const order = mode === 'rebuild' ? ['later', 'shape', 'market', 'now'] : mode === 'contend' ? ['now', 'shape', 'market', 'later'] : ['shape', 'now', 'later', 'market'];
  const shown = k => (k === 'title' || k === 'playoffs' ? k === odds : k === 'timing' ? coachTimingRead?.pos.length > 0 : true);
  const sub = k => (k === 'timing' ? `${coachTimingText()} usually gain on other positions from here.` : COACH_AIMS[k].sub);
  return coachAsk('What are you after?') + order.map(g => {
    const [label, keys] = COACH_AIM_GROUPS[g], list = keys.filter(shown);
    return `<div class="text-[12px] text-zinc-500 mt-4 first:mt-0 mb-2">${label}</div><div class="grid sm:grid-cols-2 gap-2">${list.map(k => coachChoice(`coachStartAim('${k}')`, COACH_AIMS[k].label, sub(k))).join('')}</div>`;
  }).join('');
}
async function coachAimRun(k) {
  const me = coachMe(), others = teams.filter(t => t !== me), run = { key: k, list: null, done: 0, of: 0 };
  coachFlow().aimRun = run;
  const stale = () => coachFlow().aimRun !== run;
  const show = () => { if (coachOpen() && coachFlow().step === 'pick') renderCoach(); };
  await coachTick();
  if (stale()) return;
  // Cornerstones stay in and the row tags them, as in Best fits (user, 2026-11-04).
  const players = filt => others.flatMap(t => t.assets.filter(a => a.type === 'player' && !coachTheirOff(a) && filt(a)).map(a => ({ a, t })));
  const gainOf = (t, give, get) => coachAfter(me.rosterId, t.rosterId, give, get).opt - me.opt;
  const beatsKtc = (give, get) => coachKtcPct(give, get) >= COACH_AIM_KTC;
  const out = [];
  // A trade that passes: a likely yes that isn't bad for you.
  const read = (t, give, get, extra = {}, also = () => true) => {
    const r = coachWorkRead(me, { partner: t, give, get, option: 'build' });
    if (r.yes && coachLevelRank(r) < 2 && !(coachLeavesShort(t, give, get) && Vault.teamMode(t) === 'contend') && also(r)) { const x = { t, give, get, r, ...extra }; out.push(x); return x; }
    return null;
  };
  // One target at a time, so the screen can count them off.
  const each = async (list, fn) => {
    run.of = list.length;
    for (const item of list) {
      fn(item);
      run.done++; show(); await coachTick();
      if (stale()) return false;
    }
    return true;
  };
  const offers = (a, t, protect = new Set()) => coachOffers(me, t, [a], { limit: 4, perLead: 2, option: 'build', protect });
  // Who would start for you, best upgrade first.
  const starters = (me.lineup || []).filter(s => s.id), floor = {};
  starters.forEach(s => { floor[s.pos] = Math.min(floor[s.pos] ?? Infinity, s.ppg); });
  const upgrades = () => players(a => a.ppg > 0 && floor[a.pos] != null && a.ppg >= floor[a.pos] + 1).sort((x, y) => (y.a.ppg - floor[y.a.pos]) - (x.a.ppg - floor[x.a.pos])).slice(0, COACH_AIM_TARGETS);
  const addPoints = ({ a, t }) => offers(a, t).forEach(o => { const gain = gainOf(t, o.give, o.get); if (gain >= 1) read(t, o.give, o.get, { lead: a.key, gain }); });
  let keep = true;
  if (k === 'points') keep = await each(upgrades(), addPoints);
  else if (k === 'title' || k === 'playoffs') {
    keep = await each(upgrades(), addPoints);
    if (keep) {
      // The season simulation is the slow part, so only the trades that add the most run it.
      const best = out.splice(0).sort((x, y) => coachLevelRank(x.r) - coachLevelRank(y.r) || y.gain - x.gain).filter((x, i, l) => l.findIndex(z => z.lead === x.lead) === i).slice(0, COACH_AIM_ODDS);
      run.done = 0; run.phase = 'Running the season';
      keep = await each(best, x => {
        const s = coachSeasonOdds({ partner: x.t, give: x.give, get: x.get });
        if (!s) return;
        const [was, now] = k === 'title' ? [s.before, s.after] : [s.playoffsBefore, s.playoffsAfter];
        if (now - was < 0.5) return;
        const pc = v => `${v > 0 && v < 1 ? '<1' : Math.round(v)}%`;
        out.push({ ...x, lift: now - was, note: `${k === 'title' ? 'Title' : 'Playoffs'} ${pc(was)} → ${pc(now)}` });
      });
    }
  } else if (k === 'consolidate') {
    const best = Math.max(...me.assets.filter(a => a.type === 'player').map(a => a.value)), bench = coachStarterKeys(me);
    keep = await each(players(a => a.value >= 3000 && a.value <= best * 1.3).sort((x, y) => y.a.value - x.a.value).slice(0, COACH_AIM_TARGETS), ({ a, t }) => offers(a, t, bench).forEach(o => {
      if (o.give.length >= 2 && o.get.length === 1 && Math.max(...o.give.map(x => x.value)) < a.value) read(t, o.give, o.get, { lead: a.key });
    }));
  } else if (k === 'strength') {
    const { needs, surpluses } = Vault.positionalProfile(me, teams), up = l => l.map(p => p.toUpperCase());
    const want = up(needs.length ? needs : [coachDefaultPos()]), deep = up(surpluses).filter(p => !want.includes(p));
    run.deep = deep; run.want = want;
    if (deep.length) {
      const keepOut = new Set(me.assets.filter(a => !(a.type === 'player' && deep.includes(a.pos))).map(a => a.key));
      const fits = t => deep.some(p => coachPosNeed(t, p));
      keep = await each(players(a => want.includes(a.pos) && a.ppg > 0 && a.value >= 1500).sort((x, y) => fits(y.t) - fits(x.t) || y.a.ppg - x.a.ppg).slice(0, COACH_AIM_TARGETS), ({ a, t }) => offers(a, t, keepOut).forEach(o => {
        read(t, o.give, o.get, { lead: a.key, both: o.give.some(x => coachPosNeed(t, x.pos)), gain: Math.max(0, gainOf(t, o.give, o.get)) || undefined });
      }));
    }
  } else if (k === 'future') {
    const sellers = me.assets.filter(a => a.type === 'player' && a.value >= 1000 && a.age >= COACH_AIM_AGE[a.pos]).sort((x, y) => y.value - x.value).slice(0, COACH_AIM_SELLERS);
    keep = await each(sellers, a => {
      others.flatMap(t => t.assets.filter(x => !coachTheirOff(x) && (x.type === 'pick' || (x.age > 0 && x.age <= 24)) && x.value >= a.value * 0.5 && x.value <= a.value * 1.3).map(x => ({ a: x, t })))
        .sort((x, y) => Math.abs(x.a.value - a.value) - Math.abs(y.a.value - a.value)).slice(0, 16).forEach(c => read(c.t, [a], [c.a], { lead: a.key }));
    });
  } else if (k === 'younger') {
    const olds = me.assets.filter(a => a.type === 'player' && a.value >= 1500 && a.age >= 26).sort((x, y) => y.age - x.age || y.value - x.value).slice(0, COACH_AIM_MARKET);
    keep = await each(olds, a => {
      players(x => x.pos === a.pos && x.age > 0 && x.age <= a.age - 2.5 && x.value >= a.value * 0.7 && x.value <= a.value * 1.25).sort((x, y) => (y.a.ppg || 0) - (x.a.ppg || 0)).slice(0, 12).forEach(({ a: b, t }) => {
        const gain = gainOf(t, [a], [b]);
        if (gain >= -1) read(t, [a], [b], { lead: a.key, drop: a.age - b.age, note: `${(a.age - b.age).toFixed(1)} years younger · ${Math.abs(gain) < 0.05 ? 'same points' : `${gain > 0 ? '+' : '−'}${Math.abs(gain).toFixed(1)} pts a week`}` });
      });
    });
  } else if (k === 'sellhigh' || k === 'buylow') {
    await marketLoad(league).catch(() => {});
    if (stale()) return;
    if (Market.data && !Market.data.failed) {
      const adj = a => marketPeerAdj(league, a), pc = v => `${Math.abs(Math.round(v))}%`;
      if (k === 'sellhigh') {
        const highs = me.assets.filter(a => a.value >= 1500 && adj(a) >= COACH_AIM_MARKET).sort((x, y) => adj(y) - adj(x)).slice(0, COACH_AIM_SELLERS);
        keep = await each(highs, a => {
          others.flatMap(t => t.assets.filter(x => !coachTheirOff(x) && x.value >= a.value * 0.9 && x.value <= a.value * 1.4).map(x => ({ a: x, t })))
            .sort((x, y) => Math.abs(x.a.value - a.value) - Math.abs(y.a.value - a.value)).slice(0, 16)
            .forEach(c => read(c.t, [a], [c.a], { lead: a.key, note: `${coachEsc(a.name)} goes ${pc(adj(a))} over similar players` }, () => beatsKtc([a], [c.a])));
        });
      } else {
        keep = await each(players(a => a.value >= 1500 && adj(a) <= -COACH_AIM_MARKET).sort((x, y) => adj(x.a) - adj(y.a)).slice(0, COACH_AIM_TARGETS), ({ a, t }) => offers(a, t).forEach(o => {
          read(t, o.give, o.get, { lead: a.key, note: `${coachEsc(a.name)} goes ${pc(adj(a))} under similar players` }, () => beatsKtc(o.give, o.get));
        }));
      }
    }
  } else if (k === 'timing') {
    const by = new Map((coachTimingRead?.pos || []).map(p => [p.pos, p.gain]));
    keep = await each(players(a => by.has(a.pos) && a.value >= 2000).sort((x, y) => y.a.value - x.a.value).slice(0, COACH_AIM_TARGETS), ({ a, t }) => offers(a, t).forEach(o => {
      read(t, o.give, o.get, { lead: a.key, note: `${a.pos}s usually gain about ${by.get(a.pos)}% on other positions over 3 months` });
    }));
  }
  if (!keep) return;
  const rank = (x, y) => coachLevelRank(x.r) - coachLevelRank(y.r)
    || (k === 'title' || k === 'playoffs' ? y.lift - x.lift : k === 'points' ? y.gain - x.gain : k === 'strength' ? (y.r.score + (y.both ? 3 : 0)) - (x.r.score + (x.both ? 3 : 0))
      : k === 'younger' ? y.drop * y.get[0].value - x.drop * x.get[0].value : k === 'consolidate' ? y.get[0].value - x.get[0].value : y.r.score - x.r.score);
  // Two teams' 2029 2nds read the same, so a sale shows once.
  const twice = new Set(['future', 'younger', 'sellhigh']), seen = new Map(), same = new Set(), list = [];
  for (const x of out.sort(rank)) {
    const n = seen.get(x.lead) || 0, id = negKeys(x.give).join() + '>' + x.get.map(a => a.name).join();
    if (list.length >= COACH_AIM_SHOW || n >= (twice.has(k) ? 2 : 1) || same.has(id)) continue;
    seen.set(x.lead, n + 1);
    same.add(id);
    list.push(x);
  }
  run.list = list;
  show();
}
function coachAimBuild(i) {
  const f = coachFlow(), x = f.aimRun?.list?.[i];
  if (x) coachBuildFrom(x.t, x.give, x.get, f.aim === 'future' || f.aim === 'sellhigh' ? 'sell' : null);
}
function coachAimHtml(me) {
  const f = coachFlow(), aim = COACH_AIMS[f.aim], run = f.aimRun;
  const blurb = f.aim === 'timing' ? `${coachTimingText()} usually gain on other positions over the next three months, so these are worth buying now.`
    : f.aim === 'strength' && run?.deep ? `Your ${run.deep.join(' and ')} for their ${run.want.join(' and ')}.` : aim.blurb;
  const head = coachAsk(aim.ask, blurb);
  if (!run || run.key !== f.aim) { coachAimRun(f.aim); return head + '<div class="text-[12px] text-zinc-400 py-2">Finding trades…</div>'; }
  if (!run.list) return `${head}<div class="text-[12px] text-zinc-400 py-2">${run.phase || 'Finding trades'}${run.of ? `: ${run.done} of ${run.of}` : '…'}</div>`;
  if (!run.list.length) {
    const none = f.aim === 'future' && !me.assets.some(a => a.type === 'player' && a.value >= 1000 && a.age >= COACH_AIM_AGE[a.pos]) ? 'Your roster has no older players worth selling.'
      : f.aim === 'strength' && !run.deep?.length ? 'Your roster doesn\'t have a deep spot to trade from right now.' : aim.none;
    return `${head}<div class="text-[13px] text-zinc-400 py-2">${none} Try another goal, or start from a player or position.</div>`;
  }
  const names = l => l.map(a => coachEsc(a.name)).join(' + ');
  return head + `<div class="text-[12px] text-zinc-400 mb-2">${run.list.length} their manager would likely take.</div><div class="grid gap-2">${run.list.map((x, i) => {
    const tier = Vault.verdictTier(x.r.score), note = x.note || (x.gain ? `+${x.gain.toFixed(1)} pts a week` : '');
    return coachChoice(`coachAimBuild(${i})`, `Get ${names(x.get)} <span class="text-zinc-400">for ${names(x.give)}</span>`,
      `${coachEsc(x.t.teamName)} · <span class="text-emerald-300">Likely yes</span> · <span class="${Vault.VERDICT_TIER_TEXT[tier.key]}">${tier.label}</span> for you${note ? ` · ${note}` : ''}<br>${coachForThem(x.t, x.give, x.r)}${coachAsksCornerstone(x.t, x.get) ? ' · <span class="text-amber-200/90">their cornerstone, rarely traded</span>' : ''}${x.r.consensus ? ` · ${coachConsensusText(x.r)}` : ''}`);
  }).join('')}</div>`;
}

/* ---------- Step 2: what to do with it ---------- */
function coachGoalHtml(me) {
  const f = coachFlow(), a = f.what === 'player' ? me.assets.find(x => x.key === f.myKey) : null;
  if (a) {
    const name = coachEsc(a.name);
    return coachAsk(`What's the plan for ${name}?`) + `<div class="grid gap-2">${[
      ['upgrade', 'Upgrade', `Send ${name} plus more for one better ${a.pos}.`],
      ['downtier', 'Down-tier', `Send ${name} for a lesser ${a.pos} plus more pieces.`],
      ['sell', 'Sell', `Send ${name} for picks and young players.`],
    ].map(([k, l, s]) => coachChoice(`coachChooseGoal('${k}')`, l, s)).join('')}</div>`;
  }
  const P = f.pos;
  return coachAsk(`What do you want to do at ${P}?`, coachPosNeed(me, P) ? '<span class="text-rose-300">You\'re thin here.</span>' : '') + `<div class="grid gap-2">${[
    ['upgrade', 'Upgrade', `Send one of your ${P}s plus more for a better one.`],
    ['downtier', 'Down-tier', `Send one of your ${P}s for a lesser one plus more pieces.`],
    ['sell', 'Sell', `Send one of your ${P}s for picks and young players.`],
    ['depth', 'Add depth', 'Cheap backups for bye weeks and injuries.'],
  ].map(([k, l, s]) => coachChoice(`coachChooseGoal('${k}')`, l, s)).join('')}</div>`;
}
/* ---------- A position: which of yours ---------- */
function coachSendHtml(me) {
  const f = coachFlow(), P = f.pos, n = v => Math.round(v).toLocaleString();
  const starters = (me.lineup || []).filter(s => s.id && s.pos === P);
  const weakest = starters.length ? starters.reduce((x, y) => (y.ppg < x.ppg ? y : x)) : null, weakKey = weakest && 'p_' + weakest.id;
  const isStarter = a => starters.some(s => 'p_' + s.id === a.key);
  const mine = me.assets.filter(x => x.type === 'player' && x.pos === P).sort((x, y) => (f.posGoal === 'upgrade' ? (y.key === weakKey) - (x.key === weakKey) : 0) || y.value - x.value);
  const rows = mine.map(a => coachChoice(`coachChooseSend('${a.key}')`, `${coachEsc(a.name)}${a.key === weakKey ? ' <span class="text-[12px] text-amber-200/90">weakest starter</span>' : ''}`,
    [isStarter(a) ? 'Starter' : 'Bench', a.age ? `${Math.round(a.age)} years old` : '', a.ppg ? `${a.ppg.toFixed(1)} pts/game` : ''].filter(Boolean).join(' · '), `<span class="shrink-0 text-[12px] mono text-zinc-400">${n(a.value)}</span>`)).join('');
  const rest = me.assets.filter(a => !mine.includes(a) && a.value >= 300).sort((x, y) => y.value - x.value);
  const verb = { upgrade: 'upgrading', downtier: 'down-tiering', sell: 'selling' }[f.posGoal];
  return coachAsk(`Which ${P} are you ${verb}?`, 'You can add more on the next step.') + `<div class="grid gap-2">${rows || `<div class="text-[12px] text-zinc-500">You have no ${P} to send.</div>`}</div>
    <div class="text-[12px] text-zinc-500 mt-4 mb-2">Or send someone else</div>
    <select data-search="Type one of your players or picks…" onchange="coachChooseSend(this.value)" aria-label="Send someone else" class="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-amber-400/40"><option value="">Type one of your players or picks…</option>${rest.map(a => `<option value="${a.key}">${coachEsc(a.name)}${a.type === 'player' ? ` (${a.pos})` : ''} · ${n(a.value)}</option>`).join('')}</select>`;
}

/* ---------- Step 3: the match ---------- */
function coachPickHtml(me) {
  const f = coachFlow(), others = teams.filter(t => t !== me), n = v => Math.round(v).toLocaleString();
  if (f.what === 'aim') return coachAimHtml(me);
  // A team's line: timeline, needs and depth, whether it needs the position in play, and a note for the goal.
  const teamRow = (t, onclick, pos, note = '') => {
    const { needs, surpluses } = Vault.positionalProfile(t, teams), P = l => l.map(x => x.toUpperCase()).join(', ');
    const need = pos && needs.includes(pos.toLowerCase());
    return coachChoice(onclick, `${coachEsc(t.teamName)}${need ? ` <span class="text-[12px] text-emerald-300">needs ${pos}</span>` : ''}${note ? ` <span class="text-[12px] text-amber-200/80">${note}</span>` : ''}`,
      `${Vault.MODE_LABEL[Vault.teamMode(t)] || ''}${needs.length ? ` · thin at ${P(needs)}` : ''}${surpluses.length ? ` · deep at ${P(surpluses)}` : ''}`);
  };
  const playerRows = (rows, pickFn) => `<div class="grid gap-2">${rows.map(({ a, t }) => coachChoice(`${pickFn}('${a.key}')`, coachEsc(a.name),
    `${coachEsc(t.teamName)}${a.age ? ` · ${Math.round(a.age)} years old` : ''}${a.ppg ? ` · ${a.ppg.toFixed(1)} pts/game` : ''}`, `<span class="shrink-0 text-[12px] mono text-zinc-400">${n(a.value)}</span>`)).join('') || '<div class="py-3 text-[12px] text-zinc-500">No one fits.</div>'}</div>`;
  const fold = (cls, summary, body) => `<details class="mt-4 group/${cls}"><summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-[12px] text-zinc-400 hover:text-zinc-200">${summary}</summary><div class="mt-2">${body}</div></details>`;

  if (f.what === 'player') {
    const a = me.assets.find(x => x.key === f.myKey);
    if (!a || !f.goal) return coachWhatHtml(me);
    const pos = a.type === 'player' ? a.pos : null;
    const ups = coachUpAssets(), upNames = ups.map(x => coachEsc(x.name)).join(' + ') || 'your players';
    const blurb = { upgrade: `Send ${upNames} plus more for one better player.`, downtier: `Send ${coachEsc(a.name)} for a lesser ${pos} plus more pieces.`, sell: `Send ${coachEsc(a.name)} for picks and young players.` }[f.goal];
    // Upgrading: the others going out too (same position shown first).
    const upPicker = f.goal === 'upgrade' ? coachUpPickerHtml(me, me.assets.filter(x => x.type === 'player' && x.pos === pos).sort((x, y) => y.value - x.value)) : '';
    // Teams that fit the goal first: upgrade, who has someone better than the best you're sending at
    // those positions; down-tier, who has a lesser one (and needs his position); sell, who needs it.
    const upPos = new Set(ups.map(x => x.pos)), best = Math.max(...ups.map(x => x.value)), upSum = sumValue(ups);
    const better = t => t.assets.filter(x => x.type === 'player' && upPos.has(x.pos) && x.value > best * 1.05 && x.value <= Math.max(best * 2.2, upSum * 1.3)).length;
    const lesser = t => t.assets.filter(x => x.type === 'player' && x.pos === pos && x.value > a.value * 0.4 && x.value <= a.value * 0.92).length;
    const fit = t => (f.goal === 'upgrade' ? better(t) : f.goal === 'downtier' ? lesser(t) + (coachPosNeed(t, pos) ? 1 : 0) : coachPosNeed(t, pos) ? 1 : 0);
    const note = t => { const k = f.goal === 'upgrade' ? better(t) : f.goal === 'downtier' ? lesser(t) : 0; return !k ? '' : `${k} ${f.goal === 'upgrade' ? 'better' : 'lesser'} ${f.goal === 'upgrade' ? [...upPos].join('/') : pos}${k > 1 ? 's' : ''}`; };
    const order = [...others].sort((x, y) => fit(y) - fit(x));
    // The best fits for what you selected, then any team yourself, folded.
    const spec = coachRecSpec(me);
    const recs = f.goal === 'upgrade' && !ups.length ? '<div class="text-[12px] text-zinc-500 py-2">Add at least one player to see the best fits.</div>' : spec ? coachRecsHtml(me, spec) : '';
    return coachAsk('Pick your best fit', blurb) + upPicker + recs + fold('teams', 'Or pick a team yourself', `<div class="grid gap-2">${order.map(t => teamRow(t, `coachPickMoveTeam('${t.rosterId}')`, pos, note(t))).join('')}</div>`);
  }
  // A position. Add depth: cheap backups who still score, nothing of yours going out yet.
  const P = f.pos, goal = f.posGoal;
  const starters = (me.lineup || []).filter(s => s.id && s.pos === P);
  const weakest = starters.length ? starters.reduce((x, y) => (y.ppg < x.ppg ? y : x)) : null;
  const weakAsset = weakest && me.assets.find(x => x.key === 'p_' + weakest.id);
  const pool = others.flatMap(t => t.assets.filter(a => a.type === 'player' && a.pos === P && a.value >= 300).map(a => ({ a, t })));
  const sortFn = f.sort === 'value' ? (x, y) => y.a.value - x.a.value : f.sort === 'young' ? (x, y) => (x.a.age || 99) - (y.a.age || 99) || y.a.value - x.a.value : (x, y) => (y.a.ppg || 0) - (x.a.ppg || 0);
  const sorts = [['points', 'Points a game'], ['value', 'Value'], ['young', 'Youngest']];
  const sortRow = `<div class="flex flex-wrap items-center gap-1.5 mb-3"><span class="text-[12px] text-zinc-500 mr-1">Sort by</span>${sorts.map(([k, l]) => coachChip((f.sort || 'points') === k, l, `coachFlowSet('sort', '${k}')`)).join('')}</div>`;
  if (goal === 'depth') {
    const cap = Math.min(3000, weakAsset ? weakAsset.value * 0.6 : 3000);
    const rows = pool.filter(({ a }) => a.value <= cap && (a.ppg || 0) > 0).sort(sortFn).slice(0, 40);
    return coachAsk(`Pick your backup ${P}`, `${P}s on other teams worth ${Math.round(cap).toLocaleString()} or less who still score.`) + sortRow + playerRows(rows, 'coachPickDepth');
  }
  const mineAtP = me.assets.filter(x => x.type === 'player' && x.pos === P).sort((x, y) => y.value - x.value);
  const ups = coachUpAssets(), names = ups.map(x => coachEsc(x.name)).join(' + ');
  const blurb = { upgrade: `Send ${names} plus more for one better ${P}.`, downtier: `Send ${names} for a lesser ${P} plus more pieces.`, sell: `Send ${names} for picks and young players.` }[goal];
  const spec = coachRecSpec(me);
  if (!spec) return coachAsk('Pick your best fit') + coachUpPickerHtml(me, mineAtP) + `<div class="text-[12px] text-zinc-500 py-1">Add at least one of yours to see the best fits.</div>`;
  // Upgrades: everyone who out-scores them, folded under the best fits.
  const floor = Math.max(...ups.map(x => x.ppg || 0)), rows = pool.filter(({ a }) => (a.ppg || 0) >= floor + 1).sort(sortFn).slice(0, 40);
  const everyone = goal !== 'upgrade' ? '' : fold('all', `Everyone who out-scores ${ups.length > 1 ? 'them' : coachEsc(ups[0].name)} (${rows.length})`, sortRow + playerRows(rows, 'coachPickUpgrade'));
  return coachAsk('Pick your best fit', blurb) + coachUpPickerHtml(me, mineAtP) + coachRecsHtml(me, spec) + everyone;
}

/* ---------- Step 3: build it ----------
   Hints, one piece at a time: while you're getting more than you give, pieces of yours
   that fill a need of theirs first, then the closest to what's missing; while you're
   giving more, pieces of theirs that fill a need of yours, then the closest. */
// gap: on trade value (Vault.tradeSideValues, the math the read uses) once both sides have
// something; at a no, at least the value their manager wants (r: coachWorkRead).
function coachHintsHtml(me, w, r = null) {
  const n = v => Math.round(v).toLocaleString();
  let gap = sumValue(w.get) - sumValue(w.give);
  if (w.give.length && w.get.length) {
    const tv = Vault.tradeSideValues(w.give, w.get), avg = (tv.valueA + tv.valueB) / 2;
    gap = tv.valueB - tv.valueA;
    if (r && !r.yes) gap = Math.max(gap, Math.max(-r.room, r.you - VAULT_CONFIG.FAIR_PCT + 0.5) / 100 * avg);
  }
  const inGive = new Set(negKeys(w.give)), inGet = new Set(negKeys(w.get));
  // Up to three that fill a need, closest to what's missing, then the closest of the rest.
  const rank = (list, need, target) => {
    const near = l => l.filter(a => a.value >= 300).sort((x, y) => Math.abs(x.value - target) - Math.abs(y.value - target));
    const needs = near(list.filter(need)).slice(0, 3);
    return [...needs, ...near(list.filter(a => !needs.includes(a)))].slice(0, 6);
  };
  const row = (title, list, side, needOf) => !list.length ? '' : `<div class="mt-3"><div class="text-[12px] text-zinc-400 mb-1.5">${title}</div><div class="flex flex-wrap gap-1.5">${list.map(a => `<button onclick="coachWorkEdit('${side}', '${a.key}', true)" class="text-[12px] px-2.5 py-1 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25">+ ${coachEsc(a.name)} <span class="text-zinc-500">${a.type === 'pick' ? 'pick' : a.pos} · ${n(a.value)}</span>${needOf(a) ? ` <span class="text-emerald-300">${needOf(a)}</span>` : ''}</button>`).join('')}</div></div>`;
  const theyNeed = a => (a.type === 'player' && coachPosNeed(w.partner, a.pos) ? `they need ${a.pos}` : '');
  const youNeed = a => (a.type === 'player' && coachPosNeed(me, a.pos) ? `you need ${a.pos}` : '');
  let html = '';
  if (w.get.length && gap > 0) html += row(`Pieces of yours they might want (about ${n(gap)} to make up on value)`, rank(me.assets.filter(a => !inGive.has(a.key)), theyNeed, gap), 'give', theyNeed);
  // Moving one of yours with a goal: what to ask for follows it, until something of theirs is in.
  const lead = w.goal && w.give[0], pos = lead && lead.pos;
  if (lead && !w.get.length) {
    const theirs = w.partner.assets.filter(a => !inGet.has(a.key));
    // Upgrade: better than the best you're sending, at any of their positions.
    const upPos = new Set(w.give.map(a => a.pos)), best = Math.max(...w.give.map(a => a.value));
    const list = w.goal === 'upgrade' ? theirs.filter(a => a.type === 'player' && upPos.has(a.pos) && a.value > best * 1.05).sort((x, y) => x.value - y.value).slice(0, 6)
      : w.goal === 'downtier' ? theirs.filter(a => a.type === 'player' && a.pos === pos && a.value >= lead.value * 0.4 && a.value <= lead.value * 0.92).sort((x, y) => y.value - x.value).slice(0, 6)
      : rank(theirs.filter(a => a.type === 'pick' || (a.age > 0 && a.age <= 24)), () => false, lead.value);
    const title = { upgrade: `Better ${[...upPos].join('/')}s of theirs to ask for (then add what it takes)`, downtier: `Lesser ${pos}s of theirs to ask for (then ask for more pieces)`, sell: 'Their picks and young players to ask for' }[w.goal];
    html += row(title, list, 'get', youNeed) || `<div class="mt-3 text-[12px] text-zinc-500">${coachEsc(w.partner.teamName)} has no ${w.goal === 'sell' ? 'picks or young players' : w.goal === 'upgrade' ? 'better ' + [...upPos].join('/') : 'lesser ' + pos} that fits. Try another team.</div>`;
  } else if (w.give.length && gap < 0) html += row(`Pieces of theirs you could ask for (about ${n(-gap)} to make up on value)`, rank(w.partner.assets.filter(a => !inGet.has(a.key)), youNeed, -gap), 'get', youNeed);
  if (!w.give.length && !w.get.length) {
    const atNeeds = w.partner.assets.filter(a => a.type === 'player' && coachPosNeed(me, a.pos));
    html += atNeeds.length ? row('Their players at your thin spots', rank(atNeeds, () => true, 5000), 'get', youNeed)
      : row('Their most valuable players', [...w.partner.assets].filter(a => a.type === 'player').sort((x, y) => y.value - x.value).slice(0, 6), 'get', youNeed);
  }
  return html;
}
// Build it with one side still empty: what's next, then offers or hints, then the two sides.
function coachBuildStartHtml(me, w) {
  const names = list => list.map(a => coachEsc(a.name)).join(' + ');
  const ask = !w.give.length && !w.get.length ? `What do you want from ${coachEsc(w.partner.teamName)}?`
    : !w.give.length ? `What would you send for ${names(w.get)}?`
    : `What do you want back for ${names(w.give)}?`;
  return `${coachAsk(ask, w.give.length || w.get.length ? `Dealing with ${coachEsc(w.partner.teamName)}.` : '')}
    ${coachPackagesHtml(w)}
    ${coachHintsHtml(me, w)}
    <div class="mt-5">${coachSlipHtml(me, w)}</div>`;
}
function coachPackagesHtml(w) {
  if (w.give.length || !w.get.length) return '';
  const names = list => list.map(a => coachEsc(a.name)).join(' + ');
  const box = html => `<div><div class="text-[12px] text-zinc-400 mb-2">What it could take</div>${html}</div>`;
  if (!w.packages) return box('<div class="text-[12px] text-zinc-500 py-1">Finding offers they\'d take…</div>');
  if (!w.packages.length) return box(`<div class="text-[12px] text-zinc-500 py-1">No offer of yours gets a likely yes from ${coachEsc(w.partner.teamName)} without being bad for you. Try adding your own above.</div>`);
  const rows = w.packages.map((p, k) => {
    const tier = Vault.verdictTier(p.r.score), extra = p.get.filter(a => !w.get.includes(a));
    return coachChoice(`coachWorkUsePackage(${k})`, `Send ${names(p.give)}${extra.length ? ` <span class="text-zinc-400">and get ${names(extra)} too</span>` : ''}`,
      `<span class="text-emerald-300">Likely yes</span> · <span class="${Vault.VERDICT_TIER_TEXT[tier.key]}">${tier.label}</span> for you<br>${coachForThem(w.partner, p.give, p.r)}${p.r.consensus ? ` · ${coachConsensusText(p.r)}` : ''}`);
  }).join('');
  return box(`<div class="grid gap-2">${rows}</div>`);
}

const COACH_STEP_ORDER = { what: 0, aims: 1, goal: 1, send: 2, pick: 3, build: 4, neg: 5 };
function renderCoach() {
  const head = document.getElementById('coachHead'), box = document.getElementById('coachBody');
  if (!head || !coachOpen()) return;
  const me = coachMe(), neg = Coach.option === 'negotiate', f = coachFlow(), step = neg ? 'neg' : f.step;
  // The body first: it works out the read the rail shows.
  const html = neg ? `<div class="text-[13px] text-zinc-400 mb-3">Offer the trade loaded in the builder. Their manager answers in their own words, and you can steer what you ask for next.</div>${coachNegotiateHtml()}`
    : step === 'build' && Coach.work ? coachWorkHtml(me) : step === 'pick' ? coachPickHtml(me) : step === 'send' ? coachSendHtml(me) : step === 'goal' ? coachGoalHtml(me) : step === 'aims' ? coachAimsHtml(me) : coachWhatHtml(me);
  head.innerHTML = `
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0 flex items-baseline gap-2.5"><h2 id="coachTitle" class="display text-[22px] leading-none gold-text">Trade Coach</h2><span class="text-[12px] text-zinc-500 truncate">${coachEsc(me.teamName)}</span></div>
      <button onclick="setView('builder')" aria-label="Close Trade Coach" class="shrink-0 size-8 -mr-1.5 rounded-lg text-[20px] leading-none text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors">×</button>
    </div>
    ${neg && !Coach.work ? '' : coachRailHtml(me, neg)}`;
  coachSync();
  const from = Coach.shownStep, moved = from !== step;
  Coach.shownStep = step;
  box.innerHTML = `<div class="${!moved || from == null ? '' : COACH_STEP_ORDER[step] < COACH_STEP_ORDER[from] ? 'coach-prev' : 'coach-next'}">${html}</div>`;
  document.getElementById('coachFoot').innerHTML = coachFootHtml(neg);
  if (moved) {
    document.getElementById('coachScroll').scrollTop = 0;
    document.getElementById('coachPanel').focus({ preventScroll: true });
  }
}
// A search list opening low in the panel: scroll until all of it shows.
['focusin', 'input'].forEach(type => document.getElementById('coachScroll').addEventListener(type, e => {
  if (e.target.matches('.vs-input')) requestAnimationFrame(() => e.target.closest('.vs-wrap').querySelector('.vs-list:not(.hidden)')?.scrollIntoView({ block: 'nearest' }));
}));
/* Back on a phone (user, 2026-11-04). Full screen, the pop-up looks like a page, so Back undoes
   your last decision here, as ← Back does, and closes it from the first step; it left the
   calculator before. One extra history entry stands for the pop-up: put back after each step,
   and given back whenever the pop-up closes any other way. coachEntry, not history.state, says
   whether it's there, because the address sync replaces the state. */
let coachEntry = false, coachLeaving = false, coachScrollDue = false;
const coachScrollToTrade = () => document.getElementById('tradeBar').scrollIntoView({ behavior: 'smooth', block: 'start' });
// Close on the trade in the builder. The scroll waits for the history step, which would cancel it.
function coachToTrade() {
  coachScrollDue = true;
  setView('builder');
  if (!coachLeaving) { coachScrollDue = false; coachScrollToTrade(); }
}
const coachEntryAdd = () => { if (!coachEntry && !coachLeaving) { history.pushState({ vaultCoach: true }, ''); coachEntry = true; } };
function coachEntryDrop() {
  if (!coachEntry) return;
  coachEntry = false; coachLeaving = true;
  history.scrollRestoration = 'manual'; // keep the page where it is
  history.back();
}
addEventListener('popstate', () => {
  if (coachLeaving) {
    coachLeaving = false;
    syncTradeUrl(); // the trade loaded while the entry was on top
    if (view === 'coach') coachEntryAdd(); // opened again before it landed
    // A tick later: the browser finishes restoring the scroll position after this event.
    const scroll = view !== 'coach' && coachScrollDue;
    coachScrollDue = false;
    setTimeout(() => { history.scrollRestoration = 'auto'; if (scroll) coachScrollToTrade(); }, 0);
    return;
  }
  if (!coachEntry || view !== 'coach') return;
  coachEntry = false;
  const neg = Coach.option === 'negotiate' && Coach.work;
  if (!neg && !coachFlow().trail?.length) return setView('builder');
  coachEntryAdd();
  if (neg) coachNegBack(); else coachBack();
});

// Esc closes (an open search list closes first), and Tab stays inside the pop-up.
document.addEventListener('keydown', e => {
  if (view !== 'coach') return;
  const panel = document.getElementById('coachPanel');
  if (e.key === 'Escape') { if (!panel.querySelector('.vs-list:not(.hidden)')) setView('builder'); return; }
  if (e.key !== 'Tab') return;
  const stops = [...panel.querySelectorAll('button, input, select:not(.vs-native), summary, a[href]')].filter(el => el.offsetParent !== null);
  if (!stops.length) return;
  const first = stops[0], last = stops[stops.length - 1], at = document.activeElement;
  if (!panel.contains(at) || at === panel || (e.shiftKey && at === first)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
});
