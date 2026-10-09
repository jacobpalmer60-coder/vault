/* ============================================================
   RATE TRADES: a crowd check on trade value (user, 2026-10-08: "something
   similar to KTC", and "maybe we make that our login page, like KTC does").
   Used by rate.html (the full page) and index.html (one trade on the home
   page; window.RATE_MODE = 'home').

   Trades are made up from today's data, like KTC's own voting (user: "I dont
   even mind if the trades are wrong and outrageous and made up"): today's KTC
   values (data/ktc-values.json, the format's plain Superflex or 1QB price), each
   player's position, NFL team and age, and his points per game this season
   (data/weekly/<season>.json, PPR); picks by year, round and tier. Each side
   gets a timeline (Contending / Flexible / Rebuilding) as part of the question.
   Shapes lean toward star-for-pieces trades, where KTC's calculator and The
   Vault's trade value disagree most, mostly near even with the odd outrageous
   one. Everyone gets the same POOL_SIZE trades each day (seeded by the date),
   so votes pile up on the same trades. Vote: Team A won / Fair / Team B won.
   Then the reveal: KTC's calculator (Vault.ktcSideValues), The Vault's trade
   value (Vault.tradeSideValues) and the crowd, each called by the site's Fair
   cutoff (VAULT_CONFIG.FAIR_PCT).
   Votes go to Supabase (rate-config.js, supabase/rate-trades.sql): no login,
   one vote per trade per device, a random device id, nothing personal. The
   voter never leaves the page. Without it, votes stay on this device.
   ============================================================ */
