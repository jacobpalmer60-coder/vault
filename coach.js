/* ============================================================
   TRADE COACH (Trade Calculator)
   One panel, one row of options:
   - Negotiate a trade: the trade loaded in the calculator, answered by the
     other manager round by round (negotiation.js).
   - Get a player: several offers for one player their manager would take.
   - Trade with a team: the trades one team's manager would take.
   - Down-tier a player: one of your players for a lesser player plus more.
   - Fix a position: trades that upgrade your weakest starter there.
   - Rebuild: trades that turn your aging players into picks and youth.
   - Go all-in: trades that spend future value (picks, prospects, bench) on
     starters for this season.
   Every suggestion is a single trade the other manager would likely accept
   (negJudgeFor: value plus their lineup, timeline, needs, and trading
   style). Fair for you first; when nobody would take a Fair offer, the
   cheapest they would take is shown flagged as Lopsided against you. Never
   Unfair.

   Uses the Trade Calculator's globals (teams, slots, teamOf, selectedA/B,
   assetsFor) and negotiation.js (negJudgeFor, negContextFor, negLean,
   negNames, negKeys, negLoad, negOffer, negPreloadStyles, sumValue).
   ============================================================ */
const COACH = {
  SELL_AGE: { QB: 30, RB: 26, WR: 28, TE: 29 }, // roughly where each position's value starts sliding
  MIN_GAIN: 3,       // pts/week a trade has to add to your best lineup
  UPGRADE_BY: 2,     // a target must out-score your weakest starter there by 2 pts/week
  SHOW: 5,           // suggestions per list
  TARGET_SHOW: 8     // offers for one player (Get a player)
};
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
function coachSensible({ c, mine, theirs }) {
  const noFiller = side => { const top = Math.max(...side.map(a => a.value)); return side.every(a => a.value >= top * COACH_MIN_PIECE); };
  // …and the other team isn't further behind on value than managers in their spot
  // typically accept (Vault.acceptTolerance, by the trade's shape from their side).
  return theirs.score >= COACH_THEIR_MIN && (theirs.pricePct ?? theirs.valuePct) >= -Vault.acceptTolerance(c.giveA, c.giveB) && Vault.verdictTier(mine.score).level === 'good' && mine.rosterFit >= -1 && theirs.rosterFit >= -1
    && (mine.pricePct ?? mine.valuePct) >= -COACH_VALUE_FLOOR && noFiller(c.giveA) && noFiller(c.giveB) && coachPriceFair(c.giveA, c.giveB) && !coachAsksCornerstone(c.partner, c.giveB);
}
// Trades where both teams come out ahead (2026-10-09). The league search
// (suggestionPool) keeps only the closest-to-even package per piece, which
// rarely is the one that also fits both teams. This builds every 1-for-1,
// 2-for-1 and 1-for-2 from both teams' top pieces priced WIN_WIN_BAND on trade
// value (your way +) and not Unfair on KTC's calculator, keeps the
// WIN_WIN_PER_PARTNER closest to WIN_WIN_TARGET per team, and lets the checks
// for both teams (coachSensible) decide. The band is where real trades balance:
// every kind of team trades at about the market price (contenders paid no
// premium for points, rebuilders got none for selling vets), the middle half of
// accepted trades within about 10% (VaultValues timeline-premium.js, 26,480
// trades), so most of each side's win comes from fit, points and timeline. The
// aim depends on your timeline (WIN_WIN_TARGET): a contender's win is this
// season's points, so near even; a rebuilder's is mostly value, so toward the
// top of the usual range (a quarter of accepted trades are 10%+ one way, so
// up to 15% is still a realistic ask). (It was -2 to +18 aimed at +8 for
// everyone: contenders' offers priced past what managers usually accept.)
const WIN_WIN_BAND = [-2, 15], WIN_WIN_TARGET = { contend: 2, flexible: 5, rebuild: 9 }, WIN_WIN_PER_PARTNER = 120, WIN_WIN_TOP = 14;
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
const coachFairFirst = (x, y) => (Math.abs(x.edge) >= VAULT_CONFIG.FAIR_PCT) - (Math.abs(y.edge) >= VAULT_CONFIG.FAIR_PCT);

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

// Fair offers first; when there are fewer than `min`, add up to `min` of the
// cheapest Lopsided ones (flagged on the card) so they don't crowd the list.
async function coachPriced(run, min) {
  const fair = await run(VAULT_CONFIG.FAIR_PCT);
  if (fair.length >= min) return fair;
  const keys = new Set(fair.map(o => o.id));
  const extra = (await run(VAULT_CONFIG.LOPSIDED_PCT)).filter(o => !keys.has(o.id) && o.edge >= VAULT_CONFIG.FAIR_PCT);
  return fair.concat(extra.slice(0, min));
}

/* ---------- The four lists ---------- */

