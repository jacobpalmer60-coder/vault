/* ============================================================
   VAULT CORE
   Shared config + data pipeline for all Vault pages.
   Depends on PapaParse being loaded on the page.
   ============================================================ */
const VAULT_CONFIG = {
  DEFAULT_LEAGUE_ID: '1313454100225990656',
  VALUES_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRqxhqyuKK6vu_EoYta5FZ_KdOB8M54Q_qBwJKOUF5KcgbTt2dmHn_FuLj9d-FS8-ta5T0zkU0QEGcN/pub?gid=4113168&single=true&output=csv',
  PPG_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRqxhqyuKK6vu_EoYta5FZ_KdOB8M54Q_qBwJKOUF5KcgbTt2dmHn_FuLj9d-FS8-ta5T0zkU0QEGcN/pub?gid=118408869&single=true&output=csv',
  PICKS_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRqxhqyuKK6vu_EoYta5FZ_KdOB8M54Q_qBwJKOUF5KcgbTt2dmHn_FuLj9d-FS8-ta5T0zkU0QEGcN/pub?gid=972793131&single=true&output=csv',
  PICK_YEARS: [2027, 2028, 2029],
  PICK_ROUNDS: [1, 2, 3, 4]
};

/* ---------- League ID handling (shared across every page) ---------- */
const Vault = {
  getLeagueId() {
    const fromUrl = new URLSearchParams(location.search).get('league_id');
    if (fromUrl) {
      localStorage.setItem('vault_league_id', fromUrl);
      return fromUrl;
    }
    return localStorage.getItem('vault_league_id') || VAULT_CONFIG.DEFAULT_LEAGUE_ID;
  },
  setLeagueId(id) {
    localStorage.setItem('vault_league_id', id);
  },
  linkTo(page, id) {
    const lid = id || Vault.getLeagueId();
    return `${page}?league_id=${encodeURIComponent(lid)}`;
  },

  /* ---------- formatting / string helpers ---------- */
  norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); },
  normalizeName(s) {
    if (!s) return '';
    return s.toString().toLowerCase()
      .replace(/\./g, '')
      .replace(/'/g, '')
      .replace(/ jr$| sr$| ii$| iii$| iv$| v$/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  },
  clean(v) { return parseFloat(String(v || '').replace(/,/g, '')) || 0; },
  fmtInt(n) { return Number.isFinite(n) ? Math.round(n).toLocaleString() : '—'; },
  fmtFloat(n, d = 2) { return Number.isFinite(n) ? n.toFixed(d) : '—'; },
  escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));
  },

  /* ---------- CSV fetching ---------- */
  async fetchCsvRows(url) {
    const text = await fetch(url).then(r => r.text());
    return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
  },

  /* ---------- Sleeper API ---------- */
  async fetchSleeperCore(leagueId) {
    const [league, users, rosters, players, traded] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${leagueId}`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/players/nfl`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`).then(r => r.json())
    ]);
    if (!league || league.error) throw new Error('League not found. Double-check the league ID.');
    return { league, users, rosters, players, traded };
  },

  async fetchValueSheets() {
    const [values, ppgs, pickVals] = await Promise.all([
      Vault.fetchCsvRows(VAULT_CONFIG.VALUES_URL),
      Vault.fetchCsvRows(VAULT_CONFIG.PPG_URL),
      Vault.fetchCsvRows(VAULT_CONFIG.PICKS_URL)
    ]);
    return { values, ppgs, pickVals };
  },

  buildValueMaps({ values, ppgs, pickVals, isSF }) {
    const valMap = new Map();
    values.forEach(r => {
      const sid = String(r.sleeper_id || '').trim();
      if (sid) valMap.set(sid, Vault.clean(isSF ? r.val_sf_ppr_tep05 : r.val_1qb_ppr_tep05));
    });
    const ppgMap = new Map();
    ppgs.forEach(r => {
      const n = r.Player || r.player || '';
      if (n) ppgMap.set(Vault.norm(n), parseFloat(r['Avg_PPR_0.5_TEP']) || 0);
    });
    const pickMap = new Map();
    pickVals.forEach(r => {
      if (r.season) {
        pickMap.set(
          `${r.season}-${r.round}-${(r.slot || 'mid').toLowerCase()}`,
          Vault.clean(isSF ? r.sf_value : r.qb_value)
        );
      }
    });
    return { valMap, ppgMap, pickMap };
  },

  /* ---------- Archetype classifier (shared by app.html + team-analyzer.html) ---------- */
  archetype(t) {
    const { valP, ppgP, age, bal } = t;
    if (valP >= 75 && ppgP >= 75 && age >= 24 && age <= 27.5) return ['Elite Contender', 'from-amber-500/20 to-yellow-500/20 text-amber-200 border-amber-600/40'];
    if (ppgP >= 70 && age >= 27.5) return ['Aging Contender', 'from-orange-500/20 to-amber-600/20 text-orange-200 border-orange-600/40'];
    if (ppgP >= 60 && ppgP < 75 && age >= 26) return ['Win-Now Fringe', 'from-amber-600/20 to-yellow-700/20 text-amber-300 border-amber-700/40'];
    if (age < 25.5 && valP >= 45 && ppgP >= 40 && ppgP < 65) return ['Young Riser', 'from-emerald-600/20 to-teal-600/20 text-emerald-200 border-emerald-600/40'];
    if (ppgP < 40 && age < 26 && valP >= 35) return ['Pick-Rich Rebuilder', 'from-sky-600/20 to-cyan-600/20 text-sky-200 border-sky-600/40'];
    if (bal >= 70) return ['Balanced Core', 'from-zinc-600/20 to-neutral-600/20 text-zinc-200 border-zinc-600/40'];
    if (valP >= 70 && ppgP <= 45) return ['Volatile', 'from-rose-600/20 to-red-600/20 text-rose-200 border-rose-600/40'];
    if (valP <= 25 && ppgP <= 25) return ['Stripped Rebuilder', 'from-stone-700/30 to-stone-800/30 text-stone-300 border-stone-700/40'];
    return ['Stuck Middle', 'from-zinc-700/20 to-zinc-800/20 text-zinc-300 border-zinc-700/40'];
  },

  /* ---------- Full league team-building pipeline ----------
     Single source of truth used by app.html (League Overview) and
     team-analyzer.html (Team Analyzer). Previously each page had its
     own copy of this logic and they had drifted out of sync — most
     notably team-analyzer.html was valuing every rookie pick as
     "mid" tier instead of ranking tiers by standings like app.html did.
     Fixing that drift was the main reason to centralize this. */
  async buildLeagueTeams(leagueId) {
    const { league, users, rosters, players, traded } = await Vault.fetchSleeperCore(leagueId);
    const { values, ppgs, pickVals } = await Vault.fetchValueSheets();
    const isSF = (league.roster_positions || []).includes('SUPER_FLEX');
    const { valMap, ppgMap, pickMap } = Vault.buildValueMaps({ values, ppgs, pickVals, isSF });

    const userMap = new Map(users.map(u => [u.user_id, u]));
    const slots = (league.roster_positions || []).filter(s => !['BN', 'IR', 'TAXI'].includes(s));

    const optimal = plist => {
      const pool = [...plist].sort((a, b) => b.ppg - a.ppg);
      const used = new Set();
      let tot = 0;
      for (const slot of slots) {
        let allowed = [slot];
        if (slot === 'FLEX') allowed = ['RB', 'WR', 'TE'];
        if (slot === 'SUPER_FLEX') allowed = ['QB', 'RB', 'WR', 'TE'];
        if (slot === 'WRRB_FLEX') allowed = ['RB', 'WR'];
        if (slot === 'REC_FLEX') allowed = ['WR', 'TE'];
        const i = pool.findIndex(p => !used.has(p.id) && allowed.includes(p.pos));
        if (i >= 0) { tot += pool[i].ppg; used.add(pool[i].id); }
      }
      return tot;
    };

    const { PICK_YEARS: YEARS, PICK_ROUNDS: ROUNDS } = VAULT_CONFIG;
    const pickOwner = new Map();
    YEARS.forEach(y => ROUNDS.forEach(r => rosters.forEach(ro => pickOwner.set(`${y}-${r}-${ro.roster_id}`, ro.roster_id))));
    traded.filter(p => YEARS.includes(+p.season)).forEach(p => {
      const to = Number(p.owner_id);
      if (to && to !== p.roster_id) pickOwner.set(`${p.season}-${p.round}-${p.roster_id}`, to);
    });
    const own = new Map(rosters.map(r => [r.roster_id, []]));
    pickOwner.forEach((o, k) => {
      const [s, r, orig] = k.split('-');
      own.get(o).push({ season: +s, round: +r, original: +orig });
    });

    const built = rosters.map(r => {
      const u = userMap.get(r.owner_id) || {};
      const tn = u.metadata?.team_name || u.display_name || 'Team';
      const un = u.username || '';
      const plist = (r.players || []).map(pid => {
        const p = players[String(pid)] || {};
        const nm = `${p.first_name || ''} ${p.last_name || ''}`.trim();
        return { id: String(pid), name: nm, pos: p.position || '', age: p.age || 0, value: valMap.get(String(pid)) || 0, ppg: ppgMap.get(Vault.norm(nm)) || 0 };
      });
      const total = plist.reduce((s, p) => s + p.value, 0);
      const qb = plist.filter(p => p.pos === 'QB').reduce((s, p) => s + p.value, 0);
      const rb = plist.filter(p => p.pos === 'RB').reduce((s, p) => s + p.value, 0);
      const wr = plist.filter(p => p.pos === 'WR').reduce((s, p) => s + p.value, 0);
      const te = plist.filter(p => p.pos === 'TE').reduce((s, p) => s + p.value, 0);
      const vAge = plist.filter(p => p.value > 0 && p.age > 0);
      const sumV = vAge.reduce((s, p) => s + p.value, 0);
      const age = sumV ? vAge.reduce((s, p) => s + p.value * p.age, 0) / sumV : 0;
      const opt = optimal(plist);
      const sumPos = qb + rb + wr + te || 1;
      const shares = [qb, rb, wr, te].map(v => v / sumPos);
      const mean = shares.reduce((a, b) => a + b) / 4;
      const std = Math.sqrt(shares.reduce((s, x) => s + (x - mean) ** 2, 0) / 4);
      const bal = 100 - std * 200;
      return { rosterId: r.roster_id, teamName: tn, username: un, total, qb, rb, wr, te, age, opt, plist, bal, picks: own.get(r.roster_id) || [] };
    });

    // Production vs. league average
    const avgOpt = built.reduce((s, t) => s + t.opt, 0) / built.length;
    built.forEach(t => t.production = avgOpt ? t.opt / avgOpt * 100 : 100);

    // Pick tiers ranked by standings (early/mid/late), then priced from the pick-value sheet
    const sorted = [...built].sort((a, b) => b.opt - a.opt);
    const n = sorted.length;
    const late = n === 10 ? 3 : 4;
    const mid = 4;
    const tier = new Map(sorted.map((t, i) => [t.rosterId, i < late ? 'late' : (i < late + mid ? 'mid' : 'early')]));
    built.forEach(t => {
      let sum = 0;
      t.picks.forEach(p => {
        p.tier = tier.get(p.original) || 'mid';
        p.value = pickMap.get(`${p.season}-${p.round}-${p.tier}`) || 0;
        sum += p.value;
      });
      t.picksValue = sum;
    });

    // Longevity score: 60% roster value + 20% age + 20% pick capital, normalized to league avg = 100
    const maxVal = Math.max(...built.map(t => t.total));
    const maxPicks = Math.max(...built.map(t => t.picksValue));
    built.forEach(t => {
      const valScore = maxVal ? t.total / maxVal * 100 : 50;
      const ageScore = Math.max(0, Math.min(100, 100 - ((t.age - 23) * 8)));
      const pickScore = maxPicks ? t.picksValue / maxPicks * 100 : 50;
      t.longRaw = valScore * 0.6 + ageScore * 0.2 + pickScore * 0.2;
    });
    const avgLong = built.reduce((s, t) => s + t.longRaw, 0) / built.length;
    built.forEach(t => t.longevity = avgLong ? t.longRaw / avgLong * 100 : 100);

    // Percentiles + archetype
    const vals = built.map(t => t.total).sort((a, b) => a - b);
    const opts = built.map(t => t.opt).sort((a, b) => a - b);
    built.forEach(t => {
      t.valP = vals.indexOf(t.total) / (vals.length - 1) * 100;
      t.ppgP = opts.indexOf(t.opt) / (opts.length - 1) * 100;
      const [a, c] = Vault.archetype(t);
      t.arch = a; t.archCls = c;
    });

    // Column ranks (used by the League Overview table)
    ['total', 'qb', 'rb', 'wr', 'te', 'picksValue', 'opt', 'production', 'longevity'].forEach(k => {
      [...built].sort((a, b) => b[k] - a[k]).forEach((t, i) => t[k + 'Rank'] = i + 1);
    });
    [...built].sort((a, b) => a.age - b.age).forEach((t, i) => t.ageRank = i + 1);

    built.sort((a, b) => b.total - a.total);
    built.forEach((t, i) => t.rank = i + 1);

    return { league, isSF, teams: built };
  }
};
