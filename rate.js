/* ============================================================
   RATE TRADES: a crowd check on trade value (user, 2026-10-08: "something
   similar to KTC", and "maybe we make that our login page, like KTC does").
   Used by rate.html (the full page) and index.html (one trade on the home
   page; window.RATE_MODE = 'home').

   Trades: the crawl's recent completed Sleeper trades (data/market-history/
   recent-<sf|oneQB>.json: pieces, each priced by KTC in its league's format on
   the day), shown without numbers so nobody anchors. Everyone gets the same
   POOL_SIZE trades each day (shuffled by the date), so votes pile up on the
   same trades. Vote: Team A won / Fair / Team B won. Then the reveal: KTC's
   calculator (Vault.ktcSideValues), The Vault's trade value
   (Vault.tradeSideValues) and the crowd, each called by the site's Fair cutoff
   (VAULT_CONFIG.FAIR_PCT).
   Votes go to Supabase (rate-config.js, supabase/rate-trades.sql): no login,
   one vote per trade per device, a random device id, nothing personal. The
   voter never leaves the page. Without it, votes stay on this device.
   ============================================================ */
(function () {
  const MODE = window.RATE_MODE || 'full';
  const POOL_SIZE = 40, MIN_TOP = 2500, MAX_PIECES = 4;
  const DEVICE_KEY = 'vault_rate_device', VOTES_KEY = 'vault_rate_votes', FMT_KEY = 'vault_rate_fmt';
  const cfg = window.RATE_CONFIG || {};
  const shared = !!(cfg.supabaseUrl && cfg.anonKey);
  const $ = id => document.getElementById(id);
  const esc = s => Vault.escapeHtml(String(s ?? ''));
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const device = (() => { let d = store.get(DEVICE_KEY, null); if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); store.set(DEVICE_KEY, d); } return d; })();
  let fmt = store.get(FMT_KEY, 'sf') === 'oneQB' ? 'oneQB' : 'sf', data = {}, pool = [], idx = 0;
  const tallies = new Map(), skipped = new Set();
  const votes = store.get(VOTES_KEY, {}); // tradeId -> 1 | 0 | -1

  // Stable id for a trade: its date and pieces.
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const tradeId = t => `${fmt}-${hash(`${t[0]}|${t[1].map(p => p[0]).sort().join(',')}|${t[2].map(p => p[0]).sort().join(',')}`)}`;
  // Same order for everyone on a given day.
  const seeded = seed => () => { seed = Math.imul(seed ^ (seed >>> 15), 2246822507); seed = Math.imul(seed ^ (seed >>> 13), 3266489909); return ((seed ^= seed >>> 16) >>> 0) / 4294967296; };
  const ROUND = ['', '1st', '2nd', '3rd', '4th', '5th'];
  const piece = ([id, value], names) => {
    if (id[0] === 'p') { const [season, round] = id.slice(1).split('-'); return { name: `${season} ${ROUND[+round] || 'round ' + round} round pick`, pos: 'PICK', value, type: 'pick' }; }
    const n = names[id] || [`Player ${id}`, ''];
    return { name: n[0], pos: n[1] || '', value, type: 'player' };
  };
  const badge = pos => `<span class="inline-flex items-center justify-center w-10 py-px rounded text-[11px] font-semibold border pos-badge-${['QB', 'RB', 'WR', 'TE'].includes(pos) ? pos : 'default'}">${esc(pos || '—')}</span>`;
  // % Team A is ahead under a side-value function, and the call by the Fair cutoff.
  const read = (fn, A, B) => { const r = fn(A, B), avg = (r.valueA + r.valueB) / 2 || 1; return (r.valueA - r.valueB) / avg * 100; };
  const call = pct => (Math.abs(pct) < VAULT_CONFIG.FAIR_PCT ? 0 : pct > 0 ? 1 : -1);
  const callText = c => ({ 1: 'Team A won', 0: 'Fair', '-1': 'Team B won' })[c];
  const pctText = pct => (Math.abs(pct) < 1 ? 'even' : `Team ${pct > 0 ? 'A' : 'B'} ${Math.abs(Math.round(pct))}% ahead`);
  const ktcRead = (A, B) => read((x, y) => Vault.ktcSideValues(x, y), A, B), tvRead = (A, B) => read((x, y) => Vault.tradeSideValues(x, y), A, B);
  const rateLink = () => { const id = Vault.getLeagueId && Vault.getLeagueId(); return id ? Vault.linkTo('rate.html', id) : 'rate.html'; };

  async function loadFormat(f) {
    if (data[f]) return data[f];
    const r = await fetch(`data/market-history/recent-${f}.json`);
    if (!r.ok) throw new Error('trades ' + r.status);
    return (data[f] = await r.json());
  }
  function buildPool(d) {
    const seen = new Set(), ok = [];
    for (const t of d.trades) {
      const [, a, b] = t;
      if (!a.length || !b.length || a.length > MAX_PIECES || b.length > MAX_PIECES) continue;
      if ([...a, ...b].some(p => !(p[1] > 0) || /^p\d+-[5-9]/.test(p[0]))) continue;
      if (Math.max(...a.map(p => p[1]), ...b.map(p => p[1])) < MIN_TOP) continue;
      const key = [a.map(p => p[0]).sort().join(','), b.map(p => p[0]).sort().join(',')].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      ok.push(t);
    }
    const day = new Date().toISOString().slice(0, 10), rnd = seeded(parseInt(hash(day + fmt), 36));
    for (let i = ok.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ok[i], ok[j]] = [ok[j], ok[i]]; }
    return ok.slice(0, POOL_SIZE);
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
  const sides = t => { const names = data[fmt].names; return { A: t[1].map(p => piece(p, names)), B: t[2].map(p => piece(p, names)) }; };
  const sideHtml = (label, list) => `<div class="min-w-0"><div class="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">${label} gets</div>
    ${list.map(p => `<div class="flex items-center gap-2 py-1.5 border-t border-white/[0.06] first:border-t-0">${badge(p.pos)}<span class="text-[14px] text-zinc-100 truncate">${esc(p.name)}</span></div>`).join('')}</div>`;
  function leagueLine(t) {
    const [rec, tep, teams] = t[3] || [];
    const ppr = rec === 1 ? 'PPR' : rec === 0.5 ? 'half PPR' : rec === 0 ? 'standard' : `${rec} PPR`;
    return [teams ? `${teams}-team` : '', fmt === 'sf' ? 'Superflex' : '1QB', ppr, tep >= 0.75 ? 'TE++' : tep >= 0.25 ? 'TE+' : ''].filter(Boolean).join(' · ') + ` · ${t[0]}`;
  }
  const open = () => pool.findIndex((t, i) => i >= idx && votes[tradeId(t)] == null && !skipped.has(tradeId(t)));
  function render() {
    const card = $('rateCard');
    if (!card) return;
    const done = pool.filter(t => votes[tradeId(t)] != null).length;
    if ($('rateStatus')) $('rateStatus').textContent = `${done} of ${pool.length} rated today · ${fmt === 'sf' ? 'Superflex' : '1QB'} trades`;
    renderRecord();
    const head = MODE === 'home' ? `<div class="flex items-baseline justify-between gap-2 mb-3"><span class="text-[15px] font-semibold text-zinc-100">Who won this trade?</span><a href="${rateLink()}" class="text-[12px] text-zinc-400 hover:text-white">Rate more →</a></div>` : '';
    if (idx < 0 || idx >= pool.length) {
      card.innerHTML = head + (MODE === 'home'
        ? `<div class="text-[13px] text-zinc-400">You've rated today's trades. <a href="${rateLink()}" class="text-zinc-200 underline underline-offset-2 decoration-white/20">See how you compare</a>.</div>`
        : `<div class="text-[15px] text-zinc-100 font-medium">That's today's ${pool.length} trades.</div><div class="text-[13px] text-zinc-400 mt-1">New trades tomorrow. Your record and the crowd's are below.</div>`);
      return;
    }
    const t = pool[idx], id = tradeId(t), { A, B } = sides(t), mine = votes[id];
    const btn = (v, text) => `<button onclick="RateTrades.vote(${v})" class="flex-1 px-2 py-3 rounded-xl border text-[14px] font-medium transition-colors ${mine === v ? 'border-amber-400/60 bg-amber-400/10 text-amber-100' : 'border-white/10 hover:bg-white/[0.05] text-zinc-100'}" ${mine != null ? 'disabled' : ''}>${text}</button>`;
    card.innerHTML = `${head}<div class="flex items-center justify-between gap-2 mb-3">${MODE === 'home' ? '' : `<span class="text-[12px] text-zinc-400">Trade ${idx + 1} of ${pool.length}</span>`}<span class="text-[11px] text-zinc-500">${esc(leagueLine(t))}</span></div>
      <div class="grid grid-cols-2 gap-4 text-left">${sideHtml('Team A', A)}${sideHtml('Team B', B)}</div>
      <div class="flex gap-2 mt-5">${btn(1, 'Team A won')}${btn(0, 'Fair')}${btn(-1, 'Team B won')}</div>
      ${mine == null && MODE === 'home' ? `<div class="flex justify-end mt-2"><button onclick="RateTrades.skip()" class="text-[12px] text-zinc-500 hover:text-zinc-300">Skip</button></div>` : ''}
      <div class="mt-4 text-left">${mine != null ? revealHtml(t, A, B, mine) : ''}</div>`;
  }
  function revealHtml(t, A, B, mine) {
    const ktc = ktcRead(A, B), tv = tvRead(A, B);
    const c = tallies.get(tradeId(t)), n = c ? c.a + c.fair + c.b : 0;
    const crowd = n ? `<span class="mono">${Math.round(100 * c.a / n)}% / ${Math.round(100 * c.fair / n)}% / ${Math.round(100 * c.b / n)}%</span> <span class="text-zinc-500">(A won / fair / B won, ${n} vote${n === 1 ? '' : 's'})</span>` : `<span class="text-zinc-500">${shared ? 'You\'re the first vote on this one.' : 'Shared votes aren\'t connected yet.'}</span>`;
    const row = (label, pct) => `<div class="flex items-baseline justify-between gap-3 py-1.5 border-t border-white/[0.06] first:border-t-0"><span class="text-[13px] text-zinc-300">${label}</span><span class="text-[13px] text-right"><span class="font-medium ${call(pct) === mine ? 'text-emerald-300' : 'text-zinc-100'}">${callText(call(pct))}</span> <span class="text-zinc-500">· ${pctText(pct)}</span></span></div>`;
    return `<div class="rounded-xl bg-black/25 border border-white/5 p-4">
        <div class="text-[12px] text-zinc-400 mb-1">You said <span class="text-zinc-100 font-medium">${callText(mine)}</span>.</div>
        ${row("KTC's calculator", ktc)}${row('The Vault (trade value)', tv)}
        <div class="flex items-baseline justify-between gap-3 py-1.5 border-t border-white/[0.06]"><span class="text-[13px] text-zinc-300">Everyone</span><span class="text-[13px] text-right">${crowd}</span></div>
        <div class="text-[11px] text-zinc-500 mt-2">Within ${VAULT_CONFIG.FAIR_PCT}% reads as Fair. Green: agrees with you.</div>
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
      const { A, B } = sides(t), mine = votes[tradeId(t)];
      const k = call(ktcRead(A, B)), v = call(tvRead(A, B));
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
      pool = buildPool(await loadFormat(f));
      idx = 0; idx = open();
      await loadTallies(pool.map(tradeId));
      render();
    } catch (e) {
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
  window.RateTrades = { vote, next, skip, setFormat };
  if ($('rateNote')) $('rateNote').textContent = shared ? 'Votes are anonymous: a random id for this browser, no account, nothing personal.' : 'Shared votes aren\'t connected yet, so for now your votes are saved on this device only.';
  setFormat(fmt);
})();
