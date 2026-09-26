/* ============================================================
   NEGOTIATION (Trade Coach, Trade Calculator)
   Offer a trade and get the other manager's predicted response: accept,
   decline with reasons, what they'd rather have from your roster, and a
   concrete counter — then counter back as many rounds as you like.

   Everything is judged from the RECEIVING manager's side, from things you can
   check: the overall fairness (KTC value, roster fit, timeline — the same
   Vault.blendedFairness the verdict uses), their positional needs and
   surpluses (Vault.positionalProfile), whether they're rebuilding or
   contending (Vault.teamMode), roster spots, and — once loaded — their real
   trading style from Trade Grades (Vault.managerProfile). No randomness: the
   same offer always gets the same answer.

   Counters lean a little their way (NEG.TARGET_EDGE), the way real counters
   do, but never past Fair for you — the site won't pitch you a counter it
   would itself grade Lopsided.

   Uses the Trade Calculator's own globals: teams, teamOf, selectedA/B,
   render, computeTradeAnalysis, projectedRosterCount, rosterCap, offeredBy,
   capPct, flashButtonMessage.
   ============================================================ */
const NEG = {
  ACCEPT_EDGE: -2,      // they accept from ~2% behind or better...
  TARGET_EDGE: 4,       // ...and their counters aim ~4% in their favor
  STRETCH_ADD_PAIRS: 8  // top wanted pieces tried in pairs when no single add works
};
const Negotiation = { offering: null, rounds: [], styles: null, stylesLoading: null };

// Trading style per roster (Trade Grades history), loaded once in the background.
function negPreloadStyles() {
  if (Negotiation.styles || Negotiation.stylesLoading) return Negotiation.stylesLoading;
  Negotiation.stylesLoading = Vault.fetchAndGradeAllTrades(Vault.getLeagueId()).then(({ teams: gt, allGraded }) => {
    const stats = Vault.buildManagerStats(allGraded, gt);
    const avg = stats.length ? stats.reduce((t, s) => t + s.trades, 0) / stats.length : 0;
    Negotiation.styles = new Map(stats.map(s => [s.rosterId, { ...Vault.managerProfile(s, avg), trades: s.trades }]));
    return Negotiation.styles;
  }).catch(() => { Negotiation.styles = new Map(); return Negotiation.styles; });
  return Negotiation.stylesLoading;
}

function negReset() {
  Negotiation.offering = null;
  Negotiation.rounds = [];
  const box = document.getElementById('negotiation');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
  if (typeof renderCoach === 'function') renderCoach(); // back to the Negotiate prompt in the coach
}

const negOther = s => (s === 'A' ? 'B' : 'A');
const negAssets = (side, keys) => keys.map(k => teamOf(side).assets.find(a => a.key === k)).filter(Boolean);
const negKeys = list => list.map(a => a.key);
const negNames = list => list.map(a => Vault.escapeHtml(a.name)).join(', ') || 'nothing';

// Who's offering: an explicit "who's offering" pick, else your team, else Team A.
function negOfferingSide() {
  if (Negotiation.offering) return Negotiation.offering;
  if (offeredBy) return offeredBy;
  const mine = Vault.myTeam(teams);
  if (mine && String(mine.rosterId) === document.getElementById('teamB').value) return 'B';
  return 'A';
}

// How this manager leans: their real trading style if we have it, else the
// roster's own rebuild/contend read.
function negContext(R) { return negContextFor(teamOf(R)); }
function negContextFor(team) {
  const style = Negotiation.styles?.get(team.rosterId) || null;
  let lean = Vault.teamMode(team);
  if (style && /youth & picks/.test(style.style)) lean = 'rebuild';
  if (style && /win-now/.test(style.style)) lean = 'contend';
  const { needs, surpluses } = Vault.positionalProfile(team, teams);
  // Rarely-trading managers want to come out ahead; active ones will take a bit less.
  let ask = NEG.ACCEPT_EDGE;
  if (style && (!style.trades || /^Occasional|Sits tight/.test(style.style))) ask = 0;
  if (style && /^Active/.test(style.style)) ask = -3;
  return { team, style, lean, needs, surpluses, ask };
}

// How much a manager with this context wants a piece, relative to its KTC value.
function negInterestMult(a, ctx) {
  let m = 1;
  if (a.type === 'pick') m *= ctx.lean === 'rebuild' ? 1.25 : ctx.lean === 'contend' ? 0.8 : 1;
  else {
    const pos = (a.pos || '').toLowerCase();
    if (ctx.needs.includes(pos)) m *= 1.25; else if (ctx.surpluses.includes(pos)) m *= 0.8;
    if (ctx.lean === 'rebuild') m *= a.age && a.age <= 24 ? 1.15 : a.age >= 28 ? 0.75 : 1;
    if (ctx.lean === 'contend') m *= (a.ppg || 0) >= 12 ? 1.15 : (a.ppg || 0) < 6 ? 0.85 : 1;
  }
  return m;
}

