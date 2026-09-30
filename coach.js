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
const COACH_OPTIONS = {
  best: { label: 'Best trades', blurb: 'The fairest trades across the league for your team that the other manager would likely accept, best for you first.' },
  negotiate: { label: 'Negotiate a trade', blurb: 'Offer the trade loaded in the calculator. Their manager answers in their own words, and you can steer what you ask for next.' },
  shop: { label: 'Shop a player', blurb: 'Pick one of your players or picks and see the best offer from every team, any return.' },
  target: { label: 'Get a player', blurb: 'Pick any player on another team and see offers their manager would likely take for them.' },
  downtier: { label: 'Down-tier a player', blurb: 'Pick one of your players. See trades where you get back a lesser player plus extra pieces, so you gain total value, that their manager would likely take.' },
  team: { label: 'Trade with a team', blurb: 'Pick a team and see the trades their manager would likely take, best for you first.' },
  position: { label: 'Fix a position', blurb: 'Pick a position. These trades upgrade your weakest starter there without giving up your other starters.' },
  rebuild: { label: 'Rebuild', blurb: 'Throw in the towel on this season: trades that turn your aging players into picks and players 24 or under while they still hold value.' },
  contend: { label: 'Go all-in', blurb: 'Win now: trades that spend picks, prospects, and bench players on starters for this season. Your starters stay put.' }
};
const Coach = { option: 'best', step: 'type', shopKey: null, targetKey: null, teamId: null, downKey: null, downSame: false, pos: null, results: {}, busy: false, mine: { must: [], keep: [], never: [], groups: [] }, theirs: { must: [], keep: [], never: [], groups: [] }, picker: { open: false, q: '', pos: 'ALL' } };

const coachTick = () => new Promise(r => setTimeout(r, 0));

/* ---------- Your timeline ----------
   The same per-team timeline as the calculator's Timeline picker
   (setTeamTimeline in trade.html). Go all-in and Rebuild set yours to match,
   so a rebuilder going all-in isn't graded as spending picks "a rebuild
   needed". */
const COACH_PLAN_FOR = { contend: 'contend', rebuild: 'rebuild' }; // options that imply a timeline
const coachSetPlan = mode => setTeamTimeline(coachMe().rosterId, mode);
function coachPlanHtml(me, chip) {
  const chosen = Vault.planOverride[me.rosterId] || 'auto';
  const auto = Vault.MODE_LABEL[autoTimeline(me)];
  return `<div class="flex flex-wrap items-center gap-1.5 mb-2">
      <span class="text-[12px] text-zinc-500 mr-1">Your timeline</span>
      ${chip(chosen === 'auto', `Auto <span class="text-zinc-500">· reads as ${auto}</span>`, "coachSetPlan('auto')")}
      ${chip(chosen === 'contend', 'Contending', "coachSetPlan('contend')")}
      ${chip(chosen === 'rebuild', 'Rebuilding', "coachSetPlan('rebuild')")}
    </div>`;
}
const coachMe = () => teamOf('A'); // the calculator's left side is always your team
const coachFairFirst = (x, y) => (x.edge >= VAULT_CONFIG.FAIR_PCT) - (y.edge >= VAULT_CONFIG.FAIR_PCT);

// Your team after a trade, for lineup gains.
function coachAfter(meId, partnerId, give, get) {
  const { pool } = Vault.simulateTrade(teams, slots, meId, partnerId, give, get);
  return pool.find(t => t.rosterId === meId);
}

// Depth guard for suggestions the coach picks on its own: never a trade that
// thins your depth (bye and injury cover, Vault.depthShift) by more than it adds
// to your healthy lineup, with depth at the grade's weight. Rebuilders are
// exempt (they aren't playing for this season's lineup); trades that don't
// touch depth are unaffected.
function coachDepthOK(me, partner, give, get) {
  if (Vault.teamMode(me) === 'rebuild') return true;
  const aft = coachAfter(me.rosterId, partner.rosterId, give, get);
  const dd = Vault.depthShift('contend', me, aft, slots).perWeek;
  return !(dd < -0.25 && (aft.opt - me.opt) + dd * VAULT_CONFIG.DEPTH_FIT_WEIGHT < 0);
}