// Lineup upgrades at these positions, paid for without anything in `protect`.
// valueMode (Fix a position): an upgrade is any lineup gain AND you end up
// with the best asset in the deal (the most valuable single piece comes to
// you). Otherwise (Go all-in): COACH.MIN_GAIN points a week.
// UPGRADE_TARGETS players looked at, UPGRADE_PER_TARGET packages each (different
// lead pieces), UPGRADE_SHOW listed (2026-10-23, user: "there's gotta be more
// trades to upgrade RB": 15 / 1 / 5 left two RB upgrades on a roster with a dozen).
// UPGRADE_STOP: players with a trade before the search stops. UPGRADE_SHOW is before coachShape folds a player's second package into his card (then 10).
const UPGRADE_TARGETS = 25, UPGRADE_PER_TARGET = 2, UPGRADE_SHOW = 20, UPGRADE_STOP = 12;
async function coachUpgrades(me, positions, protect, progress, pay, valueMode = false, option = valueMode ? 'position' : 'contend') {
  const starters = me.lineup.filter(s => s.id);
  const floor = {};
  positions.forEach(P => { const at = starters.filter(s => s.pos === P); floor[P] = at.length ? Math.min(...at.map(s => s.ppg)) : 0; });
  const must = coachMust(me), off = coachOffLimits(me);
  const budget = sumValue(must) + me.assets.filter(a => !protect.has(a.key) && !off.has(a.key) && !must.includes(a)).map(a => a.value).sort((x, y) => y - x).slice(0, 3).reduce((t, v) => t + v, 0);
  const cands = teams.filter(t => t !== me && coachPartnerOK(t))
    .flatMap(t => t.assets.filter(a => a.type === 'player' && !coachTheirOff(a) && positions.includes(a.pos) && (a.ppg || 0) >= floor[a.pos] + COACH.UPGRADE_BY && a.value <= budget).map(a => ({ a, t })))
    .sort((x, y) => (y.a.ppg - floor[y.a.pos]) - (x.a.ppg - floor[x.a.pos])).slice(0, UPGRADE_TARGETS);
  const run = async ceiling => {
    const out = [];
    for (const { a, t } of cands) {
      // Players come best upgrade first: once UPGRADE_STOP have a trade, the rest can't
      // beat them for a list of 10 (2026-10-23, faster first search).
      if (new Set(out.map(o => o.id.split('|')[0])).size >= UPGRADE_STOP) break;
      progress(`Pricing ${a.name}${ceiling > VAULT_CONFIG.FAIR_PCT ? ' with a premium' : ''}…`);
      await coachTick();
      // The cheapest packages, best for you first; keep the first few that
      // really upgrade your lineup and pass every check the list will apply (a
      // package built on one of your own starters there may only be a
      // sidegrade, and one KTC calls off would be dropped, so try the next).
      const starterKeys = new Set(starters.map(s => 'p_' + s.id)), kept = [], leads = new Set();
      for (const cand of coachOffers(me, t, [a], { protect, ceiling, limit: 8, perLead: 2, option })) {
        // Never pay a premium to send away one of your starters: a Lopsided
        // offer is only worth it when it's paid with bench players and picks.
        if (cand.edge >= VAULT_CONFIG.FAIR_PCT && cand.give.some(x => starterKeys.has(x.key))) continue;
        // One package per lead piece of yours, so the two shown differ.
        const lead = [...cand.give].sort((x, y) => y.value - x.value)[0].key;
        if (leads.has(lead)) continue;
        // The cheap parts of coachListOK first, before the lineup math (2026-10-23, "Faster Coach").
        if (!coachPiecesOK(cand.give, cand.get) || !coachPriceFair(cand.give, cand.get, option) || coachAsksCornerstone(t, cand.get)) continue;
        // Net lineup gain: the healthy best lineup, minus any depth it costs
        // (what bye and injury weeks cost the lineup, Vault.depthShift), with
        // depth counted at the grade's weight.
        const aft = coachAfter(me.rosterId, t.rosterId, cand.give, cand.get);
        const g = aft.opt - me.opt + Vault.depthShift('contend', me, aft, slots).perWeek * VAULT_CONFIG.DEPTH_FIT_WEIGHT;
        const top = list => Math.max(...list.map(x => x.value));
        const betterAsset = top(cand.get) > top(cand.give);
        if (!(valueMode ? g >= 0.5 && betterAsset : g >= COACH.MIN_GAIN)) continue;
        if (!coachListOK(cand, option)) continue;
        leads.add(lead);
        kept.push({ ...cand, id: a.key + '|' + negKeys(cand.give).join(), gain: g, why: `${Vault.escapeHtml(a.name)} starts for you: about +${g.toFixed(1)} pts/week to your lineup, depth included${pay ? `, ${pay}` : ''}.${cand.note ? ' ' + cand.note : ''}` });
        if (kept.length >= UPGRADE_PER_TARGET) break;
      }
      out.push(...kept);
    }
    return out;
  };
  const list = await coachPriced(run, 3);
  return list.sort((x, y) => coachFairFirst(x, y) || y.gain - x.gain).slice(0, UPGRADE_SHOW);
}

// Which spot a Fix a position trade fills (2026-10-24, user: "it could be make my
// number 1 better my number 2 or upgrade some of my depth pieces"): where the best
// player you get at P would rank among your players there by points a game (minus
// any you send), and who he'd pass. group 0: a new #1, 1: a better starter, 2: depth.
function coachSlotFor(me, o, P) {
  const a = o.get.filter(x => x.type === 'player' && x.pos === P).sort((x, y) => (y.ppg || 0) - (x.ppg || 0))[0];
  if (!a) return null;
  const sent = new Set(o.give.map(x => x.key));
  const room = me.assets.filter(x => x.type === 'player' && x.pos === P && !sent.has(x.key)).sort((x, y) => (y.ppg || 0) - (x.ppg || 0));
  const rank = 1 + room.filter(x => (x.ppg || 0) > (a.ppg || 0)).length, over = room[rank - 1];
  const passes = over ? `, ahead of ${Vault.escapeHtml(over.name)} (${(over.ppg || 0).toFixed(1)})` : '';
  if (o.depth) return { group: 2, label: `Depth at ${P}` };
  return { group: rank === 1 ? 0 : 1, label: `New ${P}${rank}${passes}` };
}
const COACH_SLOT_FIRST = 3; // new #1s kept ahead of the 10-card cut
// Depth at a position (2026-10-24, user: "doesn't have to be main starter. Could be
// a little lesser potentially for depth"): players who wouldn't beat your weakest
// starter there by COACH.UPGRADE_BY but out-score your best backup by DEPTH_OVER_BENCH,
// paid with bench players and picks only (never a starter), that make bye and injury
// weeks cost your lineup at least DEPTH_MIN_PTS less a week (Vault.depthShift) and
// don't lower it. Listed after the starter upgrades, one trade per player; the
// usual checks for both teams decide. In The League of Gold: 6 at QB, 8 at WR, 5 at TE.
const DEPTH_TARGETS = 15, DEPTH_SHOW = 3, DEPTH_OVER_BENCH = 1, DEPTH_MIN_PTS = 0.3;
async function coachDepthAdds(me, P, progress, skip = new Set()) {
  const starters = me.lineup.filter(s => s.id), startKeys = new Set(starters.map(s => 'p_' + s.id));
  const at = starters.filter(s => s.pos === P), floor = at.length ? Math.min(...at.map(s => s.ppg)) : 0;
  const bench = me.assets.filter(a => a.type === 'player' && a.pos === P && !startKeys.has(a.key)).map(a => a.ppg || 0);
  const backup = bench.length ? Math.max(...bench) : 0;
  const cands = teams.filter(t => t !== me && coachPartnerOK(t))
    .flatMap(t => t.assets.filter(a => a.type === 'player' && a.pos === P && !skip.has(a.key) && !coachTheirOff(a) && (a.ppg || 0) < floor + COACH.UPGRADE_BY && (a.ppg || 0) > backup + DEPTH_OVER_BENCH).map(a => ({ a, t })))
    .sort((x, y) => y.a.ppg - x.a.ppg).slice(0, DEPTH_TARGETS);
  const out = [];
  for (const { a, t } of cands) {
    if (out.length >= DEPTH_SHOW) break;
    progress(`Pricing ${a.name} for depth…`);
    await coachTick();
    for (const cand of coachOffers(me, t, [a], { protect: startKeys, limit: 6, perLead: 1, option: 'position' })) {
      const aft = coachAfter(me.rosterId, t.rosterId, cand.give, cand.get);
      const lineup = aft.opt - me.opt, depth = Vault.depthShift('contend', me, aft, slots).perWeek;
      if (depth < DEPTH_MIN_PTS || lineup < -0.1 || !coachListOK(cand, 'position')) continue;
      const name = Vault.escapeHtml(a.name);
      const why = lineup >= 0.5
        ? `${name} starts for you some weeks (about +${lineup.toFixed(1)} a week) and backs up your ${P}s: bye and injury weeks would cost your lineup about ${depth.toFixed(1)} fewer points a week.`
        : `Depth: ${name} backs up your ${P}s, starting when one is out. Bye and injury weeks would cost your lineup about ${depth.toFixed(1)} fewer points a week.`;
      out.push({ ...cand, id: a.key + '|' + negKeys(cand.give).join(), gain: lineup + depth * VAULT_CONFIG.DEPTH_FIT_WEIGHT, depth: true, why: [why, cand.note].filter(Boolean).join(' ') });
      break;
    }
  }
  return out.sort((x, y) => y.gain - x.gain);
}

