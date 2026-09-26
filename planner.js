/* ============================================================
   TRADE COACH (Trade Calculator)
   One panel with a row of options: Negotiate a trade (negotiation.js) or
   one of four goals below. A goal gets the trades to reach it, in order,
   with the next one highlighted. Every step is checked the way Negotiate checks an offer: the
   other manager would likely accept it (negJudgeFor, same needs, timeline,
   and trading style) and it's Fair for you on the overall grade.

   Later steps are judged in the league as it would look after the earlier
   ones (Vault.simulateTrade), so step 2 can spend what step 1 brings in and
   everyone's needs are re-read after each trade.

   Goals:
   - Get a player: the best direct offer, or a two-trade path through a third
     team when that gets the owner a piece they want more (only when it
     saves you real value; one trade beats two otherwise).
   - Fix a position: the biggest lineup upgrade there you can afford without
     touching your other starters, then a second if it's still a need.
   - Rebuild: aging players sold, most valuable first, for the
     best picks and young players (24 or under) any team would give.
   - Go all-in: bench players and picks turned into starters, biggest lineup
     gain first.
   Any goal that leaves a new hole gets one more trade to refill it.

   Uses the Trade Calculator's globals (teams, slots, teamOf, selectedA/B,
   assetsFor, render) and negotiation.js (negJudgeFor, negContextFor,
   negInterestMult, negLean, negLoad, negOffer, sumValue).
   ============================================================ */
const PLAN = {
  SELL_AGE: { QB: 30, RB: 26, WR: 28, TE: 29 }, // roughly where each position's value starts sliding
  TWO_STEP_SAVES: 5,  // a two-trade path must save 5% of the target's value over the direct offer
  MIN_GAIN: 1,        // pts/week a lineup move has to add to count as an upgrade
  UPGRADE_BY: 2,      // a target must out-score your weakest starter there by 2 pts/week
  MAX_SELLS: 4,
  MAX_BUYS: 3
};
const PLAN_GOALS = {
  negotiate: { label: 'Negotiate a trade', blurb: 'Offer the trade loaded in the calculator and see how their manager would likely respond, with a recommended next move after every reply.' },
  target: { label: 'Get a player', blurb: 'Pick any player on another team. The planner finds the cheapest fair offer their manager would take, or a two-trade path when setting it up through another team saves you real value.' },
  position: { label: 'Fix a position', blurb: 'Upgrades your weakest starter at a position, paid for without touching your other starters.' },
  rebuild: { label: 'Rebuild', blurb: 'Sells your aging players while they still hold value, most valuable first, for the best picks and young players (24 or under) anyone would give.' },
  contend: { label: 'Go all-in', blurb: 'Turns bench players and picks into starters, biggest lineup gain first. Your starters stay put.' }
};
const Planner = { goal: 'target', fromStep: null, picker: { open: false, q: '', pos: 'ALL' }, targetKey: null, pos: null, result: null, busy: false, rejected: { partners: new Set(), deals: new Set() } };

const planTick = () => new Promise(r => setTimeout(r, 0));
const planTeam = (world, id) => world.find(t => t.rosterId === id);
const planOwner = (world, key) => world.find(t => t.assets.some(a => a.key === key));
const planSig = (partnerId, give, get) => `${partnerId}|${negKeys(give).sort()}|${negKeys(get).sort()}`;
const planMe = () => Vault.myTeam(teams) || teamOf('A');

// Run engine code against a hypothetical league: the calculator's analysis
// reads the global `teams`, so swap it in for the duration of a sync call.
function planIn(world, fn) {
  const real = teams;
  teams = world;
  try { return fn(); } finally { teams = real; }
}

// The league after a trade: both teams rebuilt, everyone else untouched.
function planApply(world, meId, partnerId, give, get) {
  const { pool } = Vault.simulateTrade(world, slots, meId, partnerId, give, get);
  pool.forEach(t => { if (t.rosterId === meId || t.rosterId === partnerId) t.assets = assetsFor(t); });
  return pool;
}

function planJudge(world, me, give, partner, get) {
  return planIn(world, () => negJudgeFor(me, give, partner, get, negContextFor(partner)));
}

// Of these packages, the one best for you that they'd accept and that's Fair for you.
function planBest(world, me, partner, get, packs) {
  let best = null;
  packs.forEach(give => {
    if (!give.length || Planner.rejected.deals.has(planSig(partner.rosterId, give, get))) return;
    const j = planJudge(world, me, give, partner, get);
    if (j.accepts && j.edge < VAULT_CONFIG.FAIR_PCT && (!best || j.edge < best.edge)) best = { partner, give, get, edge: j.edge };
  });
  return best;
}