// Your side (the "Your side" box): pieces every suggestion must include,
// pieces to keep, and whole groups (a position, or picks) never to trade.
// Must-include wins over a group toggle, and over protecting your starters.
const coachGroup = a => (a.type === 'pick' ? 'PICK' : a.pos);
const coachMust = me => Coach.mine.must.map(k => me.assets.find(a => a.key === k)).filter(Boolean);
function coachOffLimits(me) {
  const off = new Set(Coach.mine.keep);
  me.assets.forEach(a => { if (Coach.mine.never.includes(coachGroup(a))) off.add(a.key); });
  Coach.mine.must.forEach(k => off.delete(k));
  return off;
}
const coachHasRules = side => Coach[side].must.length + Coach[side].keep.length + Coach[side].never.length + Coach[side].groups.length > 0;
// "Must include a" (Your side) / "Must get a" (Their side): every suggestion
// sends at least one of each chosen group (a position, or a pick) and brings
// back at least one of each of theirs.
const coachGroupsOK = (give, get) => Coach.mine.groups.every(g => give.some(a => coachGroup(a) === g)) && Coach.theirs.groups.every(g => get.some(a => coachGroup(a) === g));
const coachHasMine = () => coachHasRules('mine') || coachHasRules('theirs');

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
function coachOffers(me, partner, get, { protect = new Set(), ceiling = VAULT_CONFIG.FAIR_PCT, limit = 1, perLead = 1 } = {}) {
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
  const ctx = negContextFor(partner);
  const judge = list => list.map(give => ({ give, j: negJudgeFor(me, give, partner, get, ctx) })).filter(x => x.j.accepts);
  const offer = x => ({ partner, give: x.give, get, edge: x.j.edge });
  let taken = judge(packs);
  let found = taken.filter(x => x.j.edge < ceiling).map(offer);
  if (found.length < limit) {
    const top = pool.slice(0, 10), triples = [];
    top.forEach((a, i) => top.slice(i + 1).forEach((b, k) => top.slice(i + k + 2).forEach(c => {
      const s = mustVal + a.value + b.value + c.value;
      if (s >= want * 0.9 && s <= want * 2.2) triples.push([...must, a, b, c]);
    })));
    const t3 = judge(triples);
    taken = taken.concat(t3);
    found = found.concat(t3.filter(x => x.j.edge < ceiling).map(offer));
  }
  // Balance it back: the closest overpays, each with the one piece of theirs
  // that brings it to Fair while leaving you best off.
  const over = taken.filter(x => x.j.edge >= VAULT_CONFIG.FAIR_PCT).sort((x, y) => x.j.edge - y.j.edge).slice(0, 12);
  if (over.length) {
    const inGet = new Set(negKeys(get));
    const fillers = partner.assets.filter(a => !inGet.has(a.key) && !coachTheirOff(a) && a.value >= want * 0.05 && a.value <= want * 0.6)
      .sort((x, y) => y.value - x.value).slice(0, 12);
    over.forEach(x => {
      let best = null;
      fillers.forEach(fl => {
        const g2 = [...get, fl];
        const j = negJudgeFor(me, x.give, partner, g2, ctx);
        if (j.accepts && j.edge < VAULT_CONFIG.FAIR_PCT && (!best || j.edge < best.edge)) best = { partner, give: x.give, get: g2, edge: j.edge, note: `They add ${Vault.escapeHtml(fl.name)} to even it out.` };
      });
      if (best) found.push(best);
    });
  }
  const count = new Map();
  return found.filter(o => coachGroupsOK(o.give, o.get)).sort((x, y) => x.edge - y.edge).filter(o => {
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

async function coachTarget(me, progress) {
  const seller = teams.find(t => t.assets.some(a => a.key === Coach.targetKey));
  if (!seller || seller === me) return { empty: 'Pick a player on another team first.' };
  const target = seller.assets.find(a => a.key === Coach.targetKey);
  progress(`Checking what ${seller.teamName} would take for ${target.name}…`);
  await coachTick();
  const run = async ceiling => coachOffers(me, seller, [target], { ceiling, limit: COACH.TARGET_SHOW, perLead: 2 }).map(o => ({ ...o, id: negKeys(o.give).join() + '>' + negKeys(o.get).join(), why: o.note || '' }));
  const list = (await coachPriced(run, 3)).slice(0, COACH.TARGET_SHOW);
  if (!list.length) return { empty: `${Vault.escapeHtml(seller.teamName)} wouldn't likely take anything on your roster for ${Vault.escapeHtml(target.name)} right now, even with a premium.` };
  return { title: `Offers for ${Vault.escapeHtml(target.name)}`, list };
}

// Lineup upgrades at these positions, paid for without anything in `protect`.
// valueMode (Fix a position): an upgrade is any lineup gain AND you end up
// with the best asset in the deal (the most valuable single piece comes to
// you). Otherwise (Go all-in): COACH.MIN_GAIN points a week.
async function coachUpgrades(me, positions, protect, progress, pay, valueMode = false) {
  const starters = me.lineup.filter(s => s.id);
  const floor = {};
  positions.forEach(P => { const at = starters.filter(s => s.pos === P); floor[P] = at.length ? Math.min(...at.map(s => s.ppg)) : 0; });
  const must = coachMust(me), off = coachOffLimits(me);
  const budget = sumValue(must) + me.assets.filter(a => !protect.has(a.key) && !off.has(a.key) && !must.includes(a)).map(a => a.value).sort((x, y) => y - x).slice(0, 3).reduce((t, v) => t + v, 0);
  const cands = teams.filter(t => t !== me && coachPartnerOK(t))
    .flatMap(t => t.assets.filter(a => a.type === 'player' && !coachTheirOff(a) && positions.includes(a.pos) && (a.ppg || 0) >= floor[a.pos] + COACH.UPGRADE_BY && a.value <= budget).map(a => ({ a, t })))
    .sort((x, y) => (y.a.ppg - floor[y.a.pos]) - (x.a.ppg - floor[x.a.pos])).slice(0, 15);
  const run = async ceiling => {
    const out = [];
    for (const { a, t } of cands) {
      progress(`Pricing ${a.name}${ceiling > VAULT_CONFIG.FAIR_PCT ? ' with a premium' : ''}…`);
      await coachTick();
      // The cheapest few packages, best for you first; keep the first that
      // really upgrades your lineup (a package built on one of your own
      // starters there may only be a sidegrade, so try the next one).
      let o = null, gain = 0;
      const starterKeys = new Set(starters.map(s => 'p_' + s.id));
      for (const cand of coachOffers(me, t, [a], { protect, ceiling, limit: 4 })) {
        // Never pay a premium to send away one of your starters: a Lopsided
        // offer is only worth it when it's paid with bench players and picks.
        if (cand.edge >= VAULT_CONFIG.FAIR_PCT && cand.give.some(x => starterKeys.has(x.key))) continue;
        // Net lineup gain: the healthy best lineup, minus any depth it costs
        // (what bye and injury weeks cost the lineup, Vault.depthShift), with
        // depth counted at the grade's weight.
        const aft = coachAfter(me.rosterId, t.rosterId, cand.give, cand.get);
        const g = aft.opt - me.opt + Vault.depthShift('contend', me, aft, slots).perWeek * VAULT_CONFIG.DEPTH_FIT_WEIGHT;
        const top = list => Math.max(...list.map(x => x.value));
        const betterAsset = top(cand.get) > top(cand.give);
        if (valueMode ? g >= 0.5 && betterAsset : g >= COACH.MIN_GAIN) { o = cand; gain = g; break; }
      }
      if (!o) continue;
      out.push({ ...o, id: a.key, gain, why: `${Vault.escapeHtml(a.name)} starts for you: about +${gain.toFixed(1)} pts/week to your lineup, depth included${pay ? `, ${pay}` : ''}.${o.note ? ' ' + o.note : ''}` });
    }
    return out;
  };
  const list = await coachPriced(run, 3);
  return list.sort((x, y) => coachFairFirst(x, y) || y.gain - x.gain).slice(0, COACH.SHOW);
}

async function coachPosition(me, progress) {
  const P = Coach.pos;
  // Starters at other positions stay put; any of your starters at this
  // position can be part of the deal, as long as the trade really upgrades
  // your lineup (COACH.MIN_GAIN), not a sidegrade like one WR1 for another.
  const protect = new Set(me.lineup.filter(s => s.id && s.pos !== P).map(s => 'p_' + s.id));
  const list = await coachUpgrades(me, [P], protect, progress, '', true);
  if (!list.length) return { empty: `No upgrade at ${P} found: nobody who'd out-score your weakest ${P} starter by ${COACH.UPGRADE_BY}+ pts/week is gettable without giving up your other starters.` };
  return { title: `Upgrades at ${P}`, list };
}

async function coachContend(me, progress) {
  const protect = new Set(me.lineup.filter(s => s.id).map(s => 'p_' + s.id));
  const list = await coachUpgrades(me, ['QB', 'RB', 'WR', 'TE'], protect, progress, 'paid with picks, prospects, and bench players');
  if (!list.length) return { empty: 'No lineup upgrade found that your picks, prospects, and bench can pay for.' };
  return { title: 'Win-now trades', list };
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
      const j = negJudgeFor(me, [v], t, pack, negContextFor(t));
      if (j.accepts && j.edge < VAULT_CONFIG.FAIR_PCT && (!best || j.edge < best.edge)) best = { partner: t, give: [v], get: pack, edge: j.edge };
    });
    if (best) offers.push(best);
  });
  return offers.sort((x, y) => x.edge - y.edge);
}