// Each team's best package for your piece `v` (from pieces passing `filter`)
// that they'd accept and that's Fair for you, best for you first. Follows
// Their side rules.
function coachSaleOffers(me, v, filter) {
  const offers = [];
  teams.filter(t => t !== me && coachPartnerOK(t)).forEach(t => {
    const tm = coachTheirMust(t), tmVal = sumValue(tm);
    const pool = t.assets.filter(a => filter(a) && !coachTheirOff(a) && !tm.includes(a) && a.value >= v.value * 0.1 && a.value + tmVal <= v.value * 1.3).sort((x, y) => y.value - x.value).slice(0, 10);
    const packs = tm.length ? [[...tm]] : [];
    pool.forEach(a => packs.push([...tm, a]));
    pool.forEach((a, i) => pool.slice(i + 1).forEach(b => { const s = tmVal + a.value + b.value; if (s >= v.value * 0.6 && s <= v.value * 1.5) packs.push([...tm, a, b]); }));
    let best = null;
    packs.filter(pack => coachGroupsOK([v], pack)).forEach(pack => {
      const j = coachJudged(me, t, [v], pack);
      if (coachMarketOK([v], pack) && j.edge < VAULT_CONFIG.FAIR_PCT && (!best || coachKey({ edge: j.edge, an: j.an }) < coachKey(best))) best = { partner: t, give: [v], get: pack, edge: j.edge, score: coachScore(j) };
    });
    if (best) offers.push(best);
  });
  return offers.sort((x, y) => coachKey(x) - coachKey(y));
}

/* Sell high and Buy low (market-data.js), two Trade Coach options. A market
   high is a player managers pay more than KTC for, so the way to cash in is
   to sell him for more than his KTC value; a market low goes for less, so buy
   him for less than his.
   - Sell high: your pieces going for MARKET_SELL_AT % or more over similar
     players (same position and KTC value; marketPeerAdj), or the ones under Sell these, shopped to every team (coachSaleOffers: the best
     package each team would likely take, Fair or better for you on KTC).
   - Buy low: the other teams' pieces going for MARKET_BUY_AT % or more under
     similar players (worth at least MARKET_MIN_VALUE), with your best packages for each
     that their manager would likely take (coachOffers; your Must include
     pieces go in every package).
   Kept only when you come out at least MARKET_MIN_GAIN % ahead on KTC value,
   i.e. you actually sell above or buy below KTC; most ahead first. */
const MARKET_SELL_AT = 8, MARKET_BUY_AT = 8, MARKET_MIN_VALUE = 1500, MARKET_MIN_GAIN = 3, MARKET_SHOW = 10;
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