(function () {
  const MODE = window.RATE_MODE || 'full';
  const POOL_SIZE = 40, MIN_VALUE = 800;
  // [pieces Team A, pieces Team B, weight %]: half are star-for-pieces.
  const SHAPES = [[1, 1, 25], [1, 2, 35], [2, 2, 15], [1, 3, 15], [2, 3, 10]];
  const TIMELINES = [['C', 40], ['F', 25], ['R', 35]];
  const DEVICE_KEY = 'vault_rate_device', VOTES_KEY = 'vault_rate_votes', FMT_KEY = 'vault_rate_fmt';
  const cfg = window.RATE_CONFIG || {};
  const shared = !!(cfg.supabaseUrl && cfg.anonKey);
  const $ = id => document.getElementById(id);
  const esc = s => Vault.escapeHtml(String(s ?? ''));
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const device = (() => { let d = store.get(DEVICE_KEY, null); if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); store.set(DEVICE_KEY, d); } return d; })();
  let fmt = store.get(FMT_KEY, 'sf') === 'oneQB' ? 'oneQB' : 'sf', pool = [], idx = 0, ktcData = null, weeklyData;
  const universe = {}, tallies = new Map(), skipped = new Set();
  const votes = store.get(VOTES_KEY, {}); // tradeId -> 1 | 0 | -1

  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const seeded = seed => () => { seed = Math.imul(seed ^ (seed >>> 15), 2246822507); seed = Math.imul(seed ^ (seed >>> 13), 3266489909); return ((seed ^= seed >>> 16) >>> 0) / 4294967296; };
  const tradeId = t => t.id;
  const badge = pos => `<span class="inline-flex items-center justify-center w-10 py-px rounded text-[11px] font-semibold border pos-badge-${['QB', 'RB', 'WR', 'TE'].includes(pos) ? pos : 'default'}">${esc(pos || '—')}</span>`;
  const TIMELINE = { C: ['Contending', 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10'], F: ['Flexible', 'text-zinc-300 border-white/15 bg-white/5'], R: ['Rebuilding', 'text-sky-300 border-sky-400/30 bg-sky-400/10'] };
  // % Team A is ahead under a side-value function, and the call by the Fair cutoff.
  const read = (fn, A, B) => { const r = fn(A, B), avg = (r.valueA + r.valueB) / 2 || 1; return (r.valueA - r.valueB) / avg * 100; };
  const call = pct => (Math.abs(pct) < VAULT_CONFIG.FAIR_PCT ? 0 : pct > 0 ? 1 : -1);
  const callText = c => ({ 1: 'Team A won', 0: 'Fair', '-1': 'Team B won' })[c];
  const pctText = pct => (Math.abs(pct) < 1 ? 'even' : `Team ${pct > 0 ? 'A' : 'B'} ${Math.abs(Math.round(pct))}% ahead`);
  const ktcRead = (A, B) => read((x, y) => Vault.ktcSideValues(x, y), A, B), tvRead = (A, B) => read((x, y) => Vault.tradeSideValues(x, y), A, B);
  const rateLink = () => { const id = Vault.getLeagueId && Vault.getLeagueId(); return id ? Vault.linkTo('rate.html', id) : 'rate.html'; };

  // ---------- Today's players and picks ----------
  // Points per game this season (PPR), by normalized name.
  function ppgByName(w) {
    const out = new Map();
    if (!w) return out;
    for (const p of Object.values(w.players)) {
      let tot = 0, gp = 0;
      for (const arr of Object.values(p.w)) {
        const off = arr.length - w.keys.length, s = {};
        w.keys.forEach((k, i) => { s[k] = arr[i + off]; });
        if (!s.gp) continue;
        gp++;
        tot += (s.rec || 0) + (s.rec_yd || 0) * 0.1 + (s.rec_td || 0) * 6 + (s.rush_yd || 0) * 0.1 + (s.rush_td || 0) * 6 + (s.pass_yd || 0) * 0.04 + (s.pass_td || 0) * 4 - (s.pass_int || 0) - (s.fum_lost || 0) * 2;
      }
      if (gp) out.set(Vault.normalizeName(p.n), { ppg: tot / gp, gp });
    }
    return out;
  }
  async function loadUniverse(f) {
    if (universe[f]) return universe[f];
    if (!ktcData) ktcData = await Vault.fetchKtcValues({ raw: true });
    if (weeklyData === undefined) {
      const season = new Date().getUTCMonth() >= 2 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
      weeklyData = await fetch(`data/weekly/${season}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    }
    const ppg = ppgByName(weeklyData), ROUND = ['', '1st', '2nd', '3rd', '4th'];
    const players = (ktcData.players || []).filter(p => ['QB', 'RB', 'WR', 'TE'].includes(p.pos) && p[f] >= MIN_VALUE)
      .map(p => { const g = ppg.get(Vault.normalizeName(p.name)); return { name: p.name, pos: p.pos, team: p.team || '', age: p.age ? Math.floor(p.age) : null, rookie: !!p.rookie, ppg: g ? g.ppg : null, gp: g ? g.gp : 0, value: p[f], type: 'player' }; });
    const picks = (ktcData.picks || []).filter(p => p.round <= 2 && p[f] > 0)
      .map(p => ({ name: `${p.season} ${ROUND[p.round]} (${p.slot})`, pos: 'PICK', value: p[f], type: 'pick' }));
    return (universe[f] = { players, picks });
  }
  // Today's trades: the same for everyone (seeded by the date and format).
  function buildPool(u) {
    const day = new Date().toISOString().slice(0, 10), rnd = seeded(parseInt(hash(day + fmt), 36));
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const weighted = list => { let r = rnd() * list.reduce((s, x) => s + x[x.length - 1], 0); return list.find(x => (r -= x[x.length - 1]) < 0) || list[0]; };
    const all = [...u.players, ...u.picks];
    const near = (target, used, lo, hi, below = Infinity) => { const c = all.filter(p => !used.has(p.name) && p.value < below && p.value >= target * lo && p.value <= target * hi); return c.length ? pick(c) : null; };
    const leads = u.players.filter(p => p.value >= 2500);
    const out = [], seen = new Set();
    for (let guard = 0; out.length < POOL_SIZE && guard < 3000; guard++) {
      const [na, nb] = weighted(SHAPES), used = new Set();
      const lead = pick(nb > na ? leads.filter(p => p.value >= 4000) : leads);
      used.add(lead.name);
      const A = [lead];
      for (let i = 1; i < na; i++) { const p = near(lead.value * (0.3 + rnd() * 0.45), used, 0.85, 1.15, lead.value); if (!p) break; used.add(p.name); A.push(p); }
      if (A.length < na) continue;
      // Aim Team B at a target (midway between KTC's calculator and trade value): mostly within 18% either way, so
      // the trade is a real decision (that's where KTC's calculator and The Vault
      // part ways), and 15% of the time wild, up to 50%. Of 60 tries, keep the
      // closest.
      const goal = (rnd() * 2 - 1) * (rnd() < 0.15 ? 50 : 18), totalA = A.reduce((s, p) => s + p.value, 0);
      let best = null;
      for (let k = 0; k < 60; k++) {
        const tried = new Set(used), B = [];
        let left = totalA * (nb === na ? 0.65 + rnd() * 0.7 : 0.85 + rnd() * 1.0);
        for (let i = 0; i < nb; i++) {
          const share = i === nb - 1 ? left : left * (nb - i === 2 ? 0.4 + rnd() * 0.25 : 0.3 + rnd() * 0.15);
          const p = near(share, tried, 0.85, 1.15, nb > na ? lead.value : Infinity);
          if (!p) break;
          tried.add(p.name); B.push(p); left -= p.value;
        }
        if (B.length < nb) continue;
        const e = (tvRead(A, B) + ktcRead(A, B)) / 2; // midway between the two, so neither method is favored by how trades are built
        if (!best || Math.abs(e - goal) < Math.abs(best.e - goal)) best = { B, e };
      }
      if (!best) continue;
      const B = best.B;
      const key = [A.map(p => p.name).sort().join(','), B.map(p => p.name).sort().join(',')].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const flip = rnd() < 0.5, tl = weighted(TIMELINES)[0] + weighted(TIMELINES)[0];
      out.push({ A: flip ? B : A, B: flip ? A : B, tl, id: `${fmt}-${day}-${hash(key)}` });
    }
    return out;
  }

  // ---------- Shared votes (Supabase REST) ----------
  const sb = (p, body, extra = {}) => fetch(`${cfg.supabaseUrl.replace(/\/$/, '')}/rest/v1/${p}`, { method: 'POST', headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  async function sendVote(id, vote) {
    if (!shared) return true;
    try { const r = await sb('trade_votes', { trade_id: id, fmt, vote, device }, { Prefer: 'return=minimal' }); return r.ok || r.status === 409; } catch { return false; }
  }
  async function loadTallies(ids) {
    if (!shared || !ids.length) return;
    try {
      const r = await sb('rpc/vote_tally', { ids });
      if (!r.ok) return;
      for (const row of await r.json()) tallies.set(row.trade_id, { a: +row.a, fair: +row.fair, b: +row.b });
    } catch {}
  }

  // ---------- Drawing ----------
  const sides = t => ({ A: t.A, B: t.B });
  // One piece: position, name, then NFL team, age, points per game this season and KTC value today.
  const pieceHtml = p => `<div class="flex items-start gap-2 py-1.5 border-t border-white/[0.06] first:border-t-0">${badge(p.pos)}<span class="min-w-0"><span class="block text-[14px] text-zinc-100 truncate">${esc(p.name)}</span>
      <span class="block text-[11px] text-zinc-400 mono">${p.type === 'pick' ? '' : [p.team, p.age ? `age ${p.age}` : '', p.rookie ? 'rookie' : '', p.ppg != null ? `${p.ppg.toFixed(1)} PPG` : ''].filter(Boolean).join(' · ') + ' · '}KTC ${Math.round(p.value).toLocaleString()}</span></span></div>`;
  const sideHtml = (label, list, tl) => { const [name, cls] = TIMELINE[tl] || TIMELINE.F; return `<div class="min-w-0"><div class="flex items-center justify-between gap-2 mb-1.5"><span class="text-[11px] uppercase tracking-wider text-zinc-500">${label} gets</span><span class="text-[11px] px-1.5 py-px rounded border ${cls}" title="This team's situation: part of the question">${name}</span></div>
    ${list.map(pieceHtml).join('')}</div>`; };
  const leagueLine = () => `${fmt === 'sf' ? 'Superflex' : '1QB'} · today's KTC values · this season's PPG (PPR)`;
  const open = () => pool.findIndex((t, i) => i >= idx && votes[tradeId(t)] == null && !skipped.has(tradeId(t)));
  function render() {
    const card = $('rateCard');
    if (!card) return;
    const done = pool.filter(t => votes[tradeId(t)] != null).length;
    if ($('rateStatus')) $('rateStatus').textContent = `${done} of ${pool.length} rated today · ${fmt === 'sf' ? 'Superflex' : '1QB'}`;
    renderRecord();
    const head = MODE === 'home' ? `<div class="flex items-baseline justify-between gap-2 mb-3"><span class="text-[15px] font-semibold text-zinc-100">Who wins this trade?</span><a href="${rateLink()}" class="text-[12px] text-zinc-400 hover:text-white">Rate more →</a></div>` : '';
    if (idx < 0 || idx >= pool.length) {
      card.innerHTML = head + (MODE === 'home'
        ? `<div class="text-[13px] text-zinc-400">You've rated today's trades. <a href="${rateLink()}" class="text-zinc-200 underline underline-offset-2 decoration-white/20">See how you compare</a>.</div>`
        : `<div class="text-[15px] text-zinc-100 font-medium">That's today's ${pool.length} trades.</div><div class="text-[13px] text-zinc-400 mt-1">New trades tomorrow. Your record and the crowd's are below.</div>`);
      return;
    }
    const t = pool[idx], id = tradeId(t), mine = votes[id];
    const btn = (v, text) => `<button onclick="RateTrades.vote(${v})" class="flex-1 px-2 py-3 rounded-xl border text-[14px] font-medium transition-colors ${mine === v ? 'border-amber-400/60 bg-amber-400/10 text-amber-100' : 'border-white/10 hover:bg-white/[0.05] text-zinc-100'}" ${mine != null ? 'disabled' : ''}>${text}</button>`;
    card.innerHTML = `${head}<div class="flex items-center justify-between gap-2 mb-3">${MODE === 'home' ? '' : `<span class="text-[12px] text-zinc-400">Trade ${idx + 1} of ${pool.length}</span>`}<span class="text-[11px] text-zinc-500">${esc(leagueLine())}</span></div>
      <div class="grid grid-cols-2 gap-4 text-left">${sideHtml('Team A', t.A, t.tl[0])}${sideHtml('Team B', t.B, t.tl[1])}</div>
      <div class="flex gap-2 mt-5">${btn(1, 'Team A wins')}${btn(0, 'Fair')}${btn(-1, 'Team B wins')}</div>
      ${mine == null && MODE === 'home' ? `<div class="flex justify-end mt-2"><button onclick="RateTrades.skip()" class="text-[12px] text-zinc-500 hover:text-zinc-300">Skip</button></div>` : ''}
      <div class="mt-4 text-left">${mine != null ? revealHtml(t, t.A, t.B, mine) : ''}</div>`;
  }
  function revealHtml(t, A, B, mine) {
    const ktc = ktcRead(A, B), tv = tvRead(A, B);
    const c = tallies.get(tradeId(t)), n = c ? c.a + c.fair + c.b : 0;
    const crowd = n ? `<span class="mono">${Math.round(100 * c.a / n)}% / ${Math.round(100 * c.fair / n)}% / ${Math.round(100 * c.b / n)}%</span> <span class="text-zinc-500">(A / fair / B, ${n} vote${n === 1 ? '' : 's'})</span>` : `<span class="text-zinc-500">${shared ? 'You\'re the first vote on this one.' : 'Shared votes aren\'t connected yet.'}</span>`;
    const row = (label, pct) => `<div class="flex items-baseline justify-between gap-3 py-1.5 border-t border-white/[0.06] first:border-t-0"><span class="text-[13px] text-zinc-300">${label}</span><span class="text-[13px] text-right"><span class="font-medium ${call(pct) === mine ? 'text-emerald-300' : 'text-zinc-100'}">${callText(call(pct))}</span> <span class="text-zinc-500">· ${pctText(pct)}</span></span></div>`;
    return `<div class="rounded-xl bg-black/25 border border-white/5 p-4">
        <div class="text-[12px] text-zinc-400 mb-1">You said <span class="text-zinc-100 font-medium">${callText(mine)}</span>.</div>
        ${row("KTC's calculator", ktc)}${row('The Vault (trade value)', tv)}
        <div class="flex items-baseline justify-between gap-3 py-1.5 border-t border-white/[0.06]"><span class="text-[13px] text-zinc-300">Everyone</span><span class="text-[13px] text-right">${crowd}</span></div>
        <div class="text-[11px] text-zinc-500 mt-2">On value alone; within ${VAULT_CONFIG.FAIR_PCT}% reads as Fair. Green: agrees with you.</div>
      </div>
      <div class="flex justify-end gap-2 mt-3">${MODE === 'home' ? `<a href="${rateLink()}" class="px-4 py-2 rounded-lg btn-gold text-[13px]">Rate more</a>` : ''}<button onclick="RateTrades.next()" class="px-4 py-2 rounded-lg btn-gold text-[13px]">Next trade →</button></div>`;
  }
  function renderRecord() {
    const box = $('rateRecord');
    if (!box) return;
    const done = pool.filter(t => votes[tradeId(t)] != null);
    if (!done.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    let ktcMe = 0, tvMe = 0, cn = 0, ktcCrowd = 0, tvCrowd = 0;
    for (const t of done) {
      const mine = votes[tradeId(t)];
      const k = call(ktcRead(t.A, t.B)), v = call(tvRead(t.A, t.B));
      if (k === mine) ktcMe++;
      if (v === mine) tvMe++;
      const c = tallies.get(tradeId(t)), n = c ? c.a + c.fair + c.b : 0;
      if (n >= 5) { const crowd = c.a >= c.fair && c.a >= c.b ? 1 : c.b >= c.fair ? -1 : 0; cn++; if (k === crowd) ktcCrowd++; if (v === crowd) tvCrowd++; }
    }
    const pc = (x, n) => `${Math.round(100 * x / n)}%`;
    const tile = (label, x) => `<div class="rounded-xl bg-black/25 border border-white/5 p-3"><div class="text-zinc-400 text-[12px]">${label}</div><div class="num text-[26px] text-zinc-100">${pc(x, done.length)}</div><div class="text-zinc-500 text-[11px]">of your ${done.length} vote${done.length === 1 ? '' : 's'}</div></div>`;
    box.innerHTML = `<div class="text-[15px] font-semibold text-zinc-100 mb-2">Who agrees with you?</div>
      <div class="grid grid-cols-2 gap-3 text-[13px]">${tile("KTC's calculator", ktcMe)}${tile('The Vault', tvMe)}</div>
      ${cn ? `<div class="text-[12px] text-zinc-400 mt-3">On the ${cn} trade${cn === 1 ? '' : 's'} you rated with 5+ votes, the crowd's pick matched KTC ${pc(ktcCrowd, cn)} of the time and The Vault ${pc(tvCrowd, cn)}.</div>` : ''}`;
  }

  // ---------- Actions ----------
  async function vote(v) {
    const t = pool[idx];
    if (!t) return;
    const id = tradeId(t);
    if (votes[id] != null) return;
    votes[id] = v;
    store.set(VOTES_KEY, votes);
    const ok = await sendVote(id, v);
    if (shared && ok) await loadTallies([id]);
    if (shared && !ok && $('rateNote')) $('rateNote').textContent = 'Your vote couldn\'t be sent just now; it\'s saved on this device.';
    render();
  }
  function next() { idx++; idx = open(); render(); }
  function skip() { if (pool[idx]) skipped.add(tradeId(pool[idx])); next(); }
  async function setFormat(f) {
    fmt = f; store.set(FMT_KEY, f);
    renderToggle();
    try {
      pool = buildPool(await loadUniverse(f));
      idx = 0; idx = open();
      await loadTallies(pool.map(tradeId));
      render();
    } catch (e) {
      console.error(e);
      if ($('rateStatus')) $('rateStatus').textContent = 'Couldn\'t load trades. Try again in a minute.';
      else if ($('rateCard')) $('rateCard').classList.add('hidden');
    }
  }
  function renderToggle() {
    const el = $('rateFmt');
    if (!el) return;
    const b = (f, label) => `<button onclick="RateTrades.setFormat('${f}')" class="px-3 py-1.5 text-[13px] rounded-lg ${fmt === f ? 'bg-white/[0.08] text-white font-medium' : 'text-zinc-400 hover:bg-white/5'}">${label}</button>`;
    el.innerHTML = b('sf', 'Superflex') + b('oneQB', '1QB');
  }
  window.RateTrades = { vote, next, skip, setFormat, today: () => pool };
  if ($('rateNote')) $('rateNote').textContent = shared ? 'Votes are anonymous: a random id for this browser, no account, nothing personal.' : 'Shared votes aren\'t connected yet, so for now your votes are saved on this device only.';
  setFormat(fmt);
})();