async function coachShop(me, progress) {
  const v = me.assets.find(a => a.key === Coach.shopKey);
  if (!v) return { empty: 'Pick one of your players or picks to shop.' };
  progress(`Shopping ${v.name} around the league…`);
  await coachTick();
  const list = coachSaleOffers(me, v, () => true).map(o => ({ ...o, id: o.partner.rosterId + '', why: '' }));
  if (!list.length) return { empty: `No team would give fair value for ${Vault.escapeHtml(v.name)} right now.` };
  return { title: `Offers for ${Vault.escapeHtml(v.name)}`, list };
}

// With Sell these set, shops only those pieces, with several offers each
// (one per team). Otherwise, the best offer for each aging player not kept
// off limits, most valuable first.
async function coachRebuild(me, progress) {
  const must = coachMust(me), off = coachOffLimits(me);
  const vets = must.length ? must : me.assets.filter(a => a.type === 'player' && !off.has(a.key) && COACH.SELL_AGE[a.pos] && a.age >= COACH.SELL_AGE[a.pos] && a.value >= 1500).sort((x, y) => y.value - x.value).slice(0, 8);
  if (!vets.length) return { empty: 'You don\'t have aging players worth selling (RBs 26+, WRs 28+, TEs 29+, QBs 30+ with real value). Add anyone you want to move under Sell these.' };
  const perPiece = must.length ? Math.max(2, Math.floor(6 / must.length)) : 1;
  const young = a => a.type === 'pick' || (a.age && a.age <= 24);
  const list = [];
  for (const v of vets) {
    progress(`Shopping ${v.name}…`);
    await coachTick();
    const offers = coachSaleOffers(me, v, young);
    const age = Math.floor(v.age);
    const why = must.length
      ? (v.type === 'player' && COACH.SELL_AGE[v.pos] && age >= COACH.SELL_AGE[v.pos] ? `At ${age}, ${Vault.escapeHtml(v.name)} is ${age > COACH.SELL_AGE[v.pos] ? 'past' : 'at'} the age ${v.pos}s usually start losing value.` : '')
      : `At ${age}, ${Vault.escapeHtml(v.name)} is ${age > COACH.SELL_AGE[v.pos] ? 'past' : 'at'} the age ${v.pos}s usually start losing value.`;
    offers.slice(0, perPiece).forEach(o => list.push({ ...o, id: v.key + o.partner.rosterId, why }));
  }
  const names = must.map(a => Vault.escapeHtml(a.name)).join(', ');
  if (!list.length) return { empty: must.length ? `No team would give fair value in picks or young players for ${names} right now.` : 'No team would give fair value in picks or young players for your veterans right now.' };
  return { title: must.length ? `Offers for ${names}` : 'Rebuild trades', list: list.slice(0, must.length ? 12 : 6) };
}

async function coachBest(me, progress) {
  progress('Searching the league for fair trades…');
  await coachTick();
  const must = coachMust(me), off = coachOffLimits(me);
  const pool = suggestionPool(me).filter(c =>
    coachPartnerOK(c.partner) && must.every(m => c.giveA.includes(m)) && !c.giveA.some(a => off.has(a.key))
    && !c.giveB.some(coachTheirOff) && coachTheirMust(c.partner).every(m => c.giveB.includes(m)) && coachGroupsOK(c.giveA, c.giveB)
    && coachDepthOK(me, c.partner, c.giveA, c.giveB));
  progress('Checking which of those their managers would take…');
  await coachTick();
  const perPartner = new Map(), list = [];
  pool.map(c => ({ c, j: negJudgeFor(me, c.giveA, c.partner, c.giveB, negContextFor(c.partner)) }))
    .filter(x => x.j.accepts && x.j.edge < VAULT_CONFIG.FAIR_PCT)
    .sort((x, y) => x.j.edge - y.j.edge)
    .forEach(({ c, j }) => {
      const n = perPartner.get(c.partner.rosterId) || 0;
      if (n >= 2 || list.length >= 10) return;
      perPartner.set(c.partner.rosterId, n + 1);
      const fit = c.result.bucket === 'Great' ? 'A strong fit for both rosters.' : c.result.bucket === 'Good' ? 'A strong fit for one side.' : '';
      list.push({ partner: c.partner, give: c.giveA, get: c.giveB, edge: j.edge, id: negKeys(c.giveA).join() + '>' + negKeys(c.giveB).join(), why: fit });
    });
  if (!list.length) return { empty: `No trade across the league is both Fair for ${Vault.escapeHtml(me.teamName)} and one the other manager would likely take right now. Try Get a player or Fix a position.` };
  return { title: 'Best trades for you', list };
}

// Trades with one team: the league search (suggestionPool) narrowed to them,
// plus offers for each of their most valuable pieces. Fair ones first; when
// there are fewer than 3, the cheapest Lopsided ones they'd take are added
// (flagged on the card). At most 2 offers built on the same piece of theirs.
async function coachTeam(me, progress) {
  const partner = teams.find(t => String(t.rosterId) === String(Coach.teamId));
  if (!partner || partner === me) return { empty: 'Pick a team to trade with first.' };
  const name = Vault.escapeHtml(partner.teamName);
  if (!coachPartnerOK(partner)) return { empty: `${name} doesn't have any of the pieces you require under Their side.` };
  progress(`Looking for trades with ${partner.teamName}…`);
  await coachTick();
  const must = coachMust(me), off = coachOffLimits(me), ctx = negContextFor(partner);
  const seen = new Set(), found = [];
  const add = (give, get, edge, why) => {
    const id = negKeys(give).join() + '>' + negKeys(get).join();
    if (seen.has(id) || !coachGroupsOK(give, get) || !coachDepthOK(me, partner, give, get)) return;
    seen.add(id);
    found.push({ partner, give, get, edge, id, why });
  };
  suggestionPool(me, partner).filter(c =>
    must.every(m => c.giveA.includes(m)) && !c.giveA.some(a => off.has(a.key))
    && !c.giveB.some(coachTheirOff) && coachTheirMust(partner).every(m => c.giveB.includes(m)))
    .forEach(c => {
      const j = negJudgeFor(me, c.giveA, partner, c.giveB, ctx);
      if (j.accepts && j.edge < VAULT_CONFIG.LOPSIDED_PCT) add(c.giveA, c.giveB, j.edge, c.result.bucket === 'Great' ? 'A strong fit for both rosters.' : c.result.bucket === 'Good' ? 'A strong fit for one side.' : '');
    });
  const targets = partner.assets.filter(a => !coachTheirOff(a) && a.value >= 500).sort((x, y) => y.value - x.value).slice(0, 8);
  for (const a of targets) {
    progress(`Pricing ${a.name}…`);
    await coachTick();
    coachOffers(me, partner, [a], { ceiling: VAULT_CONFIG.LOPSIDED_PCT, limit: 2 }).forEach(o => add(o.give, o.get, o.edge, o.note || ''));
  }
  // Pick-for-pick swaps last, like the league search: they price almost even
  // by construction, so closest-to-Fair says little about them.
  const picksOnly = o => [...o.give, ...o.get].every(a => a.type === 'pick');
  const perLead = new Map();
  const varied = found.sort((x, y) => picksOnly(x) - picksOnly(y) || x.edge - y.edge).filter(o => {
    const lead = [...o.get].sort((x, y) => y.value - x.value)[0].key, n = perLead.get(lead) || 0;
    if (n >= 2) return false;
    perLead.set(lead, n + 1);
    return true;
  });
  const fair = varied.filter(o => o.edge < VAULT_CONFIG.FAIR_PCT);
  const list = (fair.length >= 3 ? fair : fair.concat(varied.filter(o => o.edge >= VAULT_CONFIG.FAIR_PCT).slice(0, 3))).slice(0, COACH.TARGET_SHOW);
  if (!list.length) return { empty: `No trade with ${name} is one their manager would likely take right now.` };
  return { title: `Trades with ${name}`, list };
}