// Other ways (2026-10-23, user: "Other ways on each card"): Best trades finds far
// more trades than its varied list shows (81 for Skat Happens Chase Love, 6
// shown). Each one held back goes on the card it's most like: the same team and a
// shared piece, else the same team, else one of your same pieces; best first, up
// to COACH_OTHERS a card.
const COACH_OTHERS = 3;
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
// step-by-step Coach, from the top.
function openCoach(option) {
  if (option === 'negotiate') Coach.option = 'negotiate';
  else if (option) { Coach.option = 'coach'; coachFlow().step = 'what'; }
  const wasOpen = coachOpen();
  setView('coach');
  renderCoach();
  if (!wasOpen) document.getElementById('coach').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
// From a roster row: Shop (your piece: pick the team to deal with) or Get (their player: build it).
function coachShopFor(key) {
  Coach.option = 'coach';
  Coach.flow = { ...coachFlow(), what: 'player', myKey: key, goal: null, step: 'pick' };
  setView('coach');
  renderCoach();
  document.getElementById('coach').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function coachGetFor(key) { coachPickPlayer(key); }

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
  // Fold the list away so the trade is right there (mostly for phones).
  Coach.collapsed = true;
  renderCoach();
  document.getElementById('tradeBar').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  return { j, o, score: coachScore(o), yes, room, you, them: improvementOf(j.an, 'B') };
}
async function coachWorkTweaks() {
  const w = Coach.work, me = coachMe(); if (!w) return;
  const seq = ++w.seq; w.tweaks = null;
  // Nothing to judge until both sides have something.
  if (!w.give.length || !w.get.length) { w.tweaks = { more: [], less: [], yes: [], closer: [] }; if (coachOpen()) renderCoach(); return; }
  const base = coachWorkRead(me, w), off = coachOffLimits(me), inGive = new Set(negKeys(w.give)), inGet = new Set(negKeys(w.get));
  const getVal = sumValue(w.get), giveVal = sumValue(w.give);
  // Never suggest dropping a Must go piece, or the player an Upgrade a player trade is upgrading.
  const locked = new Set([...Coach.mine.must, ...(w.option === 'upgrade' && Coach.upKey ? [Coach.upKey] : [])]);
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
    // Pieces sized to what's missing on trade value (extra pieces count for less, so aim a bit above it).
    const tv = Vault.tradeSideValues(w.give, w.get), needVal = Math.max(-base.room, base.you - VAULT_CONFIG.FAIR_PCT + 0.5) / 100 * (tv.valueA + tv.valueB) / 2;
    mine.filter(a => a.value >= 300).sort((x, y) => Math.abs(x.value - needVal * 1.5) - Math.abs(y.value - needVal * 1.5)).slice(0, 16)
      .forEach(a => cands.push({ kind: 'yes', add: true, text: `Add your ${Vault.escapeHtml(a.name)}`, give: [...w.give, a], get: w.get }));
    w.give.filter(a => !locked.has(a.key)).forEach(g => mine.filter(a => a.value > g.value * 1.03 && a.value <= g.value * 1.6).sort((x, y) => x.value - y.value).slice(0, 4)
      .forEach(a => cands.push({ kind: 'yes', text: `Send your ${Vault.escapeHtml(a.name)} instead of ${Vault.escapeHtml(g.name)}`, give: w.give.map(x => (x === g ? a : x)), get: w.get })));
    if (w.get.length > 1) w.get.filter(a => !Coach.theirs.must.includes(a.key) && a.key !== Coach.targetKey).forEach(a => cands.push({ kind: 'yes', text: `Don't ask for ${Vault.escapeHtml(a.name)}`, give: w.give, get: w.get.filter(x => x !== a) }));
  }
  const out = [], closer = [];
  for (let k = 0; k < cands.length; k++) {
    if (k % 6 === 5) { await coachTick(); if (Coach.work !== w || w.seq !== seq) return; }
    const c = cands[k], r = coachWorkRead(me, w, c.give, c.get);
    // At a no, a piece that gets them closest without reaching yes is still worth showing.
    if (!r.yes && c.add && r.room > base.room + 1) closer.push({ ...c, r });
    if (!r.yes || !coachPiecesOK(c.give, c.get)) continue;
    if (c.kind !== 'yes' && r.score <= base.score + 0.5) continue; // only changes that help you
    out.push({ ...c, r });
  }
  const top = kind => out.filter(c => c.kind === kind).sort((x, y) => y.r.score - x.r.score).slice(0, 4);
  w.tweaks = { more: top('more'), less: top('less'), yes: top('yes'), closer: closer.sort((x, y) => y.r.room - x.r.room).slice(0, 4) };
  if (coachOpen()) renderCoach();
}
function coachWorkApply(kind, k) {
  const w = Coach.work, c = w && w.tweaks && w.tweaks[kind][k];
  if (!c) return;
  w.give = [...c.give]; w.get = [...c.get];
  renderCoach(); coachWorkTweaks();
}
function coachWorkEdit(side, key, add) {
  const w = Coach.work, me = coachMe(); if (!w) return;
  const pool = side === 'give' ? me.assets : w.partner.assets, a = pool.find(x => x.key === key);
  if (!a) return;
  if (add) { if (!w[side].includes(a)) w[side] = [...w[side], a]; }
  else w[side] = w[side].filter(x => x !== a);
  renderCoach(); coachWorkTweaks();
}
// The trade as it stands, loaded into the builder (your team as Team A).
function coachWorkLoad() { const w = Coach.work; if (w) coachLoadTrade({ partner: w.partner, give: w.give, get: w.get }); }
function coachWorkNegotiate(btn) {
  coachWorkLoad();
  Coach.option = 'negotiate'; Coach.collapsed = false;
  renderCoach();
  negOffer(btn);
}
function coachWorkShare(btn) { coachWorkLoad(); shareTrade(btn); }
function coachWorkHtml(me) {
  const w = Coach.work, esc = Vault.escapeHtml;
  // One side still empty: the trade so far, what to add, and hints; no read yet.
  if (!w.give.length || !w.get.length) return coachBuildStartHtml(me, w);
  const r = coachWorkRead(me, w);
  const tier = Vault.verdictTier(r.score), pc = v => `${Math.round(Math.abs(v))}%`;
  const piece = (a, side) => `<div class="flex items-center justify-between gap-2 py-1.5 border-t border-white/[0.05] first:border-t-0">
      <span class="min-w-0 truncate text-[13px] text-zinc-100">${esc(a.name)} <span class="text-[11px] text-zinc-500">${a.type === 'pick' ? (a.tier || 'pick') : a.pos}</span></span>
      <span class="flex items-center gap-2 shrink-0"><span class="text-[11px] mono text-zinc-500">${Math.round(a.value).toLocaleString()}</span><button onclick="coachWorkEdit('${side}', '${a.key}', false)" aria-label="Take ${esc(a.name)} off" class="px-1 text-zinc-500 hover:text-white">×</button></span>
    </div>`;
  const off = coachOffLimits(me), inGive = new Set(negKeys(w.give)), inGet = new Set(negKeys(w.get));
  const addSel = (side, list, label) => `<select data-search="+ Type a player or pick…" onchange="coachWorkEdit('${side}', this.value, true)" aria-label="${label}" class="mt-2 w-full text-[12px] px-2 py-1 rounded-lg border border-white/10 text-zinc-400 bg-black/40"><option value="">${label}</option>${list.sort((x, y) => y.value - x.value).map(a => `<option value="${a.key}">${esc(a.name)}${a.type === 'player' ? ` (${a.pos})` : ''} · ${Math.round(a.value).toLocaleString()}</option>`).join('')}</select>`;
  const status = r.yes
    ? `<div class="text-[14px] text-emerald-300 font-medium">${esc(w.partner.teamName)} would likely say yes.</div><div class="text-[12px] text-zinc-400 mt-0.5">${r.room >= 2 && !(w.tweaks && !w.tweaks.more.length && !w.tweaks.less.length) ? `You likely have room to ask for about ${pc(r.room)} more value.` : 'That\'s about as far as they\'d go.'}</div>`
    : `<div class="text-[14px] text-orange-300 font-medium">${esc(w.partner.teamName)} would likely say no.</div><div class="text-[12px] text-zinc-400 mt-0.5">${(() => {
        // How far off: their will against what they ask, or the price past Fair in your favor.
        const need = Math.max(-r.room, r.you - VAULT_CONFIG.FAIR_PCT + 0.5), worry = r.j.concerns.filter(c => c.w < 0).sort((a, b) => a.w - b.w)[0];
        const why = worry ? `: ${esc(worry.text.replace(/<[^>]+>/g, '').replace(/\.$/, ''))}` : '';
        return need > 0 ? `They'd want about ${pc(need)} more value, or less to worry about${why}.` : `The value works, but it reads as a bad trade for their team or too lopsided on KTC's calculator${why}.`;
      })()}</div>`;
  const tweakRows = (kind, title) => {
    const list = w.tweaks ? w.tweaks[kind] : [];
    if (!list.length) return '';
    return `<div class="mt-3"><div class="text-[12px] text-zinc-400 mb-1">${title}</div>${list.map((c, k) => { const t = Vault.verdictTier(c.r.score); return `<div class="flex items-center justify-between gap-3 py-2 border-t border-white/[0.06]">
        <span class="min-w-0 text-[13px] text-zinc-200">${c.text} <span class="text-[12px] text-zinc-500">· for you <span class="font-medium ${Vault.VERDICT_TIER_TEXT[t.key]}">${t.label}</span>, ${esc(coachMe().teamName)} pays ${pc(c.r.you)} ${c.r.you >= 0 ? 'under' : 'over'} trade value${kind === 'yes' ? '' : kind === 'closer' ? `, they'd still want about ${pc(Math.max(-c.r.room, c.r.you - VAULT_CONFIG.FAIR_PCT + 0.5))} more` : `, room left ${c.r.room >= 2 ? `about ${pc(c.r.room)}` : 'about none'}`}</span></span>
        <button onclick="coachWorkApply('${kind}', ${k})" class="shrink-0 text-[12px] px-3 py-1 rounded-lg border border-white/15 text-zinc-100 hover:bg-white/[0.06]">Apply</button>
      </div>`; }).join('')}</div>`;
  };
  const tweaks = w.tweaks == null ? '<div class="text-[12px] text-zinc-500 mt-3">Looking for ways to make it better…</div>'
    : (r.yes ? tweakRows('more', 'Ask for more (they\'d still say yes)') + tweakRows('less', 'Send less (they\'d still say yes)') : tweakRows('yes', 'One piece that gets them to yes, best for you first') || tweakRows('closer', 'No single piece gets them to yes. These get them closest'))
      || `<div class="text-[12px] text-zinc-500 mt-3">${r.yes ? 'No one-step change helps you and keeps them at yes: this one is as good as it gets.' : 'No single piece of yours moves them much. Try a bigger piece, or ask for less.'}</div>`;
  return `${coachBuildHeadHtml(w)}
    <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div class="p-3 rounded-lg bg-black/30 border border-white/5 min-w-0"><div class="text-[11px] text-zinc-400 uppercase tracking-wider mb-1">${esc(me.teamName)} gives</div>${w.give.map(a => piece(a, 'give')).join('')}${addSel('give', me.assets.filter(a => !inGive.has(a.key) && !off.has(a.key) && a.value >= 100), '+ Add one of yours…')}</div>
      <div class="p-3 rounded-lg bg-black/30 border border-white/5 min-w-0"><div class="text-[11px] text-zinc-400 uppercase tracking-wider mb-1">${esc(me.teamName)} gets</div>${w.get.map(a => piece(a, 'get')).join('')}${addSel('get', w.partner.assets.filter(a => !inGet.has(a.key) && !coachTheirOff(a) && a.value >= 100), '+ Ask for one of theirs…')}</div>
    </div>
    <div class="grid gap-3 sm:grid-cols-3 mt-3">
      <div><div class="text-[11px] text-zinc-500">For ${esc(me.teamName)}</div><div class="text-[18px] font-semibold ${Vault.VERDICT_TIER_TEXT[tier.key]}">${tier.label}</div></div>
      <div><div class="text-[11px] text-zinc-500">For ${esc(w.partner.teamName)}</div><div class="text-[18px] font-semibold ${Vault.VERDICT_TIER_TEXT[r.them.tier]}">${r.them.label}</div></div>
      <div><div class="text-[11px] text-zinc-500">${esc(me.teamName)} pays</div><div class="text-[18px] font-semibold text-zinc-100">${Math.abs(r.you) < 1 ? 'even' : `${pc(r.you)} ${r.you > 0 ? 'under' : 'over'}`} <span class="text-[12px] font-normal text-zinc-500">trade value</span></div></div>
    </div>
    <div class="mt-3 p-3 rounded-lg ${r.yes ? 'bg-emerald-500/[0.06] border border-emerald-500/20' : 'bg-orange-500/[0.06] border border-orange-500/20'}">${status}</div>

    ${tweaks}
    <div class="flex flex-wrap items-center justify-end gap-2 mt-4 pt-3 border-t border-white/5">
      <button onclick="coachWorkShare(this)" class="text-[12px] px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/20">Copy offer link</button>
      <button onclick="coachWorkLoad()" class="text-[12px] px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/20">Open in builder</button>
      <button onclick="coachWorkNegotiate(this)" class="text-[12px] px-4 py-1.5 rounded-lg btn-gold-solid">Negotiate it</button>
    </div>`;
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
  if (!remainingWeeks.length || typeof tradeSeasonOdds !== 'function') return null;
  const me = coachMe(), { next } = tradeSeasonOdds(me, o.partner, o.give, o.get);
  const before = seasonBase?.get(me.rosterId)?.championshipPct, after = next.get(me.rosterId)?.championshipPct;
  if (before == null || after == null || (before < 1 && after < 1)) return null;
  return { before, after };
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
function coachFlowGo(step) {
  const f = coachFlow();
  if (step === 'build' && !Coach.work) return;
  if (step === 'pick' && !f.what) return;
  Coach.option = 'coach';
  f.step = step;
  renderCoach();
}
function coachFlowSet(k, v) { coachFlow()[k] = v; renderCoach(); }
// Into Build it with a starting trade.
// goal: what you're doing with your own player (upgrade, downtier, sell), for the hints.
function coachBuildFrom(partner, give, get, goal = null) {
  if (!partner) return;
  Coach.option = 'coach';
  Coach.work = { partner, give: [...give], get: [...get], option: 'build', goal, tweaks: null, seq: 0 };
  coachFlow().step = 'build';
  if (!coachOpen()) setView('coach');
  renderCoach();
  document.getElementById('coach').scrollIntoView({ behavior: 'smooth', block: 'start' });
  coachWorkTweaks();
}
const coachOwner = key => teams.find(t => t !== coachMe() && t.assets.some(a => a.key === key));
function coachPickPlayer(key) { const t = coachOwner(key); if (t) coachBuildFrom(t, [], [t.assets.find(a => a.key === key)]); }
function coachPickTeam(id) { const t = teams.find(x => String(x.rosterId) === String(id)); if (t) coachBuildFrom(t, [], []); }
// A player from the one list: another team's goes straight to building; yours asks what to
// do with him (a pick can only be sold).
function coachPickAny(key) {
  if (!key) return;
  const mine = coachMe().assets.find(a => a.key === key);
  if (!mine) return coachPickPlayer(key);
  const f = coachFlow(); f.myKey = key; f.upKeys = [key]; f.goal = mine.type === 'pick' ? 'sell' : null;
  renderCoach();
}
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
function coachRecSpec(me) {
  const f = coachFlow(), others = teams.filter(t => t !== me);
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
  return { key: JSON.stringify([f.what, goal, f.pos, negKeys(give)]), give, goal, cands: cands.slice(0, COACH_REC_CANDS) };
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
  const yes = out.filter(fit).sort(spec.goal === 'downtier' ? (x, y) => (y.r.yes ? 1 : 0) - (x.r.yes ? 1 : 0) || y.a.value - x.a.value : (x, y) => y.r.score - x.r.score);
  const no = out.filter(x => !fit(x)).sort((x, y) => y.r.room - x.r.room);
  // Close the gap (user, 2026-10-28): for the closest noes, the one piece of yours that gets
  // them to yes and leaves you best off (sized to what's missing on trade value), so a fit
  // that "wants 2% more" comes with what to add.
  const off = coachOffLimits(me), inGive = new Set(negKeys(spec.give));
  const pool = me.assets.filter(p => !inGive.has(p.key) && !off.has(p.key) && p.value >= 150);
  for (const x of no.slice(0, COACH_REC_SHOW)) {
    await coachTick(); if (stale()) return;
    const tv = Vault.tradeSideValues(spec.give, [x.a]), need = Math.max(-x.r.room, x.r.you - VAULT_CONFIG.FAIR_PCT + 0.5) / 100 * (tv.valueA + tv.valueB) / 2;
    for (const p of [...pool].sort((u, v) => Math.abs(u.value - need * 1.5) - Math.abs(v.value - need * 1.5)).slice(0, 10)) {
      const r = coachWorkRead(me, { partner: x.t, give: [...spec.give, p], get: [x.a], option: 'build' });
      if (r.yes && (!x.fix || r.score > x.fix.r.score)) x.fix = { p, r };
    }
  }
  const fixed = no.filter(x => x.fix).sort((x, y) => y.fix.r.score - x.fix.r.score), rest = no.filter(x => !x.fix);
  f.recs = { key: spec.key, list: [...yes, ...fixed, ...rest].slice(0, COACH_REC_SHOW), yes: yes.length, fixed: fixed.length, total: out.length, give: negKeys(spec.give), goal: spec.goal };
  if (coachOpen() && f.step === 'pick') renderCoach();
}
// Build a fit: what you selected, plus its gap-closing piece if it has one, for him.
function coachRecBuild(i) {
  const rec = coachFlow().recs, x = rec && rec.list && rec.list[i], me = coachMe();
  if (!x) return;
  const give = rec.give.map(k => me.assets.find(a => a.key === k)).filter(Boolean);
  coachBuildFrom(x.t, x.fix && !x.r.yes ? [...give, x.fix.p] : give, [x.a], rec.goal);
}
function coachRecsHtml(me, spec) {
  const f = coachFlow(), n = v => Math.round(v).toLocaleString(), pc = v => `${Math.round(Math.abs(v))}%`;
  if (!spec.cands.length) {
    // Upgrading someone nobody out-scores: say that, not just "nobody fits".
    const top = spec.goal === 'upgrade' ? [...spec.give].sort((x, y) => (y.ppg || 0) - (x.ppg || 0))[0] : null;
    return `<div class="text-[12px] text-zinc-500 py-2">${top && top.ppg ? `No ${coachEsc(top.pos)} on another team scores more than ${coachEsc(top.name)} (${top.ppg.toFixed(1)} pts/game) within reach of what you'd send. He's already the upgrade.` : 'Nobody on another team fits that. Try different players.'}</div>`;
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
    return `<div class="flex items-center justify-between gap-3 py-2.5 border-t border-white/[0.06] first:border-t-0">
        <div class="min-w-0">
          <div class="text-[13px] text-zinc-100 truncate">${coachEsc(a.name)} <span class="text-[11px] text-zinc-500">${a.type === 'pick' ? 'pick' : a.pos} · ${coachEsc(t.teamName)} · ${n(a.value)}</span></div>
          <div class="text-[11px] text-zinc-400">${status} · <span class="${Vault.VERDICT_TIER_TEXT[tier.key]}">${tier.label}</span> for you${gain != null ? ` · ${gain >= 0 ? '+' : '−'}${Math.abs(gain).toFixed(1)} pts/game` : ''}</div>
        </div>
        <button onclick="coachRecBuild(${i})" class="shrink-0 text-[12px] px-3 py-1 rounded-lg border border-white/15 text-zinc-100 hover:bg-white/[0.06]">Build</button>
      </div>`;
  }).join('');
  const word = spec.goal === 'upgrade' ? 'would likely say yes' : 'would take it';
  const summary = f.recs.yes || f.recs.fixed ? [f.recs.yes ? `${f.recs.yes} ${word}` : '', f.recs.fixed ? `${f.recs.fixed} more with one piece added` : ''].filter(Boolean).join(', ') : 'none would say yes yet; these are the closest';
  return `<div class="text-[12px] text-zinc-400 mb-1.5">Best fits: ${summary}.</div>
    <div class="rounded-lg bg-black/30 border border-white/5 px-3">${rows}</div>`;
}

