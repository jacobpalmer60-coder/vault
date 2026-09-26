/* ============================================================
   NEGOTIATION (Trade Calculator)
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
function negContext(R) {
  const team = teamOf(R);
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
function negConcerns(aAssets, bAssets, R, ctx, drops) {
  const [out, inc] = R === 'A' ? [aAssets, bAssets] : [bAssets, aAssets];
  const list = [];
  out.forEach(o => {
    const pos = (o.pos || '').toLowerCase();
    if (o.type === 'pick' && ctx.lean === 'rebuild') list.push({ w: -3, text: `They're rebuilding, so their ${Vault.escapeHtml(o.name)} matters more to them than its trade value.` });
    else if (o.type === 'player' && ctx.needs.includes(pos)) list.push({ w: -4, text: `${o.pos} is already thin for them — losing ${Vault.escapeHtml(o.name)} opens a hole.` });
    else if (o.type === 'player' && ctx.lean === 'contend' && (o.ppg || 0) >= 14) list.push({ w: -3, text: `They're contending and ${Vault.escapeHtml(o.name)} is one of their better scorers.` });
  });
  inc.forEach(i => {
    const pos = (i.pos || '').toLowerCase();
    if (i.type === 'player' && ctx.surpluses.includes(pos)) list.push({ w: -3, text: `They're already deep at ${i.pos}, so ${Vault.escapeHtml(i.name)} doesn't fill a hole.` });
    else if (i.type === 'player' && ctx.needs.includes(pos)) list.push({ w: 3, text: `${i.pos} is a need for them — ${Vault.escapeHtml(i.name)} helps.` });
    if (i.type === 'player' && ctx.lean === 'rebuild' && i.age >= 28) list.push({ w: -3, text: `At ${i.age.toFixed(0)}, ${Vault.escapeHtml(i.name)} doesn't fit a rebuild.` });
    if (i.type === 'pick' && ctx.lean === 'contend') list.push({ w: -2, text: `${Vault.escapeHtml(i.name)} doesn't help a contender win now.` });
  });
  if (drops) list.push({ w: -2 * drops, text: `They'd have to drop ${drops} player${drops === 1 ? '' : 's'} to fit this.` });
  return list;
}

// The receiving manager's read of a trade. edge = % they come out ahead on the
// site's overall fairness; will = edge plus their specific concerns/pluses.
function negJudge(aAssets, bAssets, R, ctx) {
  const { valueA, valueB } = Vault.tradeSideValues(aAssets, bAssets);
  const an = computeTradeAnalysis(teamOf('A'), teamOf('B'), aAssets, bAssets, valueA, valueB);
  const edge = (R === 'B' ? 1 : -1) * an.fairness.overallSigned;
  const [out, inc] = R === 'A' ? [aAssets, bAssets] : [bAssets, aAssets];
  const drops = rosterCap ? Math.max(0, projectedRosterCount(teamOf(R), out, inc) - rosterCap) : 0;
  const concerns = negConcerns(aAssets, bAssets, R, ctx, drops);
  const will = edge + concerns.reduce((t, c) => t + c.w, 0);
  const accepts = will >= ctx.ask && drops <= 1;
  return { an, edge, will, drops, concerns, accepts };
}

function negReasons(j, ctx) {
  const e = j.edge;
  const reasons = [];
  if (e <= -VAULT_CONFIG.LOPSIDED_PCT) reasons.push(`Not close on value — they'd be giving up about ${capPct(-e).toFixed(0)}% more than they get back.`);
  else if (e < -1) reasons.push(`On value, they'd be giving up about ${capPct(-e).toFixed(0)}% more than they get back.`);
  else reasons.push(e >= 1 ? `On value, they come out about ${capPct(e).toFixed(0)}% ahead.` : 'On value, it\'s about even for them.');
  // Concerns first (they're why it's a no), then pluses.
  [...j.concerns].sort((x, y) => x.w - y.w).forEach(c => reasons.push(c.text));
  if (!j.accepts && e >= ctx.ask && j.concerns.some(c => c.w < 0)) reasons.push('The value is close enough, but those concerns tip it to a no.');
  if (!j.accepts && ctx.ask >= 0 && e < ctx.ask && e > -4) reasons.push('They rarely trade, so they want to come out ahead.');
  if (ctx.style && ctx.style.trades) reasons.push(`Their trade history: ${Vault.escapeHtml(ctx.style.style.toLowerCase())}.`);
  return [...new Set(reasons)].slice(0, 6);
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

// Send the calculator's current trade as the next offer.
async function negOffer(btn) {
  const aAssets = negAssets('A', [...selectedA]), bAssets = negAssets('B', [...selectedB]);
  if (!aAssets.length || !bAssets.length) return flashButtonMessage(btn, 'Add pieces to both sides first');
  const O = negOfferingSide(), R = negOther(O);
  Negotiation.offering = O;
  if (offeredBy !== O) { offeredBy = O; render('A'); render('B'); }
  const box = document.getElementById('negotiation');
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
  if (j.accepts) round.decision = 'accept';
  else {
    const c = negCounter(aAssets, bAssets, O, R, ctx);
    const inTrade = new Set(negKeys([...aAssets, ...bAssets]));
    round.interests = negKeys(negInterests(O, ctx, inTrade));
    if (c) { round.decision = 'counter'; round.counter = { A: negKeys(c.A), B: negKeys(c.B), text: negCounterText(c, R, ctx), edge: c.edge }; }
    else round.decision = 'decline';
  }
  Negotiation.rounds.push(round);
  negRender();
}

function negLoad(keysA, keysB) {
  selectedA.clear(); selectedB.clear();
  keysA.forEach(k => selectedA.add(k)); keysB.forEach(k => selectedB.add(k));
  render('A'); render('B');
}

function negAcceptCounter(i) {
  const c = Negotiation.rounds[i]?.counter;
  if (!c) return;
  negLoad(c.A, c.B);
  Negotiation.rounds.push({ decision: 'deal', offer: { A: c.A, B: c.B }, O: Negotiation.rounds[i].O, R: Negotiation.rounds[i].R });
  negRender();
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
  deal: ['Deal reached', 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25']
};

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
    <p class="text-[11px] text-zinc-500 mb-3">Predicted from their roster, needs, timeline, value${Negotiation.styles?.size ? ', and trade history' : ''} — not the real manager. Send the real offer in Sleeper.</p>
    <div class="space-y-3">${Negotiation.rounds.map((r, i) => {
      const [label, cls] = NEG_PILL[r.decision];
      if (r.decision === 'deal') return `<div class="p-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20">
          <div class="flex items-center gap-2 mb-1"><span class="text-[11px] px-2 py-0.5 rounded-md border ${cls}">${label}</span><span class="text-[12px] text-zinc-300">You accepted their counter.</span></div>
          <div class="text-[12px]">${negTradeLine(r.offer, r.O)}</div>
          <div class="text-[11px] text-zinc-400 mt-1.5">It's loaded in the calculator above — use Share to send yourself the link, then make the offer in Sleeper.</div></div>`;
      const last = i === Negotiation.rounds.length - 1;
      return `<div class="p-3 rounded-xl bg-black/30">
        <div class="text-[11px] text-zinc-500 mb-1">Round ${i + 1} · your offer</div>
        <div class="text-[12px] mb-2">${negTradeLine(r.offer, r.O)}</div>
        <div class="flex items-center gap-2 mb-1.5"><span class="text-[11px] px-2 py-0.5 rounded-md border ${cls}">${label}</span><span class="text-[12px] text-zinc-400">${who}</span></div>
        <ul class="space-y-0.5 mb-2">${r.reasons.map(t => `<li class="text-[12px] text-zinc-300 flex gap-2"><span class="text-zinc-500">•</span><span>${t}</span></li>`).join('')}</ul>
        ${r.decision === 'accept' && r.edge >= VAULT_CONFIG.FAIR_PCT ? `<div class="text-[12px] text-amber-300 mb-1.5">Heads up: they'd accept because it now leans ${capPct(r.edge).toFixed(0)}% their way — ${r.edge >= VAULT_CONFIG.LOPSIDED_PCT ? 'Unfair' : 'Lopsided'} for you.${negAssets(r.O, r.offer[r.O]).length < negAssets(r.R, r.offer[r.R]).length ? ' On KTC\'s math, extra smaller pieces on your side count for less than the premium on the best player in the deal, so asking for a throw-in can make it worse for you.' : ''}</div>` : ''}
        ${r.decision === 'accept' ? `<div class="text-[11px] text-zinc-400">They'd take this as offered — make the offer in Sleeper.</div>` : ''}
        ${r.interests?.length ? `<div class="text-[11px] text-zinc-400 mb-1.5">On your roster, they'd be more interested in:</div>
          <div class="flex flex-wrap gap-1.5 mb-2">${negAssets(r.O, r.interests).map(a => `<button onclick="negAddInterest('${a.key}')" title="Add to your side" class="text-[11px] px-2 py-1 rounded-md border border-white/10 text-zinc-300 hover:text-white hover:border-amber-500/40">+ ${Vault.escapeHtml(a.name)} <span class="mono text-zinc-500">${Math.round(a.value).toLocaleString()}</span></button>`).join('')}</div>` : ''}
        ${r.counter ? `<div class="mt-2 p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.04]">
            <div class="text-[12px] text-amber-200 mb-1">${r.counter.text}</div>
            <div class="text-[12px] mb-1">${negTradeLine(r.counter, r.O)}</div>
            <div class="text-[11px] text-zinc-400 mb-2">Leans ${capPct(Math.abs(r.counter.edge)).toFixed(0)}% ${r.counter.edge >= 0 ? 'their way' : 'your way'} — still Fair for you.</div>
            ${last ? `<div class="flex flex-wrap gap-2"><button onclick="negAcceptCounter(${i})" class="text-[11px] px-3 py-1.5 rounded-lg btn-gold-solid">Accept their counter</button><button onclick="negEditCounter(${i})" class="text-[11px] px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white">Edit it and counter back</button></div>` : ''}
          </div>` : ''}
        ${r.decision === 'decline' ? `<div class="text-[11px] text-zinc-400">Nothing close to this works for them. Try building around the pieces above.</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  box.classList.remove('hidden');
  renderOfferButton();
}

// The Offer button in the trade bar.
function renderOfferButton() {
  const el = document.getElementById('offerBtn');
  if (!el) return;
  const bothSides = selectedA.size && selectedB.size;
  if (!bothSides) { el.innerHTML = ''; return; }
  const O = negOfferingSide(), R = negOther(O);
  const done = Negotiation.rounds.length && Negotiation.rounds[Negotiation.rounds.length - 1].decision === 'deal';
  const label = done ? 'Negotiate again' : Negotiation.rounds.length ? 'Send revised offer' : `Offer to ${Vault.escapeHtml(teamOf(R).teamName)}`;
  el.innerHTML = `<button onclick="${done ? 'negReset(); negOffer(this)' : 'negOffer(this)'}" title="See how ${Vault.escapeHtml(teamOf(R).teamName)} would likely respond — accept, decline, or counter" class="shrink-0 text-[11px] px-3 py-1.5 rounded-lg border border-amber-500/30 text-amber-200 hover:bg-amber-500/10 transition-colors">${label}</button>`;
}
