/* ============================================================
   TRADE COACH (Trade Calculator)
   One panel, one row of options:
   - Negotiate a trade: the trade loaded in the calculator, answered by the
     other manager round by round (negotiation.js).
   - Get a player: several offers for one player their manager would take.
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
  MIN_GAIN: 1,       // pts/week a trade has to add to your best lineup
  UPGRADE_BY: 2,     // a target must out-score your weakest starter there by 2 pts/week
  SHOW: 5,           // suggestions per list
  TARGET_SHOW: 8     // offers for one player (Get a player)
};
const COACH_OPTIONS = {
  negotiate: { label: 'Negotiate a trade', blurb: 'Offer the trade loaded in the calculator. Their manager answers in their own words, and you can steer what you ask for next.' },
  target: { label: 'Get a player', blurb: 'Pick any player on another team and see offers their manager would likely take for them.' },
  position: { label: 'Fix a position', blurb: 'Pick a position. These trades upgrade your weakest starter there without giving up your other starters.' },
  rebuild: { label: 'Rebuild', blurb: 'Throw in the towel on this season: trades that turn your aging players into picks and players 24 or under while they still hold value.' },
  contend: { label: 'Go all-in', blurb: 'Win now: trades that spend picks, prospects, and bench players on starters for this season. Your starters stay put.' }
};
const Coach = { option: 'target', targetKey: null, pos: null, results: {}, busy: false, mine: { must: [], keep: [], never: [] }, theirs: { must: [], keep: [], never: [] }, picker: { open: false, q: '', pos: 'ALL' } };

const coachTick = () => new Promise(r => setTimeout(r, 0));
const coachMe = () => Vault.myTeam(teams) || teamOf('A');
const coachFairFirst = (x, y) => (x.edge >= VAULT_CONFIG.FAIR_PCT) - (y.edge >= VAULT_CONFIG.FAIR_PCT);

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
  Coach.mine.must.forEach(k => off.delete(k));
  return off;
}
const coachHasRules = side => Coach[side].must.length + Coach[side].keep.length + Coach[side].never.length > 0;
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
  return found.sort((x, y) => x.edge - y.edge).filter(o => {
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
async function coachUpgrades(me, positions, protect, progress, pay) {
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
      const o = coachOffers(me, t, [a], { protect, ceiling })[0];
      if (!o) continue;
      const gain = coachAfter(me.rosterId, t.rosterId, o.give, o.get).opt - me.opt;
      if (gain < COACH.MIN_GAIN) continue;
      out.push({ ...o, id: a.key, gain, why: `${Vault.escapeHtml(a.name)} starts for you: about +${gain.toFixed(1)} pts/week to your best lineup${pay ? `, ${pay}` : ''}.${o.note ? ' ' + o.note : ''}` });
    }
    return out;
  };
  const list = await coachPriced(run, 3);
  return list.sort((x, y) => coachFairFirst(x, y) || y.gain - x.gain).slice(0, COACH.SHOW);
}

async function coachPosition(me, progress) {
  const P = Coach.pos;
  const protect = new Set(me.lineup.filter(s => s.id && s.pos !== P).map(s => 'p_' + s.id));
  const list = await coachUpgrades(me, [P], protect, progress, '');
  if (!list.length) return { empty: `No upgrade at ${P} found: nobody who'd out-score your weakest ${P} starter by ${COACH.UPGRADE_BY}+ pts/week is gettable without giving up your other starters.` };
  return { title: `Upgrades at ${P}`, list };
}

async function coachContend(me, progress) {
  const protect = new Set(me.lineup.filter(s => s.id).map(s => 'p_' + s.id));
  const list = await coachUpgrades(me, ['QB', 'RB', 'WR', 'TE'], protect, progress, 'paid with picks, prospects, and bench players');
  if (!list.length) return { empty: 'No lineup upgrade found that your picks, prospects, and bench can pay for.' };
  return { title: 'Win-now trades', list };
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
    const offers = [];
    teams.filter(t => t !== me && coachPartnerOK(t)).forEach(t => {
      const tm = coachTheirMust(t), tmVal = sumValue(tm);
      const pool = t.assets.filter(a => young(a) && !coachTheirOff(a) && !tm.includes(a) && a.value >= v.value * 0.1 && a.value + tmVal <= v.value * 1.3).sort((x, y) => y.value - x.value).slice(0, 10);
      const packs = tm.length ? [[...tm]] : [];
      pool.forEach(a => packs.push([...tm, a]));
      pool.forEach((a, i) => pool.slice(i + 1).forEach(b => { const s = tmVal + a.value + b.value; if (s >= v.value * 0.6 && s <= v.value * 1.5) packs.push([...tm, a, b]); }));
      let best = null;
      packs.forEach(pack => {
        const j = negJudgeFor(me, [v], t, pack, negContextFor(t));
        if (j.accepts && j.edge < VAULT_CONFIG.FAIR_PCT && (!best || j.edge < best.edge)) best = { partner: t, give: [v], get: pack, edge: j.edge };
      });
      if (best) offers.push(best);
    });
    const age = Math.floor(v.age);
    const why = must.length
      ? (v.type === 'player' && COACH.SELL_AGE[v.pos] && age >= COACH.SELL_AGE[v.pos] ? `At ${age}, ${Vault.escapeHtml(v.name)} is ${age > COACH.SELL_AGE[v.pos] ? 'past' : 'at'} the age ${v.pos}s usually start losing value.` : '')
      : `At ${age}, ${Vault.escapeHtml(v.name)} is ${age > COACH.SELL_AGE[v.pos] ? 'past' : 'at'} the age ${v.pos}s usually start losing value.`;
    offers.sort((x, y) => x.edge - y.edge).slice(0, perPiece).forEach(o => list.push({ ...o, id: v.key + o.partner.rosterId, why }));
  }
  const names = must.map(a => Vault.escapeHtml(a.name)).join(', ');
  if (!list.length) return { empty: must.length ? `No team would give fair value in picks or young players for ${names} right now.` : 'No team would give fair value in picks or young players for your veterans right now.' };
  return { title: must.length ? `Offers for ${names}` : 'Rebuild trades', list: list.slice(0, must.length ? 12 : 6) };
}

const COACH_RUN = { target: coachTarget, position: coachPosition, rebuild: coachRebuild, contend: coachContend };

async function coachFind() {
  if (Coach.busy) return;
  if (Coach.option === 'target' && !Coach.targetKey) return coachOpenPicker();
  const me = coachMe(), option = Coach.option;
  Coach.busy = true;
  renderCoach();
  const status = document.getElementById('coachStatus');
  const progress = text => { if (status) status.textContent = text; };
  if (!Negotiation.styles) { progress('Reading every manager\'s trade history…'); await Promise.race([negPreloadStyles(), new Promise(r => setTimeout(r, 8000))]); }
  try {
    Coach.results[option] = { ...(await COACH_RUN[option](me, progress)), meId: me.rosterId, key: coachInputKey() };
  } catch (e) {
    console.error(e);
    Coach.results[option] = { empty: 'Something went wrong finding trades. Try again.' };
  }
  Coach.busy = false;
  renderCoach();
}

// Results belong to the inputs they were found for.
const coachInputKey = () => ({ target: Coach.targetKey, position: Coach.pos }[Coach.option] || '') + '|' + JSON.stringify([Coach.mine, Coach.theirs]);

/* ---------- Panel ---------- */