// Your cheapest package for `get`: one or two pieces, three only when that won't do.
function planBuy(world, me, partner, get, { protect = new Set(), must = [] } = {}) {
  const want = sumValue(get), mustVal = sumValue(must);
  const skip = new Set([...protect, ...negKeys(must)]);
  const pool = me.assets.filter(a => !skip.has(a.key) && a.value >= want * 0.08 && a.value + mustVal <= want * 1.4)
    .sort((x, y) => y.value - x.value).slice(0, 14);
  const packs = must.length ? [[...must]] : [];
  pool.forEach((a, i) => {
    packs.push([...must, a]);
    pool.slice(i + 1).forEach(b => { const s = mustVal + a.value + b.value; if (s >= want * 0.7 && s <= want * 1.7) packs.push([...must, a, b]); });
  });
  let best = planBest(world, me, partner, get, packs);
  if (!best) {
    const top = pool.slice(0, 10), triples = [];
    top.forEach((a, i) => top.slice(i + 1).forEach((b, k) => top.slice(i + k + 2).forEach(c => {
      const s = mustVal + a.value + b.value + c.value;
      if (s >= want * 0.9 && s <= want * 2.2) triples.push([...must, a, b, c]);
    })));
    best = planBest(world, me, partner, get, triples);
  }
  return best;
}

// The best return any team would give for `give`, from pieces that pass `filter`.
function planSell(world, me, give, filter) {
  const val = sumValue(give);
  let best = null;
  world.filter(t => t.rosterId !== me.rosterId && !Planner.rejected.partners.has(t.rosterId)).forEach(t => {
    const pool = t.assets.filter(a => filter(a) && a.value >= val * 0.1 && a.value <= val * 1.3).sort((x, y) => y.value - x.value).slice(0, 10);
    const packs = pool.map(a => [a]);
    pool.forEach((a, i) => pool.slice(i + 1).forEach(b => { const s = a.value + b.value; if (s >= val * 0.6 && s <= val * 1.5) packs.push([a, b]); }));
    packs.forEach(pack => {
      if (Planner.rejected.deals.has(planSig(t.rosterId, give, pack))) return;
      const j = planJudge(world, me, give, t, pack);
      if (j.accepts && j.edge < VAULT_CONFIG.FAIR_PCT && (!best || j.edge < best.edge)) best = { partner: t, give, get: pack, edge: j.edge };
    });
  });
  return best;
}

// The biggest lineup upgrade at these positions you can afford without
// giving up anything in `protect`.
async function planUpgrade(world, meId, positions, protect, progress) {
  const me = planTeam(world, meId);
  const starters = me.lineup.filter(s => s.id);
  const floor = {};
  positions.forEach(P => { const at = starters.filter(s => s.pos === P); floor[P] = at.length ? Math.min(...at.map(s => s.ppg)) : 0; });
  const budget = me.assets.filter(a => !protect.has(a.key)).map(a => a.value).sort((x, y) => y - x).slice(0, 3).reduce((t, v) => t + v, 0);
  const cands = world.filter(t => t.rosterId !== meId && !Planner.rejected.partners.has(t.rosterId))
    .flatMap(t => t.assets.filter(a => a.type === 'player' && positions.includes(a.pos) && (a.ppg || 0) >= floor[a.pos] + PLAN.UPGRADE_BY && a.value <= budget).map(a => ({ a, t })))
    .sort((x, y) => (y.a.ppg - floor[y.a.pos]) - (x.a.ppg - floor[x.a.pos])).slice(0, 12);
  let best = null;
  for (const { a, t } of cands) {
    progress(`Pricing ${a.name}…`);
    await planTick();
    const s = planBuy(world, me, t, [a], { protect });
    if (!s) continue;
    const next = planApply(world, meId, t.rosterId, s.give, s.get);
    const gain = planTeam(next, meId).opt - me.opt;
    if (gain < PLAN.MIN_GAIN) continue;
    if (!best || gain > best.gain + 0.3 || (Math.abs(gain - best.gain) <= 0.3 && s.edge < best.s.edge)) best = { s, gain, next };
  }
  return best;
}

const planStep = (found, why, world) => ({ partnerId: found.partner.rosterId, partnerName: found.partner.teamName, give: found.give, get: found.get, edge: found.edge, why, world, done: false });
const planNet = steps => steps.reduce((t, s) => { const { valueA, valueB } = Vault.tradeSideValues(s.give, s.get); return t + valueB - valueA; }, 0);
const planProtectAcquired = (steps, set) => { steps.forEach(s => s.get.forEach(a => set.add(a.key))); return set; };