// Their concerns and pluses about the specific pieces moving. Each carries a
// weight in "% of value" terms (w), so a concern actually costs willingness —
// the decision and the reasons shown can never disagree.
// out = what the judging manager gives up, inc = what they receive.
function negConcerns(out, inc, ctx, drops) {
  const list = [];
  out.forEach(o => {
    const pos = (o.pos || '').toLowerCase();
    if (o.type === 'pick' && ctx.lean === 'rebuild') list.push({ w: -3, text: `They're rebuilding, so their ${Vault.escapeHtml(o.name)} matters more to them than its trade value.`, say: `I'm rebuilding. My ${Vault.escapeHtml(o.name)} means more to me than its trade value.` });
    else if (o.type === 'player' && ctx.needs.includes(pos)) list.push({ w: -4, text: `${o.pos} is already thin for them — losing ${Vault.escapeHtml(o.name)} opens a hole.`, say: `I'm already thin at ${o.pos}. I can't give up ${Vault.escapeHtml(o.name)}.` });
    else if (o.type === 'player' && ctx.lean === 'contend' && (o.ppg || 0) >= 14) list.push({ w: -3, text: `They're contending and ${Vault.escapeHtml(o.name)} is one of their better scorers.`, say: `I'm trying to win now, and ${Vault.escapeHtml(o.name)} is one of my best scorers.` });
  });
  inc.forEach(i => {
    const pos = (i.pos || '').toLowerCase();
    if (i.type === 'player' && ctx.surpluses.includes(pos)) list.push({ w: -3, text: `They're already deep at ${i.pos}, so ${Vault.escapeHtml(i.name)} doesn't fill a hole.`, say: `I'm already deep at ${i.pos}. I don't need ${Vault.escapeHtml(i.name)}.` });
    else if (i.type === 'player' && ctx.needs.includes(pos)) list.push({ w: 3, text: `${i.pos} is a need for them — ${Vault.escapeHtml(i.name)} helps.`, say: `I could use a ${i.pos} like ${Vault.escapeHtml(i.name)}.` });
    if (i.type === 'player' && ctx.lean === 'rebuild' && i.age >= 28) list.push({ w: -3, text: `At ${i.age.toFixed(0)}, ${Vault.escapeHtml(i.name)} doesn't fit a rebuild.`, say: `I'm rebuilding. ${Vault.escapeHtml(i.name)} at ${i.age.toFixed(0)} doesn't help me.` });
    if (i.type === 'pick' && ctx.lean === 'contend') list.push({ w: -2, text: `${Vault.escapeHtml(i.name)} doesn't help a contender win now.`, say: `${Vault.escapeHtml(i.name)} doesn't help me win this year.` });
  });
  if (drops) list.push({ w: -2 * drops, text: `They'd have to drop ${drops} player${drops === 1 ? '' : 's'} to fit this.`, say: `I'd have to cut ${drops === 1 ? 'someone' : drops + ' players'} to fit this.` });
  return list;
}

// The receiving manager's read of a trade. edge = % they come out ahead on the
// site's overall fairness; will = edge plus their specific concerns/pluses.
function negJudge(aAssets, bAssets, R, ctx) {
  return R === 'B' ? negJudgeFor(teamOf('A'), aAssets, teamOf('B'), bAssets, ctx)
                   : negJudgeFor(teamOf('B'), bAssets, teamOf('A'), aAssets, ctx);
}
// Works for any pair of teams (not just the two loaded) — the coach uses it to
// shop your piece around the league. teamO/oAssets = the offering side.
// Two different numbers on purpose. `edge` is the site's overall grade, the
// one the verdict bar shows and "Fair for you" is judged on. `own` is how the
// receiving manager reads it for themselves: the same value + roster fit +
// timeline blend, but without the display rule that fit can't pull a grade
// toward even (Vault.blendedFairness). A contender giving up a top scorer for a
// pick and prospects sees a worse deal than KTC value alone says, and that's
// what they'd decide on. They also never accept an offer the calculator's own
// read for them (heads.B, the "Decline This" verdict) says to decline, so the
// prediction and the Trade Analysis below can't disagree.
function negJudgeFor(teamO, oAssets, teamR, rAssets, ctx) {
  const { valueA, valueB } = Vault.tradeSideValues(oAssets, rAssets);
  const an = computeTradeAnalysis(teamO, teamR, oAssets, rAssets, valueA, valueB);
  const fair = an.fairness; // positive favors the receiving team (side B here)
  const edge = fair.overallSigned, own = fair.blend;
  const drops = rosterCap ? Math.max(0, projectedRosterCount(teamR, rAssets, oAssets) - rosterCap) : 0;
  const concerns = negConcerns(rAssets, oAssets, ctx, drops);
  const will = own + concerns.reduce((t, c) => t + c.w, 0);
  const siteSaysNo = an.heads.B.tone === 'bad';
  const accepts = will >= ctx.ask && drops <= 1 && !siteSaysNo;
  return { an, edge, own, will, drops, concerns, accepts, siteSaysNo, fair, headO: an.heads.A };
}

// The manager's reply in their own words: what bothers them most, then what
// they'd do instead (their counter), or an opening to ask for something else.
function negReply(j, oGive, rGive, c, ctx) {
  const nm = a => Vault.escapeHtml(a.name);
  const byVal = l => [...l].sort((x, y) => y.value - x.value);
  const [yourMain] = byVal(oGive), [theirMain, ...theirRest] = byVal(rGive);
  const worst = j.concerns.filter(x => x.w < 0 && x.say).sort((x, y) => x.w - y.w)[0];
  const plus = j.concerns.find(x => x.w > 0 && x.say);
  if (j.accepts) return worst ? `Deal. ${worst.say} But the value makes it worth it.` : plus ? `Deal. ${plus.say}` : 'Deal. That works for me.';
  let lead;
  if (theirRest.length && yourMain && theirMain && yourMain.value > theirMain.value) lead = `I don't think the difference between ${nm(yourMain)} and ${nm(theirMain)} is worth ${negNames(theirRest)}.`;
  else if (j.fair.value <= -3) lead = `${negNames(oGive)} for ${negNames(rGive)}? That's not enough for me.`;
  else if (worst) lead = worst.say;
  else if (j.fair.roster <= -5) lead = 'This makes my lineup worse, and the value doesn\'t make up for it.';
  else if (j.fair.timeline <= -5) lead = 'This doesn\'t fit where my team is headed.';
  else if (ctx.ask >= 0) lead = 'I\'d need to come out clearly ahead to make a move.';
  else lead = 'I\'ll pass on this one.';
  let next = 'What else have you got?';
  if (c && c.type === 'add') next = `Add ${negNames(c.pieces)} and we have a deal.`;
  else if (c && c.type === 'keep') next = `I'd do it without ${negNames(c.pieces)}.`;
  else if (c && c.type === 'swap') next = `I'd rather send ${nm(c.sub)} than ${nm(c.pieces[0])}.`;
  return `${lead} ${next}`;
}