// The coach button toggles the panel. It opens on Negotiate when a trade is
// loaded (or already being negotiated), otherwise on the last option picked.
function openCoach(option) {
  const box = document.getElementById('coach');
  const wasOpen = !box.classList.contains('hidden');
  if (!option && wasOpen) return closeCoach();
  if (!option && (Negotiation.rounds.length || (selectedA.size && selectedB.size))) option = 'negotiate';
  if (option) Coach.option = option;
  box.classList.remove('hidden');
  if (!Coach.pos) Coach.pos = coachDefaultPos();
  if (!Coach.targetKey) { const b = [...selectedB]; if (b.length === 1 && b[0].startsWith('p_')) Coach.targetKey = b[0]; }
  negPreloadStyles();
  renderCoach();
  if (!wasOpen) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeCoach() { document.getElementById('coach').classList.add('hidden'); }
const coachOpen = () => !document.getElementById('coach').classList.contains('hidden');
function coachSync() {
  const neg = document.getElementById('negotiation');
  if (neg) neg.classList.toggle('hidden', !(Coach.option === 'negotiate' && Negotiation.rounds.length));
}
function coachReset() { Coach.results = {}; if (coachOpen()) renderCoach(); }
function coachSetOption(o) { Coach.option = o; renderCoach(); }
function coachSetPos(p) { Coach.pos = p; renderCoach(); }

function coachDefaultPos() {
  const { posPct, needs } = Vault.positionalProfile(coachMe(), teams);
  const order = Object.keys(posPct).sort((x, y) => posPct[x] - posPct[y]);
  return (order.find(p => needs.includes(p)) || order[0] || 'rb').toUpperCase();
}

// Load a suggestion into the calculator (your team as Team A).
function coachLoad(i) {
  const r = Coach.results[Coach.option], o = r && r.list[i];
  if (!o) return;
  const selA = document.getElementById('teamA'), selB = document.getElementById('teamB');
  if (selA.value !== String(r.meId)) { selA.value = String(r.meId); selA.onchange(); }
  if (selB.value !== String(o.partner.rosterId)) { selB.value = String(o.partner.rosterId); selB.onchange(); }
  negLoad(negKeys(o.give), negKeys(o.get));
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
function coachSideToggle(side, g) { const n = Coach[side].never; Coach[side].never = n.includes(g) ? n.filter(x => x !== g) : [...n, g]; renderCoach(); }
function coachSideClear(side) { Coach[side] = { must: [], keep: [], never: [] }; renderCoach(); }

function coachSideHtml(side, me) {
  const m = Coach[side], esc = Vault.escapeHtml, mine = side === 'mine';
  const others = teams.filter(x => x !== me);
  const find = k => (mine ? me.assets : others.flatMap(x => x.assets)).find(a => a.key === k);
  const owner = k => others.find(x => x.assets.some(a => a.key === k));
  const tag = (k, list) => {
    const a = find(k);
    if (!a) return '';
    const who = mine ? '' : ` <span class="opacity-60">· ${esc(owner(k).teamName)}</span>`;
    return `<span class="inline-flex items-center gap-0.5 text-[11px] pl-2 pr-0.5 py-0.5 rounded-md border ${list === 'must' ? 'border-emerald-500/30 text-emerald-200 bg-emerald-500/10' : 'border-rose-500/30 text-rose-200 bg-rose-500/10'}">${esc(a.name)}${who}<button onclick="coachSideRemove('${side}', '${list}', '${k}')" aria-label="Remove ${esc(a.name)}" class="px-1 text-zinc-400 hover:text-white">×</button></span>`;
  };
  const used = new Set([...m.must, ...m.keep]);
  const opt = a => `<option value="${a.key}">${esc(a.name)}${a.type === 'player' ? ` (${a.pos})` : ''} · ${Math.round(a.value).toLocaleString()}</option>`;
  const opts = mine
    ? me.assets.filter(a => !used.has(a.key)).map(opt).join('')
    : others.map(x => `<optgroup label="${esc(x.teamName)}">${x.assets.filter(a => !used.has(a.key) && a.value >= 300).map(opt).join('')}</optgroup>`).join('');
  const add = list => `<select onchange="coachSideAdd('${side}', '${list}', this.value)" aria-label="Add a player or pick" class="text-[11px] px-2 py-1 rounded-lg border border-white/10 text-zinc-400 bg-black/40 max-w-[170px]"><option value="">+ Add…</option>${opts}</select>`;
  const group = g => `<button onclick="coachSideToggle('${side}', '${g}')" class="text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${m.never.includes(g) ? 'bg-rose-500/10 border-rose-500/30 text-rose-200' : 'border-white/10 text-zinc-400 hover:text-white'}">${g === 'PICK' ? 'Picks' : g}</button>`;
  const row = (label, body) => `<div class="flex flex-wrap items-center gap-1.5"><span class="text-[11px] text-zinc-500 w-[96px] shrink-0">${label}</span>${body}</div>`;
  const labels = mine
    ? [Coach.option === 'rebuild' ? 'Sell these' : 'Must include', 'Don\'t trade', 'Never trade any']
    : ['Must get', 'Don\'t want', 'Never take any'];
  return `<div class="p-2.5 rounded-lg bg-black/30 border border-white/5 space-y-2 min-w-0">
      <div class="flex items-center justify-between gap-2"><span class="text-[11px] text-zinc-400 uppercase tracking-wider">${mine ? 'Your side' : 'Their side'}</span>${coachHasRules(side) ? `<button onclick="coachSideClear('${side}')" class="text-[11px] text-zinc-500 hover:text-white">Clear</button>` : ''}</div>
      ${row(labels[0], m.must.map(k => tag(k, 'must')).join('') + add('must'))}
      ${row(labels[1], m.keep.map(k => tag(k, 'keep')).join('') + add('keep'))}
      ${row(labels[2], ['QB', 'RB', 'WR', 'TE', 'PICK'].map(group).join(''))}
    </div>`;
}
function coachMineHtml(me) {
  return `<div class="grid gap-2 lg:grid-cols-2 mb-3">${coachSideHtml('mine', me)}${coachSideHtml('theirs', me)}</div>`;
}

/* ---------- Target picker ---------- */

function coachTargetOptions() {
  const me = coachMe();
  return teams.filter(t => t !== me).flatMap(t => t.assets.filter(a => a.type === 'player' && a.value >= 300).map(a => ({ key: a.key, value: a.value, name: a.name, pos: a.pos, team: t.teamName })))
    .sort((x, y) => y.value - x.value);
}
function coachPickTarget(key) { Coach.targetKey = key; Coach.picker.open = false; renderCoach(); coachFind(); }
function coachOpenPicker() { Coach.picker = { open: true, q: '', pos: 'ALL' }; renderCoach(); document.getElementById('coachTargetSearch')?.focus(); }
function coachClosePicker() { Coach.picker.open = false; renderCoach(); }
function coachPickerPos(p) { Coach.picker.pos = p; renderCoach(); }
function coachPickerSearch(q) { Coach.picker.q = q; renderCoachTargetList(); }
function renderCoachTargetList() {
  const el = document.getElementById('coachTargetList');
  if (!el) return;
  const q = Coach.picker.q.trim().toLowerCase(), pos = Coach.picker.pos;
  const hits = coachTargetOptions().filter(o => (pos === 'ALL' || o.pos === pos) && (!q || o.name.toLowerCase().includes(q) || o.team.toLowerCase().includes(q))).slice(0, 40);
  el.innerHTML = hits.length ? hits.map(o => `<button onclick="coachPickTarget('${o.key}')" class="w-full px-3 py-2 flex items-center justify-between gap-3 text-left hover:bg-violet-500/10 ${o.key === Coach.targetKey ? 'bg-violet-500/10' : ''}">
      <span class="min-w-0 truncate text-[12px] text-zinc-200">${Vault.escapeHtml(o.name)} <span class="text-zinc-500">${o.pos} · ${Vault.escapeHtml(o.team)}</span></span>
      <span class="mono text-[11px] text-zinc-400 shrink-0">${Math.round(o.value).toLocaleString()}</span>
    </button>`).join('') : '<div class="px-3 py-2 text-[12px] text-zinc-400">No players match.</div>';
}
function coachTargetHtml(chip) {
  const cur = coachTargetOptions().find(o => o.key === Coach.targetKey);
  if (!Coach.picker.open && cur) {
    return `<div class="flex items-center gap-2 min-w-0">
        <div class="min-w-0 px-3 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/[0.06] text-[13px] truncate">${Vault.escapeHtml(cur.name)} <span class="text-zinc-400">${cur.pos} · ${Vault.escapeHtml(cur.team)}</span></div>
        <button onclick="coachOpenPicker()" class="shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white">Change</button>
      </div>`;
  }
  return `<div class="w-full sm:w-[440px]">
      <div class="flex gap-2 mb-2">
        <input id="coachTargetSearch" type="text" autocomplete="off" placeholder="Search a player or team…" value="${Vault.escapeHtml(Coach.picker.q)}" oninput="coachPickerSearch(this.value)"
          class="flex-1 min-w-0 bg-black/40 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-violet-500/40" />
        ${cur ? '<button onclick="coachClosePicker()" class="shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-white">Cancel</button>' : ''}
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
  const chip = (on, label, onclick, extra = '') => `<button onclick="${onclick}" class="text-[12px] px-3 py-1.5 rounded-lg border transition-colors ${on ? 'bg-violet-500/15 border-violet-500/40 text-violet-200' : 'border-white/10 text-zinc-400 hover:text-white hover:border-white/20'}">${label}${extra}</button>`;
  head.innerHTML = `
    <div class="flex items-start justify-between gap-3 mb-3">
      <div>
        <div class="text-[11px] text-zinc-400 uppercase tracking-wider">Trade Coach <span class="normal-case tracking-normal text-zinc-500">· for ${Vault.escapeHtml(me.teamName)}</span></div>
        <div class="text-[12px] text-zinc-400 mt-1 max-w-[680px]">Every trade the coach suggests is one the other manager would likely take, and Fair for you unless it says otherwise. Responses are predicted from their roster, needs, timeline, and trade history, not the real managers.</div>
      </div>
      <button onclick="closeCoach()" class="shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-white hover:border-white/20">Close</button>
    </div>
    <div class="flex gap-1.5 flex-wrap mb-2">${Object.entries(COACH_OPTIONS).map(([o, d]) => chip(Coach.option === o, d.label, `coachSetOption('${o}')`)).join('')}</div>
    <div class="text-[12px] text-zinc-400 mb-3 max-w-[680px]">${COACH_OPTIONS[Coach.option].blurb}</div>`;
  coachSync();

  if (Coach.option === 'negotiate') { box.innerHTML = coachNegotiateHtml(); return; }
  const needs = Vault.positionalProfile(me, teams).needs;
  const input = {
    target: coachTargetHtml(chip),
    position: `<div class="flex gap-1.5 flex-wrap">${['QB', 'RB', 'WR', 'TE'].map(p => chip(Coach.pos === p, p, `coachSetPos('${p}')`, needs.includes(p.toLowerCase()) ? ' <span class="text-[10px] text-rose-300/80">need</span>' : '')).join('')}</div>`,
    rebuild: '', contend: ''
  }[Coach.option];
  const r = Coach.results[Coach.option], fresh = r && r.key === coachInputKey();
  box.innerHTML = `
    ${coachMineHtml(me)}
    <div class="flex flex-col sm:flex-row sm:items-start gap-2 mb-1">
      ${input}
      <button onclick="coachFind()" ${Coach.busy ? 'disabled' : ''} class="self-start shrink-0 text-[12px] px-4 py-1.5 rounded-lg btn-gold-solid ${Coach.busy ? 'opacity-60' : ''}">${fresh ? 'Search again' : 'Find trades'}</button>
    </div>
    <div id="coachStatus" class="text-[12px] text-zinc-400 min-h-[18px] ${Coach.busy ? '' : 'hidden'}">Searching…</div>
    ${Coach.busy || !fresh ? '' : coachResultsHtml(r)}`;
  renderCoachTargetList();
}

function coachResultsHtml(r) {
  if (!r.list || !r.list.length) return `<div class="mt-3 p-3 rounded-xl bg-black/30 text-[12px] text-zinc-300">${r.empty || 'No trades found.'}${coachHasMine() ? ' Your side or Their side rules out some pieces, so try loosening them.' : ''}</div>`;
  const over = r.list.some(o => o.edge >= VAULT_CONFIG.FAIR_PCT);
  return `
    <div class="mt-3 mb-2 flex items-baseline justify-between gap-3 flex-wrap">
      <div class="text-[15px] font-medium text-zinc-100">${r.title}</div>
      <div class="text-[11px] text-zinc-500">${r.list.length} option${r.list.length > 1 ? 's' : ''}, best for you first</div>
    </div>
    ${over ? '<div class="text-[12px] text-amber-300 mb-2">Some of these pay a premium: nobody would take a Fair offer for them. Those are marked Lopsided. Nothing here is Unfair.</div>' : ''}
    <div class="grid gap-2.5 md:grid-cols-2">${r.list.map((o, i) => {
      const lop = o.edge >= VAULT_CONFIG.FAIR_PCT;
      return `<div class="p-3 rounded-xl border ${lop ? 'border-amber-500/20' : 'border-white/5'} bg-black/30 flex flex-col">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <span class="text-[13px] text-zinc-100 font-medium">With ${Vault.escapeHtml(o.partner.teamName)}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded border ${lop ? 'border-amber-500/30 text-amber-300 bg-amber-500/10' : 'border-emerald-500/25 text-emerald-300 bg-emerald-500/10'}">${lop ? 'Lopsided for you' : 'Fair'}</span>
        </div>
        <div class="text-[13px] text-zinc-300">You give <span class="text-zinc-100 font-medium">${negNames(o.give)}</span> · you get <span class="text-zinc-100 font-medium">${negNames(o.get)}</span></div>
        ${o.why ? `<div class="text-[12px] text-zinc-400 mt-1">${o.why}</div>` : ''}
        <div class="text-[11px] text-zinc-400 mt-1">They'd likely accept. ${negLean(-o.edge)}</div>
        <div class="flex flex-wrap gap-2 mt-auto pt-2.5">
          <button onclick="coachLoad(${i})" class="text-[11px] px-3 py-1.5 rounded-lg btn-gold-solid">Load in calculator</button>
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