// Down-tier: your player for one of their lesser players (40-92% of the
// value) plus one or two more pieces, adding up to more raw KTC value than
// you send. Best package per player of theirs, at most 2 per team; Fair ones
// first, then (when there are fewer than 3) the cheapest Lopsided ones.
async function coachDowntier(me, progress) {
  const v = me.assets.find(a => a.key === Coach.downKey);
  if (!v) return { empty: 'Pick one of your players to down-tier.' };
  const give = [v, ...coachMust(me).filter(a => a !== v)], sent = sumValue(give);
  const found = [];
  for (const t of teams.filter(x => x !== me && coachPartnerOK(x))) {
    progress(`Checking ${t.teamName}…`);
    await coachTick();
    const ctx = negContextFor(t), tm = coachTheirMust(t);
    const leads = t.assets.filter(a => a.type === 'player' && !coachTheirOff(a) && a.value >= v.value * 0.4 && a.value <= v.value * 0.92 && (!Coach.downSame || a.pos === v.pos))
      .sort((x, y) => y.value - x.value).slice(0, 4);
    leads.forEach(L => {
      const fillers = t.assets.filter(a => a !== L && !tm.includes(a) && !coachTheirOff(a) && a.value >= v.value * 0.05 && a.value <= L.value).sort((x, y) => y.value - x.value).slice(0, 8);
      const packs = [];
      fillers.forEach((f, i) => {
        packs.push([...tm, L, f]);
        fillers.slice(i + 1).forEach(g => packs.push([...tm, L, f, g]));
      });
      let best = null;
      packs.filter(p => sumValue(p) > sent && sumValue(p) <= sent * 2 && coachGroupsOK(give, p)).forEach(p => {
        const j = negJudgeFor(me, give, t, p, ctx);
        if (j.accepts && j.edge < VAULT_CONFIG.LOPSIDED_PCT && (!best || j.edge < best.edge)) best = { partner: t, give, get: p, edge: j.edge, lead: L };
      });
      if (best) found.push(best);
    });
  }
  const perTeam = new Map();
  const varied = found.sort((x, y) => x.edge - y.edge).filter(o => {
    const n = perTeam.get(o.partner.rosterId) || 0;
    if (n >= 2) return false;
    perTeam.set(o.partner.rosterId, n + 1);
    return true;
  });
  const fair = varied.filter(o => o.edge < VAULT_CONFIG.FAIR_PCT);
  const list = (fair.length >= 3 ? fair : fair.concat(varied.filter(o => o.edge >= VAULT_CONFIG.FAIR_PCT).slice(0, 3))).slice(0, COACH.TARGET_SHOW)
    .map(o => {
      const n = x => Math.round(x).toLocaleString(), rest = o.get.filter(a => a !== o.lead);
      return { ...o, id: negKeys(o.give).join() + '>' + negKeys(o.get).join(),
        why: `Down from ${Vault.escapeHtml(v.name)} (${n(v.value)}) to ${Vault.escapeHtml(o.lead.name)} (${n(o.lead.value)}), plus ${negNames(rest)}: +${n(sumValue(o.get) - sent)} KTC value in total.` };
    });
  if (!list.length) return { empty: `No team would give a lesser ${Coach.downSame ? v.pos + ' ' : ''}player plus more for ${Vault.escapeHtml(v.name)} right now.` };
  return { title: `Down-tier ${Vault.escapeHtml(v.name)}`, list };
}

const COACH_RUN = { downtier: coachDowntier, team: coachTeam, best: coachBest, shop: coachShop, target: coachTarget, position: coachPosition, rebuild: coachRebuild, contend: coachContend };

async function coachFind() {
  if (Coach.busy) return;
  Coach.collapsed = false;
  if (!coachReady()) {
    Coach.step = 'type';
    return Coach.option === 'target' ? coachOpenPicker() : renderCoach();
  }
  Coach.step = 'results';
  const me = coachMe(), option = Coach.option;
  const implied = COACH_PLAN_FOR[option];
  let planNote = '';
  if (implied && Vault.teamMode(me) !== implied) {
    coachSetPlan(implied);
    planNote = `Your timeline is now set to ${implied === 'contend' ? 'Contending' : 'Rebuilding'}, so these trades (and the Trade Analysis) grade your side as ${implied === 'contend' ? 'contending' : 'rebuilding'}. Switch back under Your timeline in step 1.`;
  }
  Coach.busy = true;
  renderCoach();
  const status = document.getElementById('coachStatus');
  const progress = text => { if (status) status.textContent = text; };
  if (!Negotiation.styles) { progress('Reading every manager\'s trade history…'); await Promise.race([negPreloadStyles(), new Promise(r => setTimeout(r, 8000))]); }
  try {
    Coach.results[option] = { ...(await COACH_RUN[option](me, progress)), meId: me.rosterId, key: coachInputKey(), planNote };
  } catch (e) {
    console.error(e);
    Coach.results[option] = { empty: 'Something went wrong finding trades. Try again.' };
  }
  Coach.busy = false;
  renderCoach();
}

// Results belong to the inputs they were found for.
const coachInputKey = () => ({ shop: Coach.shopKey, target: Coach.targetKey, team: Coach.teamId, downtier: Coach.downKey + (Coach.downSame ? ':same' : ''), position: Coach.pos }[Coach.option] || '') + '|' + JSON.stringify([Coach.mine, Coach.theirs, Vault.planOverride[coachMe().rosterId] || 'auto']);

/* ---------- Panel ---------- */