// Why a manager would want this piece, in their terms.
function planWantReason(a, ctx) {
  if (a.type === 'pick') return ctx.lean === 'rebuild' ? 'they\'re rebuilding and want picks' : 'they like the pick';
  if (ctx.needs.includes((a.pos || '').toLowerCase())) return `${a.pos} is a need for them`;
  if (ctx.lean === 'rebuild' && a.age && a.age <= 24) return 'they\'re rebuilding and want young players';
  if (ctx.lean === 'contend' && (a.ppg || 0) >= 12) return 'they\'re contending and want starters';
  return 'it fits what they need';
}

/* ---------- Goals: each takes the league as it stands and returns steps ---------- */

async function planGoalTarget(world, meId, progress) {
  const seller = planOwner(world, Planner.targetKey);
  if (!seller || seller.rosterId === meId) return { steps: [], empty: 'Pick a player on another team first.' };
  const me = planTeam(world, meId);
  const target = seller.assets.find(a => a.key === Planner.targetKey);
  const name = Vault.escapeHtml(target.name), sName = Vault.escapeHtml(seller.teamName);
  progress(`Checking what ${seller.teamName} would take…`);
  await planTick();
  const direct = planBuy(world, me, seller, [target]);
  const paths = direct ? [[planStep(direct, `${sName} would likely take this for ${name}.`, world)]] : [];

  // Two trades: first pick up a piece the owner wants more than what you have, then use it.
  const ctxS = planIn(world, () => negContextFor(seller));
  for (const Y of world.filter(t => t.rosterId !== meId && t.rosterId !== seller.rosterId && !Planner.rejected.partners.has(t.rosterId))) {
    progress(`Looking for a stepping stone on ${Y.teamName}…`);
    await planTick();
    const stones = Y.assets.filter(y => y.value >= target.value * 0.35 && y.value <= target.value * 1.15 && negInterestMult(y, ctxS) > 1)
      .sort((p, q) => negInterestMult(q, ctxS) * q.value - negInterestMult(p, ctxS) * p.value).slice(0, 2);
    for (const y of stones) {
      const s1 = planBuy(world, me, Y, [y]);
      if (!s1) continue;
      const w1 = planApply(world, meId, Y.rosterId, s1.give, s1.get);
      const me1 = planTeam(w1, meId), seller1 = planTeam(w1, seller.rosterId);
      const y1 = me1.assets.find(a => a.key === y.key), t1 = seller1.assets.find(a => a.key === target.key);
      if (!y1 || !t1) continue;
      const s2 = planBuy(w1, me1, seller1, [t1], { must: [y1] });
      if (!s2) continue;
      const yName = Vault.escapeHtml(y.name);
      paths.push([
        planStep(s1, `Sets up the deal: ${sName} values ${yName} more than what you'd send them directly (${planWantReason(y, ctxS)}).`, world),
        planStep(s2, `${yName} headlines the offer for ${name}.`, w1)
      ]);
    }
  }
  if (!paths.length) return { steps: [], title: `Get ${name}`, empty: `No fair path found. ${sName} wouldn't likely take anything on your roster for ${name} at a price that's Fair for you, even after one trade to set it up.` };
  const scored = paths.map(p => ({ p, net: planNet(p) }));
  const bestDirect = scored.find(x => x.p.length === 1);
  const bestTwo = scored.filter(x => x.p.length === 2).sort((x, y) => y.net - x.net)[0];
  let pick = bestDirect || bestTwo, note = '';
  if (bestDirect && bestTwo && bestTwo.net - bestDirect.net > target.value * PLAN.TWO_STEP_SAVES / 100) {
    pick = bestTwo;
    note = `Two trades instead of one: setting it up through ${Vault.escapeHtml(bestTwo.p[0].partnerName)} saves you about ${Math.round(bestTwo.net - bestDirect.net).toLocaleString()} in value over the best direct offer.`;
  } else if (!bestDirect) note = `${sName} wouldn't likely take anything you have now, so step 1 gets them something they want more.`;
  return { steps: pick.p, title: `Get ${name}`, note };
}

