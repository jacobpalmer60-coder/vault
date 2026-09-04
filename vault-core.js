/* ============================================================
   VAULT CORE
   Shared config + data pipeline for all Vault pages.
   ============================================================ */
const VAULT_CONFIG = {
  DEFAULT_LEAGUE_ID: '1313454100225990656',
  KTC_URL: 'data/ktc-values.json',
  PROJECTIONS_URL: 'data/projections.json',
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

  /* ---------- KeepTradeCut values ----------
     KTC has no public API; data/ktc-values.json is produced by scripts/fetch-ktc.js,
     run daily by .github/workflows/update-ktc.yml (KTC sends no CORS headers, so this
     can't be fetched client-side from a different origin). Matched by normalized name
     since KTC has no Sleeper IDs. */
  async fetchKtcValues() {
    const res = await fetch(VAULT_CONFIG.KTC_URL);
    if (!res.ok) throw new Error('KTC values fetch failed: ' + res.status);
    return res.json();
  },

  buildKtcValueMap(ktcData, isSF) {
    const map = new Map();
    (ktcData.players || []).forEach(p => {
      const key = Vault.normalizeName(p.name);
      if (!key) return;
      map.set(key, isSF ? p.sf_tep : p.oneQB_tep);
    });
    return map;
  },

  /* KTC's pick grid rolls forward each spring after that year's rookie draft, so its
     available seasons can lag a league's configured PICK_YEARS by a year. Map each
     configured year to whichever KTC season is closest rather than hardcoding either. */
  buildKtcPickMap(ktcData, isSF) {
    const raw = new Map();
    const seasons = new Set();
    (ktcData.picks || []).forEach(p => {
      raw.set(`${p.season}-${p.round}-${p.slot}`, isSF ? p.sf_tep : p.oneQB_tep);
      seasons.add(p.season);
    });
    const availYears = [...seasons].sort((a, b) => a - b);
    const map = new Map();
    if (!availYears.length) return map;
    VAULT_CONFIG.PICK_YEARS.forEach(year => {
      const nearest = availYears.reduce((best, y) => Math.abs(y - year) < Math.abs(best - year) ? y : best, availYears[0]);
      VAULT_CONFIG.PICK_ROUNDS.forEach(round => {
        ['early', 'mid', 'late'].forEach(tier => {
          const val = raw.get(`${nearest}-${round}-${tier}`);
          if (val != null) map.set(`${year}-${round}-${tier}`, val);
        });
      });
    });
    return map;
  },

  /* KTC prices picks per-round assuming a 12-team, linear (non-snake) draft order:
     round R spans overall picks (R-1)*12+1..R*12, split early/mid/late in groups of 4
     (worst teams pick first = early = most valuable). A league with a different team
     count draws from the same rookie class at a different overall pace, so the right
     comparison is by OVERALL pick number, not by matching round labels — e.g. in a
     10-team league, standings ranks 1-4 in round 3 land at overall picks 21-24, which
     is round 2's LATE tier in the 12-team convention, not round 3 at all. Round is
     clamped to KTC's tracked range (1-4) since it has no pricing beyond that. */
  ktcPickSlot(overallPick) {
    const round = Math.min(4, Math.max(1, Math.ceil(overallPick / 12)));
    const pos = ((overallPick - 1) % 12) + 1;
    const tier = pos <= 4 ? 'early' : pos <= 8 ? 'mid' : 'late';
    return { round, tier };
  },

  /* ---------- Season projections (per-league scoring) ----------
     Every league scores differently (PPR vs half vs standard, TE premium, first-down
     bonuses...), so one canned PPG number can't be right everywhere. data/projections.json
     (scripts/fetch-projections.js) stores each player's raw projected stat counts;
     scoreStats dot-products them against THIS league's actual scoring_settings from
     Sleeper, so projected PPG always matches how points are really scored here. */
  async fetchProjections() {
    const res = await fetch(VAULT_CONFIG.PROJECTIONS_URL);
    if (!res.ok) throw new Error('Projections fetch failed: ' + res.status);
    return res.json();
  },

  scoreStats(stats, scoringSettings) {
    let total = 0;
    for (const [k, w] of Object.entries(scoringSettings || {})) total += (stats[k] || 0) * w;
    return total;
  },

  buildProjectedPpgMapById(projData, scoringSettings) {
    const map = new Map();
    Object.entries(projData.players || {}).forEach(([pid, p]) => {
      const gp = p.stats.gp || 0;
      if (gp) map.set(pid, Vault.scoreStats(p.stats, scoringSettings) / gp);
    });
    return map;
  },

  buildProjectedPpgMapByName(projData, scoringSettings) {
    const map = new Map();
    Object.values(projData.players || {}).forEach(p => {
      const gp = p.stats.gp || 0;
      const key = Vault.normalizeName(p.name);
      if (gp && key) map.set(key, Vault.scoreStats(p.stats, scoringSettings) / gp);
    });
    return map;
  },

  async fetchValueSheets() {
    const [ktcData, projData] = await Promise.all([
      Vault.fetchKtcValues(),
      Vault.fetchProjections()
    ]);
    return { ktcData, projData };
  },

  buildValueMaps({ ktcData, projData, isSF, scoringSettings }) {
    const valMap = Vault.buildKtcValueMap(ktcData, isSF);
    const ppgMap = Vault.buildProjectedPpgMapById(projData, scoringSettings);
    const pickMap = Vault.buildKtcPickMap(ktcData, isSF);
    return { valMap, ppgMap, pickMap };
  },

  /* ---------- Archetype classifier (shared by app.html + team-analyzer.html) ----------
     Built around valP/ppgP terciles rather than absolute thresholds, since those are
     true in-league percentiles and guaranteed to spread across teams. `bal` (positional
     balance) only ranges ~69-90 in practice regardless of roster shape, so a static
     "bal >= 70" gate used to catch nearly every team before more specific rules got a
     chance — it's now just a tiebreaker within the genuine middle-of-both-axes cell.
     Thresholds sit at 60/40 rather than the more "natural" 67/33 because percentiles
     over a small league are discrete steps (e.g. 66.67 for a 10-team league) — a cutoff
     placed almost exactly on a step, like 67, misclassifies whichever team lands there
     by a hair. 60/40 sits cleanly between steps for the common league sizes (8-14). */
  archetype(t) {
    const { valP, ppgP, age, bal } = t;
    const vTier = valP > 60 ? 'H' : valP < 40 ? 'L' : 'M';
    const pTier = ppgP > 60 ? 'H' : ppgP < 40 ? 'L' : 'M';

    if (vTier === 'H' && pTier === 'H') {
      return age > 27.5
        ? ['Aging Contender', 'from-orange-500/20 to-amber-600/20 text-orange-200 border-orange-600/40']
        : ['Elite Contender', 'from-amber-500/20 to-yellow-500/20 text-amber-200 border-amber-600/40'];
    }
    if (vTier === 'H' && pTier === 'M') return ['Win-Now Fringe', 'from-amber-600/20 to-yellow-700/20 text-amber-300 border-amber-700/40'];
    if (vTier === 'H' && pTier === 'L') return ['Volatile', 'from-rose-600/20 to-red-600/20 text-rose-200 border-rose-600/40'];

    if (vTier === 'M' && pTier === 'H') {
      return age < 26
        ? ['Young Riser', 'from-emerald-600/20 to-teal-600/20 text-emerald-200 border-emerald-600/40']
        : ['Overachiever', 'from-lime-600/20 to-green-600/20 text-lime-200 border-lime-600/40'];
    }
    if (vTier === 'M' && pTier === 'M') {
      return bal >= 78
        ? ['Balanced Core', 'from-zinc-600/20 to-neutral-600/20 text-zinc-200 border-zinc-600/40']
        : ['Stuck Middle', 'from-zinc-700/20 to-zinc-800/20 text-zinc-300 border-zinc-700/40'];
    }
    if (vTier === 'M' && pTier === 'L') {
      return age < 26
        ? ['Pick-Rich Rebuilder', 'from-sky-600/20 to-cyan-600/20 text-sky-200 border-sky-600/40']
        : ['Treading Water', 'from-slate-600/20 to-slate-700/20 text-slate-200 border-slate-600/40'];
    }

    if (vTier === 'L' && pTier === 'H') return ['Scrappy Contender', 'from-teal-600/20 to-cyan-700/20 text-teal-200 border-teal-700/40'];
    if (vTier === 'L' && pTier === 'M') return ['Retooling', 'from-indigo-600/20 to-blue-700/20 text-indigo-200 border-indigo-700/40'];
    return age < 26
      ? ['Pick-Rich Rebuilder', 'from-sky-600/20 to-cyan-600/20 text-sky-200 border-sky-600/40']
      : ['Stripped Rebuilder', 'from-stone-700/30 to-stone-800/30 text-stone-300 border-stone-700/40'];
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
    const { ktcData, projData } = await Vault.fetchValueSheets();
    const isSF = (league.roster_positions || []).includes('SUPER_FLEX');
    const { valMap, ppgMap, pickMap } = Vault.buildValueMaps({ ktcData, projData, isSF, scoringSettings: league.scoring_settings });

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
        return { id: String(pid), name: nm, pos: p.position || '', age: p.age || 0, value: valMap.get(Vault.normalizeName(nm)) || 0, ppg: ppgMap.get(String(pid)) || 0 };
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

    // Draft order rank (1 = worst team, picks first; n = best team, picks last),
    // used to convert each pick into its overall pick number for ktcPickSlot.
    const sorted = [...built].sort((a, b) => b.opt - a.opt); // best team first
    const n = sorted.length;
    const draftRank = new Map(sorted.map((t, k) => [t.rosterId, n - k]));
    built.forEach(t => {
      let sum = 0;
      t.picks.forEach(p => {
        const rank = draftRank.get(p.original) || 1;
        const overall = (p.round - 1) * n + rank;
        const { round: ktcRound, tier } = Vault.ktcPickSlot(overall);
        p.tier = tier;
        p.value = pickMap.get(`${p.season}-${ktcRound}-${tier}`) || 0;
        sum += p.value;
      });
      t.picksValue = sum;
    });

    /* ---------- Percentiles ----------
       Everything below keys off in-league percentile rank rather than a ratio to the
       max/mean team. Ratios compress unevenly when the underlying inputs are
       correlated (or, for Longevity's blend, anti-correlated — value-rich teams tend
       to be pick-poor and vice versa, so a weighted average of raw ratios cancels
       toward the middle for nearly everyone). Percentiles are evenly spread across
       the league by construction regardless of the data's shape, the same fix that
       replaced the old `bal >= 70` archetype gate. */
    const vals = built.map(t => t.total).sort((a, b) => a - b);
    const opts = built.map(t => t.opt).sort((a, b) => a - b);
    const ages = built.map(t => t.age).sort((a, b) => a - b);
    const pickVals = built.map(t => t.picksValue).sort((a, b) => a - b);
    built.forEach(t => {
      t.valP = vals.indexOf(t.total) / (vals.length - 1) * 100;
      t.ppgP = opts.indexOf(t.opt) / (opts.length - 1) * 100;
      t.ageP = 100 - ages.indexOf(t.age) / (ages.length - 1) * 100; // youngest = 100
      t.pickP = pickVals.indexOf(t.picksValue) / (pickVals.length - 1) * 100;
    });

    // Production: percentile of optimal-lineup PPG, rescaled to league avg = 100.
    const avgPpgP = built.reduce((s, t) => s + t.ppgP, 0) / built.length;
    built.forEach(t => t.production = avgPpgP ? t.ppgP / avgPpgP * 100 : 100);

    // Longevity: 60% roster value + 20% age + 20% pick capital, each as an in-league
    // percentile, blended and normalized to league avg = 100.
    built.forEach(t => { t.longRaw = t.valP * 0.6 + t.ageP * 0.2 + t.pickP * 0.2; });
    const avgLong = built.reduce((s, t) => s + t.longRaw, 0) / built.length;
    built.forEach(t => t.longevity = avgLong ? t.longRaw / avgLong * 100 : 100);

    // Archetype (+ a continuous best-to-worst score for sorting by it)
    built.forEach(t => {
      const [a, c] = Vault.archetype(t);
      t.arch = a; t.archCls = c;
      t.archScore = t.valP + t.ppgP;
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