/* ---------- The header: one line about your team, and where you are ----------
   (2026-10-28, user: "cleaner and flow more easily"; picked all four: one search box to
   start, trim the headers, a shorter tick list, close the gap on each fit.) One line with
   your record, odds, thin and deep spots and timeline (a small dropdown), and a breadcrumb
   (Start › what you picked › Build) in place of the team card, the repeated team names and
   the numbered steps. */
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
function coachCrumbsHtml(me) {
  const f = coachFlow(), w = Coach.work, crumbs = [['Start', "coachFlowGo('what')"]];
  const goal = f.what === 'player' && f.goal ? COACH_GOALS[f.goal] : f.what === 'position' ? (f.posGoal === 'depth' ? 'Add depth' : COACH_GOALS[f.posGoal || 'upgrade']) : '';
  const mine = f.what === 'player' && me.assets.find(a => a.key === f.myKey);
  const picked = mine ? mine.name : f.what === 'position' ? f.pos : null;
  if (f.step !== 'what' && picked) crumbs.push([`${picked}${goal ? ' · ' + goal : ''}`, "coachFlowGo('pick')"]);
  if (f.step === 'build' && w) crumbs.push([`Building with ${w.partner.teamName}`, null]);
  return crumbs.map(([label, go], i) => (i === crumbs.length - 1 ? `<span class="text-zinc-100">${coachEsc(label)}</span>` : `<button onclick="${go}" class="text-zinc-400 hover:text-white">${coachEsc(label)}</button>`)).join('<span class="text-zinc-600 px-1.5" aria-hidden="true">›</span>');
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
  return `<div class="text-[15px] text-zinc-100 font-medium mb-2">Who or what do you want to trade around?</div>
    <select data-search="Type a player, a position (RB) or a team…" onchange="coachStartFrom(this.value)" aria-label="Start from a player, a position or a team" class="w-full sm:w-[520px] bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[14px] outline-none focus:border-amber-400/40">
      <option value="">Type a player, a position (RB) or a team…</option>
      <optgroup label="Your players and picks">${mine.map(a => `<option value="${a.key}">${coachEsc(a.name)}${a.type === 'player' ? ` (${a.pos})` : ''} · yours · ${n(a.value)}</option>`).join('')}</optgroup>
      <optgroup label="Positions">${['QB', 'RB', 'WR', 'TE'].map(posOpt).join('')}</optgroup>
      <optgroup label="Teams">${others.map(teamOpt).join('')}</optgroup>
      <optgroup label="Other teams' players">${theirs.map(({ a, t }) => `<option value="${a.key}">${coachEsc(a.name)} (${a.pos}) · ${coachEsc(t.teamName)} · ${n(a.value)}</option>`).join('')}</optgroup>
    </select>
    <div class="flex flex-wrap items-center gap-1.5 mt-3"><span class="text-[12px] text-zinc-500 mr-1">Or a position</span>${['QB', 'RB', 'WR', 'TE'].map(p => coachChip(false, p, `coachStartFrom('pos:${p}')`, coachPosNeed(me, p) ? ' <span class="text-[11px] text-rose-300/80">thin</span>' : '')).join('')}</div>`;
}
function coachStartFrom(v) {
  if (!v) return;
  const f = coachFlow();
  f.recs = null;
  if (v.startsWith('pos:')) { Object.assign(f, { what: 'position', pos: v.slice(4), posGoal: f.posGoal && f.posGoal !== 'depth' ? f.posGoal : 'upgrade', upPos: null, upKeys: null, step: 'pick' }); return renderCoach(); }
  if (v.startsWith('team:')) return coachPickTeam(v.slice(5));
  if (coachMe().assets.some(a => a.key === v)) { Object.assign(f, { what: 'player', step: 'pick' }); return coachPickAny(v); }
  coachPickPlayer(v);
}