async function planGoalPosition(world, meId, progress) {
  const P = Planner.pos;
  const steps = [];
  let w = world;
  for (let n = 0; n < 2; n++) {
    const me = planTeam(w, meId);
    const protect = planProtectAcquired(steps, new Set(me.lineup.filter(s => s.id && s.pos !== P).map(s => 'p_' + s.id)));
    const best = await planUpgrade(w, meId, [P], protect, progress);
    if (!best) break;
    steps.push(planStep(best.s, `${Vault.escapeHtml(best.s.get[0].name)} starts for you at ${P}: about +${best.gain.toFixed(1)} pts/week to your best lineup.`, w));
    w = best.next;
    if (!planIn(w, () => Vault.positionalProfile(planTeam(w, meId), w)).needs.includes(P.toLowerCase())) break;
  }
  if (!steps.length) return { steps, title: `Fix ${P}`, empty: `No fair upgrade at ${P} found: nobody who'd out-score your weakest ${P} starter by ${PLAN.UPGRADE_BY}+ pts/week is gettable for what's on your bench and picks.` };
  return { steps, title: `Fix ${P}`, w };
}

async function planGoalRebuild(world, meId, progress) {
  const steps = [], unsold = [];
  let w = world;
  const vets = planTeam(world, meId).assets
    .filter(a => a.type === 'player' && PLAN.SELL_AGE[a.pos] && a.age >= PLAN.SELL_AGE[a.pos] && a.value >= 1500)
    .sort((x, y) => y.value - x.value);
  if (!vets.length) return { steps, title: 'Rebuild', empty: 'You don\'t have any aging players worth selling (RBs 26+, WRs 28+, TEs 29+, QBs 30+ with real value).' };
  for (const v of vets) {
    if (steps.length >= PLAN.MAX_SELLS) break;
    progress(`Shopping ${v.name}…`);
    await planTick();
    const me = planTeam(w, meId), vNow = me.assets.find(a => a.key === v.key);
    if (!vNow) continue;
    const s = planSell(w, me, [vNow], a => a.type === 'pick' || (a.age && a.age <= 24));
    if (!s) { unsold.push(v.name); continue; }
    steps.push(planStep(s, `At ${Math.floor(v.age)}, ${Vault.escapeHtml(v.name)} is ${Math.floor(v.age) > PLAN.SELL_AGE[v.pos] ? 'past' : 'at'} the age ${v.pos}s usually start losing value. Selling now brings back ${negNames(s.get)}.`, w));
    w = planApply(w, meId, s.partner.rosterId, s.give, s.get);
  }
  const note = unsold.length ? `No team would give fair value in picks or young players for ${unsold.map(Vault.escapeHtml).join(', ')} right now.` : '';
  if (!steps.length) return { steps, title: 'Rebuild', empty: note };
  return { steps, title: 'Rebuild', note, w };
}

async function planGoalContend(world, meId, progress) {
  const steps = [];
  let w = world;
  for (let n = 0; n < PLAN.MAX_BUYS; n++) {
    const me = planTeam(w, meId);
    const protect = planProtectAcquired(steps, new Set(me.lineup.filter(s => s.id).map(s => 'p_' + s.id)));
    const best = await planUpgrade(w, meId, ['QB', 'RB', 'WR', 'TE'], protect, progress);
    if (!best) break;
    steps.push(planStep(best.s, `${Vault.escapeHtml(best.s.get[0].name)} goes straight into your lineup: about +${best.gain.toFixed(1)} pts/week, paid with bench players and picks.`, w));
    w = best.next;
  }
  if (!steps.length) return { steps, title: 'Go all-in', empty: 'No fair lineup upgrade found that your bench and picks can pay for.' };
  return { steps, title: 'Go all-in', w };
}

// One more trade if the plan opened a hole that wasn't there before.
async function planRepair(startWorld, res, meId, progress) {
  if (!res.w || !res.steps.length) return;
  const before = planIn(startWorld, () => Vault.positionalProfile(planTeam(startWorld, meId), startWorld)).needs;
  const after = planIn(res.w, () => Vault.positionalProfile(planTeam(res.w, meId), res.w)).needs;
  const hole = after.find(p => !before.includes(p));
  if (!hole) return;
  const P = hole.toUpperCase(), me = planTeam(res.w, meId);
  const protect = planProtectAcquired(res.steps, new Set(me.lineup.filter(s => s.id && s.pos !== P).map(s => 'p_' + s.id)));
  const best = await planUpgrade(res.w, meId, [P], protect, progress);
  if (best) res.steps.push(planStep(best.s, `Refills ${P}, which the trades above leave thin: about +${best.gain.toFixed(1)} pts/week.`, res.w));
  else res.note = [res.note, `Heads up: this plan leaves ${P} thin, and no fair trade to refill it turned up.`].filter(Boolean).join(' ');
}

const PLAN_RUN = { target: planGoalTarget, position: planGoalPosition, rebuild: planGoalRebuild, contend: planGoalContend };