// What they like and what gives them pause, plus one line on which side wins,
// so a "yes" never reads as a list of reasons to say no (and vice versa).
function negReasons(j, ctx) {
  const yes = [], no = [];
  const v = j.fair.value, pct = x => capPct(Math.abs(x)).toFixed(0);
  if (v >= 1) yes.push(`On KTC value, they come out about ${pct(v)}% ahead.`);
  else if (v <= -VAULT_CONFIG.LOPSIDED_PCT) no.push(`Not close on KTC value: they'd give up about ${pct(v)}% more than they get back.`);
  else if (v <= -1) no.push(`On KTC value, they'd give up about ${pct(v)}% more than they get back.`);
  else yes.push('It\'s about even on KTC value.');
  const r = j.fair.roster, tl = j.fair.timeline, when = { contend: 'win-now', rebuild: 'rebuild' }[ctx.lean];
  if (r >= 5) yes.push('It makes their starting lineup better.');
  else if (r <= -5) no.push('It makes their starting lineup worse.');
  if (tl >= 5) yes.push(`It fits their${when ? ' ' + when : ''} timeline.`);
  else if (tl <= -5) no.push(`It works against their${when ? ' ' + when : ''} timeline.`);
  [...j.concerns].sort((x, y) => Math.abs(y.w) - Math.abs(x.w)).forEach(c => (c.w > 0 ? yes : no).push(c.text));
  let summary;
  if (j.accepts) summary = no.length ? 'What they gain outweighs what gives them pause.' : 'Nothing here gives them pause.';
  else if (j.drops > 1) summary = `They'd have to cut ${j.drops} players to make room, so they'd pass.`;
  else if (j.siteSaysNo && j.will >= ctx.ask) summary = 'Graded from their side, this is a Decline (see Trade Analysis), so they\'d pass.';
  else if (ctx.ask >= 0 && j.will < ctx.ask && j.will > -4) summary = 'They rarely trade, so they want to come out clearly ahead.';
  else summary = 'What gives them pause outweighs what they gain.';
  const style = ctx.style && ctx.style.trades ? `Their trade history: ${Vault.escapeHtml(ctx.style.style.toLowerCase())}.` : '';
  return { yes: [...new Set(yes)].slice(0, 4), no: [...new Set(no)].slice(0, 4), summary, style };
}

// Pieces on your roster they'd most want, for "what they'd rather have".
function negInterests(O, ctx, inTrade) {
  return teamOf(O).assets.filter(a => !inTrade.has(a.key) && a.value >= 1500)
    .map(a => ({ a, w: a.value * negInterestMult(a, ctx) }))
    .sort((x, y) => y.w - x.w).slice(0, 4).map(x => x.a);
}

// The counter they'd make: the most realistic change they'd accept that still
// reads Fair for you. Tries (1) you adding a piece they want, (2) them keeping
// one of theirs, (3) them sending a lesser piece instead — scored by how close
// it lands to TARGET_EDGE and how much they care about the piece involved.
function negCounter(aAssets, bAssets, O, R, ctx) {
  const inTrade = new Set(negKeys([...aAssets, ...bAssets]));
  const build = (oList, rList) => (O === 'A' ? { A: oList, B: rList } : { A: rList, B: oList });
  const [oGive, rGive] = O === 'A' ? [aAssets, bAssets] : [bAssets, aAssets];
  const ownMult = a => negInterestMult(a, ctx); // how much they value their own pieces
  const cands = [];
  const wanted = teamOf(O).assets.filter(a => !inTrade.has(a.key) && a.value >= 300)
    .map(a => ({ a, m: negInterestMult(a, ctx) })).sort((x, y) => y.a.value * y.m - x.a.value * x.m).slice(0, 30);
  wanted.forEach(({ a, m }) => cands.push({ type: 'add', pieces: [a], bonus: 4 * (m - 1), ...build([...oGive, a], rGive) }));
  const top = wanted.slice(0, NEG.STRETCH_ADD_PAIRS);
  for (let i = 0; i < top.length; i++) for (let k = i + 1; k < top.length; k++)
    cands.push({ type: 'add', pieces: [top[i].a, top[k].a], bonus: 2 * (top[i].m + top[k].m - 2) - 3, ...build([...oGive, top[i].a, top[k].a], rGive) });
  if (rGive.length >= 2) rGive.forEach(r => cands.push({ type: 'keep', pieces: [r], bonus: 4 * (ownMult(r) - 1) + 1, ...build(oGive, rGive.filter(x => x !== r)) }));
  rGive.forEach(r => teamOf(R).assets.filter(s => !inTrade.has(s.key) && s.value < r.value && s.value >= r.value * 0.4)
    .sort((x, y) => ownMult(x) - ownMult(y)).slice(0, 6)
    .forEach(s => cands.push({ type: 'swap', pieces: [r], sub: s, bonus: 4 * (ownMult(r) - ownMult(s)), ...build(oGive, rGive.map(x => (x === r ? s : x))) })));

  let best = null;
  cands.forEach(c => {
    const j = negJudge(c.A, c.B, R, ctx);
    // They'd take it, and it's still Fair for you on the site's own grade.
    if (!j.accepts || j.edge >= VAULT_CONFIG.FAIR_PCT) return;
    const score = Math.abs(j.will - NEG.TARGET_EDGE) - c.bonus + 2 * j.drops;
    if (!best || score < best.score) best = { ...c, score, edge: j.edge };
  });
  return best;
}

function negCounterText(c, R, ctx) {
  const why = a => {
    const pos = (a.pos || '').toLowerCase();
    if (a.type === 'pick') return ctx.lean === 'rebuild' ? ' — they want picks while they rebuild' : '';
    if (ctx.needs.includes(pos)) return ` — ${a.pos} is a need for them`;
    if (ctx.lean === 'rebuild' && a.age && a.age <= 24) return ' — young, which fits their rebuild';
    if (ctx.lean === 'contend' && (a.ppg || 0) >= 12) return ' — production they can use now';
    return '';
  };
  if (c.type === 'add') return `They'd do it if you add ${negNames(c.pieces)}${c.pieces.length === 1 ? why(c.pieces[0]) : ''}.`;
  if (c.type === 'keep') return `They'd do it if they keep ${negNames(c.pieces)}${c.pieces[0].type === 'pick' && ctx.lean === 'rebuild' ? ' — they want their picks while they rebuild' : ''}.`;
  return `They'd rather send ${Vault.escapeHtml(c.sub.name)} than ${Vault.escapeHtml(c.pieces[0].name)}.`;
}