/* ---------- Step 2: pick ---------- */
function coachPickHtml(me) {
  const f = coachFlow(), others = teams.filter(t => t !== me), n = v => Math.round(v).toLocaleString();
  const head = text => `<div class="text-[14px] text-zinc-100 font-medium mb-3">${text}</div>`; // the breadcrumb goes back
  const pickBtn = onclick => `<button onclick="${onclick}" class="shrink-0 text-[12px] px-3 py-1 rounded-lg border border-white/15 text-zinc-100 hover:bg-white/[0.06]">Pick</button>`;
  // A team's line: timeline, needs and depth, whether it needs the position in play, and a note for the goal.
  const teamRow = (t, onclick, pos, note = '') => {
    const { needs, surpluses } = Vault.positionalProfile(t, teams), P = l => l.map(x => x.toUpperCase()).join(', ');
    const need = pos && needs.includes(pos.toLowerCase());
    return `<div class="flex items-center justify-between gap-3 py-2 border-t border-white/[0.06] first:border-t-0">
        <div class="min-w-0"><div class="text-[13px] text-zinc-100 truncate">${coachEsc(t.teamName)}${need ? ` <span class="text-[11px] text-emerald-300">needs ${pos}</span>` : ''}${note ? ` <span class="text-[11px] text-amber-200/80">${note}</span>` : ''}</div>
          <div class="text-[11px] text-zinc-500">${Vault.MODE_LABEL[Vault.teamMode(t)] || ''}${needs.length ? ` · thin at ${P(needs)}` : ''}${surpluses.length ? ` · deep at ${P(surpluses)}` : ''}</div></div>
        ${pickBtn(onclick)}
      </div>`;
  };
  const playerRows = (rows, pickFn = 'coachPickPlayer') => `<div class="rounded-lg bg-black/30 border border-white/5 px-3">${rows.map(({ a, t }) => `<div class="flex items-center justify-between gap-3 py-2 border-t border-white/[0.06] first:border-t-0">
      <div class="min-w-0"><div class="text-[13px] text-zinc-100 truncate">${coachEsc(a.name)}</div><div class="text-[11px] text-zinc-500 truncate">${coachEsc(t.teamName)}${a.age ? ` · ${Math.round(a.age)} years old` : ''}${a.ppg ? ` · ${a.ppg.toFixed(1)} pts/game` : ''}</div></div>
      <span class="flex items-center gap-3 shrink-0"><span class="text-[12px] mono text-zinc-400">${n(a.value)}</span>${pickBtn(`${pickFn}('${a.key}')`)}</span></div>`).join('') || '<div class="py-3 text-[12px] text-zinc-500">No one fits.</div>'}</div>`;

  if (f.what === 'player') {
    const mineList = me.assets.filter(a => a.value >= 300).sort((x, y) => y.value - x.value);
    const theirs = others.flatMap(t => t.assets.filter(a => a.type === 'player' && a.value >= 300).map(a => ({ a, t }))).sort((x, y) => y.a.value - x.a.value);
    const sel = `<select data-search="Type any player, yours or theirs…" onchange="coachPickAny(this.value)" aria-label="Player" class="w-full sm:w-[460px] bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-amber-400/40">
        <option value="">Pick a player…</option>
        <optgroup label="Your players and picks">${mineList.map(a => `<option value="${a.key}" ${a.key === f.myKey ? 'selected' : ''}>${coachEsc(a.name)}${a.type === 'player' ? ` (${a.pos})` : ''} · yours · ${n(a.value)}</option>`).join('')}</optgroup>
        <optgroup label="Other teams">${theirs.map(({ a, t }) => `<option value="${a.key}">${coachEsc(a.name)} (${a.pos}) · ${coachEsc(t.teamName)} · ${n(a.value)}</option>`).join('')}</optgroup></select>`;
    const a = mineList.find(x => x.key === f.myKey);
    if (!a) return head('Which player? One of yours, or one on another team.') + sel;
    // One of yours: what to do with him, then the team.
    const pos = a.type === 'player' ? a.pos : null;
    const goals = a.type === 'pick' ? { sell: 'Sell' } : COACH_GOALS;
    const ups = coachUpAssets(), upNames = ups.map(x => coachEsc(x.name)).join(' + ') || 'your players';
    const blurb = { upgrade: `Send ${upNames} plus more for one better player.`, downtier: `Send ${coachEsc(a.name)} for a lesser ${pos} plus more pieces.`, sell: `Send ${coachEsc(a.name)} for picks and young players.` };
    const goalRow = `<div class="flex flex-wrap items-center gap-1.5 mb-1">${Object.entries(goals).map(([k, l]) => coachChip(f.goal === k, l, `coachFlowSet('goal', '${k}')`)).join('')}</div>${f.goal ? `<div class="text-[12px] text-zinc-400 mb-3">${blurb[f.goal]}</div>` : ''}`;
    if (!f.goal) return head(`${coachEsc(a.name)} is yours. What do you want to do with him?`) + goalRow;
    // Upgrading: tick the others going out with him (same position shown first).
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
    return head(`${COACH_GOALS[f.goal]} ${f.goal === 'upgrade' ? upNames : coachEsc(a.name)}.`) + `${goalRow}${upPicker}${recs}
      <details class="mt-3 group/teams"><summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-[12px] text-zinc-400 hover:text-zinc-200">Or pick a team yourself <span class="group-open/teams:hidden">▾</span><span class="hidden group-open/teams:inline">▴</span></summary>
        <div class="mt-2 rounded-lg bg-black/30 border border-white/5 px-3">${order.map(t => teamRow(t, `coachPickMoveTeam('${t.rosterId}')`, pos, note(t))).join('')}</div></details>`;
  }
  if (f.what === 'position') {
    // (2026-10-27, user: "once we select our player, give the option to upgrade, downtier, or
    // sell".) Tick your players at the position, then Upgrade, Down-tier or Sell them: the best
    // fits for them come first (coachRecSpec, coachRecsHtml). Add depth is its own choice: cheap
    // backups who still score, nothing of yours ticked.
    const P = f.pos, goal = f.posGoal || 'upgrade';
    const starters = (me.lineup || []).filter(s => s.id && s.pos === P);
    const weakest = starters.length ? starters.reduce((x, y) => (y.ppg < x.ppg ? y : x)) : null;
    const weakAsset = weakest && me.assets.find(x => x.key === 'p_' + weakest.id);
    const pool = others.flatMap(t => t.assets.filter(a => a.type === 'player' && a.pos === P && a.value >= 300).map(a => ({ a, t })));
    const sortFn = f.sort === 'value' ? (x, y) => y.a.value - x.a.value : f.sort === 'young' ? (x, y) => (x.a.age || 99) - (y.a.age || 99) || y.a.value - x.a.value : (x, y) => (y.a.ppg || 0) - (x.a.ppg || 0);
    const sorts = [['points', 'Points a game'], ['value', 'Value'], ['young', 'Youngest']];
    const posChips = `<div class="flex flex-wrap gap-1.5 mb-3">${['QB', 'RB', 'WR', 'TE'].map(p => coachChip(P === p, p, `coachFlowSet('pos', '${p}')`, coachPosNeed(me, p) ? ' <span class="text-[11px] text-rose-300/80">need</span>' : '')).join('')}</div>`;
    const sortRow = `<div class="flex flex-wrap items-center gap-1.5 mb-3"><span class="text-[12px] text-zinc-500 mr-1">Sort by</span>${sorts.map(([k, l]) => coachChip((f.sort || 'points') === k, l, `coachFlowSet('sort', '${k}')`)).join('')}</div>`;
    const goalChips = `<div class="flex flex-wrap items-center gap-1.5 mb-3">${Object.entries(COACH_GOALS).map(([k, l]) => coachChip(goal === k, l, `coachFlowSet('posGoal', '${k}')`)).join('')}<span class="text-zinc-600 px-1">or</span>${coachChip(goal === 'depth', 'Add depth', `coachFlowSet('posGoal', 'depth')`)}</div>`;
    if (goal === 'depth') {
      const cap = Math.min(3000, weakAsset ? weakAsset.value * 0.6 : 3000);
      const rows = pool.filter(({ a }) => a.value <= cap && (a.ppg || 0) > 0).sort(sortFn).slice(0, 40);
      return head(`Add depth at ${P}. Pick the player you want.`) + posChips + goalChips + `<div class="text-[12px] text-zinc-400 mb-2">${P}s on other teams worth ${Math.round(cap).toLocaleString()} or less who still score, best scorers first: backups for bye weeks and injuries.</div>` + sortRow + playerRows(rows);
    }
    // Your weakest starter there is ticked once, on arriving at the position; after that any can be unticked.
    const mineAtP = me.assets.filter(x => x.type === 'player' && x.pos === P).sort((x, y) => y.value - x.value);
    if (f.upPos !== P) { f.upKeys = weakAsset ? [weakAsset.key] : []; f.upPos = P; }
    const ups = coachUpAssets(), names = ups.map(x => coachEsc(x.name)).join(' + ');
    const blurb = { upgrade: `Send ${names} plus more for one better ${P}.`, downtier: `Send ${names} for a lesser ${P} plus more pieces.`, sell: `Send ${names} for picks and young players.` }[goal];
    const spec = coachRecSpec(me);
    if (!spec) return head(`${P}: who are you sending? Then upgrade, down-tier or sell. Or add depth.`) + posChips + coachUpPickerHtml(me, mineAtP) + goalChips + `<div class="text-[12px] text-zinc-500 py-1">Add at least one of your ${P}s to see the best fits.</div>`;
    // Upgrades: everyone who out-scores them, folded under the best fits.
    const floor = Math.max(...ups.map(x => x.ppg || 0)), rows = pool.filter(({ a }) => (a.ppg || 0) >= floor + 1).sort(sortFn).slice(0, 40);
    const everyone = goal !== 'upgrade' ? '' : `<details class="mt-3 group/all"><summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-[12px] text-zinc-400 hover:text-zinc-200">Everyone who out-scores ${ups.length > 1 ? 'them' : coachEsc(ups[0].name)} (${rows.length}) <span class="group-open/all:hidden">▾</span><span class="hidden group-open/all:inline">▴</span></summary><div class="mt-2">${sortRow}${playerRows(rows, 'coachPickUpgrade')}</div></details>`;
    return head(`${P}: who are you sending? Then upgrade, down-tier or sell. Or add depth.`) + posChips + coachUpPickerHtml(me, mineAtP) + goalChips + `<div class="text-[12px] text-zinc-400 mb-2">${blurb}</div>` + coachRecsHtml(me, spec) + everyone;
  }
  return head('Which team do you want to deal with?') + `<div class="rounded-lg bg-black/30 border border-white/5 px-3">${others.map(t => teamRow(t, `coachPickTeam('${t.rosterId}')`)).join('')}</div>`;
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
function coachBuildHeadHtml(w) {
  return `<div class="flex items-center justify-between gap-3 flex-wrap mb-3">
      <div class="text-[13px] text-zinc-300">${w.goal && w.give[0] ? `${COACH_GOALS[w.goal]} ${w.goal === 'upgrade' ? w.give.map(a => coachEsc(a.name)).join(' + ') : coachEsc(w.give[0].name)} with` : 'Building a trade with'} <span class="text-zinc-100 font-medium">${coachEsc(w.partner.teamName)}</span>: add or take off one piece at a time.</div>
    </div>`;
}
// Build it with one side still empty: the two sides, what's missing, and hints.
function coachBuildStartHtml(me, w) {
  const n = v => Math.round(v).toLocaleString(), inGive = new Set(negKeys(w.give)), inGet = new Set(negKeys(w.get));
  const piece = (a, side) => `<div class="flex items-center justify-between gap-2 py-1.5 border-t border-white/[0.05] first:border-t-0">
      <span class="min-w-0 truncate text-[13px] text-zinc-100">${coachEsc(a.name)} <span class="text-[11px] text-zinc-500">${a.type === 'pick' ? (a.tier || 'pick') : a.pos}</span></span>
      <span class="flex items-center gap-2 shrink-0"><span class="text-[11px] mono text-zinc-500">${n(a.value)}</span><button onclick="coachWorkEdit('${side}', '${a.key}', false)" aria-label="Take ${coachEsc(a.name)} off" class="px-1 text-zinc-500 hover:text-white">×</button></span>
    </div>`;
  const addSel = (side, list, label) => `<select data-search="+ Type a player or pick…" onchange="coachWorkEdit('${side}', this.value, true)" aria-label="${label}" class="mt-2 w-full text-[12px] px-2 py-1 rounded-lg border border-white/10 text-zinc-400 bg-black/40"><option value="">${label}</option>${list.sort((x, y) => y.value - x.value).map(a => `<option value="${a.key}">${coachEsc(a.name)}${a.type === 'player' ? ` (${a.pos})` : ''} · ${n(a.value)}</option>`).join('')}</select>`;
  const empty = text => `<div class="py-2 text-[12px] text-zinc-500">${text}</div>`;
  const need = !w.give.length && !w.get.length ? `Start by asking for something from ${coachEsc(w.partner.teamName)}'s roster.` : !w.give.length ? 'Now add what you\'d give for it.' : 'Now add what you\'d want back.';
  return `${coachBuildHeadHtml(w)}
    <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div class="p-3 rounded-lg bg-black/30 border border-white/5 min-w-0"><div class="text-[11px] text-zinc-400 uppercase tracking-wider mb-1">${coachEsc(me.teamName)} gives</div>${w.give.map(a => piece(a, 'give')).join('') || empty('Nothing yet.')}${addSel('give', me.assets.filter(a => !inGive.has(a.key) && a.value >= 100), '+ Add one of yours…')}</div>
      <div class="p-3 rounded-lg bg-black/30 border border-white/5 min-w-0"><div class="text-[11px] text-zinc-400 uppercase tracking-wider mb-1">${coachEsc(me.teamName)} gets</div>${w.get.map(a => piece(a, 'get')).join('') || empty('Nothing yet.')}${addSel('get', w.partner.assets.filter(a => !inGet.has(a.key) && a.value >= 100), '+ Ask for one of theirs…')}</div>
    </div>
    <div class="mt-3 p-3 rounded-lg bg-white/[0.03] border border-white/10 text-[13px] text-zinc-200">${need} The read on both teams, and whether their manager would say yes, shows up once both sides have something.</div>
    ${coachHintsHtml(me, w)}`;
}

function renderCoach() {
  const head = document.getElementById('coachHead'), box = document.getElementById('coachBody');
  if (!head || !coachOpen()) return;
  const me = coachMe(), neg = Coach.option === 'negotiate', f = coachFlow();
  head.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap mb-1">
      <h2 class="text-[18px] font-semibold text-zinc-100">Trade Coach</h2>
      <nav aria-label="Where you are" class="text-[12px] flex flex-wrap items-center">${neg ? `<button onclick="coachFlowGo(Coach.work ? 'build' : 'what')" class="text-zinc-400 hover:text-white">← Back to Trade Coach</button>` : coachCrumbsHtml(me)}</nav>
    </div>
    <div class="mb-4">${coachTeamLineHtml(me)}</div>`;
  coachSync();
  if (neg) { box.innerHTML = `<div class="text-[12px] text-zinc-400 mb-3 max-w-[680px]">Offer the trade loaded in the builder. Their manager answers in their own words, and you can steer what you ask for next.</div>${coachNegotiateHtml()}`; return; }
  box.innerHTML = f.step === 'build' && Coach.work ? coachWorkHtml(me) : f.step === 'pick' && f.what ? coachPickHtml(me) : coachWhatHtml(me);
}