// Plan from `world`, keeping any steps before `from` as they are.
async function planRun(world, from = 0) {
  const me = planMe();
  const status = document.getElementById('planStatus');
  const progress = text => { if (status) status.textContent = text; };
  Planner.busy = true;
  renderPlanner();
  if (!Negotiation.styles) { progress('Reading every manager\'s trade history…'); await Promise.race([negPreloadStyles(), new Promise(r => setTimeout(r, 8000))]); }
  try {
    const res = await PLAN_RUN[Planner.goal](world, me.rosterId, progress);
    if (Planner.goal !== 'rebuild') await planRepair(world, res, me.rosterId, progress);
    const kept = from && Planner.result ? Planner.result.steps.slice(0, from) : [];
    const startWorld = from && Planner.result ? Planner.result.startWorld : world;
    Planner.result = { ...res, steps: [...kept, ...res.steps], meId: me.rosterId, goal: Planner.goal, startWorld };
  } catch (e) {
    console.error(e);
    Planner.result = { steps: [], empty: 'Something went wrong building this plan. Try again, or pick a different goal.' };
  }
  Planner.busy = false;
  renderPlanner();
}

/* ---------- Actions ---------- */

// The coach button toggles the panel. It opens on Negotiate when a trade is
// loaded (or already being negotiated), otherwise on the last goal picked.
function openCoach(option) {
  const box = document.getElementById('coach');
  const wasOpen = !box.classList.contains('hidden');
  if (!option && wasOpen) return closeCoach();
  if (!option && (Negotiation.rounds.length || (selectedA.size && selectedB.size))) option = 'negotiate';
  if (option) Planner.goal = option;
  box.classList.remove('hidden');
  if (!Planner.pos) Planner.pos = planDefaultPos();
  if (!Planner.targetKey) { const b = [...selectedB]; if (b.length === 1 && b[0].startsWith('p_')) Planner.targetKey = b[0]; }
  negPreloadStyles();
  renderPlanner();
  if (!wasOpen) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeCoach() { document.getElementById('coach').classList.add('hidden'); }
const coachOpen = () => !document.getElementById('coach').classList.contains('hidden');

// Negotiate shows the rounds (when there are any); goals show the planner.
function coachSync() {
  const neg = document.getElementById('negotiation');
  if (neg) neg.classList.toggle('hidden', !(Planner.goal === 'negotiate' && Negotiation.rounds.length));
}

function planReset() {
  Planner.result = null;
  Planner.rejected = { partners: new Set(), deals: new Set() };
  if (coachOpen()) renderPlanner();
}

function planDefaultPos() {
  const { posPct, needs } = Vault.positionalProfile(planMe(), teams);
  const order = Object.keys(posPct).sort((x, y) => posPct[x] - posPct[y]);
  return (order.find(p => needs.includes(p)) || order[0] || 'rb').toUpperCase();
}

// Switching options keeps a built plan and any negotiation, so you can flip back.
function planSetGoal(g) { Planner.goal = g; renderPlanner(); }
function planSetPos(p) { Planner.pos = p; Planner.result = null; renderPlanner(); }
// Target picker: the whole league by value, filtered by name and position.
function planPickTarget(key) {
  if (key !== Planner.targetKey) { Planner.targetKey = key; Planner.result = null; Planner.rejected = { partners: new Set(), deals: new Set() }; }
  Planner.picker.open = false;
  renderPlanner();
}
function planOpenPicker() { Planner.picker = { open: true, q: '', pos: 'ALL' }; renderPlanner(); document.getElementById('planTargetSearch')?.focus(); }
function planClosePicker() { Planner.picker.open = false; renderPlanner(); }
function planPickerPos(p) { Planner.picker.pos = p; renderPlanner(); }
function planPickerSearch(q) { Planner.picker.q = q; renderPlanTargetList(); }
function renderPlanTargetList() {
  const el = document.getElementById('planTargetList');
  if (!el) return;
  const q = Planner.picker.q.trim().toLowerCase(), pos = Planner.picker.pos;
  const hits = planTargetOptions().filter(o => (pos === 'ALL' || o.pos === pos) && (!q || o.name.toLowerCase().includes(q) || o.team.toLowerCase().includes(q))).slice(0, 40);
  el.innerHTML = hits.length ? hits.map(o => `<button onclick="planPickTarget('${o.key}')" class="w-full px-3 py-2 flex items-center justify-between gap-3 text-left hover:bg-violet-500/10 ${o.key === Planner.targetKey ? 'bg-violet-500/10' : ''}">
      <span class="min-w-0 truncate text-[12px] text-zinc-200">${Vault.escapeHtml(o.name)} <span class="text-zinc-500">${o.pos} · ${Vault.escapeHtml(o.team)}</span></span>
      <span class="mono text-[11px] text-zinc-400 shrink-0">${Math.round(o.value).toLocaleString()}</span>
    </button>`).join('') : '<div class="px-3 py-2 text-[12px] text-zinc-400">No players match.</div>';
}
function planTargetHtml(chip) {
  const cur = planTargetOptions().find(o => o.key === Planner.targetKey);
  if (!Planner.picker.open && cur) {
    return `<div class="flex items-center gap-2 min-w-0">
        <div class="min-w-0 px-3 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/[0.06] text-[13px] truncate">${Vault.escapeHtml(cur.name)} <span class="text-zinc-400">${cur.pos} · ${Vault.escapeHtml(cur.team)}</span></div>
        <button onclick="planOpenPicker()" class="shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white">Change</button>
      </div>`;
  }
  return `<div class="w-full sm:w-[440px]">
      <div class="flex gap-2 mb-2">
        <input id="planTargetSearch" type="text" autocomplete="off" placeholder="Search a player or team…" value="${Vault.escapeHtml(Planner.picker.q)}" oninput="planPickerSearch(this.value)"
          class="flex-1 min-w-0 bg-black/40 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-violet-500/40" />
        ${cur ? '<button onclick="planClosePicker()" class="shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-white">Cancel</button>' : ''}
      </div>
      <div class="flex gap-1.5 flex-wrap mb-2">${['ALL', 'QB', 'RB', 'WR', 'TE'].map(p => chip(Planner.picker.pos === p, p === 'ALL' ? 'All' : p, `planPickerPos('${p}')`)).join('')}</div>
      <div id="planTargetList" class="max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-black/40 divide-y divide-white/5 scrollbar"></div>
    </div>`;
}
function planBuild() {
  if (Planner.busy) return;
  if (Planner.goal === 'target' && !Planner.targetKey) return planOpenPicker();
  Planner.rejected = { partners: new Set(), deals: new Set() };
  planRun(teams);
}

function planDone(i) { Planner.result.steps[i].done = true; renderPlanner(); }
function planUndo(i) { Planner.result.steps[i].done = false; renderPlanner(); }

// They said no: rule that trade out and re-plan from this step on.
function planNo(i) {
  const s = Planner.result.steps[i];
  const isOwner = Planner.goal === 'target' && s.get.some(a => a.key === Planner.targetKey);
  if (isOwner) Planner.rejected.deals.add(planSig(s.partnerId, s.give, s.get));
  else Planner.rejected.partners.add(s.partnerId);
  planRun(s.world, i);
}

// A step can load into the calculator once everything in it is on the real rosters.
function planLoadable(s) {
  const me = teams.find(t => t.rosterId === Planner.result.meId), them = teams.find(t => t.rosterId === s.partnerId);
  return me && them && s.give.every(a => me.assets.some(x => x.key === a.key)) && s.get.every(a => them.assets.some(x => x.key === a.key));
}

function planLoad(i) {
  const s = Planner.result.steps[i];
  if (!planLoadable(s)) return;
  const selA = document.getElementById('teamA'), selB = document.getElementById('teamB');
  if (selA.value !== String(Planner.result.meId)) { selA.value = String(Planner.result.meId); selA.onchange(); }
  if (selB.value !== String(s.partnerId)) { selB.value = String(s.partnerId); selB.onchange(); }
  negLoad(negKeys(s.give), negKeys(s.get));
  document.getElementById('tradeBar').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function planNegotiate(i) {
  planLoad(i);
  Planner.fromStep = i;
  Negotiation.offering = 'A';
  negOffer(document.querySelector('#offerBtn button'));
  document.getElementById('coach').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- Render ---------- */

function planTargetOptions() {
  const me = planMe();
  return teams.filter(t => t !== me).flatMap(t => t.assets.filter(a => a.type === 'player' && a.value >= 300).map(a => ({ key: a.key, value: a.value, name: a.name, pos: a.pos, team: t.teamName })))
    .sort((x, y) => y.value - x.value);
}

function renderPlanner() {
  const head = document.getElementById('coachHead'), box = document.getElementById('planner');
  if (!head || !coachOpen()) return;
  const me = planMe();
  const chip = (on, label, onclick, extra = '') => `<button onclick="${onclick}" class="text-[12px] px-3 py-1.5 rounded-lg border transition-colors ${on ? 'bg-violet-500/15 border-violet-500/40 text-violet-200' : 'border-white/10 text-zinc-400 hover:text-white hover:border-white/20'}">${label}${extra}</button>`;
  head.innerHTML = `
    <div class="flex items-start justify-between gap-3 mb-3">
      <div>
        <div class="text-[11px] text-zinc-400 uppercase tracking-wider">Trade Coach <span class="normal-case tracking-normal text-zinc-500">· for ${Vault.escapeHtml(me.teamName)}</span></div>
        <div class="text-[12px] text-zinc-400 mt-1 max-w-[680px]">Every trade the coach suggests is Fair for you and one the other manager would likely take. Responses are predicted from their roster, needs, timeline, and trade history, not the real managers.</div>
      </div>
      <button onclick="closeCoach()" class="shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-white hover:border-white/20">Close</button>
    </div>
    <div class="flex gap-1.5 flex-wrap mb-2">${Object.entries(PLAN_GOALS).map(([g, d]) => chip(Planner.goal === g, d.label, `planSetGoal('${g}')`)).join('')}</div>
    <div class="text-[12px] text-zinc-400 mb-3 max-w-[680px]">${PLAN_GOALS[Planner.goal].blurb}</div>`;
  coachSync();

  if (Planner.goal === 'negotiate') { box.innerHTML = coachNegotiateHtml(); return; }
  const needs = Vault.positionalProfile(me, teams).needs;
  const input = {
    target: Planner.goal === 'target' ? planTargetHtml(chip) : '',
    position: `<div class="flex gap-1.5 flex-wrap">${['QB', 'RB', 'WR', 'TE'].map(p => chip(Planner.pos === p, p, `planSetPos('${p}')`, needs.includes(p.toLowerCase()) ? ' <span class="text-[10px] text-rose-300/80">need</span>' : '')).join('')}</div>`,
    rebuild: '', contend: ''
  }[Planner.goal];
  const built = Planner.result && Planner.result.goal === Planner.goal;
  box.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-start gap-2 mb-1">
      ${input}
      <button id="planBuildBtn" onclick="planBuild()" ${Planner.busy ? 'disabled' : ''} class="self-start sm:self-auto shrink-0 text-[12px] px-4 py-1.5 rounded-lg btn-gold-solid ${Planner.busy ? 'opacity-60' : ''}">${built ? 'Plan again' : 'Build plan'}</button>
    </div>
    <div id="planStatus" class="text-[12px] text-zinc-400 min-h-[18px] ${Planner.busy ? '' : 'hidden'}">Planning…</div>
    ${Planner.busy ? '' : planResultHtml()}`;
  renderPlanTargetList();
}

// Negotiate option: a prompt to offer the loaded trade, or (once rounds exist)
// a link back to the plan step being negotiated. The rounds render below.
function coachNegotiateHtml() {
  const r = Planner.result, step = r && Planner.fromStep != null ? r.steps[Planner.fromStep] : null;
  if (Negotiation.rounds.length) {
    return step ? `<div class="flex items-center justify-between gap-3 flex-wrap mb-3 p-2.5 rounded-lg bg-violet-500/[0.06] border border-violet-500/20">
        <span class="text-[12px] text-violet-200/90">Step ${Planner.fromStep + 1} of your plan: ${r.title}</span>
        <button onclick="planSetGoal('${r.goal}')" class="text-[11px] px-2.5 py-1 rounded-lg border border-white/10 text-zinc-300 hover:text-white">Back to plan</button>
      </div>` : '';
  }
  const ready = selectedA.size && selectedB.size;
  return `<div class="p-3 rounded-xl bg-black/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <span class="text-[12px] text-zinc-300">${ready ? `Ready: ${negNames(negAssets('A', [...selectedA]))} for ${negNames(negAssets('B', [...selectedB]))}.` : 'Add pieces to both sides of the calculator below, then offer it here.'}</span>
      ${ready ? `<button onclick="negOffer(this)" class="self-start sm:self-auto shrink-0 text-[12px] px-4 py-1.5 rounded-lg btn-gold-solid">Offer to ${Vault.escapeHtml(teamOf(negOther(negOfferingSide())).teamName)}</button>` : ''}
    </div>`;
}

function planResultHtml() {
  const r = Planner.result;
  if (!r || r.goal !== Planner.goal) return '';
  if (!r.steps.length) return `<div class="mt-3 p-3 rounded-xl bg-black/30 text-[12px] text-zinc-300">${r.empty || 'No fair plan found.'}</div>`;
  const next = r.steps.findIndex(s => !s.done);
  const outcome = planOutcome(r);
  const pill = (s, i) => s.done ? ['Done', 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'] : i === next ? ['Next up', 'bg-violet-500/15 text-violet-200 border-violet-500/40'] : [`Step ${i + 1}`, 'bg-white/5 text-zinc-400 border-white/10'];
  return `
    <div class="mt-4 mb-3">
      <div class="text-[15px] font-medium text-zinc-100">${r.title}: ${r.steps.length} trade${r.steps.length > 1 ? 's' : ''}</div>
      ${outcome ? `<div class="text-[12px] text-zinc-300 mt-0.5">${outcome}</div>` : ''}
      ${r.note ? `<div class="text-[12px] text-zinc-400 mt-1">${r.note}</div>` : ''}
      ${next >= 0 ? `<div class="text-[12px] text-violet-200/90 mt-2">Start with step ${next + 1}. Use Negotiate it to see how ${Vault.escapeHtml(r.steps[next].partnerName)} would likely respond, then make the real offer in Sleeper.</div>` : '<div class="text-[12px] text-emerald-300 mt-2">Every step is marked done. Reload rosters once the trades go through to plan your next move.</div>'}
    </div>
    <ol class="space-y-2.5">${r.steps.map((s, i) => {
      const [label, cls] = pill(s, i);
      const loadable = !s.done && planLoadable(s);
      return `<li class="p-3 rounded-xl border ${i === next ? 'border-violet-500/30 bg-violet-500/[0.04]' : 'border-white/5 bg-black/30'} ${s.done ? 'opacity-70' : ''}">
        <div class="flex items-center gap-2 mb-1.5 flex-wrap">
          <span class="text-[11px] px-2 py-0.5 rounded-md border ${cls}">${label}</span>
          <span class="text-[13px] text-zinc-100 font-medium">Trade with ${Vault.escapeHtml(s.partnerName)}</span>
        </div>
        <div class="text-[13px] text-zinc-300">You give <span class="text-zinc-100 font-medium">${negNames(s.give)}</span> · you get <span class="text-zinc-100 font-medium">${negNames(s.get)}</span></div>
        <div class="text-[12px] text-zinc-400 mt-1">${s.why}</div>
        <div class="text-[11px] text-zinc-400 mt-1">They'd likely accept. ${negLean(-s.edge)}</div>
        ${s.done
          ? `<button onclick="planUndo(${i})" class="mt-2 text-[11px] text-zinc-400 hover:text-white">Undo</button>`
          : `<div class="flex flex-wrap gap-2 mt-2.5">
              ${loadable ? `<button onclick="planNegotiate(${i})" class="text-[11px] px-3 py-1.5 rounded-lg ${i === next ? 'btn-gold-solid' : 'border border-white/10 text-zinc-300 hover:text-white'}">Negotiate it</button>
                <button onclick="planLoad(${i})" class="text-[11px] px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white">Load in calculator</button>`
                : `<span class="text-[11px] text-zinc-500 self-center">Loads once the steps before it go through in Sleeper and you reload rosters.</span>`}
              <button onclick="planDone(${i})" class="text-[11px] px-3 py-1.5 rounded-lg border border-emerald-500/25 text-emerald-300/90 hover:bg-emerald-500/5">Mark done</button>
              <button onclick="planNo(${i})" class="text-[11px] px-3 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-rose-300 hover:border-rose-400/40">They said no</button>
            </div>`}
      </li>`;
    }).join('')}</ol>
    <div class="text-[11px] text-zinc-500 mt-3">"They said no" rules that trade out and re-plans from that step. Plans aren't saved; rebuilding one always starts from your current roster.</div>`;
}

// One line on where the whole plan leaves you.
function planOutcome(r) {
  const start = planTeam(r.startWorld, r.meId);
  let w = r.startWorld;
  r.steps.forEach(s => { w = planApply(w, r.meId, s.partnerId, s.give, s.get); });
  const end = planTeam(w, r.meId);
  const dOpt = end.opt - start.opt, dAge = end.age - start.age;
  const net = planNet(r.steps), gave = r.steps.reduce((t, s) => t + Vault.tradeSideValues(s.give, s.get).valueA, 0);
  const valueLine = Math.abs(net) < gave * 0.01 ? 'about even on value overall' : `${net > 0 ? '+' : '−'}${Math.round(Math.abs(net)).toLocaleString()} in value overall`;
  if (r.goal === 'rebuild') return `Your roster gets ${Math.abs(dAge).toFixed(1)} yrs ${dAge <= 0 ? 'younger' : 'older'} (value-weighted), ${valueLine}.`;
  return `Your best lineup: ${dOpt >= 0 ? '+' : '−'}${Math.abs(dOpt).toFixed(1)} pts/week, ${valueLine}.`;
}