/* ---------- Coach: your best next move after each response ----------
   Weighs, from YOUR side: accepting their counter, countering back with the
   offer closest to even they'd still take, shopping the same piece(s) to the
   team that would give the most, or walking away — and highlights the one
   that leaves you best off (certainty breaks near-ties). "You come out X%"
   below is always your side of the site's overall grade. */
const sumValue = list => list.reduce((t, a) => t + a.value, 0);

// Closest-to-even version of `base` they'd still accept: ask for one more of
// their least-wanted pieces, pull one of yours back out, or swap one of
// yours for a cheaper piece they still want. One change per round.
function negCounterBack(baseA, baseB, O, R, ctx) {
  const [oGive, rGive] = O === 'A' ? [baseA, baseB] : [baseB, baseA];
  const build = (oList, rList) => (O === 'A' ? { A: oList, B: rList } : { A: rList, B: oList });
  const baseEdge = negJudge(baseA, baseB, R, ctx).edge;
  const inTrade = new Set(negKeys([...baseA, ...baseB]));
  const cands = [];
  const rVal = sumValue(rGive);
  teamOf(R).assets.filter(a => !inTrade.has(a.key) && a.value >= rVal * 0.05 && a.value <= rVal)
    .sort((x, y) => negInterestMult(x, ctx) - negInterestMult(y, ctx)).slice(0, 25)
    .forEach(a => cands.push({ text: `Ask for their ${Vault.escapeHtml(a.name)} too.`, ...build(oGive, [...rGive, a]) }));
  // Any piece you give can come back out or be swapped for a cheaper one they still like.
  oGive.forEach(a => {
    if (oGive.length > 1) cands.push({ text: `Keep your ${Vault.escapeHtml(a.name)}.`, ...build(oGive.filter(x => x !== a), rGive) });
    teamOf(O).assets.filter(s => !inTrade.has(s.key) && s.value < a.value && s.value >= a.value * 0.4)
      .sort((x, y) => negInterestMult(y, ctx) * y.value - negInterestMult(x, ctx) * x.value).slice(0, 6)
      .forEach(s => cands.push({ text: `Offer your ${Vault.escapeHtml(s.name)} instead of ${Vault.escapeHtml(a.name)}.`, ...build(oGive.map(x => (x === a ? s : x)), rGive) }));
  });
  let best = null;
  cands.forEach(c => {
    const j = negJudge(c.A, c.B, R, ctx);
    if (!j.accepts || j.edge >= baseEdge - 1) return; // must still work for them AND be better for you
    if (!best || j.edge < best.edge) best = { ...c, edge: j.edge };
  });
  return best;
}

// The same piece(s) you're offering, shopped to every other team: their best
// single or pair they'd accept for it (and that's still Fair for them).
// Returns the one that leaves you best off.
function negShop(O, R, coreAssets) {
  const oTeam = teamOf(O), rTeam = teamOf(R);
  const core = sumValue(coreAssets);
  let best = null;
  teams.filter(t => t !== oTeam && t !== rTeam).forEach(t => {
    const ctxT = negContextFor(t);
    // Their singles and pairs worth roughly what you're shopping; keep the
    // package that's best for you among the ones they'd actually accept.
    const pool = t.assets.filter(a => a.value >= core * 0.1 && a.value <= core * 1.3).sort((x, y) => y.value - x.value).slice(0, 12);
    const packs = pool.map(a => [a]);
    pool.forEach((a, i) => pool.slice(i + 1).forEach(b => { const s = a.value + b.value; if (s >= core * 0.6 && s <= core * 1.4) packs.push([a, b]); }));
    packs.forEach(pack => {
      const j = negJudgeFor(oTeam, coreAssets, t, pack, ctxT);
      if (!j.accepts || j.edge >= VAULT_CONFIG.FAIR_PCT) return;
      if (!best || j.edge < best.edge) {
        const plus = j.concerns.filter(c => c.w > 0).map(c => c.text)[0] || '';
        best = { team: t, oKeys: negKeys(coreAssets), tKeys: negKeys(pack), edge: j.edge, why: plus };
      }
    });
  });
  return best;
}

function negCoach(aAssets, bAssets, O, R, ctx, j, counter, originalOKeys) {
  const you = e => -e; // their edge -> your edge
  const opts = {};
  const oGive = O === 'A' ? aAssets : bAssets;
  const core = negAssets(O, originalOKeys).length ? negAssets(O, originalOKeys) : oGive;
  if (j.accepts) opts.send = { you: you(j.edge) };
  if (counter) {
    const cj = negJudge(counter.A, counter.B, R, ctx);
    opts.accept = { you: you(counter.edge), tone: cj.headO.tone };
  }
  const base = counter ? [counter.A, counter.B] : j.accepts ? [aAssets, bAssets] : null;
  if (base) { const cb = negCounterBack(base[0], base[1], O, R, ctx); if (cb) opts.cb = { you: you(cb.edge), A: negKeys(cb.A), B: negKeys(cb.B), text: cb.text }; }
  // Shopping means selling your pieces elsewhere: only when you offered a player.
  const shop = core.some(a => a.type === 'player') ? negShop(O, R, core) : null;
  if (shop) opts.shop = { you: you(shop.edge), team: shop.team.rosterId, name: shop.team.teamName, oKeys: shop.oKeys, tKeys: shop.tKeys, why: shop.why };

  // Pick the recommendation: the option that leaves you best off. Sending an
  // offer they already accept (or taking their counter) wins near-ties over
  // counter-backs and shopping, since those aren't guaranteed.
  const score = { send: opts.send ? opts.send.you + 2 : -Infinity, accept: opts.accept && opts.accept.tone !== 'bad' ? opts.accept.you + 2 : -Infinity, cb: opts.cb ? opts.cb.you : -Infinity, shop: opts.shop ? opts.shop.you - 1 : -Infinity };
  // Never recommend sending an offer that's Lopsided against you.
  if (opts.send && opts.send.you <= -VAULT_CONFIG.FAIR_PCT) score.send = -Infinity;
  let primary = Object.entries(score).sort((x, y) => y[1] - x[1])[0];
  primary = primary[1] === -Infinity ? 'walk' : primary[0];
  return { primary, ...opts };
}