// The coach is one of the tools on the Trade Calculator's start screen (and
// the Trade Coach tab). It's set up one step at a time: the trade type (and
// its player, team, or position), then what every trade must include, what to
// leave out, and position rules, each skippable, then the trades.
const COACH_STEPS = [['type', 'Trade type'], ['include', 'Must include'], ['exclude', 'Leave out'], ['positions', 'Positions'], ['results', 'Trades']];
function openCoach(option) {
  if (option) { Coach.option = option; Coach.collapsed = false; if (option !== 'negotiate') Coach.step = 'type'; }
  const wasOpen = coachOpen();
  setView('coach');
  renderCoach();
  if (option === 'target' && !Coach.targetKey) coachOpenPicker();
  if (!wasOpen) document.getElementById('coach').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// The option's own input is filled in (a player, team, or position).
const coachReady = () => ({ shop: !!Coach.shopKey, target: !!Coach.targetKey, team: !!Coach.teamId, downtier: !!Coach.downKey }[Coach.option] ?? true);
// Anything set on a rule step.
function coachStepHas(step) {
  const n = list => Coach.mine[list].length + Coach.theirs[list].length;
  return step === 'include' ? n('must') > 0 : step === 'exclude' ? n('keep') > 0 : step === 'positions' ? n('groups') + n('never') > 0 : false;
}
function coachGo(step) {
  if (step === 'results') {
    const r = Coach.results[Coach.option];
    if (!(r && r.key === coachInputKey())) return coachFind();
  }
  Coach.step = step;
  renderCoach();
}
// Called when the workspace opens on your team: fresh results, back to step 1.
function coachStart() {
  Coach.results = {};
  Coach.pos = coachDefaultPos();
  Coach.targetKey = null;
  Coach.teamId = null;
  Coach.downKey = null;
  if (Coach.option !== 'negotiate') { Coach.option = 'best'; Coach.step = 'type'; }
  negPreloadStyles();
  renderCoach();
}
const coachOpen = () => view === 'coach' && !document.getElementById('workspace').classList.contains('hidden');
function coachSync() {
  const neg = document.getElementById('negotiation');
  if (neg) neg.classList.toggle('hidden', !(Coach.option === 'negotiate' && Negotiation.rounds.length));
}
function coachReset() { Coach.results = {}; if (coachOpen()) renderCoach(); }
function coachSetOption(o) {
  Coach.option = o; Coach.collapsed = false;
  if (o === 'team' && !Coach.teamId && teamOf('B')) Coach.teamId = String(teamOf('B').rosterId);
  renderCoach();
}
function coachSetDown(key) { Coach.downKey = key || null; renderCoach(); }
function coachSetDownSame(same) { Coach.downSame = same; renderCoach(); }
function coachSetTeam(id) { Coach.teamId = id || null; renderCoach(); }
function coachSetPos(p) { Coach.pos = p; renderCoach(); }
function coachSetShop(key) { Coach.shopKey = key || null; renderCoach(); }
// From a roster row: Shop (your piece) or Get (their player), then search.
function coachShopFor(key) { Coach.option = 'shop'; Coach.shopKey = key; coachJump(); }
function coachGetFor(key) { Coach.option = 'target'; Coach.targetKey = key; Coach.picker.open = false; coachJump(); }
function coachJump() {
  setView('coach');
  renderCoach();
  document.getElementById('coach').scrollIntoView({ behavior: 'smooth', block: 'start' });
  coachFind();
}

function coachDefaultPos() {
  const { posPct, needs } = Vault.positionalProfile(coachMe(), teams);
  const order = Object.keys(posPct).sort((x, y) => posPct[x] - posPct[y]);
  return (order.find(p => needs.includes(p)) || order[0] || 'rb').toUpperCase();
}

// Load a suggestion into the calculator (your team as Team A).
function coachLoad(i) {
  const r = Coach.results[Coach.option], o = r && r.list[i];
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

function coachSideAdd(side, list, key) {
  if (!key) return;
  const other = list === 'must' ? 'keep' : 'must';
  Coach[side][other] = Coach[side][other].filter(k => k !== key);
  if (!Coach[side][list].includes(key)) Coach[side][list].push(key);
  renderCoach();
}
function coachSideRemove(side, list, key) { Coach[side][list] = Coach[side][list].filter(k => k !== key); renderCoach(); }
function coachSideToggle(side, g) { const s = Coach[side]; s.never = s.never.includes(g) ? s.never.filter(x => x !== g) : [...s.never, g]; s.groups = s.groups.filter(x => x !== g); renderCoach(); }
// A group is either required or ruled out, never both.
function coachSideGroup(side, g) {
  const s = Coach[side];
  s.groups = s.groups.includes(g) ? s.groups.filter(x => x !== g) : [...s.groups, g];
  s.never = s.never.filter(x => x !== g);
  renderCoach();
}
function coachSideClear(side) { Coach[side] = { must: [], keep: [], never: [], groups: [] }; renderCoach(); }

// The asset behind a rule key, on your roster or anyone else's.
function coachRuleAsset(side, me, k) {
  const pool = side === 'mine' ? me.assets : teams.filter(x => x !== me).flatMap(x => x.assets);
  return pool.find(a => a.key === k);
}

// One side's rows for a rule step (include: pieces it must include; exclude:
// pieces to leave out; positions: positions it must include or never include).
function coachSideHtml(side, me, step) {
  const m = Coach[side], esc = Vault.escapeHtml, mine = side === 'mine';
  const others = teams.filter(x => x !== me);
  const find = k => (mine ? me.assets : others.flatMap(x => x.assets)).find(a => a.key === k);
  const owner = k => others.find(x => x.assets.some(a => a.key === k));
  const tag = (k, list) => {
    const a = find(k);
    if (!a) return '';
    const who = mine ? '' : ` <span class="opacity-60">· ${esc(owner(k).teamName)}</span>`;
    return `<span class="inline-flex items-center gap-0.5 text-[12px] pl-2 pr-0.5 py-0.5 rounded-md border ${list === 'must' ? 'border-emerald-500/30 text-emerald-200 bg-emerald-500/10' : 'border-rose-500/30 text-rose-200 bg-rose-500/10'}">${esc(a.name)}${who}<button onclick="coachSideRemove('${side}', '${list}', '${k}')" aria-label="Remove ${esc(a.name)}" class="px-1 text-zinc-400 hover:text-white">×</button></span>`;
  };
  const used = new Set([...m.must, ...m.keep]);
  const opt = a => `<option value="${a.key}">${esc(a.name)}${a.type === 'player' ? ` (${a.pos})` : ''} · ${Math.round(a.value).toLocaleString()}</option>`;
  const opts = mine
    ? me.assets.filter(a => !used.has(a.key)).map(opt).join('')
    : others.map(x => `<optgroup label="${esc(x.teamName)}">${x.assets.filter(a => !used.has(a.key) && a.value >= 300).map(opt).join('')}</optgroup>`).join('');
  const add = list => `<select data-search="+ Type a player or pick…" onchange="coachSideAdd('${side}', '${list}', this.value)" aria-label="Add a player or pick" class="text-[12px] px-2 py-1 rounded-lg border border-white/10 text-zinc-400 bg-black/40 max-w-[170px]"><option value="">+ Add…</option>${opts}</select>`;
  const group = g => `<button onclick="coachSideToggle('${side}', '${g}')" class="text-[12px] px-2.5 py-1 rounded-lg border transition-colors ${m.never.includes(g) ? 'bg-rose-500/10 border-rose-500/30 text-rose-200' : 'border-white/10 text-zinc-400 hover:text-white'}">${g === 'PICK' ? 'Picks' : g}</button>`;
  const need = g => `<button onclick="coachSideGroup('${side}', '${g}')" class="text-[12px] px-2.5 py-1 rounded-lg border transition-colors ${m.groups.includes(g) ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'border-white/10 text-zinc-400 hover:text-white'}">${g === 'PICK' ? 'Pick' : g}</button>`;
  const row = (label, body) => `<div class="flex flex-wrap items-center gap-1.5"><span class="text-[12px] text-zinc-500 w-[108px] shrink-0">${label}</span>${body}</div>`;
  const G = ['QB', 'RB', 'WR', 'TE', 'PICK'];
  const rows = {
    include: row(mine ? (Coach.option === 'rebuild' ? 'Sell these' : 'You send') : 'You get', m.must.map(k => tag(k, 'must')).join('') + add('must')),
    exclude: row(mine ? 'Don\'t trade' : 'Don\'t want', m.keep.map(k => tag(k, 'keep')).join('') + add('keep')),
    positions: row(mine ? 'Must send a' : 'Must get a', G.map(need).join('')) + row(mine ? 'Never trade any' : 'Never take any', G.map(group).join(''))
  }[step];
  return `<div class="p-3 rounded-lg bg-black/30 border border-white/5 space-y-2 min-w-0">
      <div class="text-[11px] text-zinc-400 uppercase tracking-wider">${mine ? 'Your side' : 'Their side'}</div>
      ${rows}
    </div>`;
}
const COACH_STEP_HELP = {
  include: 'Players or picks every trade has to include. Skip if anything goes.',
  exclude: 'Players or picks to leave out of every trade. Skip if nothing is off limits.',
  positions: 'Positions every trade has to include, or can never include. Skip to allow any.'
};
function coachRulesHtml(me, step) {
  return `<div class="text-[13px] text-zinc-300 mb-3">${COACH_STEP_HELP[step]}</div>
    <div class="grid gap-2 lg:grid-cols-2">${coachSideHtml('mine', me, step)}${coachSideHtml('theirs', me, step)}</div>`;
}

// Everything chosen so far, as chips that jump back to their step.
function coachSummaryHtml(me) {
  const esc = Vault.escapeHtml, find = (side, k) => coachRuleAsset(side, me, k);
  const detail = {
    shop: () => find('mine', Coach.shopKey)?.name,
    target: () => find('theirs', Coach.targetKey)?.name,
    team: () => teams.find(t => String(t.rosterId) === String(Coach.teamId))?.teamName,
    downtier: () => { const a = find('mine', Coach.downKey); return a && a.name + (Coach.downSame ? `, same position` : ''); },
    position: () => Coach.pos
  }[Coach.option];
  const d = detail && detail();
  const chips = [[`<span class="text-zinc-100 font-medium">${COACH_OPTIONS[Coach.option].label}</span>${d ? `: ${esc(d)}` : ''}`, 'type']];
  const names = (side, list) => Coach[side][list].map(k => find(side, k)).filter(Boolean).map(a => esc(a.name)).join(', ');
  const grp = g => (g === 'PICK' ? 'Pick' : g);
  const add = (label, text, step) => { if (text) chips.push([`${label}: ${text}`, step]); };
  add(Coach.option === 'rebuild' ? 'Sell' : 'You send', names('mine', 'must'), 'include');
  add('You get', names('theirs', 'must'), 'include');
  add('Don\'t trade', names('mine', 'keep'), 'exclude');
  add('Don\'t want', names('theirs', 'keep'), 'exclude');
  add('Must send a', Coach.mine.groups.map(grp).join(', '), 'positions');
  add('Must get a', Coach.theirs.groups.map(grp).join(', '), 'positions');
  add('Never trade any', Coach.mine.never.map(grp).join(', '), 'positions');
  add('Never take any', Coach.theirs.never.map(grp).join(', '), 'positions');
  return `<div class="flex flex-wrap items-center gap-1.5">${chips.map(([html, step]) => `<button onclick="coachGo('${step}')" title="Change this" class="text-[12px] text-zinc-300 px-2.5 py-1 rounded-lg border border-white/10 hover:border-white/20 hover:text-white">${html}</button>`).join('')}
    ${coachHasMine() ? `<button onclick="coachSideClear('mine'); coachSideClear('theirs')" class="text-[12px] text-zinc-500 hover:text-white px-1">Clear rules</button>` : ''}</div>`;
}

// Numbered steps along the top; any step can be reopened.
function coachStepperHtml() {
  const at = COACH_STEPS.findIndex(([s]) => s === Coach.step);
  return `<ol class="flex flex-wrap items-center gap-1.5 text-[12px]">${COACH_STEPS.map(([s, label], i) => {
    const cur = i === at, done = i < at || (s !== 'results' && s !== 'type' && coachStepHas(s));
    const blocked = s !== 'type' && !coachReady();
    return `<li class="flex items-center gap-1.5">${i ? '<span class="text-zinc-600" aria-hidden="true">›</span>' : ''}<button onclick="coachGo('${s}')" ${blocked ? 'disabled' : ''} ${cur ? 'aria-current="step"' : ''}
      class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors ${cur ? 'bg-amber-400/10 border-amber-400/40 text-amber-100' : blocked ? 'border-transparent text-zinc-600 cursor-default' : 'border-transparent text-zinc-400 hover:text-white'}">
      <span class="size-[18px] rounded-full text-[11px] font-semibold flex items-center justify-center ${cur ? 'bg-amber-400 text-black' : done ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-zinc-400'}">${s === 'results' ? '✓' : i + 1}</span>${label}</button></li>`;
  }).join('')}</ol>`;
}

// Back / Skip-or-Next / Find trades along the bottom of each step.
function coachNavHtml() {
  const i = COACH_STEPS.findIndex(([s]) => s === Coach.step), prev = COACH_STEPS[i - 1], next = COACH_STEPS[i + 1];
  const ready = coachReady(), last = next[0] === 'results';
  const back = prev ? `<button onclick="coachGo('${prev[0]}')" class="text-[12px] px-3 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-white">← Back</button>` : '<span></span>';
  const hint = ready ? '' : `<div class="text-[12px] text-zinc-500 mt-2 text-right">${{ shop: 'Pick a player or pick to shop first.', target: 'Pick a player to get first.', team: 'Pick a team first.', downtier: 'Pick a player to down-tier first.' }[Coach.option]}</div>`;
  // Step 1: most searches need no rules, so Find trades is the main button and
  // the rule steps are an optional detour.
  if (Coach.step === 'type') {
    return `<div class="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-white/5">
        <button onclick="coachGo('include')" ${ready ? '' : 'disabled'} class="text-[12px] px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/20 ${ready ? '' : 'opacity-50 cursor-default'}">Add rules (optional) →</button>
        <button onclick="coachFind()" ${ready ? '' : 'disabled'} class="text-[12px] px-4 py-1.5 rounded-lg btn-gold-solid">Find trades</button>
      </div>${hint}`;
  }
  const primaryLabel = last ? 'Find trades' : coachStepHas(Coach.step) ? 'Next →' : 'Skip →';
  const now = !last ? `<button onclick="coachFind()" ${ready ? '' : 'disabled'} class="text-[12px] px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/20 ${ready ? '' : 'opacity-50 cursor-default'}">Find trades now</button>` : '';
  return `<div class="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-white/5">
      ${back}
      <div class="flex items-center gap-2">${now}<button onclick="coachGo('${next[0]}')" ${ready ? '' : 'disabled'} class="text-[12px] px-4 py-1.5 rounded-lg btn-gold-solid">${primaryLabel}</button></div>
    </div>${hint}`;
}

/* ---------- Target picker ---------- */

function coachTargetOptions() {
  const me = coachMe();
  return teams.filter(t => t !== me).flatMap(t => t.assets.filter(a => a.type === 'player' && a.value >= 300).map(a => ({ key: a.key, value: a.value, name: a.name, pos: a.pos, team: t.teamName })))
    .sort((x, y) => y.value - x.value);
}
function coachPickTarget(key) { Coach.targetKey = key; Coach.picker.open = false; renderCoach(); }
function coachOpenPicker() { Coach.picker = { open: true, q: '', pos: 'ALL' }; renderCoach(); document.getElementById('coachTargetSearch')?.focus(); }
function coachClosePicker() { Coach.picker.open = false; renderCoach(); }
function coachPickerPos(p) { Coach.picker.pos = p; renderCoach(); }
function coachPickerSearch(q) { Coach.picker.q = q; renderCoachTargetList(); }
function renderCoachTargetList() {
  const el = document.getElementById('coachTargetList');
  if (!el) return;
  const q = Coach.picker.q.trim().toLowerCase(), pos = Coach.picker.pos;
  const hits = coachTargetOptions().filter(o => (pos === 'ALL' || o.pos === pos) && (!q || o.name.toLowerCase().includes(q) || o.team.toLowerCase().includes(q))).slice(0, 40);
  el.innerHTML = hits.length ? hits.map(o => `<button onclick="coachPickTarget('${o.key}')" class="w-full px-3 py-2 flex items-center justify-between gap-3 text-left hover:bg-white/[0.05] ${o.key === Coach.targetKey ? 'bg-white/[0.06]' : ''}">
      <span class="min-w-0 truncate text-[12px] text-zinc-200">${Vault.escapeHtml(o.name)} <span class="text-zinc-500">${o.pos} · ${Vault.escapeHtml(o.team)}</span></span>
      <span class="mono text-[12px] text-zinc-400 shrink-0">${Math.round(o.value).toLocaleString()}</span>
    </button>`).join('') : '<div class="px-3 py-2 text-[12px] text-zinc-400">No players match.</div>';
}
function coachTargetHtml(chip) {
  const cur = coachTargetOptions().find(o => o.key === Coach.targetKey);
  if (!Coach.picker.open && cur) {
    return `<div class="flex items-center gap-2 min-w-0">
        <div class="min-w-0 px-3 py-1.5 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] text-[13px] truncate">${Vault.escapeHtml(cur.name)} <span class="text-zinc-400">${cur.pos} · ${Vault.escapeHtml(cur.team)}</span></div>
        <button onclick="coachOpenPicker()" class="shrink-0 text-[12px] px-2.5 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white">Change</button>
      </div>`;
  }
  return `<div class="w-full sm:w-[440px]">
      <div class="flex gap-2 mb-2">
        <input id="coachTargetSearch" type="text" autocomplete="off" placeholder="Search a player or team…" value="${Vault.escapeHtml(Coach.picker.q)}" oninput="coachPickerSearch(this.value)"
          class="flex-1 min-w-0 bg-black/40 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-amber-400/40" />
        ${cur ? '<button onclick="coachClosePicker()" class="shrink-0 text-[12px] px-2.5 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-white">Cancel</button>' : ''}
      </div>
      <div class="flex gap-1.5 flex-wrap mb-2">${['ALL', 'QB', 'RB', 'WR', 'TE'].map(p => chip(Coach.picker.pos === p, p === 'ALL' ? 'All' : p, `coachPickerPos('${p}')`)).join('')}</div>
      <div id="coachTargetList" class="max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-black/40 divide-y divide-white/5 scrollbar"></div>
    </div>`;
}

/* ---------- Render ---------- */

function renderCoach() {
  const head = document.getElementById('coachHead'), box = document.getElementById('coachBody');
  if (!head || !coachOpen()) return;
  const me = coachMe();
  const chip = (on, label, onclick, extra = '') => `<button onclick="${onclick}" class="text-[12px] px-3 py-1.5 rounded-lg border transition-colors ${on ? 'bg-amber-400/10 border-amber-400/40 text-amber-100' : 'border-white/10 text-zinc-400 hover:text-white hover:border-white/20'}">${label}${extra}</button>`;
  const neg = Coach.option === 'negotiate';
  head.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap mb-4">
      <h2 class="text-[18px] font-semibold text-zinc-100">Trade Coach <span class="text-[13px] font-normal text-zinc-400">for ${Vault.escapeHtml(me.teamName)}</span></h2>
      ${neg ? `<button onclick="coachSetOption('best'); coachGo('type')" class="text-[12px] text-zinc-400 hover:text-white">← Other trade types</button>` : coachStepperHtml()}
    </div>`;
  coachSync();

  const typeChips = `${coachPlanHtml(me, chip)}
    <div class="flex gap-1.5 flex-wrap mb-2">${Object.entries(COACH_OPTIONS).filter(([o]) => o !== 'negotiate').map(([o, d]) => chip(Coach.option === o, d.label, `coachSetOption('${o}')`)).join('')}</div>
    <div class="text-[12px] text-zinc-400 mb-3 max-w-[680px]">${COACH_OPTIONS[Coach.option].blurb}</div>`;
  if (neg) { box.innerHTML = `<div class="text-[12px] text-zinc-400 mb-3 max-w-[680px]">${COACH_OPTIONS.negotiate.blurb}</div>${coachNegotiateHtml()}`; return; }
  if (Coach.step === 'include' || Coach.step === 'exclude' || Coach.step === 'positions') {
    box.innerHTML = coachRulesHtml(me, Coach.step) + coachNavHtml();
    return;
  }
  const needs = Vault.positionalProfile(me, teams).needs;
  const input = {
    target: coachTargetHtml(chip),
    shop: `<select data-search="Type one of your players or picks…" onchange="coachSetShop(this.value)" aria-label="Player or pick to shop" class="w-full sm:w-[380px] bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-amber-400/40">
        <option value="">Pick one of your players or picks…</option>
        ${me.assets.map(a => `<option value="${a.key}" ${a.key === Coach.shopKey ? 'selected' : ''}>${Vault.escapeHtml(a.name)}${a.type === 'player' ? ` (${a.pos})` : ''} · ${Math.round(a.value).toLocaleString()}</option>`).join('')}
      </select>`,
    downtier: `<div class="flex flex-col gap-2">
        <select data-search="Type one of your players…" onchange="coachSetDown(this.value)" aria-label="Player to down-tier" class="w-full sm:w-[380px] bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-amber-400/40">
          <option value="">Pick one of your players…</option>
          ${me.assets.filter(a => a.type === 'player' && a.value >= 1000).map(a => `<option value="${a.key}" ${a.key === Coach.downKey ? 'selected' : ''}>${Vault.escapeHtml(a.name)} (${a.pos}) · ${Math.round(a.value).toLocaleString()}</option>`).join('')}
        </select>
        <div class="flex gap-1.5 flex-wrap">${chip(!Coach.downSame, 'Any position', 'coachSetDownSame(false)')}${chip(Coach.downSame, 'Same position', 'coachSetDownSame(true)')}</div>
      </div>`,
    team: `<select data-search="Type a team…" onchange="coachSetTeam(this.value)" aria-label="Team to trade with" class="w-full sm:w-[380px] bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-amber-400/40">
        <option value="">Pick a team to trade with…</option>
        ${teams.filter(t => t !== me).map(t => `<option value="${t.rosterId}" ${String(t.rosterId) === String(Coach.teamId) ? 'selected' : ''}>${Vault.escapeHtml(t.teamName)}</option>`).join('')}
      </select>`,
    position: `<div class="flex gap-1.5 flex-wrap">${['QB', 'RB', 'WR', 'TE'].map(p => chip(Coach.pos === p, p, `coachSetPos('${p}')`, needs.includes(p.toLowerCase()) ? ' <span class="text-[11px] text-rose-300/80">need</span>' : '')).join('')}</div>`,
    rebuild: '', contend: ''
  }[Coach.option];
  if (Coach.step === 'type') {
    box.innerHTML = typeChips + (input ? `<div class="mt-1">${input}</div>` : '') + coachNavHtml();
    renderCoachTargetList();
    return;
  }
  // Trades: what was chosen (each chip reopens its step), then the list.
  const r = Coach.results[Coach.option], fresh = r && r.key === coachInputKey();
  box.innerHTML = `
    <div class="flex items-start justify-between gap-3 flex-wrap mb-2">
      ${coachSummaryHtml(me)}
      <button onclick="coachFind()" ${Coach.busy ? 'disabled' : ''} class="shrink-0 text-[12px] px-4 py-1.5 rounded-lg btn-gold-solid ${Coach.busy ? 'opacity-60' : ''}">${fresh ? 'Search again' : 'Find trades'}</button>
    </div>
    <div class="text-[12px] text-zinc-500 mb-1 max-w-[680px]">Every trade here is one the other manager would likely take, and Fair for you unless it says otherwise. Predicted from their roster, needs, timeline, and trade history, not the real managers.</div>
    <div id="coachStatus" role="status" class="text-[12px] text-zinc-400 min-h-[18px] ${Coach.busy ? '' : 'hidden'}">Searching…</div>
    ${Coach.busy || !fresh ? '' : coachResultsHtml(r)}`;
}

// One side of an offer: each piece on its own line with its position tag and value.
function coachPieces(list) {
  return list.map(a => `<div class="flex items-center gap-1.5 min-w-0 py-0.5">
      <span class="text-[11px] font-semibold w-9 text-center rounded border shrink-0 ${POS_BADGE(a.type === 'pick' ? '' : a.pos)}">${a.type === 'pick' ? 'Pick' : a.pos}</span>
      <span class="text-[13px] text-zinc-100 truncate min-w-0">${Vault.escapeHtml(a.name)}</span>
      <span class="ml-auto pl-1 text-[12px] mono text-zinc-500 shrink-0">${Math.round(a.value).toLocaleString()}</span>
    </div>`).join('');
}

function coachResultsHtml(r) {
  if (Coach.collapsed && r.list && r.list.length) return `<button onclick="Coach.collapsed = false; renderCoach()" class="mt-2 w-full text-left text-[12px] px-3 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/20">Show options again (${r.list.length}) ▾</button>`;
  if (!r.list || !r.list.length) return `<div class="mt-3 p-3 rounded-xl bg-black/30 text-[12px] text-zinc-300">${r.empty || 'No trades found.'}${coachHasMine() ? ' Your must-include, leave-out, or position choices rule out some trades, so try loosening them (click one above to change it).' : ''}</div>`;
  const over = r.list.some(o => o.edge >= VAULT_CONFIG.FAIR_PCT);
  return `
    <div class="mt-3 mb-2 flex items-baseline justify-between gap-3 flex-wrap">
      <div class="text-[15px] font-medium text-zinc-100">${r.title}</div>
      <div class="text-[12px] text-zinc-500">${r.list.length} option${r.list.length > 1 ? 's' : ''}, best for you first</div>
    </div>
    ${r.planNote ? `<div class="text-[12px] text-zinc-300 mb-2">${r.planNote}</div>` : ''}
    ${over ? '<div class="text-[12px] text-amber-300 mb-2">Some of these pay a premium: nobody would take a Fair offer for them. Those are marked Lopsided. Nothing here is Unfair.</div>' : ''}
    <div class="grid gap-2.5 md:grid-cols-2">${r.list.map((o, i) => {
      const lop = o.edge >= VAULT_CONFIG.FAIR_PCT;
      return `<div class="p-3 rounded-xl border ${lop ? 'border-amber-500/20' : 'border-white/5'} bg-black/30 flex flex-col">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <span class="text-[13px] text-zinc-100 font-medium">With ${Vault.escapeHtml(o.partner.teamName)}</span>
          <span class="text-[11px] px-1.5 py-0.5 rounded border ${lop ? 'border-amber-500/30 text-amber-300 bg-amber-500/10' : 'border-emerald-500/25 text-emerald-300 bg-emerald-500/10'}">${lop ? 'Lopsided for you' : 'Fair'}</span>
        </div>
        <div class="grid grid-cols-2 gap-3 my-1">
          <div class="min-w-0"><div class="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">You give</div>${coachPieces(o.give)}</div>
          <div class="min-w-0"><div class="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">You get</div>${coachPieces(o.get)}</div>
        </div>
        ${o.why ? `<div class="text-[12px] text-zinc-400 mt-1">${o.why}</div>` : ''}
        <div class="text-[12px] text-zinc-400 mt-1">They'd likely accept. ${negLean(-o.edge)}</div>
        <div class="flex flex-wrap gap-2 mt-auto pt-2.5">
          <button onclick="coachLoad(${i})" class="text-[12px] px-3 py-1.5 rounded-lg border border-amber-400/30 text-amber-200 hover:bg-amber-400/10 transition-colors">Open in builder →</button>
        </div>
      </div>`;
    }).join('')}</div>`;
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
