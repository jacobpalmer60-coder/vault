/* ============================================================
   VAULT CORE
   Shared config + data pipeline for all Vault pages.
   ============================================================ */
const VAULT_CONFIG = {
  DEFAULT_LEAGUE_ID: '1313454100225990656',
  KTC_URL: 'data/ktc-values.json',
  PROJECTIONS_URL: 'data/projections.json',
  // How many future draft years to track as tradeable assets. The actual starting
  // year is computed at runtime by Vault.futurePickYears — NOT hardcoded here —
  // because whether the CURRENT season's picks still count as "future" flips the
  // moment that season's rookie draft happens. Before the draft, this season's
  // picks are real, tradeable, KTC-priced assets (excluding them used to silently
  // price them at $0 everywhere). After the draft, they've already turned into
  // rostered players and showing them as still-available future picks is a phantom
  // asset that shouldn't be on anyone's roster or price into their team value.
  PICK_YEARS_WINDOW: 4,
  PICK_ROUNDS: [1, 2, 3, 4],
  // Value Based Adjustment: boosts assets above VBA_REFERENCE, discounts those
  // below it, so a single elite piece outweighs several mid-tier pieces summing
  // to the same raw value. Fitted against a real KeepTradeCut trade-calculator
  // comparison (Ja'Marr Chase vs. DeVonta Smith + Brock Purdy, which KTC itself
  // flagged with a +5239 "Value Adjustment" on Chase, a ~53% premium) rather
  // than picked by feel — see Vault.adjustedValue.
  VBA_REFERENCE: 5500,
  VBA_EXPONENT: 1.7,
  // How much a position's need/surplus status (see Vault.positionalProfile) scales
  // an asset's value to the team involved — a real need is worth more than sticker
  // price to the team receiving it (or costs more than sticker price to give up),
  // a surplus position is worth less either way. Applied per-asset so the swing
  // scales with the asset's own value, not a flat bonus regardless of size.
  POS_NEED_MULTIPLIER: 1.15,
  POS_SURPLUS_MULTIPLIER: 0.85,
  // Same idea, along a different axis: does the asset TYPE fit the team's timeline
  // (see Vault.teamMode)? A rebuilder should read a pick or a young player as worth
  // more than sticker price — that's exactly what they're stockpiling for — and a
  // proven veteran as worth less, regardless of value fairness on paper. A contender
  // gets the opposite: proven production is worth more, picks/youth worth less,
  // since they can't play a draft pick this season. See Vault.archetypeFitNotes.
  ARCH_FIT_MULTIPLIER: 1.15,
  ARCH_MISFIT_MULTIPLIER: 0.85,
  // "Young" vs. "proven veteran" is position-specific — a 25-year-old WR is in his
  // prime, not a rebuild-only asset the way a 25-year-old RB is closer to the cliff.
  // `veteran` reuses the exact decline-onset ages contentionWindow() already applies
  // (RB>26, WR>27, QB>30, TE>28) — a player who's started declining is unambiguously
  // no longer a development asset. `young` sits a few years earlier, at roughly the
  // end of a rookie contract. Ages in between are prime years: good for either
  // timeline, so archetypeFitNotes doesn't penalize or reward them either way.
  ARCH_AGE_BANDS: {
    QB: { young: 26, veteran: 30 },
    RB: { young: 23, veteran: 26 },
    WR: { young: 24, veteran: 27 },
    TE: { young: 24, veteran: 28 }
  },
  ARCH_AGE_BAND_DEFAULT: { young: 24, veteran: 28 },
  // Fair/Borderline/Lopsided cutoffs for VBA-adjusted value-diff %, shared by the
  // Trade Calculator and Trade Grades. Originally 6/15 (picked by feel); recalibrated
  // against ~19,300 real completed trades pulled from KeepTradeCut's trade database
  // (resolved via this same VBA curve) after finding the OLD cutoffs called 62% of
  // real, mutually-agreed trades "Lopsided" — the median real trade sits at ~22% off,
  // so 15% wasn't a lopsided outlier, it was normal. 10/35 splits that same real
  // population into a much more even ~27%/42%/31% Fair/Borderline/Lopsided read.
  // The VBA curve itself (VBA_EXPONENT) was grid-searched against the same data and
  // left unchanged — 1.7 was already within a rounding error of the empirical
  // minimum for both mean gap and Lopsided rate. VBA_REFERENCE turned out to have
  // NO effect on this % at all (it's a pure scale constant that cancels out of any
  // ratio), so it stays as-is too, chosen only to keep displayed numbers legible.
  FAIR_PCT: 10,
  LOPSIDED_PCT: 35
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
  /* ---------- Value Based Adjustment (VBA) ----------
     Raw KTC values are linear/additive, but two 3000-value players aren't really
     equal to one 6000-value player — roster spots are scarce and depth is
     fungible in a way a true stud isn't ("consolidation premium").

     v1 of this anchored the boost to the top of the KTC scale (9999) and only
     ever discounted values below it — which meant a near-ceiling asset (e.g. a
     top-3 overall player already at ~9960) got almost no premium no matter how
     high the exponent went, exactly backwards from where a real premium matters
     most. Confirmed against KeepTradeCut's own trade calculator: they apply an
     explicit "Value Adjustment" that boosts a concentrated star well above its
     raw value rather than discounting the fragmented side, so v1 couldn't
     reproduce that shape at all.

     v2 instead boosts anything above VBA_REFERENCE and discounts anything below
     it, unbounded — so an elite asset's premium keeps growing the closer it gets
     to the top of the scale, instead of flattening out near a ceiling. */
  adjustedValue(v, k = VAULT_CONFIG.VBA_EXPONENT) {
    if (v <= 0) return 0;
    const ref = VAULT_CONFIG.VBA_REFERENCE;
    return ref * Math.pow(v / ref, k);
  },
  meanStd(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const std = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
    return { mean, std };
  },
  fmtInt(n) { return Number.isFinite(n) ? Math.round(n).toLocaleString() : '—'; },
  fmtFloat(n, d = 2) { return Number.isFinite(n) ? n.toFixed(d) : '—'; },
  escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));
  },

  /* ---------- Sleeper API ---------- */
  async fetchSleeperCore(leagueId) {
    const [league, users, rosters, players, traded, drafts] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${leagueId}`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/players/nfl`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`).then(r => r.json()).catch(() => [])
    ]);
    if (!league || league.error) throw new Error('League not found. Double-check the league ID.');
    return { league, users, rosters, players, traded, drafts };
  },

  // A league can carry multiple draft records for the same season (an abandoned
  // pre_draft placeholder alongside the real one, old startup drafts, etc.) — only
  // a completed draft whose round count matches the league's actual rookie-draft
  // length (PICK_ROUNDS) counts as "this season's rookie draft happened".
  seasonDraftComplete(drafts, season) {
    return (drafts || []).some(d =>
      String(d.season) === String(season) && d.status === 'complete' &&
      d.settings && d.settings.rounds === VAULT_CONFIG.PICK_ROUNDS.length
    );
  },

  // The years that are still real, tradeable future picks. Anchored to the current
  // season, not shifted forward once a draft completes — Sleeper's own pick
  // tracking for this league only goes out to season + (WINDOW - 1) regardless of
  // where the current season sits (confirmed: this league's picks only go through
  // 2029, not a rolling 2030 once 2026 drops off). A completed season's draft just
  // drops that one year from the fixed window instead of extending the far end.
  futurePickYears(league, drafts) {
    const season = +league.season;
    const window = Array.from({ length: VAULT_CONFIG.PICK_YEARS_WINDOW }, (_, i) => season + i);
    return window.filter(year => !Vault.seasonDraftComplete(drafts, year));
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

  /* ---------- Value history ----------
     data/team-value-history.json and data/player-value-history.json are written
     daily by scripts/snapshot-value-history.js (same Action as the KTC refresh).
     Both files exist from the start (seeded empty) so these never 404 — pages just
     render a "not enough history yet" state until snapshots accumulate. Player
     history only covers players actually rostered in the tracked league, keyed by
     normalized name (KTC has no Sleeper IDs), not the full KTC universe. */
  async fetchTeamValueHistory() {
    try {
      const res = await fetch('data/team-value-history.json');
      if (!res.ok) return { leagueId: null, snapshots: [] };
      return res.json();
    } catch { return { leagueId: null, snapshots: [] }; }
  },
  async fetchPlayerValueHistory() {
    try {
      const res = await fetch('data/player-value-history.json');
      if (!res.ok) return { leagueId: null, snapshots: [] };
      return res.json();
    } catch { return { leagueId: null, snapshots: [] }; }
  },

  /* KTC's pick grid rolls forward each spring after that year's rookie draft, so its
     available seasons can lag a league's actual future pick years by a year. Map
     each of the league's years to whichever KTC season is closest rather than
     hardcoding either. `years` comes from Vault.futurePickYears. */
  buildKtcPickMap(ktcData, isSF, years) {
    const raw = new Map();
    const seasons = new Set();
    (ktcData.picks || []).forEach(p => {
      raw.set(`${p.season}-${p.round}-${p.slot}`, isSF ? p.sf_tep : p.oneQB_tep);
      seasons.add(p.season);
    });
    const availYears = [...seasons].sort((a, b) => a - b);
    const map = new Map();
    if (!availYears.length) return map;
    years.forEach(year => {
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

  buildValueMaps({ ktcData, projData, isSF, scoringSettings, pickYears }) {
    const valMap = Vault.buildKtcValueMap(ktcData, isSF);
    const ppgMap = Vault.buildProjectedPpgMapById(projData, scoringSettings);
    const pickMap = Vault.buildKtcPickMap(ktcData, isSF, pickYears);
    return { valMap, ppgMap, pickMap };
  },

  /* One-line meaning + badge color of each label `archetype()` can return, keyed by
     name — shown as tooltips wherever an archetype pill appears and as the glossary
     on League Overview. Kept separate from `archetype()` itself (rather than folding
     descriptions into its branches) so the classification logic stays about the two
     axes it actually reads, not string/color content — `cls` is duplicated from
     `archetype()`'s return value so the glossary can render every archetype's color
     even for one absent from the current league. */
  ARCHETYPE_INFO: {
    'Elite Contender': { cls: 'from-amber-500/20 to-yellow-500/20 text-amber-200 border-amber-600/40', desc: 'Top-tier trade value AND top-tier scoring, with a still-young core — built to win now and keep winning for a while.' },
    'Aging Contender': { cls: 'from-orange-500/20 to-amber-600/20 text-orange-200 border-orange-600/40', desc: 'Elite value and production today, but the core is getting old — the championship window is open now, not for long.' },
    'Win-Now Fringe': { cls: 'from-amber-600/20 to-yellow-700/20 text-amber-300 border-amber-700/40', desc: 'Strong trade value but only middling weekly scoring — the pieces are valuable on paper, the lineup isn’t translating that into points yet.' },
    'Volatile': { cls: 'from-rose-600/20 to-red-600/20 text-rose-200 border-rose-600/40', desc: 'High trade value that isn’t showing up on the scoreboard — hurt or underperforming stars, or a lineup that can’t unlock what the roster is worth.' },
    'Young Riser': { cls: 'from-emerald-600/20 to-teal-600/20 text-emerald-200 border-emerald-600/40', desc: 'Middling trade value but scoring like a contender, and young — production is ahead of where the market has this roster valued.' },
    'Overachiever': { cls: 'from-lime-600/20 to-green-600/20 text-lime-200 border-lime-600/40', desc: 'Outscoring what the roster’s trade value would suggest — getting more out of these players than KTC gives them credit for.' },
    'Balanced Core': { cls: 'from-zinc-600/20 to-neutral-600/20 text-zinc-200 border-zinc-600/40', desc: 'Average value and average production, spread evenly across positions — no glaring hole, but no standout strength either.' },
    'Stuck Middle': { cls: 'from-zinc-700/20 to-zinc-800/20 text-zinc-300 border-zinc-700/40', desc: 'Average value and production, but lopsided across positions — one or two spots are carrying the team while others lag.' },
    'Pick-Rich Rebuilder': { cls: 'from-sky-600/20 to-cyan-600/20 text-sky-200 border-sky-600/40', desc: 'Low on current scoring but young and/or holding real draft capital — positioned to get better, not worse, over the next few seasons.' },
    'Treading Water': { cls: 'from-slate-600/20 to-slate-700/20 text-slate-200 border-slate-600/40', desc: 'Not scoring, not particularly valuable, and not young enough to just be building for later — the least clearly-positioned kind of roster.' },
    'Scrappy Contender': { cls: 'from-teal-600/20 to-cyan-700/20 text-teal-200 border-teal-700/40', desc: 'Below-average trade value but scoring like a contender — punching above its weight, often on a few efficient or lucky performers.' },
    'Retooling': { cls: 'from-indigo-600/20 to-blue-700/20 text-indigo-200 border-indigo-700/40', desc: 'Below-average value and middling production — neither clearly rebuilding nor competing; a roster in flux.' },
    'Stripped Rebuilder': { cls: 'from-stone-700/30 to-stone-800/30 text-stone-300 border-stone-700/40', desc: 'Low value, low production, and an older core — the furthest from competing, with the least short- or long-term asset base.' }
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

  /* Best-lineup PPG for a player pool given a league's starting slots. Shared by
     buildLeagueTeams and simulateTrade (which needs to re-run it on a hypothetical
     post-trade roster). */
  optimalLineup(plist, slots) {
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
  },

  /* ---------- Full league team-building pipeline ----------
     Single source of truth used by app.html (League Overview) and
     team-analyzer.html (Team Analyzer). Previously each page had its
     own copy of this logic and they had drifted out of sync — most
     notably team-analyzer.html was valuing every rookie pick as
     "mid" tier instead of ranking tiers by standings like app.html did.
     Fixing that drift was the main reason to centralize this. */
  async buildLeagueTeams(leagueId) {
    const { league, users, rosters, players, traded, drafts } = await Vault.fetchSleeperCore(leagueId);
    const { ktcData, projData } = await Vault.fetchValueSheets();
    const isSF = (league.roster_positions || []).includes('SUPER_FLEX');
    const pickYears = Vault.futurePickYears(league, drafts);
    const { valMap, ppgMap, pickMap } = Vault.buildValueMaps({ ktcData, projData, isSF, scoringSettings: league.scoring_settings, pickYears });

    const userMap = new Map(users.map(u => [u.user_id, u]));
    const slots = (league.roster_positions || []).filter(s => !['BN', 'IR', 'TAXI'].includes(s));
    const optimal = plist => Vault.optimalLineup(plist, slots);

    const YEARS = pickYears, ROUNDS = VAULT_CONFIG.PICK_ROUNDS;
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

    /* ---------- Percentiles (used by archetype only) ----------
       Archetype buckets teams into discrete tiers, where an even 0-100 spread by
       construction is exactly what's wanted regardless of the underlying data's shape
       — the same fix that replaced the old `bal >= 70` archetype gate. */
    const vals = built.map(t => t.total).sort((a, b) => a - b);
    const opts = built.map(t => t.opt).sort((a, b) => a - b);
    built.forEach(t => {
      t.valP = vals.indexOf(t.total) / (vals.length - 1) * 100;
      t.ppgP = opts.indexOf(t.opt) / (opts.length - 1) * 100;
    });

    /* ---------- Production & Longevity (z-scores, not percentiles) ----------
       Percentile rank only knows order, not how big a gap actually is — two teams a
       fraction of a point apart in Opt PPG could land on opposite ends of a rank step
       and look dramatically far apart, while a genuinely huge gap elsewhere gets the
       same one-step treatment. A z-score (distance from the league mean, in units of
       the league's own standard deviation) keeps near-ties near each other and lets
       real gaps read as real gaps. SPREAD sets how many display points one standard
       deviation is worth; 100 = league average either way. */
    const SPREAD = 20;
    const { mean: meanOpt, std: stdOpt } = Vault.meanStd(built.map(t => t.opt));
    built.forEach(t => t.production = Math.max(0, 100 + (stdOpt ? (t.opt - meanOpt) / stdOpt * SPREAD : 0)));

    // Longevity: 60% roster value + 20% age (younger is better) + 20% pick capital,
    // each z-scored against the league before blending.
    const { mean: meanTotal, std: stdTotal } = Vault.meanStd(built.map(t => t.total));
    const { mean: meanAge, std: stdAge } = Vault.meanStd(built.map(t => t.age));
    const { mean: meanPicks, std: stdPicks } = Vault.meanStd(built.map(t => t.picksValue));
    built.forEach(t => {
      const valZ = stdTotal ? (t.total - meanTotal) / stdTotal : 0;
      const ageZ = stdAge ? -(t.age - meanAge) / stdAge : 0;
      const pickZ = stdPicks ? (t.picksValue - meanPicks) / stdPicks : 0;
      t.longevity = Math.max(0, 100 + (valZ * 0.6 + ageZ * 0.2 + pickZ * 0.2) * SPREAD);
    });

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

    return { league, isSF, slots, teams: built };
  },

  /* ---------- Trade simulation ----------
     Applies a hypothetical trade to two teams and recomputes everything that
     depends on it: value, positional splits, age, optimal lineup, pick capital,
     and — critically — archetype/percentile standing recalculated against the
     REST OF THE LEAGUE unchanged, so a trade analysis can compare each team's
     before/after standing rather than just the raw value moved. */
  simulateTrade(allTeams, slots, teamAId, teamBId, giveA, giveB) {
    const A = allTeams.find(t => t.rosterId === teamAId);
    const B = allTeams.find(t => t.rosterId === teamBId);
    const giveAPlayers = giveA.filter(x => x.type === 'player');
    const giveBPlayers = giveB.filter(x => x.type === 'player');
    const giveAPicks = giveA.filter(x => x.type === 'pick');
    const giveBPicks = giveB.filter(x => x.type === 'pick');

    const pickKey = p => `${p.season}-${p.round}-${p.original}`;

    function rebuild(team, removedPlayers, addedPlayers, removedPicks, addedPicks) {
      const removedIds = new Set(removedPlayers.map(p => p.id));
      const plist = [...team.plist.filter(p => !removedIds.has(p.id)), ...addedPlayers];
      const total = plist.reduce((s, p) => s + p.value, 0);
      const qb = plist.filter(p => p.pos === 'QB').reduce((s, p) => s + p.value, 0);
      const rb = plist.filter(p => p.pos === 'RB').reduce((s, p) => s + p.value, 0);
      const wr = plist.filter(p => p.pos === 'WR').reduce((s, p) => s + p.value, 0);
      const te = plist.filter(p => p.pos === 'TE').reduce((s, p) => s + p.value, 0);
      const vAge = plist.filter(p => p.value > 0 && p.age > 0);
      const sumV = vAge.reduce((s, p) => s + p.value, 0);
      const age = sumV ? vAge.reduce((s, p) => s + p.value * p.age, 0) / sumV : 0;
      const opt = Vault.optimalLineup(plist, slots);
      const sumPos = qb + rb + wr + te || 1;
      const shares = [qb, rb, wr, te].map(v => v / sumPos);
      const mean = shares.reduce((a, b) => a + b) / 4;
      const std = Math.sqrt(shares.reduce((s, x) => s + (x - mean) ** 2, 0) / 4);
      const bal = 100 - std * 200;
      const removedKeys = new Set(removedPicks.map(pickKey));
      const picks = [...team.picks.filter(p => !removedKeys.has(pickKey(p))), ...addedPicks];
      const picksValue = picks.reduce((s, p) => s + (p.value || 0), 0);
      return { ...team, plist, total, qb, rb, wr, te, age, opt, bal, picks, picksValue };
    }

    const newA = rebuild(A, giveAPlayers, giveBPlayers, giveAPicks, giveBPicks);
    const newB = rebuild(B, giveBPlayers, giveAPlayers, giveBPicks, giveAPicks);

    // Recompute valP/ppgP/archetype against the rest of the league, unchanged
    const others = allTeams.filter(t => t.rosterId !== teamAId && t.rosterId !== teamBId);
    const pool = [...others, newA, newB];
    const vals = pool.map(t => t.total).sort((a, b) => a - b);
    const opts = pool.map(t => t.opt).sort((a, b) => a - b);
    [newA, newB].forEach(t => {
      t.valP = vals.indexOf(t.total) / (vals.length - 1) * 100;
      t.ppgP = opts.indexOf(t.opt) / (opts.length - 1) * 100;
      const [a, c] = Vault.archetype(t);
      t.arch = a; t.archCls = c;
      t.archScore = t.valP + t.ppgP;
    });

    return { before: { A, B }, after: { A: newA, B: newB }, pool };
  },

  /* ---------- Contention window ----------
     Projects roster value 5 years out with position-specific age decay, and
     estimates which of those years clear the league's playoff-line PPG. Shared by
     Team Analyzer and the Trade Calculator (to show how a trade shifts a team's
     window, not just its current value). */
  contentionWindow(t, all) {
    const startYear = new Date().getFullYear();
    const years = 5;
    const proj = [];
    for (let y = 0; y < years; y++) {
      const projYear = startYear + y;
      let val = 0;
      t.plist.forEach(p => {
        let decay = 1;
        const age = p.age + y;
        if (p.pos === 'RB' && age > 26) decay = Math.pow(0.85, age - 26);
        if (p.pos === 'WR' && age > 27) decay = Math.pow(0.92, age - 27);
        if (p.pos === 'QB' && age > 30) decay = Math.pow(0.96, age - 30);
        if (p.pos === 'TE' && age > 28) decay = Math.pow(0.93, age - 28);
        val += p.value * decay;
      });
      // Draft picks convert into roster value once their draft year arrives.
      // Previously picks were invisible to this projection entirely — existing
      // players only ever decay, so a team's value could never exceed today's,
      // which meant a rebuilder's future window (arriving once its picks turn
      // into players) could never show up, no matter how pick-rich the team was.
      (t.picks || []).forEach(p => { if (projYear >= p.season) val += p.value || 0; });
      proj.push(Math.round(val));
    }
    const peak = Math.max(...proj);
    const year = startYear + proj.indexOf(peak);

    const playoffSpots = Math.max(4, Math.ceil(all.length * 0.6));
    const sortedPPG = [...all].map(x => x.opt).sort((a, b) => b - a);
    const playoffLine = sortedPPG[playoffSpots - 1] || sortedPPG[sortedPPG.length - 1];

    const projPPG = proj.map(v => t.opt * (v / (t.total || 1)));
    const valueThreshold = peak * 0.88;
    const inWindow = proj.map((v, i) => v >= valueThreshold && projPPG[i] >= playoffLine * 0.97);

    // No fake fallback: if no projected year actually clears the bar, windowStart/
    // End are null rather than silently defaulting to startYear (which used to be
    // indistinguishable from a genuine 1-year window starting right now).
    const hasWindow = inWindow.some(x => x);
    const startIdx = inWindow.indexOf(true);
    const endIdx = inWindow.lastIndexOf(true);
    return {
      proj, projPPG, peakYear: year, peak, startYear, inWindow, hasWindow,
      windowStart: hasWindow ? startYear + startIdx : null,
      windowEnd: hasWindow ? startYear + endIdx : null,
      years, playoffLine, playoffSpots
    };
  },

  /* ---------- Positional profile ----------
     Percentile-ranks a team's qb/rb/wr/te value against the rest of the league to
     flag genuine needs (<35th pct) and surpluses (>65th pct). Shared by Team
     Analyzer's trade-partner finder and the Trade Calculator's per-trade fit check
     (an incoming asset at a surplus position shouldn't read as a win just because
     the value matches). */
  positionalProfile(t, all) {
    const posPct = {};
    ['qb', 'rb', 'wr', 'te'].forEach(k => {
      const arr = all.map(x => x[k]).sort((a, b) => a - b);
      posPct[k] = arr.length > 1 ? arr.indexOf(t[k]) / (arr.length - 1) : 0.5;
    });
    const needs = Object.entries(posPct).filter(([, v]) => v < 0.35).map(([k]) => k);
    const surpluses = Object.entries(posPct).filter(([, v]) => v > 0.65).map(([k]) => k);
    return { posPct, needs, surpluses };
  },

  /* Scales a value by a team's need/surplus status at `pos` (from positionalProfile)
     — used both for what a team receives (a need is worth more than sticker price)
     and for what it gives up (a surplus costs less than sticker price to part with;
     a need costs more). Picks and any position outside qb/rb/wr/te pass through
     unscaled, since positionalProfile only tracks those four. */
  needAdjustedValue(value, pos, profile) {
    const k = (pos || '').toLowerCase();
    if (profile.needs.includes(k)) return value * VAULT_CONFIG.POS_NEED_MULTIPLIER;
    if (profile.surpluses.includes(k)) return value * VAULT_CONFIG.POS_SURPLUS_MULTIPLIER;
    return value;
  },

  /* Need/surplus scales each asset's OWN value (via needAdjustedValue) rather than
     handing out a flat bonus/penalty regardless of size — a superstar filling a real
     need should swing this far more than a bench piece at the same position.
     `dollarSwing` is the total effective-value gain/loss this causes (positive helps
     this team), converted to a fit-scale contribution proportional to team size.
     Shared by the Trade Calculator (a proposed trade) and Trade Grades (a completed
     one) — both just need `team`, the league, and what moved in which direction. */
  positionalFitNotes(team, allTeams, incoming, outgoing) {
    const profile = Vault.positionalProfile(team, allTeams);
    const notes = [];
    let dollarSwing = 0;

    const scan = (list, isIncoming) => {
      ['QB', 'RB', 'WR', 'TE'].forEach(POS => {
        const assets = list.filter(a => a.pos === POS);
        if (!assets.length) return;
        // Display math stays in raw-dollar terms so "worth more/less than sticker
        // price" is always literally true — VBA-adjusted values are used separately,
        // below, only for the internal fit-score contribution (never shown), since
        // showing a VBA-discounted small asset next to its need-boosted-but-still-
        // smaller-than-raw counterpart would read backwards (looks like a discount
        // even though the need multiplier is genuinely boosting it).
        const rawSum = assets.reduce((s, a) => s + a.value, 0);
        const weightedRaw = assets.reduce((s, a) => s + Vault.needAdjustedValue(a.value, POS, profile), 0);
        const adjSum = assets.reduce((s, a) => s + Vault.adjustedValue(a.value), 0);
        const weightedAdj = assets.reduce((s, a) => s + Vault.needAdjustedValue(Vault.adjustedValue(a.value), POS, profile), 0);
        const delta = weightedAdj - adjSum; // >0 = need multiplier applied, <0 = surplus discount
        if (Math.abs(delta) < 1) return;
        const rawDisplay = Math.round(rawSum).toLocaleString();
        const weightedDisplay = Math.round(weightedRaw).toLocaleString();
        const article = POS === 'RB' ? 'an' : 'a'; // "an RB" (ar-bee) vs "a QB/WR/TE"
        // `phrase` + `absDelta` are a short, tone-neutral verb phrase and this
        // theme's dollar weight — used by Vault.sideTheme to pick the single
        // biggest positional storyline for a one-sentence trade recap, without
        // having to parse the full `text` sentence back apart.
        if (isIncoming) {
          dollarSwing += delta;
          notes.push(delta > 0
            ? { tone: 'good', text: `Adds ${rawDisplay} at ${POS}, a genuine roster need — worth closer to ${weightedDisplay} to this team than sticker price.`, pos: POS, absDelta: Math.abs(delta), phrase: `addressed ${article} ${POS} need` }
            : { tone: 'bad', text: `Adds ${rawDisplay} more ${POS} value to a room that's already deep — really worth closer to ${weightedDisplay} here.`, pos: POS, absDelta: Math.abs(delta), phrase: `added ${POS} depth` });
        } else {
          dollarSwing -= delta;
          notes.push(delta < 0
            ? { tone: 'good', text: `Deals from ${POS} surplus — worth closer to ${weightedDisplay} to this team than its ${rawDisplay} sticker price.`, pos: POS, absDelta: Math.abs(delta), phrase: `trimmed ${POS} depth` }
            : { tone: 'bad', text: `Gives up ${POS} value at a position this team is already thin — costs more than the ${rawDisplay} sticker price suggests.`, pos: POS, absDelta: Math.abs(delta), phrase: `gave up needed ${POS} value` });
        }
      });
    };
    scan(incoming, true);
    scan(outgoing, false);

    const posFit = team.total ? Math.max(-3, Math.min(3, dollarSwing / team.total * 120)) : 0;
    return { posFit, notes };
  },

  /* A team's timeline — contending (score now), rebuilding (stockpile for later), or
     flexible (neither extreme) — read off where it stands vs the league on value and
     current production. Cutoffs sit away from percentile-step boundaries (see the
     archetype() comment below) rather than on a round number like 50/50. Shared by
     the Trade Calculator (a proposed trade) and Trade Grades (a completed one), since
     both need the same read on "what is this team actually trying to do". */
  teamMode(t) {
    if (t.ppgP >= 60) return 'contend';
    if (t.valP <= 40 && t.ppgP <= 40) return 'rebuild';
    return 'flexible';
  },
  MODE_LABEL: { contend: 'Contending', rebuild: 'Rebuilding', flexible: 'Flexible timeline' },

  /* Whether the SPECIFIC assets moving fit a team's timeline — on-plan for a rebuild
     is younger + more picks; on-plan for a contender is picks spent to get younger or
     no worse. This is the subset of trade.html's analyzeSide() that's computable from
     just the moved assets, with no "before/after roster" reconstruction: age direction
     and pick-capital direction, not the optimal-lineup PPG shift (which needs a full
     roster simulation Trade Grades can't do for a trade that already happened). */
  timelineFitNotes(team, incoming, outgoing) {
    const mode = Vault.teamMode(team);
    const weightedAge = list => {
      const p = list.filter(a => a.type === 'player' && a.age > 0 && a.value > 0);
      const sum = p.reduce((s, a) => s + a.value, 0);
      return sum ? p.reduce((s, a) => s + a.value * a.age, 0) / sum : null;
    };
    const ageIn = weightedAge(incoming), ageOut = weightedAge(outgoing);
    const dAge = (ageIn != null && ageOut != null) ? ageIn - ageOut : 0;
    const picksValue = list => list.filter(a => a.type === 'pick').reduce((s, a) => s + a.value, 0);
    const dPicks = picksValue(incoming) - picksValue(outgoing);

    const notes = [];
    let fit = 0;
    if (mode === 'rebuild') {
      if (dAge > 0.4) { notes.push({ tone: 'bad', text: `Gets ${dAge.toFixed(1)} yrs older while rebuilding — wrong direction for the timeline.` }); fit -= 2; }
      else if (dAge < -0.4) { notes.push({ tone: 'good', text: `Gets ${Math.abs(dAge).toFixed(1)} yrs younger — on-plan for a rebuild.` }); fit += 1; }
      if (dPicks < -1500) { notes.push({ tone: 'bad', text: `Trades away ${Math.round(Math.abs(dPicks)).toLocaleString()} in draft capital — contradicts a rebuild.` }); fit -= 2; }
      else if (dPicks > 1500) { notes.push({ tone: 'good', text: `Adds ${Math.round(dPicks).toLocaleString()} in draft capital — on-plan for a rebuild.` }); fit += 2; }
    } else if (mode === 'contend') {
      if (dAge > 1.5) notes.push({ tone: 'neutral', text: `Adds ${dAge.toFixed(1)} yrs of age — tolerable for a win-now roster, but watch the cliff.` });
      else if (dAge < -0.4) { notes.push({ tone: 'good', text: `Gets younger without giving up contention.` }); fit += 1; }
      if (dPicks < -1500) { notes.push({ tone: 'good', text: `Spends ${Math.round(Math.abs(dPicks)).toLocaleString()} in future picks to win now — the right move for a contender if those picks weren't needed.` }); fit += 1; }
      else if (dPicks > 1500) notes.push({ tone: 'neutral', text: `Banks ${Math.round(dPicks).toLocaleString()} in picks — fine, but a contender should usually prioritize immediate roster strength.` });
    } else {
      if (Math.abs(dPicks) > 1500) notes.push({ tone: 'neutral', text: `${dPicks > 0 ? 'Adds' : 'Spends'} ${Math.round(Math.abs(dPicks)).toLocaleString()} in draft capital.` });
      if (Math.abs(dAge) > 0.5) notes.push({ tone: 'neutral', text: `${dAge > 0 ? 'Gets older' : 'Gets younger'} by ${Math.abs(dAge).toFixed(1)} yrs.` });
    }
    return { mode, dAge, dPicks, fit, notes };
  },

  /* Mode-aware read on an optimal-starting-lineup PPG swing (dOpt = after.opt -
     before.opt from a real or reconstructed before/after roster pair). Shared by
     trade.html's analyzeSide (live before/after) and Trade Grades (reconstructs
     before/after via Vault.simulateTrade run in reverse on a historical trade) so
     both use the exact same current-lineup-strength read. */
  optShiftNote(mode, dOpt) {
    if (mode === 'rebuild') {
      if (dOpt > 5) return { tone: 'neutral', text: `Raises optimal PPG by ${dOpt.toFixed(1)}, but current-season points aren't the priority right now.`, fit: 0 };
      return null;
    }
    if (mode === 'contend') {
      if (dOpt > 3) return { tone: 'good', text: `Raises optimal lineup PPG by ${dOpt.toFixed(1)} — a real scoring upgrade right now.`, fit: 2 };
      if (dOpt < -3) return { tone: 'bad', text: `Drops optimal PPG by ${Math.abs(dOpt).toFixed(1)} — hurts scoring while you're trying to win.`, fit: -2 };
      return null;
    }
    if (dOpt > 3) return { tone: 'good', text: `Raises optimal lineup PPG by ${dOpt.toFixed(1)}.`, fit: 1 };
    if (dOpt < -3) return { tone: 'bad', text: `Drops optimal lineup PPG by ${Math.abs(dOpt).toFixed(1)}.`, fit: -1 };
    return null;
  },

  /* Position-aware young/prime/veteran read on a single PLAYER — 'young' (a rebuild
     target), 'veteran' (a contend target), or null for prime-years players, who are
     good for either timeline and so get no archetype adjustment. Unknown/missing age
     also returns null rather than guessing. Picks aren't handled here — the caller
     classifies them as 'young' directly, since age doesn't apply. */
  assetTimelineClass(a) {
    if (!(a.age > 0)) return null;
    const band = VAULT_CONFIG.ARCH_AGE_BANDS[a.pos] || VAULT_CONFIG.ARCH_AGE_BAND_DEFAULT;
    if (a.age <= band.young) return 'young';
    if (a.age >= band.veteran) return 'veteran';
    return null;
  },

  /* Turns a short one-line headline/verdict plus a pile of already-well-formed bullet
     notes into a 2-3 sentence prose synopsis, so a reader gets the gist without
     parsing every bullet — the lead line, then the single most relevant downside and
     upside (the first bad/good note in the array; every caller already orders notes
     most-specific-signal-first, so "first" is a reasonable stand-in for "most
     relevant" without needing a separate weight on each one). Reuses the notes'
     existing text verbatim rather than re-synthesizing new prose from their pieces,
     so the synopsis can never say something the bullets below it don't already back
     up. The full bullet list still renders separately for anyone who wants every
     reason, not just the headline two. */
  buildSynopsis(leadText, notes) {
    const meaningful = notes.filter(n => !n.isArchetype && n.tone !== 'neutral');
    const bad = meaningful.find(n => n.tone === 'bad');
    const good = meaningful.find(n => n.tone === 'good');
    const trimmed = (leadText || '').trim();
    const lead = trimmed ? (/[.!?]$/.test(trimmed) ? trimmed : trimmed + '.') : '';
    return [lead, bad && bad.text, good && good.text].filter(Boolean).join(' ');
  },

  /* A player already producing like a proven starter, regardless of age — the Jahmyr
     Gibbs case: young, but already an elite every-week producer, not a "developmental"
     asset a contender should have to wait on. Reuses VBA_REFERENCE (5500) as the bar,
     since that's already the point where VBA itself starts treating a player as
     plus-starter-caliber rather than discounting them — not a new arbitrary number. */
  isProvenProducer(a) {
    return a.type === 'player' && a.ppg > 0 && a.value >= VAULT_CONFIG.VBA_REFERENCE;
  },

  /* Does the specific asset moving fit the team's own timeline (rebuild/contend/
     flexible, from teamMode) — a rebuilder should see a pick or a young player as
     worth MORE than sticker price (exactly what they're stockpiling for) and a proven
     veteran as worth LESS, on paper value fairness aside; a contender gets the
     opposite read. Age band decides this for a rebuilder regardless of current
     production — a rebuild wants the years whether the player has broken out yet or
     not. A contender's read also checks production: a young player who's ALREADY an
     elite producer (isProvenProducer) isn't treated as a misfit just for being young
     — see the module comment above. Flexible teams, and any PLAYER in their
     position's prime years with no production override (assetTimelineClass returns
     null), get no adjustment either way. Scales with the asset's own value (via the
     same raw-display/adjusted-scoring split as positionalFitNotes) rather than a flat
     bonus regardless of size. */
  archetypeFitNotes(team, incoming, outgoing) {
    const mode = Vault.teamMode(team);
    const notes = [];
    if (mode === 'flexible') return { archFit: 0, notes };
    let dollarSwing = 0;

    const kindOf = (a, cls) => a.type === 'pick' ? 'a future pick' : (cls === 'young' ? `a ${a.age}-year-old` : 'a proven veteran');
    const planWord = mode === 'rebuild' ? 'rebuild' : 'win-now push';

    // Returns null (no archetype read at all) or a {fitsMode, cls} verdict for one asset.
    const evaluate = a => {
      if (a.type === 'pick') return { fitsMode: mode === 'rebuild', cls: 'young' };
      const cls = Vault.assetTimelineClass(a);
      if (cls == null) return null; // prime-years player — good for either timeline
      if (mode === 'rebuild') return { fitsMode: cls === 'young', cls };
      // contend: a young-but-already-producing player reads as neither a misfit
      // nor specifically the reason the trade fits — same as a prime-years player.
      if (cls === 'young' && Vault.isProvenProducer(a)) return null;
      return { fitsMode: cls === 'veteran', cls };
    };

    const scan = (list, isIncoming) => {
      list.forEach(a => {
        if (!(a.value > 0)) return;
        const verdict = evaluate(a);
        if (!verdict) return;
        const { fitsMode, cls } = verdict;
        const mult = fitsMode ? VAULT_CONFIG.ARCH_FIT_MULTIPLIER : VAULT_CONFIG.ARCH_MISFIT_MULTIPLIER;
        const rawDisplay = Math.round(a.value).toLocaleString();
        const weightedDisplay = Math.round(a.value * mult).toLocaleString();
        const delta = Vault.adjustedValue(a.value) * mult - Vault.adjustedValue(a.value);
        if (Math.abs(delta) < 1) return;

        if (isIncoming) {
          dollarSwing += delta;
          notes.push(fitsMode
            ? { tone: 'good', text: `${a.name} is ${kindOf(a, cls)} — exactly what a ${planWord} wants, worth closer to ${weightedDisplay} than its ${rawDisplay} sticker price.` }
            : { tone: 'bad', text: `${a.name} is ${kindOf(a, cls)} — doesn't fit a ${planWord}, really worth closer to ${weightedDisplay} here.` });
        } else {
          dollarSwing -= delta;
          notes.push(!fitsMode
            ? { tone: 'good', text: `Deals away ${a.name} (${kindOf(a, cls)}) — didn't fit the ${planWord} anyway, worth closer to ${weightedDisplay} to give up.` }
            : { tone: 'bad', text: `Gives up ${a.name}, ${kindOf(a, cls)} that fit the ${planWord} — costs more than the ${rawDisplay} sticker price suggests.` });
        }
      });
    };
    scan(incoming, true);
    scan(outgoing, false);

    const archFit = team.total ? Math.max(-3, Math.min(3, dollarSwing / team.total * 120)) : 0;
    return { archFit, notes };
  },

  /* Picks the single biggest storyline for one side of a trade — the positional
     theme with the largest dollar weight if there is one, otherwise an age or
     pick-capital direction. Wording is tone-neutral ("added RB depth" rather than
     "piled onto a surplus") but the returned `tone` still travels with it, since
     tradeHighlight needs to know whether this theme agrees or clashes with that
     side's value outcome to pick "and" vs. "but" — the colored bullets below carry
     the full judgment either way. Returns null if nothing here is notable enough to
     name (small moves, or a flexible-timeline team with no signal either way). */
  sideTheme(posResult, dAge, dPicks, mode) {
    if (posResult && posResult.notes.length) {
      const top = [...posResult.notes].sort((a, b) => (b.absDelta || 0) - (a.absDelta || 0))[0];
      if (top && top.phrase) return { phrase: top.phrase, tone: top.tone };
    }
    if (dAge <= -0.4) return { phrase: 'got younger', tone: 'good' };
    if (dAge >= 0.4) return { phrase: 'got older', tone: 'bad' };
    if (dPicks >= 1500) return { phrase: 'added draft capital', tone: mode === 'rebuild' ? 'good' : 'neutral' };
    if (dPicks <= -1500) return mode === 'contend' ? { phrase: 'spent picks to win now', tone: 'good' } : { phrase: 'gave up draft capital', tone: 'bad' };
    return null;
  },

  /* One-sentence trade recap in the "Team A lost X value, but added RB depth, while
     Team B got younger" style — leads with the value swing (or "landed close to
     even" under the Fair cutoff), then each side's single biggest theme from
     sideTheme, if it has one. The connector before Team A's theme is "but" only when
     its tone actually contrasts with whether Team A gained or gave up value (e.g.
     gave up value BUT addressed a need); two results pointing the same way ("gave up
     value AND gave up a need") get "and" instead, so the sentence doesn't force a
     contrast that isn't there. Shared by the Trade Calculator's overall verdict and
     Trade Grades' per-trade verdict so both tell the story the same way. */
  tradeHighlight(teamAName, teamBName, dValueAdjA, avgSideAdj, themeA, themeB) {
    const pct = avgSideAdj ? Math.abs(dValueAdjA) / avgSideAdj * 100 : 0;
    const amt = Math.round(Math.abs(dValueAdjA)).toLocaleString();
    const close = pct < VAULT_CONFIG.FAIR_PCT;
    const aGained = dValueAdjA >= 0;
    const lead = close
      ? `${teamAName} and ${teamBName} landed close to even in value`
      : `${teamAName} ${aGained ? 'gained' : 'gave up'} about ${amt} in value`;

    const extras = [];
    if (themeA) {
      const contrasts = !close && ((aGained && themeA.tone === 'bad') || (!aGained && themeA.tone === 'good'));
      extras.push(`${contrasts ? 'but' : 'and'} ${themeA.phrase}`);
    }
    if (themeB) extras.push(`while ${teamBName} ${themeB.phrase}`);
    return extras.length ? `${lead}, ${extras.join(', ')}.` : `${lead}.`;
  },

  /* ---------- Flaws ----------
     Deliberately broad: this used to require a near-catastrophic gap (e.g. a
     position at <55% of league average) before flagging anything, which meant
     most teams — teams that are just below-average somewhere, not disastrous —
     showed "no critical flaws" and the section read as mostly empty. These
     thresholds surface ordinary, worth-knowing weaknesses instead of only
     extremes. */
  fatalFlaws(t, leagueAvg) {
    const flaws = [];
    const rbOld = t.plist.filter(p => p.pos === 'RB' && p.age >= 27).reduce((s, p) => s + p.value, 0);
    const rbTotal = t.rb || 1;
    if (rbOld / rbTotal > 0.4) flaws.push(`RB Age Cliff: ${Math.round(rbOld / rbTotal * 100)}% of RB value is 27+`);
    const wrOld = t.plist.filter(p => p.pos === 'WR' && p.age >= 29).reduce((s, p) => s + p.value, 0);
    const wrTotal = t.wr || 1;
    if (wrOld / wrTotal > 0.4) flaws.push(`WR Age Cliff: ${Math.round(wrOld / wrTotal * 100)}% of WR value is 29+`);
    const pos = { QB: t.qb, RB: t.rb, WR: t.wr, TE: t.te };
    Object.entries(pos).forEach(([k, v]) => {
      // leagueAvg is keyed lowercase (qb/rb/wr/te) — this used to look up
      // leagueAvg[k] with the uppercase label key and silently always miss.
      const avg = leagueAvg[k.toLowerCase()];
      if (avg && v < avg * 0.85) flaws.push(`${k} Weakness: ${Math.round(v).toLocaleString()} vs league avg ${Math.round(avg).toLocaleString()}`);
    });
    if (t.picksValue < leagueAvg.picks * 0.85) flaws.push(`Pick Poor: ${Math.round(t.picksValue).toLocaleString()} pick value vs league avg ${Math.round(leagueAvg.picks).toLocaleString()}`);
    // Depth check is relative to the team's own roster, not a fixed headcount —
    // a fixed threshold like "16" never fires in deep superflex formats where
    // every team rosters 30+ valued players.
    const rosterSize = t.plist.filter(p => p.value > 0).length;
    const starters = t.plist.filter(p => p.value > 1000).length;
    if (rosterSize && starters / rosterSize < 0.7) flaws.push(`Thin Depth: only ${starters} of ${rosterSize} rostered players clear 1k value`);
    if (leagueAvg.age && t.age > leagueAvg.age + 1) flaws.push(`Aging Core: ${t.age.toFixed(1)} avg age vs league ${leagueAvg.age.toFixed(1)}`);
    const topAssets = [...t.plist].filter(p => p.value > 0).sort((a, b) => b.value - a.value).slice(0, 3);
    const top3Share = t.total ? topAssets.reduce((s, p) => s + p.value, 0) / t.total : 0;
    if (top3Share > 0.4) flaws.push(`Top-Heavy: top 3 players are ${Math.round(top3Share * 100)}% of total value`);
    return flaws.slice(0, 3);
  },

  /* ---------- Trade partner suggestions ----------
     Promoted from Team Analyzer so the Trade Calculator can surface the same "who
     should I actually call" read while a trade is being built, not just after the
     fact. Scores every other team by need/surplus complementarity (both directions),
     timeline gap (age), and pick-capital imbalance — no trade-specific assets
     involved yet, just whether two rosters are shaped to make a deal work. */
  tradePartnerSuggestions(t, all, limit = 2) {
    const { needs, surpluses } = Vault.positionalProfile(t, all);
    return all.filter(o => o.rosterId !== t.rosterId).map(o => {
      const { needs: theirNeeds, surpluses: theirSurplus } = Vault.positionalProfile(o, all);
      let score = 0;
      const reasons = [];
      needs.forEach(n => {
        if (theirSurplus.includes(n)) { score += 3; reasons.push(`They're deep at ${n.toUpperCase()} — your biggest need`); }
      });
      surpluses.forEach(s => {
        if (theirNeeds.includes(s)) { score += 2; reasons.push(`You're deep at ${s.toUpperCase()} — something they're missing`); }
      });
      if (Math.abs(t.age - o.age) > 2.5) {
        score += 1;
        reasons.push(t.age > o.age ? `They're ${(t.age - o.age).toFixed(1)} yrs younger — different timelines can make a deal work` : `You're ${(o.age - t.age).toFixed(1)} yrs younger — different timelines can make a deal work`);
      }
      if (t.picksValue < 5000 && o.picksValue > 8000) { score += 2; reasons.push(`They're pick-rich (${Math.round(o.picksValue).toLocaleString()}) while you're pick-poor`); }
      if (t.picksValue > 8000 && o.picksValue < 5000) { score += 2; reasons.push(`You're pick-rich while they're pick-poor (${Math.round(o.picksValue).toLocaleString()})`); }
      if (!reasons.length) reasons.push('Roughly matched value and timeline — no glaring need overlap');
      return { ...o, fit: score, reasons };
    }).sort((a, b) => b.fit - a.fit).slice(0, limit);
  },

  /* ---------- Trade grading pipeline ----------
     Promoted from Trade Grades so a second page (the Manager page) can run the exact
     same real-trade grading without re-implementing or drifting from it. */
  resolveTradeAssets(tx, sideRosterId, playersDb, valMap, pickValueByKey, ppgMap) {
    const assets = [];
    Object.entries(tx.adds || {}).forEach(([pid, toRoster]) => {
      if (toRoster !== sideRosterId) return;
      const p = playersDb[pid] || {};
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || `Player ${pid}`;
      assets.push({ type: 'player', id: String(pid), name, pos: p.position || '', age: p.age || 0, team: p.team || '', ppg: ppgMap.get(pid) || 0, value: valMap.get(Vault.normalizeName(name)) || 0 });
    });
    (tx.draft_picks || []).forEach(pk => {
      if (pk.owner_id !== sideRosterId) return;
      const info = pickValueByKey.get(`${pk.season}-${pk.round}-${pk.roster_id}`);
      assets.push({ type: 'pick', name: `${pk.season} R${pk.round}`, pos: 'PICK', age: 0, value: info ? info.value : 0 });
    });
    return assets;
  },

  // Value fairness is gated first (Fair/Borderline/Lopsided), then each side's
  // combined fit (positional need/surplus + rebuild/contend timeline + archetype +
  // optimal-lineup swing) decides the sub-label. Below the Lopsided cutoff a real
  // dollar tilt is the norm for an actual trade, not a finding worth naming — the
  // badge shown alongside this label already communicates the price gap.
  historyVerdict(pctDiff, dValueAdjA, fitA, fitB, teamAName, teamBName, avgSideAdj, posResultA, posResultB, timelineA, timelineB) {
    const good = s => s >= 2, bad = s => s <= -2;
    const themeA = Vault.sideTheme(posResultA, timelineA.dAge, timelineA.dPicks, timelineA.mode);
    const themeB = Vault.sideTheme(posResultB, timelineB.dAge, timelineB.dPicks, timelineB.mode);
    const text = Vault.tradeHighlight(teamAName, teamBName, dValueAdjA, avgSideAdj, themeA, themeB);

    if (pctDiff >= VAULT_CONFIG.LOPSIDED_PCT) {
      const favored = dValueAdjA >= 0 ? 'A' : 'B';
      return { tone: 'bad', label: `Lopsided — Favored Team ${favored}`, text };
    }
    if (good(fitA) && good(fitB)) return { tone: 'good', label: 'Great Trade — Worked for Both Sides', text };
    if (bad(fitA) && bad(fitB)) return { tone: 'bad', label: 'Questionable for Both Sides', text };
    if (good(fitA) && bad(fitB)) return { tone: 'neutral', label: 'Won for Team A', text };
    if (good(fitB) && bad(fitA)) return { tone: 'neutral', label: 'Won for Team B', text };
    if (good(fitA) || good(fitB)) return { tone: 'neutral', label: 'Solid for One Side, Fine for the Other', text };
    return { tone: 'neutral', label: 'Fair Trade', text };
  },

  gradeTrade(tx, teamById, playersDb, valMap, pickValueByKey, teams, ppgMap, slots) {
    const [rA, rB] = tx.roster_ids;
    const teamA = teamById.get(rA), teamB = teamById.get(rB);
    if (!teamA || !teamB) return null;

    const toA = Vault.resolveTradeAssets(tx, rA, playersDb, valMap, pickValueByKey, ppgMap); // what A received (B gave)
    const toB = Vault.resolveTradeAssets(tx, rB, playersDb, valMap, pickValueByKey, ppgMap); // what B received (A gave)
    if (!toA.length && !toB.length) return null;

    const aGaveAdj = toB.reduce((s, a) => s + Vault.adjustedValue(a.value), 0);
    const bGaveAdj = toA.reduce((s, a) => s + Vault.adjustedValue(a.value), 0);
    const avgAdj = (aGaveAdj + bGaveAdj) / 2 || 1;
    const pctDiff = Math.abs(aGaveAdj - bGaveAdj) / avgAdj * 100;
    const dValueAdjA = bGaveAdj - aGaveAdj; // positive = A came out ahead on value

    const fitA = Vault.positionalFitNotes(teamA, teams, toA, toB);
    const fitB = Vault.positionalFitNotes(teamB, teams, toB, toA);
    const timelineA = Vault.timelineFitNotes(teamA, toA, toB);
    const timelineB = Vault.timelineFitNotes(teamB, toB, toA);
    const archA = Vault.archetypeFitNotes(teamA, toA, toB);
    const archB = Vault.archetypeFitNotes(teamB, toB, toA);

    // Reconstruct each team's optimal-lineup PPG the day before this trade by running
    // Vault.simulateTrade in reverse: passing what each side actually RECEIVED as the
    // "give" list undoes the trade against their CURRENT roster.
    const sim = Vault.simulateTrade(teams, slots, rA, rB, toA, toB);
    const dOptA = sim.before.A.opt - sim.after.A.opt;
    const dOptB = sim.before.B.opt - sim.after.B.opt;
    const optNoteA = Vault.optShiftNote(timelineA.mode, dOptA);
    const optNoteB = Vault.optShiftNote(timelineB.mode, dOptB);

    const combinedFitA = fitA.posFit + timelineA.fit + archA.archFit + (optNoteA ? optNoteA.fit : 0);
    const combinedFitB = fitB.posFit + timelineB.fit + archB.archFit + (optNoteB ? optNoteB.fit : 0);

    const verdict = Vault.historyVerdict(pctDiff, dValueAdjA, combinedFitA, combinedFitB, teamA.teamName, teamB.teamName, avgAdj, fitA, fitB, timelineA, timelineB);
    const anyMissingValue = [...toA, ...toB].some(a => a.value <= 0);

    return { tx, teamA, teamB, toA, toB, pctDiff, dValueAdjA, fitA, fitB, timelineA, timelineB, archA, archB, dOptA, dOptB, optNoteA, optNoteB, combinedFitA, combinedFitB, verdict, anyMissingValue, created: tx.created };
  },

  /* Full fetch-build-grade pipeline for a league's real trade history — shared by
     Trade Grades and the Manager page so both read the exact same graded trades
     instead of running two copies of this fetch that could drift apart. */
  async fetchAndGradeAllTrades(leagueId) {
    const { league, isSF, teams, slots } = await Vault.buildLeagueTeams(leagueId);
    const [playersDb, ktcData, projData, ...weeks] = await Promise.all([
      fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json()),
      Vault.fetchKtcValues(),
      Vault.fetchProjections(),
      ...[...Array(18)].map((_, i) => fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${i + 1}`).then(r => r.json()).catch(() => []))
    ]);
    const valMap = Vault.buildKtcValueMap(ktcData, isSF);
    const ppgMap = Vault.buildProjectedPpgMapById(projData, league.scoring_settings);

    const pickValueByKey = new Map();
    teams.forEach(t => t.picks.forEach(p => pickValueByKey.set(`${p.season}-${p.round}-${p.original}`, p)));
    const teamById = new Map(teams.map(t => [t.rosterId, t]));

    const seen = new Set();
    const trades = weeks.flat().filter(t => t && t.type === 'trade' && t.status === 'complete' && (t.roster_ids || []).length === 2 && !seen.has(t.transaction_id) && seen.add(t.transaction_id));

    const allGraded = trades.map(tx => Vault.gradeTrade(tx, teamById, playersDb, valMap, pickValueByKey, teams, ppgMap, slots)).filter(Boolean);
    return { league, isSF, teams, slots, allGraded };
  },

  /* ---------- Manager tendencies ----------
     Aggregates every graded trade into a per-manager record — not just net value,
     but HOW they trade: volume, whether their trades fit their own timeline, pick
     direction, age direction, and their lopsided-trade record. Shared basis for
     Trade Grades' league summary and the Manager page's fuller profile.
     `teams` (optional, the full league from buildLeagueTeams) seeds every manager
     with a zero-trade record first — without it, a manager who's made zero trades
     silently disappears instead of showing up as "hasn't traded". */
  buildManagerStats(allGraded, teams) {
    const byTeam = new Map();
    const ensure = team => {
      if (!byTeam.has(team.rosterId)) byTeam.set(team.rosterId, {
        teamName: team.teamName, rosterId: team.rosterId,
        trades: 0, won: 0, lost: 0, netValue: 0, fitSum: 0,
        netPicks: 0, ageDeltaSum: 0,
        fair: 0, borderline: 0, lopsided: 0, lopsidedFor: 0, lopsidedAgainst: 0,
        best: null, worst: null,
        posNet: { QB: 0, RB: 0, WR: 0, TE: 0 },
        youthIn: 0, youthOut: 0, veteranIn: 0, veteranOut: 0,
        nflTeamCounts: new Map(),
        picksInCount: 0, picksOutCount: 0,
        optUpCount: 0, optDownCount: 0
      });
      return byTeam.get(team.rosterId);
    };
    (teams || []).forEach(ensure);
    allGraded.forEach(g => {
      [
        { team: g.teamA, dVal: g.dValueAdjA, fit: g.combinedFitA, timeline: g.timelineA, opp: g.teamB.teamName, received: g.toA, given: g.toB, dOpt: g.dOptA },
        { team: g.teamB, dVal: -g.dValueAdjA, fit: g.combinedFitB, timeline: g.timelineB, opp: g.teamA.teamName, received: g.toB, given: g.toA, dOpt: g.dOptB }
      ].forEach(({ team, dVal, fit, timeline, opp, received, given, dOpt }) => {
        const s = ensure(team);
        s.trades++; s.netValue += dVal; s.fitSum += fit;
        s.netPicks += timeline.dPicks; s.ageDeltaSum += timeline.dAge;
        if (dVal > 0) s.won++; else if (dVal < 0) s.lost++;
        if (timeline.dPicks > 500) s.picksInCount++; else if (timeline.dPicks < -500) s.picksOutCount++;
        if (dOpt > 1) s.optUpCount++; else if (dOpt < -1) s.optDownCount++;
        const bucket = g.pctDiff >= VAULT_CONFIG.LOPSIDED_PCT ? 'lopsided' : g.pctDiff >= VAULT_CONFIG.FAIR_PCT ? 'borderline' : 'fair';
        s[bucket]++;
        if (bucket === 'lopsided') { if (dVal > 0) s.lopsidedFor++; else s.lopsidedAgainst++; }
        const rec = { opp, dVal, pctDiff: g.pctDiff, created: g.tx.created };
        if (!s.best || dVal > s.best.dVal) s.best = rec;
        if (!s.worst || dVal < s.worst.dVal) s.worst = rec;

        // Which positions this manager nets toward/away from, across every trade.
        ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
          const inVal = received.filter(a => a.pos === pos).reduce((sum, a) => sum + a.value, 0);
          const outVal = given.filter(a => a.pos === pos).reduce((sum, a) => sum + a.value, 0);
          s.posNet[pos] += inVal - outVal;
        });
        // Youth-vs-veteran tilt, using the same position-aware age bands archetype
        // fit already relies on — not just a flat average age delta.
        received.forEach(a => {
          const cls = Vault.assetTimelineClass(a);
          if (cls === 'young') s.youthIn += a.value; else if (cls === 'veteran') s.veteranIn += a.value;
        });
        given.forEach(a => {
          const cls = Vault.assetTimelineClass(a);
          if (cls === 'young') s.youthOut += a.value; else if (cls === 'veteran') s.veteranOut += a.value;
        });
        // NFL-team clustering on players actually acquired — surfaces a real
        // "keeps buying into the same real-life offense" pattern if one exists.
        received.filter(a => a.type === 'player' && a.team).forEach(a => {
          s.nflTeamCounts.set(a.team, (s.nflTeamCounts.get(a.team) || 0) + 1);
        });
      });
    });
    return [...byTeam.values()].map(s => ({
      ...s,
      avgFit: s.trades ? s.fitSum / s.trades : 0,
      avgAgeDelta: s.trades ? s.ageDeltaSum / s.trades : 0
    })).sort((a, b) => b.netValue - a.netValue);
  },

  // Turns one manager's aggregated stats into plain-English tendency notes — the
  // narrative layer a raw stat line can't carry on its own.
  managerTendencyNotes(s, leagueAvgTrades) {
    if (s.trades === 0) return [{ tone: 'neutral', text: "Hasn't made a trade this season." }];
    const notes = [];
    if (leagueAvgTrades > 0) {
      if (s.trades >= leagueAvgTrades * 1.5) notes.push({ tone: 'neutral', text: `Active trader — ${s.trades} trades vs. a league average of ${leagueAvgTrades.toFixed(1)}.` });
      else if (s.trades <= leagueAvgTrades * 0.5) notes.push({ tone: 'neutral', text: `Rarely trades — just ${s.trades} vs. a league average of ${leagueAvgTrades.toFixed(1)}.` });
    }
    if (s.trades >= 3) {
      const winRate = s.won / s.trades;
      if (winRate >= 0.65) notes.push({ tone: 'good', text: `Wins on value more often than not (${s.won}-${s.lost} record).` });
      else if (s.lost > s.won && s.lost / s.trades >= 0.6) notes.push({ tone: 'bad', text: `Comes out behind on value more often than not (${s.won}-${s.lost} record).` });
    }
    if (s.avgFit >= 1.5) notes.push({ tone: 'good', text: `Trades tend to fit the team's own timeline and needs, not just the sticker price.` });
    else if (s.avgFit <= -1.5) notes.push({ tone: 'bad', text: `Trades often work against the team's own timeline or needs, even when the dollars are close.` });
    if (s.trades >= 3) {
      // Trade-type frequency, not just net dollar direction — "how often", not
      // "how much". A manager can average a small net pick gain while still
      // clearly being a picks-first trader in most of their individual deals.
      if (s.picksInCount >= Math.ceil(s.trades * 0.6)) notes.push({ tone: 'neutral', text: `Frequently trades for draft picks — ${s.picksInCount} of ${s.trades} deals net picks.` });
      else if (s.picksOutCount >= Math.ceil(s.trades * 0.6)) notes.push({ tone: 'neutral', text: `Frequently trades picks away — ${s.picksOutCount} of ${s.trades} deals spend picks.` });
      if (s.avgAgeDelta <= -0.5) notes.push({ tone: 'neutral', text: `Consistently gets younger through trades (avg ${s.avgAgeDelta.toFixed(1)} yrs/trade).` });
      else if (s.avgAgeDelta >= 0.5) notes.push({ tone: 'neutral', text: `Consistently gets older through trades (avg +${s.avgAgeDelta.toFixed(1)} yrs/trade).` });
      // Does this manager only make moves that actually help their starting lineup?
      if (s.optUpCount >= Math.ceil(s.trades * 0.75)) notes.push({ tone: 'good', text: `Almost exclusively makes trades that raise the starting lineup's PPG (${s.optUpCount} of ${s.trades}).` });
      else if (s.optDownCount >= Math.ceil(s.trades * 0.6)) notes.push({ tone: 'bad', text: `Often trades away from lineup strength — ${s.optDownCount} of ${s.trades} deals lowered Opt PPG.` });
    }
    if (s.trades >= 2) {
      // Which single position this manager's trades lean toward or away from —
      // only surfaced when it's a real pattern, not incidental noise.
      const posEntries = Object.entries(s.posNet).filter(([, v]) => Math.abs(v) >= 1500);
      if (posEntries.length) {
        const [pos, net] = posEntries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
        notes.push({ tone: 'neutral', text: net > 0
          ? `Net accumulates ${pos} value across trades (+${Math.round(net).toLocaleString()}).`
          : `Net trades away ${pos} value across trades (${Math.round(net).toLocaleString()}).` });
      }
      // Youth-vs-veteran tilt, using the same position-aware age bands the
      // archetype fit check relies on rather than a flat average age.
      const youthNet = s.youthIn - s.youthOut, veteranNet = s.veteranIn - s.veteranOut;
      if (youthNet >= 1500 && youthNet > veteranNet) notes.push({ tone: 'neutral', text: `Buys youth — nets +${Math.round(youthNet).toLocaleString()} in young assets across trades.` });
      else if (veteranNet >= 1500 && veteranNet > youthNet) notes.push({ tone: 'neutral', text: `Buys proven veterans — nets +${Math.round(veteranNet).toLocaleString()} in veteran-aged assets across trades.` });
      // A real cluster of acquired players from the same NFL team, if one exists.
      if (s.nflTeamCounts.size) {
        const [team, count] = [...s.nflTeamCounts.entries()].sort((a, b) => b[1] - a[1])[0];
        if (count >= 3) notes.push({ tone: 'neutral', text: `Has acquired ${count} players from ${team} across trades — a real cluster.` });
      }
    }
    if (s.lopsided >= 2) {
      if (s.lopsidedFor > s.lopsidedAgainst) notes.push({ tone: 'good', text: `Has come out ahead in most of their own lopsided trades (${s.lopsidedFor} of ${s.lopsided}).` });
      else if (s.lopsidedAgainst > s.lopsidedFor) notes.push({ tone: 'bad', text: `Has been on the losing end of most of their own lopsided trades (${s.lopsidedAgainst} of ${s.lopsided}).` });
    }
    if (!notes.length) notes.push({ tone: 'neutral', text: 'Not enough trade history yet for a clear read.' });
    return notes;
  }
};