// Send the calculator's current trade as the next offer.
async function negOffer(btn) {
  const aAssets = negAssets('A', [...selectedA]), bAssets = negAssets('B', [...selectedB]);
  if (!aAssets.length || !bAssets.length) return flashButtonMessage(btn, 'Add pieces to both sides first');
  const O = negOfferingSide(), R = negOther(O);
  Negotiation.offering = O;
  if (offeredBy !== O) { offeredBy = O; render('A'); render('B'); }
  const box = document.getElementById('negotiation');
  if (typeof renderCoach === 'function') openCoach('negotiate'); // negotiations live in the Trade Coach panel
  box.classList.remove('hidden');
  // Wait (briefly) for trading styles so the same offer always reads the same way.
  if (!Negotiation.styles) {
    box.insertAdjacentHTML('beforeend', '<div id="negThinking" class="text-[12px] text-zinc-400 py-2">Reading their roster and trade history…</div>');
    await Promise.race([negPreloadStyles(), new Promise(r => setTimeout(r, 8000))]);
    document.getElementById('negThinking')?.remove();
  }
  const ctx = negContext(R);
  const j = negJudge(aAssets, bAssets, R, ctx);
  const round = { offer: { A: negKeys(aAssets), B: negKeys(bAssets) }, O, R, edge: j.edge, reasons: negReasons(j, ctx) };
  let c = null;
  if (j.accepts) { round.decision = 'accept'; round.reply = negReply(j, O === 'A' ? aAssets : bAssets, O === 'A' ? bAssets : aAssets, null, ctx); }
  else {
    c = negCounter(aAssets, bAssets, O, R, ctx);
    const inTrade = new Set(negKeys([...aAssets, ...bAssets]));
    round.interests = negKeys(negInterests(O, ctx, inTrade));
    round.reply = negReply(j, O === 'A' ? aAssets : bAssets, O === 'A' ? bAssets : aAssets, c, ctx);
    if (c) { round.decision = 'counter'; round.counter = { A: negKeys(c.A), B: negKeys(c.B), text: negCounterText(c, R, ctx), edge: c.edge }; }
    else round.decision = 'decline';
  }
  // What you offered in round 1 is "your core" — the coach never trims it.
  const firstOffer = Negotiation.rounds.find(r => r.offer && r.O === O);
  const originalOKeys = firstOffer ? firstOffer.offer[O] : round.offer[O];
  round.coach = negCoach(aAssets, bAssets, O, R, ctx, j, c, originalOKeys);
  Negotiation.rounds.push(round);
  negRender();
}

// Coach actions.
function negSendCounterBack(i) {
  const cb = Negotiation.rounds[i]?.coach?.cb;
  if (!cb) return;
  negLoad(cb.A, cb.B);
  negOffer(document.querySelector('#offerBtn button'));
}

function negShopTo(i) {
  const r = Negotiation.rounds[i], s = r?.coach?.shop;
  if (!s) return;
  const sel = document.getElementById('team' + r.R);
  sel.value = String(s.team);
  sel.onchange(); // switches the partner (and resets this negotiation)
  const O = r.O;
  negLoad(O === 'A' ? s.oKeys : s.tKeys, O === 'A' ? s.tKeys : s.oKeys);
  Negotiation.offering = O;
  negOffer(document.querySelector('#offerBtn button'));
}

function negWalk(i) {
  const r = Negotiation.rounds[i];
  Negotiation.rounds.push({ decision: 'walk', O: r.O, R: r.R });
  negRender();
  renderOfferButton();
}

function negLoad(keysA, keysB) {
  selectedA.clear(); selectedB.clear();
  keysA.forEach(k => selectedA.add(k)); keysB.forEach(k => selectedB.add(k));
  render('A'); render('B');
}

// Ask for something else back for the same offer: more value, a position,
// youth, points now, picks, or players from one NFL team. Their pieces that
// fit, alone or with one smaller piece (picks: up to four picks), that they'd
// accept and that are Fair for you, best for you first (most points for
// "points now"). If nothing Fair works, the one closest deal they'd take,
// labeled as such, so you see what it would really cost.
const NEG_ASKS = [['value', 'More value'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE'], ['youth', 'Youth'], ['ppg', 'Points now'], ['picks', 'Picks']];
function negAsk(i, pref, arg) {
  const r = Negotiation.rounds[i];
  if (!r || (pref === 'nfl' && !arg)) return;
  const O = r.O, R = r.R, ctx = negContext(R);
  const oGive = negAssets(O, r.offer[O]), give = sumValue(oGive);
  const fits = {
    value: () => true,
    youth: a => a.type === 'player' && a.age && a.age <= 24,
    ppg: a => a.type === 'player' && (a.ppg || 0) >= 10,
    picks: a => a.type === 'pick',
    nfl: a => a.type === 'player' && a.nfl === arg
  }[pref] || (a => a.type === 'player' && a.pos === pref);
  // Respect the coach's Their side rules (pieces or groups you don't want back).
  const theirs = teamOf(R).assets.filter(x => typeof coachTheirOff !== 'function' || !coachTheirOff(x));
  const mains = theirs.filter(a => fits(a) && a.value >= give * 0.2 && a.value <= give * 1.3).sort((x, y) => y.value - x.value).slice(0, 12);
  const fillers = theirs.filter(a => a.value >= give * 0.05 && a.value <= give * 0.6).sort((x, y) => y.value - x.value).slice(0, 12);
  const packs = [];
  if (pref === 'picks') {
    const pk = theirs.filter(a => a.type === 'pick').sort((x, y) => y.value - x.value).slice(0, 8);
    const grow = (from, pack, sum) => {
      if (pack.length && sum >= give * 0.6 && sum <= give * 2.2) packs.push(pack);
      if (pack.length < 4) for (let k = from; k < pk.length; k++) grow(k + 1, [...pack, pk[k]], sum + pk[k].value);
    };
    grow(0, [], 0);
  } else mains.forEach(m => {
    packs.push([m]);
    fillers.forEach(f => { if (f !== m && f.value <= m.value) { const s = m.value + f.value; if (s >= give * 0.6 && s <= give * 1.5) packs.push([m, f]); } });
  });
  const build = pack => (O === 'A' ? [oGive, pack] : [pack, oGive]);
  const ppg = p => p.reduce((t, a) => t + (a.ppg || 0), 0);
  const seen = new Set();
  const ok = packs.map(pack => ({ pack, j: negJudge(...build(pack), R, ctx) })).filter(x => x.j.accepts && x.j.edge < VAULT_CONFIG.LOPSIDED_PCT);
  const fair = ok.filter(x => x.j.edge < VAULT_CONFIG.FAIR_PCT)
    .sort((x, y) => (pref === 'ppg' ? ppg(y.pack) - ppg(x.pack) : 0) || x.j.edge - y.j.edge)
    .filter(x => pref === 'picks' || (!seen.has(x.pack[0].key) && seen.add(x.pack[0].key)));
  const closest = fair.length ? [] : ok.sort((x, y) => x.j.edge - y.j.edge).slice(0, 1);
  const list = (fair.length ? fair : closest).slice(0, 3).map(x => ({ keys: negKeys(x.pack), edge: x.j.edge }));
  const label = pref === 'nfl' ? `${arg} players` : (NEG_ASKS.find(a => a[0] === pref) || [])[1];
  r.ask = { pref, arg, label, list, closest: !fair.length && list.length > 0 };
  negRender();
}
function negAskOffer(i, k) {
  const r = Negotiation.rounds[i], pick = r?.ask?.list[k];
  if (!pick) return;
  const O = r.O;
  negLoad(O === 'A' ? r.offer.A : pick.keys, O === 'A' ? pick.keys : r.offer.B);
  negOffer(document.querySelector('#offerBtn button'));
}
function negAskHtml(r, i) {
  const theirs = teamOf(r.R).assets;
  const nfl = [...new Set(theirs.filter(a => a.type === 'player' && a.nfl && a.value >= 500).map(a => a.nfl))].sort();
  const on = p => r.ask && r.ask.pref === p;
  const chip = (p, label) => `<button onclick="negAsk(${i}, '${p}')" class="text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${on(p) ? 'bg-violet-500/15 border-violet-500/40 text-violet-200' : 'border-white/10 text-zinc-400 hover:text-white hover:border-white/20'}">${label}</button>`;
  const res = r.ask ? (r.ask.list.length ? `${r.ask.closest ? `<div class="text-[12px] text-amber-300 mt-2">Nothing Fair works with ${Vault.escapeHtml(r.ask.label)}. The closest they'd take:</div>` : ''}<div class="grid gap-2 sm:grid-cols-3 mt-2">${r.ask.list.map((o, k) => {
      const lop = o.edge >= VAULT_CONFIG.FAIR_PCT;
      return `<div class="p-2.5 rounded-lg border ${lop ? 'border-amber-500/20' : 'border-white/10'} bg-black/30 flex flex-col">
        <div class="text-[12px] text-zinc-300">They'd send <span class="text-zinc-100 font-medium">${negNames(negAssets(r.R, o.keys))}</span></div>
        <div class="text-[11px] mt-1 ${lop ? 'text-amber-300' : 'text-zinc-400'}">${negLean(-o.edge)}</div>
        <button onclick="negAskOffer(${i}, ${k})" class="mt-2 self-start text-[11px] px-3 py-1.5 rounded-lg btn-gold-solid">Offer this</button>
      </div>`;
    }).join('')}</div>` : `<div class="text-[12px] text-zinc-400 mt-2">They wouldn't do any ${Vault.escapeHtml(r.ask.label)} deal for what you're offering, even a lopsided one.</div>`) : '';
  return `<div class="mt-3 pt-3 border-t border-white/5">
      <div class="text-[11px] text-zinc-400 mb-1.5">Ask for something else for ${negNames(negAssets(r.O, r.offer[r.O]))}:</div>
      <div class="flex flex-wrap gap-1.5 items-center">${NEG_ASKS.map(([p, l]) => chip(p, l)).join('')}
        ${nfl.length ? `<select onchange="negAsk(${i}, 'nfl', this.value)" class="text-[11px] px-2 py-1 rounded-lg border ${on('nfl') ? 'border-violet-500/40 text-violet-200 bg-violet-500/15' : 'border-white/10 text-zinc-400 bg-black/40'}">
          <option value="">From an NFL team…</option>${nfl.map(n => `<option value="${n}" ${on('nfl') && r.ask.arg === n ? 'selected' : ''}>${n}</option>`).join('')}</select>` : ''}
      </div>
      ${res}
    </div>`;
}

function negAcceptCounter(i) {
  const c = Negotiation.rounds[i]?.counter;
  if (!c) return;
  negLoad(c.A, c.B);
  Negotiation.rounds.push({ decision: 'deal', offer: { A: c.A, B: c.B }, O: Negotiation.rounds[i].O, R: Negotiation.rounds[i].R });
  negRender();
  renderOfferButton();
}

function negEditCounter(i) {
  const c = Negotiation.rounds[i]?.counter;
  if (!c) return;
  negLoad(c.A, c.B);
  document.getElementById('tradeBar').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Tapping a piece they want adds it to your side of the calculator.
function negAddInterest(key) {
  const O = Negotiation.offering || negOfferingSide();
  (O === 'A' ? selectedA : selectedB).add(key);
  render(O);
}

const NEG_PILL = {
  accept: ['Would accept', 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'],
  counter: ['Counters', 'bg-amber-500/10 text-amber-300 border-amber-500/25'],
  decline: ['Declines', 'bg-rose-500/10 text-rose-300 border-rose-500/25'],
  deal: ['Deal reached', 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'],
  walk: ['Walked away', 'bg-white/5 text-zinc-400 border-white/10']
};

// How a deal lands for you, as a sentence: "You'd come out about 4% ahead."
function negLean(you) {
  if (Math.abs(you) < 1) return 'About even on value for you.';
  const p = capPct(Math.abs(you)).toFixed(0);
  return you > 0 ? `You'd come out about ${p}% ahead on value.` : `You'd give up about ${p}% more value than you get${you > -VAULT_CONFIG.FAIR_PCT ? ' — still Fair' : ''}.`;
}

// The coach's box under the latest round: the recommended move first, the
// other workable moves after it, each one click.
function negReasonsHtml(r) {
  const R = r.reasons;
  const list = (title, items, dot) => items.length ? `<div class="mb-1.5"><div class="text-[11px] text-zinc-500 mb-0.5">${title}</div><ul class="space-y-0.5">${items.map(t => `<li class="text-[12px] text-zinc-300 flex gap-2"><span class="${dot} mt-[7px] size-1.5 shrink-0 rounded-full"></span><span>${t}</span></li>`).join('')}</ul></div>` : '';
  const yes = list('What they like', R.yes, 'bg-emerald-400/80'), no = list('What gives them pause', R.no, 'bg-rose-400/80');
  return `<div class="mb-2">${r.decision === 'accept' ? yes + no : no + yes}
      <div class="text-[12px] text-zinc-200">${R.summary}</div>
      ${R.style ? `<div class="text-[11px] text-zinc-500 mt-0.5">${R.style}</div>` : ''}
    </div>`;
}

function negCoachHtml(r, i) {
  const c = r.coach;
  if (!c) return '';
  const btn = (label, onclick, primary) => `<button onclick="${onclick}" class="shrink-0 text-[11px] px-3 py-1.5 rounded-lg ${primary ? 'btn-gold-solid' : 'border border-white/10 text-zinc-300 hover:text-white'}">${label}</button>`;
  const items = {
    send: c.send && { title: 'Send this offer as is', detail: `They'd take it. ${negLean(c.send.you)}`, action: primary => btn('Copy trade link', 'shareTrade(this)', primary) },
    accept: c.accept && { title: 'Accept their counter', detail: `${negLean(c.accept.you)}${c.accept.tone === 'bad' ? ' It grades as a poor deal for your team, though.' : ''}`, action: primary => btn('Accept their counter', `negAcceptCounter(${i})`, primary) },
    cb: c.cb && { title: c.cb.text, detail: `They'd likely still take it. ${negLean(c.cb.you)}`, action: primary => btn('Send this counter', `negSendCounterBack(${i})`, primary) },
    shop: c.shop && { title: `Shop it to ${Vault.escapeHtml(c.shop.name)} instead`, detail: `${c.shop.why ? c.shop.why + ' ' : ''}They'd give ${negNames(c.shop.tKeys.map(k => teams.find(t => t.rosterId === c.shop.team)?.assets.find(a => a.key === k)).filter(Boolean))}. ${negLean(c.shop.you)}`, action: primary => btn(`Open with ${Vault.escapeHtml(c.shop.name)}`, `negShopTo(${i})`, primary) },
    walk: { title: 'Walk away', detail: 'Keep what you have and try someone else later.', action: primary => btn('Walk away', `negWalk(${i})`, primary) }
  };
  if (c.primary === 'walk') items.walk.detail = 'Nothing that works for them is fair for you right now — keep what you have.';
  const order = [c.primary, ...['send', 'accept', 'cb', 'shop', 'walk'].filter(k => k !== c.primary)].filter(k => items[k]);
  const row = (k, primary) => `<div class="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${primary ? '' : 'py-1.5 border-t border-white/5'}">
      <div class="min-w-0"><div class="text-[12px] ${primary ? 'text-zinc-100 font-medium' : 'text-zinc-300'}">${items[k].title}</div><div class="text-[11px] text-zinc-400">${items[k].detail}</div></div>
      ${items[k].action(primary)}</div>`;
  return `<div class="mt-3 p-3 rounded-lg border border-sky-500/25 bg-sky-500/[0.05]">
      <div class="text-[11px] uppercase tracking-wider text-sky-300/80 mb-1.5">Recommended next step</div>
      ${row(order[0], true)}
      ${order.length > 1 ? `<div class="text-[11px] text-zinc-500 mt-3 mb-0.5">Other options</div>${order.slice(1).map(k => row(k, false)).join('')}` : ''}
    </div>`;
}

function negTradeLine(tr, O) {
  const R = negOther(O);
  const give = negAssets(O, tr[O]), get = negAssets(R, tr[R]);
  return `<span class="text-zinc-400">You give</span> <span class="text-zinc-200">${negNames(give)}</span> <span class="text-zinc-400">· you get</span> <span class="text-zinc-200">${negNames(get)}</span>`;
}

function negRender() {
  const box = document.getElementById('negotiation');
  if (!Negotiation.rounds.length) { box.classList.add('hidden'); return; }
  const first = Negotiation.rounds[0];
  const rTeam = teamOf(first.R);
  const ctx = negContext(first.R);
  const who = Vault.escapeHtml(rTeam.teamName);
  box.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap mb-1">
      <div class="text-[11px] text-zinc-400 uppercase tracking-wider">Negotiating with ${who} <span class="normal-case tracking-normal text-zinc-500">· ${Vault.MODE_LABEL[Vault.teamMode(rTeam)]}${ctx.style && ctx.style.trades ? ` · ${Vault.escapeHtml(ctx.style.style)}` : ''}</span></div>
      <button onclick="negReset()" class="text-[11px] px-2.5 py-1 rounded-lg border border-white/10 text-zinc-400 hover:text-white">Start over</button>
    </div>
    <p class="text-[11px] text-zinc-500 mb-3">Send the real offer in Sleeper.</p>
    <div class="space-y-3">${Negotiation.rounds.map((r, i) => {
      const [label, cls] = NEG_PILL[r.decision];
      if (r.decision === 'deal') return `<div class="p-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20">
          <div class="flex items-center gap-2 mb-1"><span class="text-[11px] px-2 py-0.5 rounded-md border ${cls}">${label}</span><span class="text-[12px] text-zinc-300">You accepted their counter.</span></div>
          <div class="text-[12px]">${negTradeLine(r.offer, r.O)}</div>
          <div class="text-[11px] text-zinc-400 mt-1.5">It's loaded in the calculator above — use Share to send yourself the link, then make the offer in Sleeper.</div></div>`;
      if (r.decision === 'walk') return `<div class="p-3 rounded-xl bg-black/30"><div class="flex items-center gap-2"><span class="text-[11px] px-2 py-0.5 rounded-md border ${cls}">${label}</span><span class="text-[12px] text-zinc-400">No deal with ${who}. Try Suggest a Trade for other partners, or Start over.</span></div></div>`;
      const last = i === Negotiation.rounds.length - 1;
      return `<div class="p-3 rounded-xl bg-black/30">
        <div class="text-[11px] text-zinc-500 mb-1">Round ${i + 1} · your offer</div>
        <div class="text-[12px] mb-2">${negTradeLine(r.offer, r.O)}</div>
        <div class="flex items-center gap-2 mb-1.5"><span class="text-[11px] px-2 py-0.5 rounded-md border ${cls}">${label}</span><span class="text-[12px] text-zinc-400">${who}</span></div>
        ${r.reply ? `<div class="mb-2.5 px-3 py-2 rounded-lg rounded-tl-sm bg-white/[0.04] border border-white/10 text-[13px] text-zinc-100">"${r.reply}"</div>` : ''}
        ${negReasonsHtml(r)}
        ${r.decision === 'accept' && r.edge >= VAULT_CONFIG.FAIR_PCT ? `<div class="text-[12px] text-amber-300 mb-1.5">Heads up: they'd accept because it now leans ${capPct(r.edge).toFixed(0)}% their way — ${r.edge >= VAULT_CONFIG.LOPSIDED_PCT ? 'Unfair' : 'Lopsided'} for you.${negAssets(r.O, r.offer[r.O]).length < negAssets(r.R, r.offer[r.R]).length ? ' On KTC\'s math, extra smaller pieces on your side count for less than the premium on the best player in the deal, so asking for a throw-in can make it worse for you.' : ''}</div>` : ''}
        ${r.decision === 'accept' ? `<div class="text-[11px] text-zinc-400">They'd take this as offered — make the offer in Sleeper.</div>` : ''}
        ${r.interests?.length ? `<div class="text-[11px] text-zinc-400 mb-1.5">On your roster, they'd be more interested in:</div>
          <div class="flex flex-wrap gap-1.5 mb-2">${negAssets(r.O, r.interests).map(a => `<button onclick="negAddInterest('${a.key}')" title="Add to your side" class="text-[11px] px-2 py-1 rounded-md border border-white/10 text-zinc-300 hover:text-white hover:border-amber-500/40">+ ${Vault.escapeHtml(a.name)} <span class="mono text-zinc-500">${Math.round(a.value).toLocaleString()}</span></button>`).join('')}</div>` : ''}
        ${r.counter ? `<div class="mt-2 p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.04]">
            <div class="text-[12px] text-amber-200 mb-1">${r.counter.text}</div>
            <div class="text-[12px] mb-1">${negTradeLine(r.counter, r.O)}</div>
            <div class="text-[11px] text-zinc-400 mb-2">Leans ${capPct(Math.abs(r.counter.edge)).toFixed(0)}% ${r.counter.edge >= 0 ? 'their way' : 'your way'} — still Fair for you.</div>
            ${last ? `<div class="flex flex-wrap gap-2">${r.coach ? '' : `<button onclick="negAcceptCounter(${i})" class="text-[11px] px-3 py-1.5 rounded-lg btn-gold-solid">Accept their counter</button>`}<button onclick="negEditCounter(${i})" class="text-[11px] px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white">Edit it and counter back</button></div>` : ''}
          </div>` : ''}
        ${last ? negAskHtml(r, i) : ''}
        ${last ? negCoachHtml(r, i) : ''}
      </div>`;
    }).join('')}</div>`;
  if (typeof renderCoach === 'function') renderCoach(); else box.classList.remove('hidden');
  renderOfferButton();
}

// The Offer button in the trade bar.
function renderOfferButton() {
  const el = document.getElementById('offerBtn');
  if (!el) return;
  const bothSides = selectedA.size && selectedB.size;
  if (!bothSides) { el.innerHTML = ''; return; }
  const O = negOfferingSide(), R = negOther(O);
  const done = Negotiation.rounds.length && ['deal', 'walk'].includes(Negotiation.rounds[Negotiation.rounds.length - 1].decision);
  const label = done ? 'Negotiate again' : Negotiation.rounds.length ? 'Send revised offer' : `Offer to ${Vault.escapeHtml(teamOf(R).teamName)}`;
  el.innerHTML = `<button onclick="${done ? 'negReset(); negOffer(this)' : 'negOffer(this)'}" title="See how ${Vault.escapeHtml(teamOf(R).teamName)} would likely respond — accept, decline, or counter" class="shrink-0 text-[11px] px-3 py-1.5 rounded-lg border border-amber-500/30 text-amber-200 hover:bg-amber-500/10 transition-colors">${label}</button>`;
}
