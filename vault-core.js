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
  // Typical falloff age per position (the age production tends to start declining)
  // and the per-year decay rate past it, once it does — used by contentionWindow's
  // 5-year projection so aging is modeled per-position, not by one flat team-wide cutoff.
  POSITION_DECAY: { RB: [26, 0.85], WR: [27, 0.92], QB: [30, 0.96], TE: [28, 0.93] },
  // Value Based Adjustment: boosts assets above VBA_REFERENCE, discounts those
  // below it, so a single elite piece outweighs several mid-tier pieces summing
  // to the same raw value. Fitted against a real KeepTradeCut trade-calculator
  // comparison (Ja'Marr Chase vs. DeVonta Smith + Brock Purdy, which KTC itself
  // flagged with a +5239 "Value Adjustment" on Chase, a ~53% premium) rather
  // than picked by feel — see Vault.adjustedValue.
  VBA_REFERENCE: 5500,
  VBA_EXPONENT: 1.7,
  // KeepTradeCut's own consolidation-adjustment curve (Vault.consolidationAdjustment)
  // normalizes against roughly the highest single value on their whole site plus a
  // small buffer (their live code: top player's value + 100, which sits right at
  // 10099 given KTC's scale tops out at 9999) — our KTC-sourced data shares that
  // same 0-9999 scale, so the same constant applies without needing to look it up
  // fresh from our own dataset every time.
  CONSOLIDATION_GLOBAL_MAX: 10099,
  // How much a position's need/surplus status (see Vault.positionalProfile) scales
  // an asset's value to the team involved — a real need is worth more than sticker
  // price to the team receiving it (or costs more than sticker price to give up),
  // a surplus position is worth less either way. Applied per-asset so the swing
  // scales with the asset's own value, not a flat bonus regardless of size.
  POS_NEED_MULTIPLIER: 1.15,
  POS_SURPLUS_MULTIPLIER: 0.85,
  // How much of the incoming-surplus penalty above still applies to a REBUILDING
  // team specifically (see Vault.positionalFitNotes) — a rebuild is banking future
  // value, not fielding this year's roster, so "already deep here" shouldn't cost
  // it much. Dampened, not zeroed: a real dump of redundant depth is still weaker
  // value than the same dollars at a real need, just not penalized as if the team
  // were trying to win now with a bloated position group.
  REBUILD_SURPLUS_DAMPEN: 0.3,
  // How much the "leaves this team thin" outgoing-need penalty still applies when
  // the departing player is priced mostly on upside, not current production (see
  // Vault.positionalFitNotes) — the roster-body-count check that drives "need"
  // can't otherwise tell a real starter from a stash apart; this is the same
  // dampening idea as REBUILD_SURPLUS_DAMPEN, just gated on the ASSET's own
  // price/production gap instead of the team's timeline.
  SPECULATIVE_NEED_DAMPEN: 0.3,
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
  // Fair/Borderline/Lopsided cutoffs for the value-diff %, shared by the Trade
  // Calculator and Trade Grades. Originally 6/15 (picked by feel), then 10/35 —
  // both calibrated against the same ~25,000 real completed trades pulled from
  // KeepTradeCut's trade database (data/ktc-trades.json), resolved via whatever
  // value-diff formula was live at the time, to land on a real, non-arbitrary
  // target: ~27% of real, mutually-agreed trades read as "Fair," ~31% as
  // "Lopsided" (the shape a manually-picked 6/15 badly missed, calling 62% of
  // real trades "Lopsided").
  //
  // Re-run after Vault.consolidationAdjustment (the KTC-algorithm port) replaced
  // the old VBA curve as the value-diff basis here — the two formulas don't
  // distribute the same way. Consolidation-adjusted, real trades run WIDER
  // (median ~27% off vs. the old curve's ~21%) because it correctly stops
  // touching evenly-matched-piece-count trades at all (avg ~18% off vs. the old
  // curve's ~23% — that noise was the old per-asset curve reacting to raw value
  // even when there was no real piece-count asymmetry to reward) while applying
  // real, much bigger swings specifically to 1-for-several trades (avg ~50% off
  // vs. the old curve's ~37%). Reusing 10/35 against this wider distribution
  // over-called Lopsided (38.8% of real trades, vs. the 30.3% target) and
  // under-called Fair (19.3% vs. 27.1%). 14/41 reproduces the original real-world
  // target almost exactly (27.2%/42.4%/30.4%).
  FAIR_PCT: 14,
  LOPSIDED_PCT: 41,
  // How many percentile points apart a player's value-rank and PPG-rank at their own
  // position (see buildLeagueTeams' valueRiskGap) have to be before it's worth
  // calling out as a real disagreement rather than the normal noise between two
  // independently-sourced numbers. 35 was picked by inspecting the real spread of
  // gaps across this league's actual rostered players — modest, expected gaps (like
  // a rookie slightly outprojecting a veteran QB at a similar price) mostly land
  // under 20; genuinely notable cases (an aging star WR still producing near the
  // top of the position on a bottomed-out trade price, or a rookie stash priced on
  // pure potential with next to no projected production yet) start around 35-40+.
  VALUE_RISK_GAP: 35
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

  /* ---------- Consolidation adjustment (v3 — ported from KeepTradeCut's live calculator) ----------
     v2 above (adjustedValue) is a per-asset curve: every player gets a premium or
     discount based on their OWN value alone, independent of what they're being
     traded against. Comparing it against KeepTradeCut's real trade calculator
     (extracted directly from their live client-side JS — this isn't a guess, it's
     their actual formula) showed that's the wrong SHAPE entirely: KTC's own
     "Value Adjustment" pays out ~0% on a clean 1-for-1 of two $10,000 players, and
     ~0% on a 2-piece-for-2-piece trade too, but ~65-80% on a single elite piece
     against 2-4 fragmented pieces of similar raw total — it's a genuine "one true
     difference-maker beats several good-but-replaceable pieces" bonus, sized by
     the PIECE-COUNT MISMATCH between the two sides of a specific trade, not by any
     one asset's value in isolation. A pure per-asset curve structurally cannot
     reproduce that (it inflates a $10,000 player by the same amount whether he's
     traded 1-for-1 or 1-for-3), which is why this needs its own two-sided function
     instead of being folded into adjustedValue.

     Tested against KTC's live calculator across value tiers ($1,000-$9,500),
     piece-count ratios (1v2 through 2v3), and lopsidedness (holding one side fixed
     and sweeping the other's total from well-behind to well-ahead) — real examples:
       - 1-for-1, any value: ~0% (no piece-count asymmetry to reward)
       - 2-for-2, near-equal total: ~0-3%, suppressed to 0 (matched piece counts)
       - 1-for-2, near-equal total: ~66%, stable across the whole value range tested
       - 1-for-3: ~77%; 1-for-4: ~81% (bigger fragmentation gap = bigger bonus)
       - 2-for-3, near-equal total: ~40% (same +1-piece gap as 1-for-2, but a
         smaller bonus, since the consolidated side isn't down to one true
         difference-maker anymore)
       - Bonus peaks near a raw-value near-tie and decays hard as one side pulls
         further ahead on raw dollars — by ~40% ahead it's within noise, and KTC
         hides anything under ~3.3% of the combined total regardless.

     processVConsolidation(v, r) is KTC's per-player curve (r = the single highest
     asset value across BOTH sides of the trade, not just this side). The 10099
     term inside it is KTC's own hardcoded literal (confirmed directly from their
     live site.min.js — it's baked into their forward curve, not derived from
     anything we control), kept here as CONSOLIDATION_GLOBAL_MAX.

     Re-verified 2026-09-19 directly against KTC's real client-side source (fetched
     live, function-for-function) after finding a real bug: a 1-vs-9-piece trade
     (one elite RB vs. nine real 3rd-round picks) read as "Fair, 1.4% off" — which
     turned out to be genuinely correct, KTC's real site says the same thing at
     that exact piece count — but ONE more piece (1-vs-10) caused OUR port to
     collapse the bonus back to zero and swing wildly, which is NOT what the real
     site does; it keeps a smooth, sensible bonus. The earlier version treated
     KTC's real tie-break sub-branch (used whenever the ratio-based and raw-total-
     based comparisons disagree on which side is ahead) as an "unreachable
     recovery branch" and gave up (valid=false) instead of implementing it — it
     was very much reachable. Fixed by porting that branch for real (see
     Vault.consolidationAdjustment below), fuzz-tested against KTC's actual
     extracted source across 5,000 randomized trades (0 mismatches beyond
     Newton's-method rounding noise) before shipping. One more real fix from the
     same investigation: KTC's inverse solver (reverseAdjustNew) takes the trade's
     reference ceiling as `playersArray[0].value + 100` — the CURRENT highest-
     valued player in their whole universe, not the hardcoded 10099 the forward
     curve uses — so it drifts over time as prices move. Vault._globalMaxValue
     (set by buildKtcValueMap whenever current values are resolved) tracks this
     live instead of freezing it at whatever it happened to be when this was built. */
  processVConsolidation(v, r) {
    const g = VAULT_CONFIG.CONSOLIDATION_GLOBAL_MAX;
    return (0.1 * Math.pow(v / g, 1.4) + 0.7 * Math.pow(v / (1.05 * r), 1.25) + 0.2) * v;
  },

  // Is |x - y| within tolerancePct of (x + y)? Shared "close enough" check the
  // consolidation algorithm uses twice (once on raw totals, once on the per-player
  // curve sums) before deciding which side's total even qualifies for a bonus.
  checkEquality(x, y, tolerancePct) {
    x = Math.max(0, x); y = Math.max(0, y);
    const total = x + y;
    if (!total) return true;
    const pctOff = Math.min(100, Math.abs(x - y) / total * 100);
    return Math.round(pctOff * 10) / 10 <= tolerancePct;
  },

  // Inverts processVConsolidation for a fixed r: finds X such that
  // processVConsolidation(X, r) = target. Newton's method, same as KTC's own
  // solveForX. `globalMax` is the live reference ceiling (see the comment above
  // processVConsolidation) — a real, separate value from `r` (this trade's own
  // biggest asset), not the same number under two names.
  solveConsolidation(target, globalMax, r) {
    const f = x => (0.1 * Math.pow(x / globalMax, 1.4) + 0.7 * Math.pow(x / (1.05 * r), 1.25) + 0.2) * x - target;
    const fp = x => 0.24 * Math.pow(x, 1.4) / Math.pow(globalMax, 1.4) + 1.575 * Math.pow(x, 1.25) / (Math.pow(1.05, 1.25) * Math.pow(r, 1.25)) + 0.2;
    let x = 5 * target;
    for (let i = 0; i < 20; i++) {
      const dx = f(x) / fp(x);
      const next = x - dx;
      if (Math.abs(next - x) < 1e-8) return Math.round(next);
      x = next;
    }
    return Math.round(x);
  },

  /* Main entry point: two sides' raw asset values (VBA plays no part here — this
     works in raw dollars, matching KTC's own calculator), returns how much to add
     to each side's raw total, plus whether the bonus is meaningful enough to call
     out (KTC's own ~3.3%-of-combined-total display floor). Needs at least one side
     to have 2+ pieces (a clean 1-for-1 never qualifies, regardless of value) and
     both sides non-empty — on KTC's real site this gate lives in the CALLER
     (evaluateTrade only renders the adjustment when either side has 2+ pieces),
     not inside this function, but the effect is identical since nothing else here
     depends on it running unconditionally.

     Structure mirrors KTC's real adjustPackageNew exactly (verified live, see the
     comment above processVConsolidation): try the "both totals AND both curve-
     scored totals already roughly agree" case first (favor whichever side has the
     higher curve score); otherwise fall back to whichever side the RATIO of curve-
     score-to-raw-total favors, which can itself disagree with which side has the
     higher raw curve score — that disagreement is the tie-break branch, resolved
     by a second solve against which side's running total (real total, not curve
     score) is currently behind. Every failure path (a computed bonus that comes
     out negative, or one that exceeds MAXPLAYERVAL) falls back to no adjustment —
     KTC's real code computes something for the OTHER side in a couple of these
     cases too, but never displays it (see the display gate at the end), so the
     net externally-visible effect is the same as just not adjusting. */
  consolidationAdjustment(values1, values2) {
    const zero = { adjust1: 0, adjust2: 0, display: false };
    if (!values1.length || !values2.length) return zero;
    if (values1.length <= 1 && values2.length <= 1) return zero;
    const total1 = values1.reduce((s, v) => s + v, 0);
    const total2 = values2.reduce((s, v) => s + v, 0);
    if (!total1 || !total2) return zero;

    const globalMax = (Vault._globalMaxValue || (VAULT_CONFIG.CONSOLIDATION_GLOBAL_MAX - 100)) + 100;
    const r = Math.max(...values1, ...values2);
    const pv = v => Vault.processVConsolidation(v, r);
    const rawAdj1 = values1.reduce((s, v) => s + pv(v), 0);
    const rawAdj2 = values2.reduce((s, v) => s + pv(v), 0);
    const d = rawAdj1 / total1, u = rawAdj2 / total2;
    const gap = Math.floor(Math.abs(rawAdj1 - rawAdj2));
    const fairRaw = Vault.checkEquality(total1, total2, 5);
    const fairAdj = Vault.checkEquality(rawAdj1, rawAdj2, 5);
    const solve = target => Vault.solveConsolidation(target, globalMax, r);

    let adjust1 = 0, adjust2 = 0, valid = true;
    const favor1 = () => {
      const b = total2 + solve(gap) - total1;
      if (b > 0) adjust1 = b; else valid = false;
    };
    const favor2 = () => {
      const b = total1 + solve(gap) - total2;
      if (b > 0) adjust2 = b; else valid = false;
    };
    // Reached when the ratio (d vs u) and the raw curve scores (rawAdj1 vs
    // rawAdj2) disagree on which side is ahead — this is what our previous port
    // treated as unreachable and gave up on. `g` picks whichever side's actual
    // running total is currently behind; a second solve against the raw gap
    // between the two sides' curve scores decides the bonus. `side1Primary`
    // matches KTC's own two call sites (one from the d>u branch, one from the
    // u>=d branch), which check g===1 vs g===2 in opposite order and — a real
    // quirk in KTC's own code, reproduced exactly rather than "corrected" — the
    // "not capped" case of the secondary check credits the OTHER side, not the
    // one `g` identified as behind.
    const tieBreak = side1Primary => {
      let g = -1;
      if (total1 + adjust1 < total2 + adjust2) g = 1;
      else if (total2 + adjust2 < total1 + adjust1) g = 2;
      if (g < 0) { valid = false; return; }
      const w = solve(Math.abs(rawAdj1 - rawAdj2));
      if (!(w > 0)) { valid = false; return; }
      if (side1Primary) {
        if (g === 2) {
          const T = w - (total1 - total2);
          if (T > 0) adjust2 = T; else valid = false;
        } else {
          const T = w - (total2 - total1);
          if (T > 0) { if (T > VAULT_CONFIG.CONSOLIDATION_GLOBAL_MAX) valid = false; else adjust2 = T; }
          else adjust1 = -1 * T; // real quirk: credited to side 1 here, and still valid
        }
      } else {
        if (g === 1) {
          const T = w - (total2 - total1);
          if (T > 0) adjust1 = T; else valid = false;
        } else {
          const T = w - (total1 - total2);
          if (T > 0) { if (T > VAULT_CONFIG.CONSOLIDATION_GLOBAL_MAX) valid = false; else adjust1 = T; }
          else adjust2 = -1 * T; // mirror of the quirk above, credited to side 2
        }
      }
    };

    if (fairRaw && fairAdj) {
      if (rawAdj1 > rawAdj2) favor1();
      else if (rawAdj2 > rawAdj1) favor2();
    } else if (d > u) {
      if (rawAdj1 > rawAdj2) favor1();
      else tieBreak(true);
    } else {
      if (rawAdj2 > rawAdj1) favor2();
      else tieBreak(false);
    }

    const finalAdj = adjust1 || adjust2 || 0;
    if (!finalAdj) return zero;
    let display = valid;
    if (Math.abs(finalAdj / (total1 + total2)) < 0.033) display = false;
    return { adjust1, adjust2, display };
  },

  meanStd(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const std = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
    return { mean, std };
  },

  // The real playoff cutoff, not the league average — in a league that sends most
  // teams to the playoffs (e.g. 6 of 10), "average" and "playoff-caliber" are very
  // different bars, since the average team by definition sits at the 50th percentile
  // while the playoff line sits wherever playoffSpots/teams actually falls (60th
  // percentile for 6-of-10). Shared by contentionWindow and buildLeagueTeams'
  // archetype production axis, so "Contender" and "in playoff position" mean the
  // same thing everywhere instead of two different bars with the same name.
  playoffLine(teams) {
    const playoffSpots = Math.max(4, Math.ceil(teams.length * 0.6));
    const sortedPPG = [...teams].map(t => t.opt).sort((a, b) => b - a);
    return { playoffSpots, playoffLine: sortedPPG[playoffSpots - 1] || sortedPPG[sortedPPG.length - 1] };
  },
  fmtInt(n) { return Number.isFinite(n) ? Math.round(n).toLocaleString() : '—'; },
  fmtFloat(n, d = 2) { return Number.isFinite(n) ? n.toFixed(d) : '—'; },
  escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));
  },

  // Sleeper's settings.type: 0 = redraft, 1 = keeper, 2 = dynasty. Everything this
  // app models — rebuild/contend archetypes, contention windows, 4-year pick-value
  // curves — only means anything for a dynasty league, so anything else needs to be
  // refused up front rather than quietly producing numbers that don't mean anything.
  isDynastyLeague(league) {
    return !!(league && league.settings && league.settings.type === 2);
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
    if (!Vault.isDynastyLeague(league)) throw new Error(`"${league.name}" is a redraft/keeper league, not dynasty — The Vault only supports dynasty leagues.`);
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

  // KTC only prices Tight End Premium at two discrete bonus tiers — 0.5 ("TEP") and
  // 1.0 ("TEPP") — but a league's own bonus_rec_te can be set to anything, so this
  // picks whichever tier is closest instead of requiring an exact match, and falls
  // through to the plain (no-TEP) field below a 0.25 bonus. Suffix appended to the
  // 'sf'/'oneQB' field names fetch-ktc.js writes to ktc-values.json.
  ktcTepSuffix(bonusRecTe) {
    const b = +bonusRecTe || 0;
    if (b < 0.25) return '';
    if (b < 0.75) return '_tep';
    return '_tepp';
  },

  buildKtcValueMap(ktcData, isSF, bonusRecTe) {
    const field = (isSF ? 'sf' : 'oneQB') + Vault.ktcTepSuffix(bonusRecTe);
    const map = new Map();
    let maxVal = 0;
    (ktcData.players || []).forEach(p => {
      const key = Vault.normalizeName(p.name);
      if (!key) return;
      const v = p[field];
      map.set(key, v);
      if (v > maxVal) maxVal = v;
    });
    // Tracks the CURRENT single highest-valued player (in this format/TEP tier) —
    // the reference ceiling Vault.consolidationAdjustment needs, kept live instead
    // of frozen at whatever it happened to be when that code was written. Real
    // work every time this runs (once per league load, not a hot path).
    if (maxVal) Vault._globalMaxValue = maxVal;
    return map;
  },

  /* ---------- Value history ----------
     data/player-value-history.json and data/pick-value-history.json are UNIVERSAL,
     league-agnostic daily price time series — written by scripts/snapshot-value-
     history.js (same Action as the KTC refresh) for every player/pick KTC ranks,
     not filtered to any one league's roster. Both files exist from the start
     (seeded empty) so these never 404. A specific league's own team-by-team value
     history (which roster/picks it held on which day) is reconstructed live from
     these two files by Vault.buildTeamValueHistory below — there's no per-league
     stored file for that, so it works for any league immediately. */
  async fetchPlayerValueHistory() {
    try {
      const res = await fetch('data/player-value-history.json');
      if (!res.ok) return { snapshots: [] };
      return res.json();
    } catch { return { snapshots: [] }; }
  },
  async fetchPickValueHistory() {
    try {
      const res = await fetch('data/pick-value-history.json');
      if (!res.ok) return { snapshots: [] };
      return res.json();
    } catch { return { snapshots: [] }; }
  },

  // A player-value-history / pick-value-history entry always carries plain sf/oneQB;
  // the TEP/TEPP fields only exist where KTC's own history actually differs from
  // plain (real TEs, for players — always present for picks), so this falls back to
  // plain when the league's TEP tier isn't stored on that particular entry. Mirrors
  // Vault.ktcTepSuffix's field-naming convention exactly.
  resolveHistoricalValue(entry, isSF, bonusRecTe) {
    if (!entry) return null;
    const base = isSF ? 'sf' : 'oneQB';
    const field = base + Vault.ktcTepSuffix(bonusRecTe);
    const v = entry[field] ?? entry[base];
    return v == null ? null : v;
  },

  /* data/player-history.json is a one-time pull (scripts/fetch-player-history.js,
     run manually — not part of the daily Action) of real, RAW end-of-season stat
     totals for every dynasty-relevant player (anyone KTC currently ranks), going
     back to each player's rookie year. Keyed by Sleeper player_id. Stats are raw
     (not pre-scored) so any league can score them to its own real scoring_settings
     via Vault.scoreStats — see Vault.playerSeasonPpg below. */
  async fetchPlayerHistory() {
    try {
      const res = await fetch('data/player-history.json');
      if (!res.ok) return { seasons: [], players: {} };
      return res.json();
    } catch { return { seasons: [], players: {} }; }
  },

  // Real season PPG for one player-season, scored to THIS league's actual settings
  // — the historical-stats analog of buildProjectedPpgMapById/ByName.
  playerSeasonPpg(stats, scoringSettings) {
    if (!stats || !stats.gp) return null;
    return Vault.scoreStats(stats, scoringSettings) / stats.gp;
  },

  /* ---------- Live, per-league team-value history ----------
     There's no stored file for "this league's roster/picks on day X" — that's
     reconstructed here, on demand, for whichever league is loaded, from real
     Sleeper history (drafts + transactions + traded picks) plus the two universal
     price-history files above. Any dynasty league works immediately, with no setup
     or backfill step, the first time anyone loads it.

     Two disclosed simplifications (same tradeoffs the original single-league
     backfill made, kept because reconstructing them properly needs full historical
     standings, a separate and much larger problem):
       1. A pick's tier (early/mid/late) is fixed ONCE from TODAY's real
          standings-based draft order, not recomputed for every historical day.
       2. TODAY's row always uses the league's real current roster/pick ownership
          (never the replayed state) — replay is only trusted for days before today,
          so a page never shows a "today" number that disagrees with the rest of the
          live app even if a replay edge case (an admin action with no transaction
          record, etc.) can't be perfectly reconstructed.
     Unlike the one-time Node backfill this replaces, this runs in a visitor's
     browser for an arbitrary league it has never validated against — so it never
     throws on a replay mismatch; it logs a warning and degrades gracefully instead
     of breaking the page. */
  async buildTeamValueHistory(leagueId) {
    const { league, users, rosters, players, traded, drafts } = await Vault.fetchSleeperCore(leagueId);
    const isSF = (league.roster_positions || []).includes('SUPER_FLEX');
    const bonusRecTe = league.scoring_settings?.bonus_rec_te;
    const slots = (league.roster_positions || []).filter(s => !['BN', 'IR', 'TAXI'].includes(s));
    const userMap = new Map(users.map(u => [u.user_id, u]));

    const [weeks, draftPickSets, playerHist, pickHist, projData] = await Promise.all([
      Promise.all([...Array(18)].map((_, i) =>
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${i + 1}`).then(r => r.json()).catch(() => []))),
      Promise.all((drafts || []).map(d =>
        fetch(`https://api.sleeper.app/v1/draft/${d.draft_id}/picks`).then(r => r.json()).catch(() => []).then(picks => ({ draft: d, picks })))),
      Vault.fetchPlayerValueHistory(),
      Vault.fetchPickValueHistory(),
      Vault.fetchProjections()
    ]);
    const transactions = weeks.flat().filter(t => t && t.status === 'complete');
    const realDrafts = draftPickSets.filter(d => d.picks.length > 0);

    const allEventDates = [
      ...realDrafts.map(d => new Date(d.draft.start_time)),
      ...transactions.map(t => new Date(t.created))
    ];
    if (!allEventDates.length) return { snapshots: [] }; // brand-new league — nothing to replay yet

    const playerByDate = new Map(playerHist.snapshots.map(s => [s.date, s.players || {}]));
    const pickByDate = new Map(pickHist.snapshots.map(s => [s.date, s.picks || {}]));
    const playerDates = [...playerByDate.keys()].sort();
    const pickDates = [...pickByDate.keys()].sort();
    function latestOnOrBefore(sortedDates, target) {
      let best = null;
      for (const d of sortedDates) { if (d <= target) best = d; else break; }
      return best;
    }

    // Today's real projected PPG (for optimal-lineup math) — same join Vault.
    // buildProjectedPpgMapById already does, just inlined since this needs it
    // per-pid, not per-name.
    const ppgByPid = new Map();
    Object.entries(projData.players || {}).forEach(([pid, p]) => {
      if (p.stats?.gp) ppgByPid.set(pid, Vault.scoreStats(p.stats, league.scoring_settings) / p.stats.gp);
    });

    // ---- Roster replay: who held which player on which day ----
    const events = [];
    realDrafts.forEach(({ draft, picks }) => {
      const date = new Date(draft.start_time);
      picks.forEach(pk => { if (pk.player_id) events.push({ date, rosterId: pk.roster_id, add: String(pk.player_id) }); });
    });
    transactions.forEach(t => {
      const date = new Date(t.created);
      Object.entries(t.adds || {}).forEach(([pid, rosterId]) => events.push({ date, rosterId, add: String(pid) }));
      Object.entries(t.drops || {}).forEach(([pid, rosterId]) => events.push({ date, rosterId, drop: String(pid) }));
    });
    events.sort((a, b) => a.date - b.date);

    const dayZero = Math.min(...allEventDates.map(d => +d));
    const startDay = Date.UTC(new Date(dayZero).getUTCFullYear(), new Date(dayZero).getUTCMonth(), new Date(dayZero).getUTCDate());
    const now = new Date();
    const todayDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const DAY_MS = 24 * 60 * 60 * 1000;

    const rosterOfPid = new Map(rosters.map(r => [r.roster_id, new Set()]));

    // ---- Pick replay: who held which pick on which day ----
    const pickYears = Vault.futurePickYears(league, drafts);
    const PICK_ROUNDS = VAULT_CONFIG.PICK_ROUNDS;
    function currentOptPpg(r) {
      const plist = (r.players || []).map(pid => {
        const p = players[String(pid)];
        return p ? { id: String(pid), pos: p.position || '', ppg: ppgByPid.get(String(pid)) || 0 } : null;
      }).filter(Boolean);
      return Vault.optimalLineup(plist, slots);
    }
    const draftOrder = [...rosters].sort((a, b) => currentOptPpg(b) - currentOptPpg(a)); // best team first
    const nTeams = draftOrder.length;
    const draftRank = new Map(draftOrder.map((r, i) => [r.roster_id, nTeams - i]));

    const pickAssets = [];
    pickYears.forEach(season => PICK_ROUNDS.forEach(round => rosters.forEach(r => {
      const rank = draftRank.get(r.roster_id);
      const overall = (round - 1) * nTeams + rank;
      const { round: ktcRound, tier } = Vault.ktcPickSlot(overall);
      pickAssets.push({ season, round, originalRoster: r.roster_id, label: `${season}-${ktcRound}-${tier}` });
    })));

    // KTC's pick grid can lag this league's tracked years (e.g. no 2029 pricing
    // yet) — fall back each asset's label to the nearest season KTC actually
    // prices, same reasoning as Vault.buildKtcPickMap.
    const todayPickRow = pickHist.snapshots[pickHist.snapshots.length - 1]?.picks || {};
    const pricedSeasons = [...new Set(Object.keys(todayPickRow).map(k => +k.split('-')[0]))].sort((a, b) => a - b);
    if (pricedSeasons.length) {
      pickAssets.forEach(a => {
        if (todayPickRow[a.label]) return;
        const [season, round, tier] = a.label.split('-');
        const nearest = pricedSeasons.reduce((best, y) => Math.abs(y - (+season)) < Math.abs(best - (+season)) ? y : best, pricedSeasons[0]);
        a.label = `${nearest}-${round}-${tier}`;
      });
    }

    const ownerOf = new Map(pickAssets.map(a => [`${a.season}-${a.round}-${a.originalRoster}`, a.originalRoster]));
    const pickEvents = [];
    transactions.forEach(t => (t.draft_picks || []).forEach(pk => {
      if (!pickYears.includes(+pk.season)) return;
      pickEvents.push({ date: new Date(t.created), key: `${pk.season}-${pk.round}-${pk.roster_id}`, newOwner: pk.owner_id });
    }));
    pickEvents.sort((a, b) => a.date - b.date);

    // Real current pick ownership, straight from Sleeper — used for TODAY's row
    // (never the replay) and as the ground truth a replay drift gets checked against.
    const realPickOwner = new Map(ownerOf);
    traded.filter(p => pickYears.includes(+p.season)).forEach(p => {
      const to = Number(p.owner_id);
      if (to && to !== p.roster_id) realPickOwner.set(`${p.season}-${p.round}-${p.roster_id}`, to);
    });

    // ---- Day-by-day replay ----
    const snapshots = [];
    let eventIdx = 0, pickEventIdx = 0;
    for (let dayStart = startDay; dayStart <= todayDay; dayStart += DAY_MS) {
      const isToday = dayStart === todayDay;
      const cursor = dayStart + DAY_MS - 1;
      while (eventIdx < events.length && +events[eventIdx].date <= cursor) {
        const e = events[eventIdx];
        const set = rosterOfPid.get(e.rosterId);
        if (set) { if (e.add) set.add(e.add); if (e.drop) set.delete(e.drop); }
        eventIdx++;
      }
      while (pickEventIdx < pickEvents.length && +pickEvents[pickEventIdx].date <= cursor) {
        const e = pickEvents[pickEventIdx];
        if (ownerOf.has(e.key)) ownerOf.set(e.key, e.newOwner);
        pickEventIdx++;
      }

      const date = new Date(dayStart).toISOString().slice(0, 10);
      const pvDate = latestOnOrBefore(playerDates, date);
      const pkDate = latestOnOrBefore(pickDates, date);
      const playerVals = pvDate ? playerByDate.get(pvDate) : null;
      const pickVals = pkDate ? pickByDate.get(pkDate) : null;

      const teams = rosters.map(r => {
        const u = userMap.get(r.owner_id) || {};
        const teamName = u.metadata?.team_name || u.display_name || 'Team';
        const pidSet = isToday ? new Set((r.players || []).map(String)) : (rosterOfPid.get(r.roster_id) || new Set());
        let playerValue = 0;
        const plist = [];
        pidSet.forEach(pid => {
          const p = players[pid];
          if (!p) return;
          const nameKey = Vault.normalizeName(`${p.first_name || ''} ${p.last_name || ''}`.trim());
          const v = playerVals ? Vault.resolveHistoricalValue(playerVals[nameKey], isSF, bonusRecTe) : null;
          playerValue += v || 0;
          plist.push({ id: pid, pos: p.position || '', ppg: ppgByPid.get(pid) || 0 });
        });
        const optPpg = Vault.optimalLineup(plist, slots);

        let picksValue = 0;
        pickAssets.forEach(a => {
          const ownerKey = `${a.season}-${a.round}-${a.originalRoster}`;
          const owner = isToday ? realPickOwner.get(ownerKey) : ownerOf.get(ownerKey);
          if (owner !== r.roster_id) return;
          const v = pickVals ? Vault.resolveHistoricalValue(pickVals[a.label], isSF, bonusRecTe) : null;
          picksValue += v || 0;
        });

        const playerValueR = Math.round(playerValue), picksValueR = Math.round(picksValue);
        return { rosterId: r.roster_id, teamName, playerValue: playerValueR, picksValue: picksValueR, total: playerValueR + picksValueR, optPpg: +optPpg.toFixed(1) };
      });
      snapshots.push({ date, teams });
    }

    // Replay drift is a real gap in what Sleeper's public API exposes (an admin
    // action with no transaction record, etc.), not something worth breaking a
    // visitor's page over — today's row already uses real state regardless, so
    // this only affects how precise PAST days are. Log it and move on.
    rosters.forEach(r => {
      const real = new Set((r.players || []).map(String));
      const replayed = rosterOfPid.get(r.roster_id) || new Set();
      if (replayed.size !== real.size || [...real].some(pid => !replayed.has(pid))) {
        console.warn(`Vault.buildTeamValueHistory: roster ${r.roster_id} (${(userMap.get(r.owner_id) || {}).display_name || 'unknown'}) replay drifted from Sleeper's real current roster — historical days may be slightly off for this team.`);
      }
    });

    return { snapshots };
  },

  /* KTC's pick grid rolls forward each spring after that year's rookie draft, so its
     available seasons can lag a league's actual future pick years by a year. Map
     each of the league's years to whichever KTC season is closest rather than
     hardcoding either. `years` comes from Vault.futurePickYears. */
  buildKtcPickMap(ktcData, isSF, years, bonusRecTe) {
    const field = (isSF ? 'sf' : 'oneQB') + Vault.ktcTepSuffix(bonusRecTe);
    const raw = new Map();
    const seasons = new Set();
    (ktcData.picks || []).forEach(p => {
      raw.set(`${p.season}-${p.round}-${p.slot}`, p[field]);
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
      // fetch-projections.js sums each player's real per-week projections (weeks
      // 1-FANTASY_WEEKS), so p.stats.gp is their own real count of weeks with a
      // projection — not Sleeper's own season-long gp, which is a placeholder equal
      // to the week count of the season for every player. Dividing by it directly
      // (rather than a league-wide constant) accounts for each player's own bye
      // week without assuming everyone's falls in the same place.
      if (!p.stats.gp) return;
      map.set(pid, Vault.scoreStats(p.stats, scoringSettings) / p.stats.gp);
    });
    return map;
  },

  buildProjectedPpgMapByName(projData, scoringSettings) {
    const map = new Map();
    Object.values(projData.players || {}).forEach(p => {
      const key = Vault.normalizeName(p.name);
      if (!p.stats.gp || !key) return;
      map.set(key, Vault.scoreStats(p.stats, scoringSettings) / p.stats.gp);
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
    const bonusRecTe = scoringSettings?.bonus_rec_te;
    const valMap = Vault.buildKtcValueMap(ktcData, isSF, bonusRecTe);
    const ppgMap = Vault.buildProjectedPpgMapById(projData, scoringSettings);
    const pickMap = Vault.buildKtcPickMap(ktcData, isSF, pickYears, bonusRecTe);
    return { valMap, ppgMap, pickMap };
  },

  /* One-line meaning + badge color of each label `archetype()` can return, keyed by
     name — shown as tooltips wherever an archetype pill appears and as the glossary
     on League Overview. Two independent axes — CONTENDING (current value + production:
     "how strong are you right now") and LONGEVITY (Vault.contentionWindow's 5-year,
     position-decay projection: "how many more years will THIS roster stay playoff-
     caliber") — each banded Top 2 / Top Half / Bottom Half / Bottom 2 of the league,
     collapsed to 9 names. Draft capital (picks) deliberately does NOT feed this grid —
     see the buildLeagueTeams comment above Vault.rebuildScore for why blending it in
     here was the actual bug this replaced: a team can be pick-poor and still project
     the longest window in the league (already-elite, still-prime production), or
     pick-rich and still project a short one (nothing's hit yet) — those are different
     facts and picks are already their own visible column. Mirror off-diagonal cells
     (strong-now/short-window vs. weak-now/long-window) intentionally get DIFFERENT
     names — collapsing those two into one label ("Balanced") was the other half of
     the bug, hiding that two teams with opposite profiles looked identical. See
     Vault.ARCHETYPE_GRID for the exact cell-to-name mapping. */
  ARCHETYPE_INFO: {
    'Powerhouse': { cls: 'from-amber-500/20 to-yellow-500/20 text-amber-200 border-amber-600/40', desc: 'Top-tier value and production right now, AND the longest projected contention window in the league — nothing to give up, nothing missing.' },
    'Contender': { cls: 'from-amber-600/15 to-yellow-600/15 text-amber-300/90 border-amber-700/30', desc: 'Strong now and projected to stay competitive for a while too — a real contender, just not the team with the single longest runway.' },
    'Win-Now': { cls: 'from-orange-500/20 to-red-600/20 text-orange-200 border-orange-600/40', desc: 'Strong right now, but this exact core won’t stay this good as long as the league’s best-positioned teams — the value is in cashing in while it’s here, not a knock on the roster.' },
    'Going For It': { cls: 'from-orange-600/25 to-red-700/25 text-orange-100 border-orange-700/50', desc: 'Elite production paired with the shortest projected window in the league — about as all-in as a roster gets. The bill comes due soon, but that IS what going for it means.' },
    'Balanced': { cls: 'from-zinc-600/20 to-neutral-600/20 text-zinc-200 border-zinc-600/40', desc: 'Middling on both fronts — not clearly built for now or for later, could tip either direction depending on what happens next.' },
    'Rebuilder': { cls: 'from-sky-600/20 to-cyan-600/20 text-sky-200 border-sky-600/40', desc: 'Not much going on today, but projected to be genuinely competitive for years once it comes together — building on purpose, not by accident.' },
    'Teardown': { cls: 'from-cyan-700/25 to-sky-800/25 text-cyan-100 border-cyan-700/50', desc: 'The weakest team today, but with the longest projected runway in the league — a full, deliberate rebuild around what’s coming rather than what’s here.' },
    'Limbo': { cls: 'from-slate-600/20 to-slate-700/20 text-slate-200 border-slate-600/40', desc: 'Weak today with a short-to-average runway ahead, without being the very worst — a roster that needs an actual plan.' },
    'Lightweight': { cls: 'from-stone-700/30 to-stone-800/30 text-stone-300 border-stone-700/40', desc: 'The least of both — weak today, and the shortest projected window in the league too.' }
  },

  /* Which quarter of the league (by rank, 1 = best) a team sits in on one axis —
     Top 2 / Top Half / Bottom Half / Bottom 2. Rank-based rather than z-score: these
     labels are pure standings position ("you're one of the two best right now"),
     which stays true even when the gap to the next team is a rounding error, unlike
     the old percentile-forced H/M/L tiers which implied a meaningful gap a near-tie
     couldn't always back up. cut scales with league size (20%, minimum 1) so this
     isn't hardcoded to exactly 10 teams. */
  /* Short qualifier text for a team's draft-capital tier (t.pickTier from
     buildLeagueTeams), shown alongside the archetype pill — see the ARCHETYPE_INFO
     comment above for why picks get their own visible label instead of being folded
     into the archetype name. */
  PICK_TIER_LABEL: { top2: 'Loaded picks', topHalf: 'Solid picks', bottomHalf: 'Thin picks', bottom2: 'Bare picks' },

  rankBand(rank, n) {
    const cut = Math.max(1, Math.round(n * 0.2));
    if (rank <= cut) return 'top2';
    if (rank <= Math.ceil(n / 2)) return 'topHalf';
    if (rank > n - cut) return 'bottom2';
    return 'bottomHalf';
  },

  /* Cell → archetype name for the 4x4 (contendTier x longevityTier) grid. Deliberately
     NOT symmetric the way the old grid was: a mirror pair (e.g. top2,bottomHalf vs.
     bottomHalf,top2) gets two DIFFERENT names, because "strong now, shorter window"
     and "weak now, longer window" are opposite situations, not one shared "Balanced"
     middle ground. Only cells that are genuinely similar in outlook (both axes near
     the same tier, or both mediocre-not-extreme) share a name. 16 cells, 9 names. */
  ARCHETYPE_GRID: {
    'top2,top2': 'Powerhouse',
    'top2,topHalf': 'Contender', 'topHalf,top2': 'Contender', 'topHalf,topHalf': 'Contender',
    'top2,bottomHalf': 'Win-Now', 'topHalf,bottomHalf': 'Win-Now',
    'top2,bottom2': 'Going For It', 'topHalf,bottom2': 'Going For It',
    'bottomHalf,top2': 'Rebuilder', 'bottomHalf,topHalf': 'Rebuilder', 'bottom2,topHalf': 'Rebuilder',
    'bottom2,top2': 'Teardown',
    'bottomHalf,bottomHalf': 'Balanced',
    'bottomHalf,bottom2': 'Limbo', 'bottom2,bottomHalf': 'Limbo',
    'bottom2,bottom2': 'Lightweight'
  },

  /* ---------- Archetype classifier (shared by app.html + team-analyzer.html) ----------
     Two independent axes, each answering a question in a different tense:
       - CONTENDING (t.contendTier): current value + production combined — "how
         strong are you right now." Built from valZ + ppgZ (see buildLeagueTeams),
         ranked and banded via Vault.rankBand.
       - LONGEVITY (t.longevityTier): "how many of the next 5 years will THIS roster
         still be playoff-caliber," straight from Vault.contentionWindow's real
         position-decay + arriving-picks projection (see buildLeagueTeams), ranked and
         banded the same way as contendTier.
     Earlier versions of this grid used age + picks blended together as the second
     axis ("Rebuilding") standing in for "how long will this last" — which is a
     different question. A team can be pick-poor with an average roster age and still
     project the LONGEST window in the league, if its production is already elite and
     nothing's near its decline cliff yet; blending picks into that axis read "no
     picks banked" as "not built to last" even when the actual 5-year projection said
     the opposite. Picks are still tracked (see Vault.rebuildScore, used by
     Vault.teamMode for trade-value posture, and the Picks column everywhere else) —
     they just don't drive this specific identity grid anymore. */
  archetype(t) {
    const key = `${t.contendTier},${t.longevityTier}`;
    const name = Vault.ARCHETYPE_GRID[key] || 'Balanced';
    return [name, Vault.ARCHETYPE_INFO[name].cls];
  },

  /* Best-lineup PPG for a player pool given a league's starting slots, plus which
     player actually fills each slot. Shared by buildLeagueTeams (which also wants
     the starters list, to show "the best lineup" on League Overview), simulateTrade
     (which only needs the total, re-run on a hypothetical post-trade roster), and
     anywhere else that only cares about the number. */
  optimalLineupDetail(plist, slots) {
    const pool = [...plist].sort((a, b) => b.ppg - a.ppg);
    const used = new Set();
    const starters = [];
    let total = 0;
    let vorpTotal = 0;
    for (const slot of slots) {
      let allowed = [slot];
      if (slot === 'FLEX') allowed = ['RB', 'WR', 'TE'];
      if (slot === 'SUPER_FLEX') allowed = ['QB', 'RB', 'WR', 'TE'];
      if (slot === 'WRRB_FLEX') allowed = ['RB', 'WR'];
      if (slot === 'REC_FLEX') allowed = ['WR', 'TE'];
      const i = pool.findIndex(p => !used.has(p.id) && allowed.includes(p.pos));
      if (i >= 0) {
        const p = pool[i];
        total += p.ppg;
        if (Number.isFinite(p.vorp)) vorpTotal += p.vorp;
        used.add(p.id);
        starters.push({ slot, id: p.id, name: p.name, pos: p.pos, ppg: p.ppg, vorp: p.vorp });
      } else {
        starters.push({ slot, id: null, name: null, pos: null, ppg: 0, vorp: null });
      }
    }
    return { total, vorpTotal, starters };
  },

  optimalLineup(plist, slots) {
    return Vault.optimalLineupDetail(plist, slots).total;
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

    // How many starters this league can ACTUALLY field at each position, counting
    // every flex type that's eligible for it (a Superflex slot counts for QB; FLEX/
    // WRRB_FLEX/SUPER_FLEX count for RB; etc). Used by positionalProfile so "surplus"
    // reflects real roster depth vs. this league's own format — a 3rd QB is full
    // Superflex depth (2 startable + 1 bye-week/insurance buffer), not surplus, even
    // though 3 rostered QBs would be real excess in a 1QB league with no Superflex.
    const startable = Vault.computeStartable(slots);
    // Replacement-level PPG per position, for VORP (see Vault.computeReplacementLevels)
    // — needs PPG joined by NAME across the whole KTC universe, not just rostered
    // players (buildProjectedPpgMapById only covers Sleeper IDs on THIS roster).
    const ppgByName = Vault.buildProjectedPpgMapByName(projData, league.scoring_settings);
    const replacementLevels = Vault.computeReplacementLevels(ktcData, ppgByName, startable, rosters.length);

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
        const ppg = ppgMap.get(String(pid)) || 0;
        return { id: String(pid), name: nm, pos: p.position || '', age: p.age || 0, value: valMap.get(Vault.normalizeName(nm)) || 0, ppg, vorp: Vault.vorp(ppg, p.position || '', replacementLevels) };
      });
      const total = plist.reduce((s, p) => s + p.value, 0);
      const qb = plist.filter(p => p.pos === 'QB').reduce((s, p) => s + p.value, 0);
      const rb = plist.filter(p => p.pos === 'RB').reduce((s, p) => s + p.value, 0);
      const wr = plist.filter(p => p.pos === 'WR').reduce((s, p) => s + p.value, 0);
      const te = plist.filter(p => p.pos === 'TE').reduce((s, p) => s + p.value, 0);
      // Count of ROSTERED players at each position with real trade value (mirrors
      // tradeableAssets' "meaningful asset" floor) — used alongside `startable` so
      // positionalProfile can tell "3 good QBs in a Superflex league" (full depth)
      // apart from "3 good QBs in a 1QB league" (real surplus), not just go by
      // dollar value percentile.
      const posFloor = Math.max(300, total * 0.02);
      const posCount = {
        qb: plist.filter(p => p.pos === 'QB' && p.value >= posFloor).length,
        rb: plist.filter(p => p.pos === 'RB' && p.value >= posFloor).length,
        wr: plist.filter(p => p.pos === 'WR' && p.value >= posFloor).length,
        te: plist.filter(p => p.pos === 'TE' && p.value >= posFloor).length
      };
      // Real production at each position — top-N by PPG where N is that position's
      // own startable-slot count, NOT a naive sum across every rostered player.
      // Summing would reward hoarding committee-back-caliber depth (five 8-PPG RBs
      // summing to more than two 18-PPG bell cows) over actually having good
      // starters, which is backwards — this mirrors the "best lineup fills slots"
      // logic in optimalLineupDetail rather than inventing a different notion of
      // positional strength. Dynasty value (qb/rb/wr/te above) can be high on a
      // position that isn't actually producing (hurt, buried, aging) or middling
      // value can be outproducing it — positionalProfile blends both signals
      // instead of trusting price alone.
      const topPpg = (pos, n) => plist.filter(p => p.pos === pos).map(p => p.ppg)
        .sort((a, b) => b - a).slice(0, n).reduce((s, v) => s + v, 0);
      const posPpg = {
        qb: topPpg('QB', startable.qb),
        rb: topPpg('RB', startable.rb),
        wr: topPpg('WR', startable.wr),
        te: topPpg('TE', startable.te)
      };
      const vAge = plist.filter(p => p.value > 0 && p.age > 0);
      const sumV = vAge.reduce((s, p) => s + p.value, 0);
      const age = sumV ? vAge.reduce((s, p) => s + p.value * p.age, 0) / sumV : 0;
      const { total: opt, vorpTotal, starters: lineup } = Vault.optimalLineupDetail(plist, slots);
      // Real season standings (Sleeper's own scoreboard record), not a value or
      // trade-derived stat — wins/losses/ties are tracked directly on the roster.
      const rs = r.settings || {};
      const record = {
        wins: rs.wins || 0, losses: rs.losses || 0, ties: rs.ties || 0,
        fpts: (rs.fpts || 0) + (rs.fpts_decimal || 0) / 100,
        fptsAgainst: (rs.fpts_against || 0) + (rs.fpts_against_decimal || 0) / 100
      };
      return { rosterId: r.roster_id, ownerId: r.owner_id, teamName: tn, username: un, total, qb, rb, wr, te, age, opt, vorpTotal, lineup, plist, posCount, posPpg, startable, picks: own.get(r.roster_id) || [], record };
    });

    /* ---------- Per-player value/production divergence ----------
       Dynasty VALUE (KTC market price — weighted toward proven track record and
       long-term ceiling, see Vault.adjustedValue) and PROJECTED PPG (this season's
       raw box-score math, see buildProjectedPpgMapById) come from two completely
       independent sources and are answering different questions ("what's this worth
       long-term" vs. "how many points will this score THIS year") — they can
       legitimately disagree, and that disagreement is itself useful information a
       trade shouldn't silently paper over. valuePct/ppgPct rank a player against
       every OTHER rostered player at their own position, league-wide (not just
       within one team, unlike posPpg above) — the only apples-to-apples comparison
       for "is this player priced/producing like a top-tier guy at their position."
       valueRiskGap = ppgPct - valuePct: strongly positive means producing well
       above what the market currently pays (an aging vet whose price crashed but
       who's still starting-caliber — a real buy-low signal); strongly negative
       means priced well above this year's actual output (a rookie stash getting
       paid for potential, not production yet — real bust risk if it never arrives).
       Requires at least 4 players at the position leaguewide to rank meaningfully;
       skips positions too thin to have a real percentile spread. */
    ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
      const atPos = built.flatMap(t => t.plist.filter(p => p.pos === pos && p.value > 0 && p.ppg > 0));
      if (atPos.length < 4) return;
      const vals = atPos.map(p => p.value).sort((a, b) => a - b);
      const ppgs = atPos.map(p => p.ppg).sort((a, b) => a - b);
      atPos.forEach(p => {
        p.valuePct = vals.indexOf(p.value) / (vals.length - 1) * 100;
        p.ppgPct = ppgs.indexOf(p.ppg) / (ppgs.length - 1) * 100;
        p.valueRiskGap = p.ppgPct - p.valuePct;
      });
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
        p.volatilityPct = Vault.pickVolatilityPct(pickMap, p.season, ktcRound);
        sum += p.value;
      });
      t.picksValue = sum;
      t.overall = t.total + t.picksValue;
    });

    /* ---------- Percentiles + z-scores (used by archetype) ----------
       valP/ppgP are continuous 0-100 percentile ranks, kept for the Archetype
       column's best-to-worst sort (archScore) and any other continuous display —
       percentile rank works fine there since sorting doesn't care about tier
       boundaries. valZ/ppgZ are z-scores of the same two underlying numbers, and
       together form the CONTENDING axis (see the block below and Vault.archetype) —
       "how strong is this team right now."

       valZ ranks by rostered-PLAYER value (t.total), not `overall` — a team's
       picks are a future-tense asset, and archetype's CONTENDING axis is a
       present-tense question. Ranking it by `overall` instead briefly seemed like
       a fix for a genuinely pick-rich team not getting credit for its picks, but it
       cut the other way just as hard: a team that trades a future pick for a
       player good enough to push it into a top-tier scoring team has made the most
       textbook contending move there is, and `overall` penalized it for exactly
       that, since the pick it gave up (now someone else's) still counted as a loss
       even though it was converted into real, current strength. Picks aren't
       ignored — they're a main input to the separate rebuild-posture score below
       (Vault.rebuildScore, used for trade-value posture, not this identity grid),
       which is exactly where a team's future assets belong.

       ppgZ is centered on the real PLAYOFF LINE (Vault.playoffLine), not the league
       average — "Contender" should mean what it says: in real playoff position, not
       just scoring better than the league's bottom half happens to drag the mean
       down to. In a league that sends most teams to the playoffs (6 of 10 here),
       those two bars can sit in very different places. valZ has no equivalent
       external bar (there's no "playoff line" for dynasty trade value) so it stays
       centered on the mean. */
    const vals = built.map(t => t.total).sort((a, b) => a - b);
    const opts = built.map(t => t.opt).sort((a, b) => a - b);
    const { mean: meanTotalVal, std: stdTotalVal } = Vault.meanStd(built.map(t => t.total));
    const { std: stdOpt } = Vault.meanStd(built.map(t => t.opt));
    const { playoffLine } = Vault.playoffLine(built);
    built.forEach(t => {
      t.valP = vals.indexOf(t.total) / (vals.length - 1) * 100;
      t.ppgP = opts.indexOf(t.opt) / (opts.length - 1) * 100;
      t.valZ = stdTotalVal ? (t.total - meanTotalVal) / stdTotalVal : 0;
      t.ppgZ = stdOpt ? (t.opt - playoffLine) / stdOpt : 0;
    });

    /* ---------- Longevity (Vault.contentionWindow-derived, feeds the archetype grid) ----------
       "How many of the next 5 projected years does this roster clear the league's
       real playoff line" — the exact same position-decay + arriving-picks model
       Team Analyzer and the Trade Calculator already chart per-team, not a fresh
       formula. Answers "how long will THIS roster stay good," which is a different
       question from a team's age or pick count in isolation: a roster can be
       pick-poor with an unremarkable average age and still project the LONGEST
       window in the league if its production is already elite and nothing's near
       its decline cliff yet (see Vault.rebuildScore below for where age/picks DO
       still matter). avgProjPpg is a tiebreaker only — its /100000 keeps it from
       ever moving the displayed, rounded year count, it only orders teams that tie
       on whole years so ranking isn't decided by array order. */
    const nTeams = built.length;
    built.forEach(t => {
      const win = Vault.contentionWindow(t, built);
      t.windowYears = win.inWindow.filter(Boolean).length;
      t.windowStart = win.windowStart;
      t.windowEnd = win.windowEnd;
      const avgProjPpg = win.projPPG.reduce((s, v) => s + v, 0) / win.projPPG.length;
      t.longevity = t.windowYears + avgProjPpg / 100000;
    });
    [...built].sort((a, b) => b.longevity - a.longevity)
      .forEach((t, i) => { t.longevityRank = i + 1; t.longevityTier = Vault.rankBand(i + 1, nTeams); });

    /* ---------- Rebuild posture (age + picks) — NOT the same axis as Longevity above ----------
       A completely different question: not "how long will this roster stay good" but
       "is this team actively stockpiling youth/picks for later." Vault.teamMode and
       Vault.archetypeFitNotes use this to decide whether a team should value incoming
       picks/youth over proven production in a trade — a real signal, just not one
       that belongs in the archetype identity grid above (that WAS the bug: blending
       picks into "how long will this last" mislabeled a pick-poor-but-durable roster
       as short-window, and vice versa for a pick-rich team that hasn't hit yet).
       Picks are still fully visible on their own (the Picks column, t.picksValue). */
    const { mean: meanAge, std: stdAge } = Vault.meanStd(built.map(t => t.age));
    const { mean: meanPicks, std: stdPicks } = Vault.meanStd(built.map(t => t.picksValue));
    built.forEach(t => {
      t.ageZ = stdAge ? -(t.age - meanAge) / stdAge : 0;
      t.pickZ = stdPicks ? (t.picksValue - meanPicks) / stdPicks : 0;
      t.rebuildScore = t.ageZ + t.pickZ;
    });
    [...built].sort((a, b) => b.rebuildScore - a.rebuildScore)
      .forEach((t, i) => { t.rebuildRank = i + 1; t.rebuildTier = Vault.rankBand(i + 1, nTeams); });

    /* ---------- Archetype axis: CONTENDING (paired with LONGEVITY above) ----------
       contendScore blends current value + production (valZ + ppgZ) — "how strong is
       this team right now." Ranked within the league and banded via Vault.rankBand
       (Top 2/Top Half/Bottom Half/Bottom 2), then Vault.archetype looks up the
       (contendTier, longevityTier) pair in Vault.ARCHETYPE_GRID. */
    built.forEach(t => { t.contendScore = t.valZ + t.ppgZ; });
    [...built].sort((a, b) => b.contendScore - a.contendScore)
      .forEach((t, i) => { t.contendRank = i + 1; t.contendTier = Vault.rankBand(i + 1, nTeams); });

    // Archetype. archScore is a continuous Contending-strength number (valP + ppgP)
    // — kept exactly as-is since Trade Calculator/Trade Grades diff it before/after a
    // trade (dArchScore) to judge whether a deal helped or hurt, and that comparison
    // only makes sense as a small, steady delta, not a number that can jump by
    // millions the instant a trade nudges a team across an archetype boundary.
    // archSort is a SEPARATE field, only for the League Overview table's Archetype
    // column: archScore has no relationship to which archetype a team actually landed
    // in (Longevity feeds the label too), so sorting by it didn't group same-label
    // pills together at all — clicking the column looked broken. ARCHETYPE_INFO's own
    // key order is already the guide's best-to-worst hierarchy, so that's the primary
    // sort; t.overall just breaks ties within a shared label, scaled well below the
    // per-archetype bucket size so it can never cross into the next archetype's range.
    const archOrder = Object.keys(Vault.ARCHETYPE_INFO);
    built.forEach(t => {
      const [a, c] = Vault.archetype(t);
      t.arch = a; t.archCls = c;
      t.archScore = t.valP + t.ppgP;
      t.archSort = (archOrder.length - archOrder.indexOf(a)) * 1e7 + t.overall;
    });

    // Column ranks (used by the League Overview table)
    ['total', 'qb', 'rb', 'wr', 'te', 'picksValue', 'overall', 'opt', 'longevity'].forEach(k => {
      [...built].sort((a, b) => b[k] - a[k]).forEach((t, i) => t[k + 'Rank'] = i + 1);
    });
    [...built].sort((a, b) => a.age - b.age).forEach((t, i) => t.ageRank = i + 1);

    // Draft capital tier — picksValueRank banded the same way as the archetype axes,
    // shown as a small qualifier next to the archetype pill (see Vault.PICK_TIER_LABEL)
    // instead of being folded into the archetype identity itself. This is deliberately
    // the third, independently-visible fact from a team's picksValue — the whole point
    // of NOT blending draft capital into Longevity above is that a team's picks and its
    // projected window can point in different directions, and both should be visible
    // at a glance rather than one silently overriding the other.
    built.forEach(t => { t.pickTier = Vault.rankBand(t.picksValueRank, nTeams); });

    // Ranked (and the table's default sort order) by `overall`, not player-only
    // value — a team's real standing includes its picks, same as everywhere else
    // on the site now. Ranking by player value alone let a team that had just
    // traded away its picks still show up at the top of the table while its own
    // archetype (which ranks by overall) called it merely average — two numbers
    // on the same page disagreeing about how good the same team is.
    built.sort((a, b) => b.overall - a.overall);
    built.forEach((t, i) => t.rank = i + 1);

    return { league, isSF, slots, startable, replacementLevels, teams: built };
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
      // Mirrors buildLeagueTeams' posCount/posPpg — recomputed post-trade so
      // positionalProfile (used by the fit check below) sees the roster AFTER the
      // deal, not before it. `startable` is league-wide and unaffected by a trade,
      // so it carries over via the `...team` spread below without needing to be
      // recomputed here — but topPpg needs it, so read it off the pre-trade team.
      const posFloor = Math.max(300, total * 0.02);
      const posCount = {
        qb: plist.filter(p => p.pos === 'QB' && p.value >= posFloor).length,
        rb: plist.filter(p => p.pos === 'RB' && p.value >= posFloor).length,
        wr: plist.filter(p => p.pos === 'WR' && p.value >= posFloor).length,
        te: plist.filter(p => p.pos === 'TE' && p.value >= posFloor).length
      };
      const topPpg = (pos, n) => plist.filter(p => p.pos === pos).map(p => p.ppg)
        .sort((a, b) => b - a).slice(0, n).reduce((s, v) => s + v, 0);
      const posPpg = {
        qb: topPpg('QB', team.startable.qb),
        rb: topPpg('RB', team.startable.rb),
        wr: topPpg('WR', team.startable.wr),
        te: topPpg('TE', team.startable.te)
      };
      const vAge = plist.filter(p => p.value > 0 && p.age > 0);
      const sumV = vAge.reduce((s, p) => s + p.value, 0);
      const age = sumV ? vAge.reduce((s, p) => s + p.value * p.age, 0) / sumV : 0;
      const { total: opt, vorpTotal, starters: lineup } = Vault.optimalLineupDetail(plist, slots);
      const removedKeys = new Set(removedPicks.map(pickKey));
      const picks = [...team.picks.filter(p => !removedKeys.has(pickKey(p))), ...addedPicks];
      const picksValue = picks.reduce((s, p) => s + (p.value || 0), 0);
      return { ...team, plist, total, qb, rb, wr, te, age, opt, vorpTotal, lineup, posCount, posPpg, picks, picksValue, overall: total + picksValue };
    }

    const newA = rebuild(A, giveAPlayers, giveBPlayers, giveAPicks, giveBPicks);
    const newB = rebuild(B, giveBPlayers, giveAPlayers, giveBPicks, giveAPicks);

    // Recompute valP/ppgP/valZ/ppgZ/contendTier/rebuildTier/longevityTier/archetype
    // against the rest of the league, unchanged. `others` holds the ORIGINAL team
    // objects from allTeams (not copies) — newA/newB need ranking against the full
    // pool to place correctly, but writing results onto `others` here would corrupt
    // live data those objects are shared with elsewhere in the app, so only newA/newB
    // get mutated; the rank computations below just read the pool, never write to it.
    const others = allTeams.filter(t => t.rosterId !== teamAId && t.rosterId !== teamBId);
    const pool = [...others, newA, newB];
    const vals = pool.map(t => t.total).sort((a, b) => a - b);
    const opts = pool.map(t => t.opt).sort((a, b) => a - b);
    const { mean: meanTotalVal, std: stdTotalVal } = Vault.meanStd(pool.map(t => t.total));
    const { std: stdOpt } = Vault.meanStd(pool.map(t => t.opt));
    const { playoffLine } = Vault.playoffLine(pool);
    const { mean: meanAge, std: stdAge } = Vault.meanStd(pool.map(t => t.age));
    const { mean: meanPicks, std: stdPicks } = Vault.meanStd(pool.map(t => t.picksValue));
    const scored = pool.map(t => ({
      t,
      contendScore: (stdTotalVal ? (t.total - meanTotalVal) / stdTotalVal : 0) + (stdOpt ? (t.opt - playoffLine) / stdOpt : 0),
      rebuildScore: (stdAge ? -(t.age - meanAge) / stdAge : 0) + (stdPicks ? (t.picksValue - meanPicks) / stdPicks : 0)
    }));
    const contendRankOf = new Map([...scored].sort((a, b) => b.contendScore - a.contendScore).map((s, i) => [s.t, i + 1]));
    const rebuildRankOf = new Map([...scored].sort((a, b) => b.rebuildScore - a.rebuildScore).map((s, i) => [s.t, i + 1]));
    // Longevity (see buildLeagueTeams for why this is a separate axis from
    // rebuildScore above) recomputed fresh across the post-trade pool, same reasoning
    // as contendScore/rebuildScore — everyone's contentionWindow is recalculated so
    // newA/newB rank fairly, but only newA/newB get the result written onto them.
    const longevityOf = new Map(pool.map(t => {
      const win = Vault.contentionWindow(t, pool);
      const avgProjPpg = win.projPPG.reduce((s, v) => s + v, 0) / win.projPPG.length;
      return [t, win.inWindow.filter(Boolean).length + avgProjPpg / 100000];
    }));
    const longevityRankOf = new Map([...pool].sort((a, b) => longevityOf.get(b) - longevityOf.get(a)).map((t, i) => [t, i + 1]));
    const pickRankOf = new Map([...pool].sort((a, b) => b.picksValue - a.picksValue).map((t, i) => [t, i + 1]));

    [newA, newB].forEach(t => {
      t.valP = vals.indexOf(t.total) / (vals.length - 1) * 100;
      t.ppgP = opts.indexOf(t.opt) / (opts.length - 1) * 100;
      t.valZ = stdTotalVal ? (t.total - meanTotalVal) / stdTotalVal : 0;
      t.ppgZ = stdOpt ? (t.opt - playoffLine) / stdOpt : 0;
      t.ageZ = stdAge ? -(t.age - meanAge) / stdAge : 0;
      t.pickZ = stdPicks ? (t.picksValue - meanPicks) / stdPicks : 0;
      t.contendScore = t.valZ + t.ppgZ;
      t.rebuildScore = t.ageZ + t.pickZ;
      t.longevity = longevityOf.get(t);
      t.contendTier = Vault.rankBand(contendRankOf.get(t), pool.length);
      t.rebuildTier = Vault.rankBand(rebuildRankOf.get(t), pool.length);
      t.longevityTier = Vault.rankBand(longevityRankOf.get(t), pool.length);
      t.pickTier = Vault.rankBand(pickRankOf.get(t), pool.length);
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

    // Decay is measured in years PAST the threshold age, relative to where the
    // player already stood today — not the player's raw future age. Without that
    // "- Math.max(0, age - threshold)" term, a player already past the threshold
    // TODAY would get discounted even at y=0 (today), understating the projection's
    // own starting point below the real, undecayed current number.
    function decayFactor(pos, currentAge, y) {
      const cfg = VAULT_CONFIG.POSITION_DECAY[pos];
      if (!cfg) return 1;
      const [threshold, rate] = cfg;
      const decayYears = Math.max(0, currentAge + y - threshold) - Math.max(0, currentAge - threshold);
      return Math.pow(rate, decayYears);
    }

    // League-wide $-value-per-PPG-point rate, used below to translate a converting
    // pick's dollar value into an estimated PPG contribution — built from every
    // rostered player in the league with real value AND real production, so it
    // reflects the market rate rather than one roster's own mix.
    let sumValue = 0, sumPpg = 0;
    all.forEach(team => team.plist.forEach(p => {
      if (p.value > 0 && p.ppg > 0) { sumValue += p.value; sumPpg += p.ppg; }
    }));
    const dollarsPerPpg = sumPpg ? sumValue / sumPpg : 1;

    // Age lookup for the current starters — t.lineup carries slot/pos/ppg but not
    // age, so cross-reference back to t.plist by id.
    const ageById = new Map(t.plist.map(p => [p.id, p.age]));

    const proj = [];
    const projPPG = [];
    for (let y = 0; y < years; y++) {
      const projYear = startYear + y;
      let val = 0;
      t.plist.forEach(p => { val += p.value * decayFactor(p.pos, p.age, y); });
      (t.picks || []).forEach(p => { if (projYear >= p.season) val += p.value || 0; });
      proj.push(Math.round(val));

      // PPG is projected off the current STARTING LINEUP (t.lineup) only, not the
      // full ~30-man roster — summing every rostered player's ppg would triple-to-
      // quadruple the real number, since a lineup only starts ~11 of them. A pick
      // that's arrived by this year gets estimated via the league's $-per-PPG rate,
      // then greedily swapped in for the current WEAKEST starter it beats — modeling
      // a roster upgrade (replacing a bench-caliber starter), not stacking unlimited
      // extra PPG onto a lineup that only has so many slots to fill. Without that
      // cap, a team holding many picks could project a higher PPG than any real
      // team in the league has ever scored, just from raw pick-value accumulation.
      const starterPpgs = t.lineup.filter(s => s.id).map(s => s.ppg * decayFactor(s.pos, ageById.get(s.id) || 0, y));
      const arrivedPickPpgs = (t.picks || [])
        .filter(p => projYear >= p.season)
        .map(p => (p.value || 0) / dollarsPerPpg)
        .sort((a, b) => b - a);
      arrivedPickPpgs.forEach(pickPpg => {
        let weakestIdx = 0;
        for (let i = 1; i < starterPpgs.length; i++) if (starterPpgs[i] < starterPpgs[weakestIdx]) weakestIdx = i;
        if (starterPpgs.length && pickPpg > starterPpgs[weakestIdx]) starterPpgs[weakestIdx] = pickPpg;
      });
      projPPG.push(starterPpgs.reduce((s, v) => s + v, 0));
    }
    const peak = Math.max(...proj);
    const year = startYear + proj.indexOf(peak);

    const { playoffSpots, playoffLine } = Vault.playoffLine(all);

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
     the value matches).

     Value percentile alone can't tell a real surplus from full starting depth: a
     Superflex team with 3 good QBs is worth a lot of $ at QB (easily >65th pct) but
     is NOT surplus — 2 of those 3 are real starters and the 3rd is bye-week/injury
     insurance at the league's most valuable position. So a HIGH value percentile
     only counts as surplus if the team also ROSTERS more value-bearing players at
     that position than its own starting slots + a 1-player depth buffer
     (t.posCount / t.startable, from buildLeagueTeams — see comment there).

     The mirror image matters just as much: a team can rank LOW on value at a
     position while already rostering plenty of bodies there — e.g. a pile of
     replacement-level RBs whose combined value is weak even though there's no
     shortage of roster spots filled. That's a quality problem, not a scarcity one,
     and shouldn't get flagged as a "need" — doing so would make needAdjustedValue
     treat trading away one of those redundant cheap RBs as "giving up something
     needed" (inflating its cost) purely because the position's dollar total is
     low, the same mistake the surplus fix above corrects in the other direction.
     So low value only counts as a need if the team ISN'T already stacked (more
     bodies than starting slots + buffer) at that position — being genuinely thin
     on ROSTER COUNT (fewer bodies than starting slots require) is always a need
     regardless of value, since that's a real hole regardless of how good the few
     rostered players are.

     Dollar value and production aren't the same axis, and price alone can be
     wrong about which one is missing: an aging veteran is *literally* the case
     where value is low (age discount) but he can still start and produce short
     term, so a team built around one shouldn't read as needing that position —
     while a position priced high on name value that's actually hurt or buried
     isn't the strength its dollar total suggests. So posPct blends value
     percentile with a real-production percentile (t.posPpg — top-N by PPG where N
     is that position's own startable-slot count, not a naive sum; see
     buildLeagueTeams) whenever posPpg is available, same 50/50 weighting the
     Archetype system already uses for valP/ppgP at the team level. Falls back to
     value-only (old behavior) if posCount/posPpg/startable aren't present, so any
     caller passing a bare team object still works. */

  // How many starters this league can ACTUALLY field at each position, counting
  // every flex type that's eligible for it (a Superflex slot counts for QB; FLEX/
  // WRRB_FLEX/SUPER_FLEX count for RB; etc). Shared by buildLeagueTeams and any
  // page (Player Rankings) that needs the same real-format-aware slot count
  // without going through a full buildLeagueTeams call.
  computeStartable(slots) {
    return {
      qb: slots.filter(s => s === 'QB').length + slots.filter(s => s === 'SUPER_FLEX').length,
      rb: slots.filter(s => ['RB', 'FLEX', 'SUPER_FLEX', 'WRRB_FLEX'].includes(s)).length,
      wr: slots.filter(s => ['WR', 'FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX'].includes(s)).length,
      te: slots.filter(s => ['TE', 'FLEX', 'SUPER_FLEX', 'REC_FLEX'].includes(s)).length
    };
  },

  /* ---------- VORP (Value Over Replacement Player) ----------
     Raw PPG conflates "good at this position" with "how scarce is this position"
     — comparing a QB's PPG to a WR's PPG directly is apples-to-oranges, since QBs
     score more raw points at EVERY tier, replacement-level included. VORP fixes
     that by subtracting each position's own replacement level first: what's left
     is genuinely comparable across positions, which is exactly why a Superflex
     league's QB premium is real and not just "QBs score more" — replacement-level
     QB (the guy on IR-stream waivers) is far worse than replacement-level RB/WR
     relative to a real starter, not because QBs individually outscore them.

     "Replacement level" = the best player at a position who wouldn't start
     anywhere in this league — i.e., the (teams × startable-at-that-position + 1)th
     best player leaguewide, ranked by real projected PPG. Computed across the
     WHOLE KTC-ranked universe (every fantasy-relevant player), not just rostered
     ones — replacement level means "readily available," not "already on
     somebody's bench," so a bench stash on another team must not shrink the pool. */
  computeReplacementLevels(ktcData, ppgByName, startable, teamCount) {
    const byPos = { QB: [], RB: [], WR: [], TE: [] };
    (ktcData.players || []).forEach(p => {
      if (!byPos[p.pos]) return;
      const key = Vault.normalizeName(p.name);
      const ppg = ppgByName.get(key);
      if (Number.isFinite(ppg)) byPos[p.pos].push(ppg);
    });
    const levels = {};
    ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
      const arr = byPos[pos].sort((a, b) => b - a);
      if (!arr.length) { levels[pos] = 0; return; }
      const idx = Math.round(teamCount * (startable[pos.toLowerCase()] || 0)); // 0-indexed: index N is the (N+1)th-best, i.e. the best non-starter
      levels[pos] = arr[Math.min(idx, arr.length - 1)];
    });
    return levels;
  },

  // A player's edge over the best readily-available replacement at their own
  // position (see computeReplacementLevels) — null when either input is missing
  // rather than a misleading 0, since "no projection" and "exactly replacement
  // level" are different facts.
  vorp(ppg, pos, replacementLevels) {
    if (!Number.isFinite(ppg) || !replacementLevels || replacementLevels[pos] == null) return null;
    return ppg - replacementLevels[pos];
  },

  positionalProfile(t, all) {
    const posPct = {};
    const hasPpg = !!t.posPpg;
    ['qb', 'rb', 'wr', 'te'].forEach(k => {
      const arr = all.map(x => x[k]).sort((a, b) => a - b);
      const valuePct = arr.length > 1 ? arr.indexOf(t[k]) / (arr.length - 1) : 0.5;
      if (hasPpg) {
        const ppgArr = all.map(x => x.posPpg?.[k] ?? 0).sort((a, b) => a - b);
        const ppgPct = ppgArr.length > 1 ? ppgArr.indexOf(t.posPpg[k]) / (ppgArr.length - 1) : 0.5;
        posPct[k] = (valuePct + ppgPct) / 2;
      } else {
        posPct[k] = valuePct;
      }
    });
    const DEPTH_BUFFER = 1;
    const hasRosterInfo = t.posCount && t.startable;
    const isStacked = k => hasRosterInfo && t.posCount[k] > t.startable[k] + DEPTH_BUFFER;
    const isThin = k => hasRosterInfo && t.posCount[k] < t.startable[k];
    const needs = Object.entries(posPct)
      .filter(([k, v]) => isThin(k) || (v < 0.35 && !isStacked(k)))
      .map(([k]) => k);
    const surpluses = Object.entries(posPct)
      .filter(([k, v]) => v > 0.65 && (!hasRosterInfo || isStacked(k)))
      .map(([k]) => k);
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

  /* What each side of a proposed trade is really worth once KTC's own consolidation
     bonus (Vault.consolidationAdjustment) is applied — the raw-dollar basis for the
     trade bar's $ number, the headline value comparison, and the recap text's
     "gave up about $X" language, replacing a plain per-asset sum. */
  tradeSideValues(assetsA, assetsB) {
    const valsA = assetsA.map(a => a.value), valsB = assetsB.map(a => a.value);
    const rawA = valsA.reduce((s, v) => s + v, 0), rawB = valsB.reduce((s, v) => s + v, 0);
    const { adjust1, adjust2, display } = Vault.consolidationAdjustment(valsA, valsB);
    return { rawA, rawB, valueA: rawA + adjust1, valueB: rawB + adjust2, bonusA: adjust1, bonusB: adjust2, display };
  },

  // Splits a side's already-computed total (real two-sided consolidation value, not
  // a plain sum) back across its individual assets, proportional to each asset's own
  // raw share — needAdjustedTradeValues needs a per-asset number to weight by
  // position, but the accurate total only exists at the whole-side level (KTC's
  // consolidation bonus depends on BOTH sides' piece counts at once, not any one
  // asset alone). Proportional split keeps things simple and undoes cleanly: sum
  // the results back up and you get exactly the side total you started from.
  distributeAdjustedValue(assets, adjustedTotal) {
    const rawTotal = assets.reduce((s, a) => s + a.value, 0);
    if (!rawTotal) return assets.map(a => ({ ...a, distAdjValue: 0 }));
    return assets.map(a => ({ ...a, distAdjValue: adjustedTotal * (a.value / rawTotal) }));
  },

  /* What each side of a proposed trade is really worth to the team RECEIVING it —
     this is what drives the Fair/Borderline/Lopsided verdict and the Suggest-a-
     Trade "not bad" filter, so it needs to start from the real, two-sided
     consolidation math (Vault.tradeSideValues) that the raw dollar number already
     uses, not each asset's isolated VBA score (the old needAdjustedTradeValue).
     VBA alone can't see a real concentration premium/penalty the way two-sided
     consolidation does, since it scores one asset at a time with no visibility
     into the other side's piece count — confirmed at scale by running 24,000+ real
     KTC trades through both: VBA overstated lopsidedness in every one of the ~160
     cases where the two disagreed by more than 40 points, never the reverse, and
     the gap wasn't confined to extreme piece counts — most of those cases were
     ordinary 2- or 3-piece trades where one side's value happened to be
     concentrated in one big piece rather than spread evenly.

     `teamA` gives `aAssets` (received by `teamB`); `teamB` gives `bAssets`
     (received by `teamA`) — matches Vault.tradeSideValues' A/B pairing exactly, so
     a caller already holding that result's shape doesn't need to remember a
     different convention here. Each side's real consolidation-adjusted total gets
     split back across its own assets (Vault.distributeAdjustedValue) before need-
     weighting, so a pile heavy at a position the recipient is already deep at is
     still worth less to them than the same real dollars spread across a need. */
  needAdjustedTradeValues(teamA, teamB, allTeams, aAssets, bAssets) {
    const { valueA: consolAdjA, valueB: consolAdjB } = Vault.tradeSideValues(aAssets, bAssets);
    const profileB = Vault.positionalProfile(teamB, allTeams); // judges aAssets (B receives)
    const profileA = Vault.positionalProfile(teamA, allTeams); // judges bAssets (A receives)
    const distA = Vault.distributeAdjustedValue(aAssets, consolAdjA);
    const distB = Vault.distributeAdjustedValue(bAssets, consolAdjB);
    const aValAdjNeed = distA.reduce((s, x) => s + Vault.needAdjustedValue(x.distAdjValue, x.pos, profileB), 0);
    const bValAdjNeed = distB.reduce((s, x) => s + Vault.needAdjustedValue(x.distAdjValue, x.pos, profileA), 0);
    return { aValAdjNeed, bValAdjNeed };
  },

  /* ---------- Value confidence / uncertainty ----------
     Every trade number in this app is a point estimate off today's KTC price, but
     that price itself is a real market's current best guess, not a fact — a rookie
     nobody's seen play a real snap and a 5-year proven WR1 can carry the exact same
     dollar value today with wildly different odds of still being right in 3 months.
     This section turns each asset's own recent price history into an honest ± band
     around the fairness verdict, instead of presenting one number as gospel.

     Calibrated against real data, not a guess: computing the population coefficient
     of variation (stdev/mean) of every KTC-priced player's daily value over a
     trailing 90-day window (matching TREND_WINDOW_DAYS in trade.html) splits
     cleanly along real risk lines — locked-in stars sitting at the value ceiling
     (Bijan Robinson, Ja'Marr Chase) come in under 0.5%, while speculative
     deep-bench rookies (a 3rd-string RB, an unproven late-round WR) run
     30-85%. Distribution: median 2.2%, 85th pct 5.5%, 95th pct 13%. */
  PRICE_VOLATILITY_MIN_POINTS: 8,

  // values: a plain array of daily-ish price points for one asset, most-recent
  // window only (callers filter the date range before calling this — see trade.html's
  // buildVolatilityMap). null below the minimum sample size or a non-positive mean —
  // not enough signal to say anything, not the same as "this asset is stable."
  priceVolatilityPct(values) {
    if (!values || values.length < Vault.PRICE_VOLATILITY_MIN_POINTS) return null;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    if (mean <= 0) return null;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance) / mean;
  },

  // A picked-but-not-yet-realized draft pick has no price history of its own to be
  // volatile — every "2027 R1" pick is priced the same regardless of whose it is
  // until a season plays out. Its real uncertainty is structural instead: it could
  // still land anywhere in its round depending on how that team's season goes,
  // so the round's own early-to-late spread this year IS the honest range. Half the
  // early/late gap relative to the mid value mirrors priceVolatilityPct's shape (a
  // relative, ~1-stdev-like measure) so the two can be combined the same way.
  pickVolatilityPct(pickMap, season, round) {
    const early = pickMap.get(`${season}-${round}-early`);
    const late = pickMap.get(`${season}-${round}-late`);
    const mid = pickMap.get(`${season}-${round}-mid`);
    if (early == null || late == null || !mid) return null;
    return (early - late) / (2 * mid);
  },

  // Buckets a raw volatility fraction into a plain-language read for a single
  // asset's own card — thresholds are the empirical median/85th-pct split found
  // above, not arbitrary round numbers.
  volatilityLabel(pct) {
    if (pct == null) return null;
    if (pct < 0.025) return 'stable';
    if (pct < 0.06) return 'moderate';
    return 'volatile';
  },

  /* One side's combined relative uncertainty from its individual assets' own
     volatility — sqrt of the weighted-sum-of-squares (each asset's share of its
     side's total value, squared, times its own volatility squared), the standard
     way to combine INDEPENDENT variances. Real dynasty values aren't fully
     independent (a depth-chart change or a team's record swinging can move several
     assets on the same side together), so this understates true correlated risk —
     disclosed simplification, not an oversight. Assets with no volatility reading
     (missing history, see priceVolatilityPct/pickVolatilityPct) contribute 0, not
     an average — an unestablished price isn't the same as a proven-stable one, but
     this function has no way to tell the difference, so it stays silent about it
     rather than guessing. Returns a fraction (0.08 = ±8%), or 0 for an empty/zero-
     value side. */
  combineSideVolatility(assets) {
    const total = assets.reduce((s, a) => s + a.value, 0);
    if (!total) return 0;
    const variance = assets.reduce((s, a) => s + (a.value / total) ** 2 * (a.volatilityPct || 0) ** 2, 0);
    return Math.sqrt(variance);
  },

  /* Turns each side's combined volatility into a ± band (percentage points) around
     the trade's need-weighted fairness reading (pctDiffNeed in trade.html), the same
     way a poll reports a margin alongside the topline number. Propagates uncertainty
     through the DIFFERENCE that actually drives Fair/Borderline/Lopsided: treating
     each side's dollar uncertainty as independent, Var(diff) = Var(A) + Var(B), so
     the combined band is sqrt of the two sides' own dollar-uncertainty (value times
     its own relative volatility) squared and summed — not a raw average of the two
     percentages, which would understate how a big confident side and a small shaky
     side actually combine. */
  tradeConfidenceBand(aAssets, bAssets, aValAdjNeed, bValAdjNeed) {
    const volA = Vault.combineSideVolatility(aAssets);
    const volB = Vault.combineSideVolatility(bAssets);
    const sigmaDollarsA = aValAdjNeed * volA;
    const sigmaDollarsB = bValAdjNeed * volB;
    const sigmaDiff = Math.sqrt(sigmaDollarsA ** 2 + sigmaDollarsB ** 2);
    const avg = (aValAdjNeed + bValAdjNeed) / 2 || 1;
    return { bandPct: sigmaDiff / avg * 100, volA, volB };
  },

  /* Flags moving assets whose dynasty value and this-season production disagree by
     more than VALUE_RISK_GAP percentile points at their own position (see
     buildLeagueTeams' valueRiskGap) — informational, not a correction to either
     number, since both are legitimate answers to different questions ("worth
     long-term" vs. "scores this year"). Tone is deliberately neutral either
     direction: whether a gap helps or hurts depends on which side of the trade is
     receiving the asset, which this function doesn't know and isn't trying to
     judge — it's just naming a fact a trade could otherwise paper over. Picks and
     any player too new/thin at their position to have a real percentile (see
     buildLeagueTeams) carry no valueRiskGap and are silently skipped. */
  valueRiskNotes(assets) {
    const notes = [];
    assets.forEach(a => {
      if (a.valueRiskGap == null) return;
      if (a.valueRiskGap >= VAULT_CONFIG.VALUE_RISK_GAP) {
        notes.push({ tone: 'neutral', text: `${a.name} is producing well above what the market currently pays for a ${a.pos} — priced like a bench piece, playing like a starter.` });
      } else if (a.valueRiskGap <= -VAULT_CONFIG.VALUE_RISK_GAP) {
        notes.push({ tone: 'neutral', text: `${a.name}'s price is well ahead of this season's actual production at ${a.pos} — paying for track record or upside, not this year's box score.` });
      }
    });
    return notes;
  },

  /* Need/surplus scales each asset's OWN value (via needAdjustedValue) rather than
     handing out a flat bonus/penalty regardless of size — a superstar filling a real
     need should swing this far more than a bench piece at the same position.
     `dollarSwing` is the total effective-value gain/loss this causes (positive helps
     this team), converted to a fit-scale contribution proportional to team size.
     Shared by the Trade Calculator (a proposed trade) and Trade Grades (a completed
     one).

     Takes TWO team snapshots, not one, because "does this fill a need" and "does
     giving this up create one" are different questions that need different roster
     states to answer honestly:
       - incoming assets are judged against beforeTeam/beforeAll — the roster as it
         stood BEFORE the trade, since that's what determines whether something is
         actually filling a real hole.
       - outgoing assets are judged against afterTeam/afterAll — the roster as it
         looks AFTER the trade (this team's real post-trade state, ranked against the
         rest of the post-trade league) — since a position that looked perfectly fine
         before can still become a real hole once the departing asset is gone, and
         judging outgoing assets against the BEFORE profile can never see that: a team
         with exactly enough startable-caliber depth (no bench cushion) at a scarce
         position — Superflex QB being the clearest case — reads as "fine" by the
         current roster alone right up until the trade leaves them with zero margin
         for a bye week or injury. Both callers already have both snapshots on hand
         (trade.html's live before/after, Trade Grades' reconstructed pre-trade state
         via Vault.simulateTrade run in reverse), so this doesn't cost either caller
         an extra pass. */
  // `mode` (Vault.teamMode — 'rebuild'/'contend'/'flexible') softens ONE specific
  // case: a REBUILDING team receiving value at a position it's already deep at.
  // "Deep at" here means enough startable-caliber bodies for THIS season's lineup
  // — a distinction a rebuild doesn't actually care about, since it isn't trying to
  // field the best possible roster this year, it's accumulating value/optionality
  // for later. Penalizing a rebuilder for taking a good young asset at a "surplus"
  // position (real case: acquiring a cheap ascending RB) fights the exact strategy
  // a rebuild should be running. Every other branch (a genuine need, or what either
  // mode gives UP) is untouched — a rebuild still shouldn't go fully empty at a
  // position with no plan, and dealing from surplus is already scored as good.
  positionalFitNotes(beforeTeam, beforeAll, afterTeam, afterAll, incoming, outgoing, mode) {
    const beforeProfile = Vault.positionalProfile(beforeTeam, beforeAll);
    const afterProfile = Vault.positionalProfile(afterTeam, afterAll);
    const notes = [];
    let dollarSwing = 0;

    const scan = (list, isIncoming) => {
      const profile = isIncoming ? beforeProfile : afterProfile;
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
        // having to parse the full `text` sentence back apart. `assetIds`/isIncoming/
        // needMult let Vault.mergeAssetNotes recognize when this note is about the
        // exact same single asset as an archetypeFitNotes note, so the two don't show
        // as competing "worth closer to X" figures for the same player — only
        // possible when this group is exactly one asset, since a multi-asset group's
        // figure isn't about any one of them.
        const noteExtra = { assetIds: assets.map(a => a.id), isIncoming, needMult: rawSum ? weightedRaw / rawSum : 1 };
        if (isIncoming) {
          const rebuildSurplus = delta < 0 && mode === 'rebuild';
          const swing = rebuildSurplus ? delta * VAULT_CONFIG.REBUILD_SURPLUS_DAMPEN : delta;
          dollarSwing += swing;
          notes.push(delta > 0
            ? { tone: 'good', text: `Adds ${rawDisplay} at ${POS}, a genuine roster need — worth closer to ${weightedDisplay} to this team than sticker price.`, pos: POS, absDelta: Math.abs(delta), phrase: `addressed ${article} ${POS} need`, ...noteExtra }
            : rebuildSurplus
              ? { tone: 'neutral', text: `Adds ${rawDisplay} more ${POS} value to a room that's already deep — a rebuild isn't fielding this year's roster, so banking more value here is fine even if it's closer to ${weightedDisplay} at this position.`, pos: POS, absDelta: Math.abs(swing), phrase: `added ${POS} depth`, ...noteExtra }
              : { tone: 'bad', text: `Adds ${rawDisplay} more ${POS} value to a room that's already deep — really worth closer to ${weightedDisplay} here.`, pos: POS, absDelta: Math.abs(delta), phrase: `added ${POS} depth`, ...noteExtra });
        } else {
          // Two independent reasons the standard "leaves this team thin" penalty
          // can overstate a real loss — checked in order of specificity:
          //   1. The departing player's OWN valueRiskGap (buildLeagueTeams — how far
          //      price sits ahead of actual production) separates a real, playing
          //      starter from a speculative stash — losing a rookie flier priced on
          //      upside doesn't cost a team the way losing a proven contributor
          //      does, even though both trip the same roster-body-count check.
          //      Reuses VALUE_RISK_GAP's existing threshold, not a new number.
          //   2. Failing that, a REBUILDING team giving up a real need still isn't
          //      the same problem it is for a contender — a rebuild is playing for
          //      when it NEXT contends, not patching this year's depth chart, so a
          //      hole today is largely beside the point (mirrors the incoming-
          //      surplus dampening above, same reasoning, opposite direction).
          const gaps = assets.map(a => a.valueRiskGap).filter(g => g != null);
          const avgRiskGap = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;
          const isSpeculative = delta > 0 && avgRiskGap <= -VAULT_CONFIG.VALUE_RISK_GAP;
          const rebuildGiving = delta > 0 && mode === 'rebuild' && !isSpeculative;
          const dampened = isSpeculative || rebuildGiving;
          const swing = dampened ? delta * VAULT_CONFIG.SPECULATIVE_NEED_DAMPEN : delta;
          dollarSwing -= swing;
          notes.push(delta < 0
            ? { tone: 'good', text: `Deals from ${POS} surplus — still worth closer to ${weightedDisplay} to this team than its ${rawDisplay} sticker price even after the trade.`, pos: POS, absDelta: Math.abs(delta), phrase: `trimmed ${POS} depth`, ...noteExtra }
            : isSpeculative
              ? { tone: 'neutral', text: `Gives up ${rawDisplay} of ${POS} value, but it's priced mostly on upside rather than current production — a real loss of depth, not the same as losing a proven contributor.`, pos: POS, absDelta: Math.abs(swing), phrase: `gave up speculative ${POS} depth`, ...noteExtra }
              : rebuildGiving
                ? { tone: 'neutral', text: `Gives up ${rawDisplay} of needed ${POS} value — a real hole today, but a rebuild is playing for when it next contends, not patching this year's roster.`, pos: POS, absDelta: Math.abs(swing), phrase: `gave up needed ${POS} value`, ...noteExtra }
                : { tone: 'bad', text: `Gives up ${POS} value and leaves this team thin there — costs more than the ${rawDisplay} sticker price suggests.`, pos: POS, absDelta: Math.abs(delta), phrase: `gave up needed ${POS} value`, ...noteExtra });
        }
      });
    };
    scan(incoming, true);
    scan(outgoing, false);

    const posFit = beforeTeam.total ? Math.max(-3, Math.min(3, dollarSwing / beforeTeam.total * 120)) : 0;
    return { posFit, notes };
  },

  /* A team's timeline — contending (score now), rebuilding (stockpile for later), or
     flexible (neither extreme) — reuses the exact same contendTier/rebuildTier bands
     archetype() reads (see buildLeagueTeams), so "what is this team trying to do" is
     answered identically everywhere instead of by a second, separately-tuned check.
     Contending wins ties deliberately: a team spending future assets to win now
     (Win-Now on the archetype grid) is still trying to contend, not rebuild, even
     though its rebuild band is weak. Shared by the Trade Calculator (a proposed
     trade) and Trade Grades (a completed one). */
  teamMode(t) {
    if (t.contendTier === 'top2' || t.contendTier === 'topHalf') return 'contend';
    if (t.rebuildTier === 'top2' || t.rebuildTier === 'topHalf') return 'rebuild';
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

  /* Same idea as optShiftNote, but for the optimal lineup's total VORP (see
     computeReplacementLevels) instead of raw PPG — catches what a raw-PPG swing
     can miss: a trade can raise Opt PPG while actually making the roster's real,
     scarcity-adjusted edge WORSE (e.g. adding a mediocre Superflex QB2 boosts raw
     points but barely moves VORP, since replacement-level QB is already close
     behind), or the reverse (a modest PPG bump at a genuinely scarce position is
     a bigger real gain than the raw number suggests). Thresholds are in VORP
     points, not PPG points, so they aren't directly comparable to optShiftNote's
     — calibrated against the same rough "worth mentioning" bar (a few points of
     real per-game edge), not derived from it. */
  vorpShiftNote(mode, dVorp) {
    if (!Number.isFinite(dVorp)) return null;
    if (mode === 'rebuild') {
      if (dVorp > 5) return { tone: 'neutral', text: `Raises the roster's real scarcity-adjusted edge by ${dVorp.toFixed(1)} VORP, but that's a this-year signal, not the priority for a rebuild.`, fit: 0 };
      return null;
    }
    if (mode === 'contend') {
      if (dVorp > 3) return { tone: 'good', text: `Adds ${dVorp.toFixed(1)} in real VORP — a genuine scarcity-adjusted upgrade, not just more raw points.`, fit: 2 };
      if (dVorp < -3) return { tone: 'bad', text: `Costs ${Math.abs(dVorp).toFixed(1)} in real VORP — a genuine scarcity-adjusted downgrade even if the raw PPG swing looks smaller.`, fit: -2 };
      return null;
    }
    if (dVorp > 3) return { tone: 'good', text: `Adds ${dVorp.toFixed(1)} in real, scarcity-adjusted VORP.`, fit: 1 };
    if (dVorp < -3) return { tone: 'bad', text: `Costs ${Math.abs(dVorp).toFixed(1)} in real, scarcity-adjusted VORP.`, fit: -1 };
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
     not. A contender's read also checks production: an already-elite young producer
     (isProvenProducer — the Jahmyr Gibbs case, see that comment) is treated exactly
     like a proven veteran, fit-wise — he wins games right now just as much as a
     veteran does, so a contender gets full credit for landing one and pays the full
     cost for losing one, not just a pass from being penalized. A young player who
     ISN'T yet proven still gets no signal either way — not a misfit for being
     unproven, but no credit for upside that hasn't shown up yet. Flexible teams, and
     any PLAYER in their position's prime years with no production override
     (assetTimelineClass returns null), get no adjustment either way. Scales with the
     asset's own value (via the same raw-display/adjusted-scoring split as
     positionalFitNotes) rather than a flat bonus regardless of size. */
  archetypeFitNotes(team, incoming, outgoing) {
    const mode = Vault.teamMode(team);
    const notes = [];
    if (mode === 'flexible') return { archFit: 0, notes };
    let dollarSwing = 0;

    const kindOf = (a, cls) => {
      if (a.type === 'pick') return 'a future pick';
      if (cls === 'young' && Vault.isProvenProducer(a)) return 'an already-elite young producer';
      return cls === 'young' ? `a ${a.age}-year-old` : 'a proven veteran';
    };
    const planWord = mode === 'rebuild' ? 'rebuild' : 'win-now push';

    // Returns null (no archetype read at all) or a {fitsMode, cls} verdict for one asset.
    const evaluate = a => {
      if (a.type === 'pick') return { fitsMode: mode === 'rebuild', cls: 'young' };
      const cls = Vault.assetTimelineClass(a);
      if (cls == null) return null; // prime-years player — good for either timeline
      if (mode === 'rebuild') return { fitsMode: cls === 'young', cls };
      // contend: an already-elite young producer fits a win-now plan the same way a
      // veteran does (see module comment); a young player who hasn't proven it yet
      // gets no signal either way.
      if (cls === 'young') return Vault.isProvenProducer(a) ? { fitsMode: true, cls } : null;
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

        // assetId/isIncoming/mult/rawValue/assetName/kindOfLabel/planWord below aren't
        // used by this note's own text — they let Vault.mergeAssetNotes recognize when
        // this note and a positionalFitNotes note are about the exact same asset, so
        // the two competing "worth closer to X" figures can be reconciled into one
        // instead of showing both side by side.
        const noteExtra = { assetId: a.id, isIncoming, mult, rawValue: a.value, assetName: a.name, kindOfLabel: kindOf(a, cls), planWord };
        if (isIncoming) {
          dollarSwing += delta;
          notes.push(fitsMode
            ? { tone: 'good', text: `${a.name} is ${kindOf(a, cls)} — exactly what a ${planWord} wants, worth closer to ${weightedDisplay} than its ${rawDisplay} sticker price.`, ...noteExtra }
            : { tone: 'bad', text: `${a.name} is ${kindOf(a, cls)} — doesn't fit a ${planWord}, really worth closer to ${weightedDisplay} here.`, ...noteExtra });
        } else {
          dollarSwing -= delta;
          notes.push(!fitsMode
            ? { tone: 'good', text: `Deals away ${a.name} (${kindOf(a, cls)}) — didn't fit the ${planWord} anyway, worth closer to ${weightedDisplay} to give up.`, ...noteExtra }
            : { tone: 'bad', text: `Gives up ${a.name}, ${kindOf(a, cls)} that fit the ${planWord} — costs more than the ${rawDisplay} sticker price suggests.`, ...noteExtra });
        }
      });
    };
    scan(incoming, true);
    scan(outgoing, false);

    const archFit = team.total ? Math.max(-3, Math.min(3, dollarSwing / team.total * 120)) : 0;
    return { archFit, notes };
  },

  /* archetypeFitNotes and positionalFitNotes each independently decide whether a
     moving asset is worth more or less than sticker price — one from timeline fit,
     one from positional need — and when both fire on the SAME single asset, showing
     both verbatim reads as two competing price tags for the same player with no
     explanation of how they relate (e.g. "worth closer to 5,501" right next to
     "worth closer to 7,443" for the identical player). Collapses that pair into one
     note with one reconciled number (both multipliers stacked on the same raw
     value, the basis both already use for display). Only merges when the positional
     note covers exactly one asset — a multi-asset group's figure isn't about any one
     of them, so there's nothing single to reconcile it with. Everything else passes
     through untouched. */
  mergeAssetNotes(archNotes, posNotes) {
    const usedArch = new Set(), usedPos = new Set();
    const merged = [];
    posNotes.forEach((pn, pi) => {
      if (pn.assetIds.length !== 1 || pn.assetIds[0] == null) return;
      const ai = archNotes.findIndex((an, i) => !usedArch.has(i) && an.assetId === pn.assetIds[0] && an.isIncoming === pn.isIncoming);
      if (ai === -1) return;
      const an = archNotes[ai];
      usedArch.add(ai); usedPos.add(pi);

      const combinedMult = pn.needMult * an.mult;
      const combinedDisplay = Math.round(an.rawValue * combinedMult).toLocaleString();
      const rawDisplay = Math.round(an.rawValue).toLocaleString();
      const connector = pn.tone === an.tone ? 'and' : 'but';

      const needClause = pn.isIncoming
        ? (pn.tone === 'good' ? `fills a genuine ${pn.pos} need` : `piles onto an already-deep ${pn.pos} room`)
        : (pn.tone === 'good' ? `deals from ${pn.pos} surplus` : `leaves this team thin at ${pn.pos}`);
      const archClause = an.isIncoming
        ? (an.tone === 'good' ? `is exactly what a ${an.planWord} wants` : `doesn't fit a ${an.planWord}`)
        : (an.tone === 'bad' ? `fit the ${an.planWord}` : `didn't fit the ${an.planWord} anyway`);

      const text = pn.isIncoming
        ? `${an.assetName} ${needClause} ${connector} ${archClause} — netting closer to ${combinedDisplay} for this team than the ${rawDisplay} sticker price.`
        : `Giving up ${an.assetName} (${an.kindOfLabel}) ${needClause} ${connector} ${archClause} — netting closer to ${combinedDisplay} to give up than the ${rawDisplay} sticker price.`;

      // Incoming: a combined value ABOVE sticker is good (you got more than the price
      // tag says). Outgoing: a combined value above sticker is bad (it cost you more
      // to give up than the price tag says) — same direction both source notes
      // already used individually, just applied to the one merged figure.
      const tone = pn.isIncoming === (combinedMult >= 1) ? 'good' : 'bad';
      merged.push({ tone, text, pos: pn.pos, absDelta: Math.abs(an.rawValue * combinedMult - an.rawValue), phrase: pn.phrase });
    });
    const restArch = archNotes.filter((_, i) => !usedArch.has(i));
    const restPos = posNotes.filter((_, i) => !usedPos.has(i));
    return [...merged, ...restArch, ...restPos];
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
    const myMode = Vault.teamMode(t);
    return all.filter(o => o.rosterId !== t.rosterId).map(o => {
      const { needs: theirNeeds, surpluses: theirSurplus } = Vault.positionalProfile(o, all);
      let score = 0;
      const reasons = [];

      // Timeline compatibility, checked first so it's the headline reason when it
      // applies: a contender wants proven production now and a rebuilder wants
      // picks/youth for later — that mismatch is exactly what makes a trade
      // mutually appealing, real-world "buyer meets seller" logic, not just
      // positional need. Two contenders both want to keep what they have (neither
      // is looking to sell into a rival's win-now window), and two rebuilders both
      // want the same things (picks, youth) with little to offer each other —
      // same-timeline pairs are real trade partners far less often in practice.
      const theirMode = Vault.teamMode(o);
      if ((myMode === 'contend' && theirMode === 'rebuild') || (myMode === 'rebuild' && theirMode === 'contend')) {
        score += 3;
        reasons.push(myMode === 'contend'
          ? `You want production now, they want picks and youth — classic complementary timelines`
          : `They want production now, you want picks and youth — classic complementary timelines`);
      } else if (myMode !== 'flexible' && myMode === theirMode) {
        score -= 3;
        reasons.push(`Both ${myMode === 'contend' ? 'contending' : 'rebuilding'} — less natural trade partners, same timeline and same needs`);
      }

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
  resolveTradeAssets(tx, sideRosterId, playersDb, valMap, pickValueByKey, ppgMap, replacementLevels) {
    const assets = [];
    Object.entries(tx.adds || {}).forEach(([pid, toRoster]) => {
      if (toRoster !== sideRosterId) return;
      const p = playersDb[pid] || {};
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || `Player ${pid}`;
      const ppg = ppgMap.get(pid) || 0;
      assets.push({ type: 'player', id: String(pid), name, pos: p.position || '', age: p.age || 0, team: p.team || '', ppg, vorp: Vault.vorp(ppg, p.position || '', replacementLevels), value: valMap.get(Vault.normalizeName(name)) || 0 });
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

  gradeTrade(tx, teamById, playersDb, valMap, pickValueByKey, teams, ppgMap, slots, replacementLevels) {
    const [rA, rB] = tx.roster_ids;
    const teamA = teamById.get(rA), teamB = teamById.get(rB);
    if (!teamA || !teamB) return null;

    const toA = Vault.resolveTradeAssets(tx, rA, playersDb, valMap, pickValueByKey, ppgMap, replacementLevels); // what A received (B gave)
    const toB = Vault.resolveTradeAssets(tx, rB, playersDb, valMap, pickValueByKey, ppgMap, replacementLevels); // what B received (A gave)
    if (!toA.length && !toB.length) return null;

    // Fairness uses KTC's own consolidation adjustment (see Vault.tradeSideValues) —
    // toB is what A gave (B received it), toA is what B gave.
    const { valueA: aGaveAdj, valueB: bGaveAdj } = Vault.tradeSideValues(toB, toA);
    const avgAdj = (aGaveAdj + bGaveAdj) / 2 || 1;
    const pctDiff = Math.abs(aGaveAdj - bGaveAdj) / avgAdj * 100;
    const dValueAdjA = bGaveAdj - aGaveAdj; // positive = A came out ahead on value

    const timelineA = Vault.timelineFitNotes(teamA, toA, toB);
    const timelineB = Vault.timelineFitNotes(teamB, toB, toA);
    const archA = Vault.archetypeFitNotes(teamA, toA, toB);
    const archB = Vault.archetypeFitNotes(teamB, toB, toA);

    // Value/production divergence (see Vault.valueRiskNotes) — resolveTradeAssets
    // builds toA/toB fresh from playersDb/valMap/ppgMap, not from a team's plist, so
    // they don't carry the valueRiskGap buildLeagueTeams already computed; best-
    // effort lookup by player id against every CURRENTLY rostered player in the
    // league. A player traded away and since dropped, or who left the league
    // entirely, won't resolve and is silently skipped — same as any player too new
    // at their position for a real percentile (see buildLeagueTeams).
    const riskById = new Map(teams.flatMap(t => t.plist).filter(p => p.valueRiskGap != null).map(p => [p.id, p.valueRiskGap]));
    const withRisk = list => list.map(a => ({ ...a, valueRiskGap: riskById.get(a.id) }));
    const riskA = Vault.valueRiskNotes(withRisk(toB)); // toB = what B received = what A gave up
    const riskB = Vault.valueRiskNotes(withRisk(toA)); // toA = what A received = what B gave up

    // Reconstruct each team's roster (and optimal-lineup PPG) the day before this
    // trade by running Vault.simulateTrade in reverse: passing what each side
    // actually RECEIVED as the "give" list undoes the trade against their CURRENT
    // roster. Confusingly, simulateTrade's OWN before/after refer to ITS OWN
    // give/take (this reversed trade), so sim.before.A is teamA's real CURRENT
    // (already-post-trade) roster and sim.after.A is the RECONSTRUCTED pre-trade one.
    const sim = Vault.simulateTrade(teams, slots, rA, rB, toA, toB);
    const dOptA = sim.before.A.opt - sim.after.A.opt;
    const dOptB = sim.before.B.opt - sim.after.B.opt;
    const dVorpA = sim.before.A.vorpTotal - sim.after.A.vorpTotal;
    const dVorpB = sim.before.B.vorpTotal - sim.after.B.vorpTotal;

    // Need-weighted fairness — same reasoning as trade.html's computeTradeAnalysis
    // (Vault.needAdjustedTradeValues), applied here to a completed trade instead of a
    // live one: what each side gave up, valued by what it was actually worth to the
    // team that received it, not just its sticker price. Judged against the
    // recipient's reconstructed PRE-trade roster (sim.after, despite the name — see
    // above) — "was this a real need for them AT THE TIME," not colored by whatever
    // else has happened to their roster since. This is what drives the
    // Fair/Borderline/Lopsided badge on Trade Grades; pctDiff above stays the raw
    // sticker-price version, kept for the recap text and as a tooltip detail.
    const { aValAdjNeed: aGaveAdjNeed, bValAdjNeed: bGaveAdjNeed } = Vault.needAdjustedTradeValues(sim.after.A, sim.after.B, teams, toB, toA);
    const avgAdjNeed = (aGaveAdjNeed + bGaveAdjNeed) / 2 || 1;
    const pctDiffNeed = Math.abs(aGaveAdjNeed - bGaveAdjNeed) / avgAdjNeed * 100;

    // positionalFitNotes needs both snapshots — see its own comment for why. What
    // each team received is judged against its pre-trade roster (sim.after, despite
    // the name — see above); what it gave up is judged against its real current
    // roster, so a position that only looks thin because of THIS trade still gets
    // caught, not just a position that was already thin beforehand.
    const fitA = Vault.positionalFitNotes(sim.after.A, teams, teamA, teams, toA, toB, timelineA.mode);
    const fitB = Vault.positionalFitNotes(sim.after.B, teams, teamB, teams, toB, toA, timelineB.mode);
    const optNoteA = Vault.optShiftNote(timelineA.mode, dOptA);
    const optNoteB = Vault.optShiftNote(timelineB.mode, dOptB);
    const vorpNoteA = Vault.vorpShiftNote(timelineA.mode, dVorpA);
    const vorpNoteB = Vault.vorpShiftNote(timelineB.mode, dVorpB);

    const combinedFitA = fitA.posFit + timelineA.fit + archA.archFit + (optNoteA ? optNoteA.fit : 0) + (vorpNoteA ? vorpNoteA.fit : 0);
    const combinedFitB = fitB.posFit + timelineB.fit + archB.archFit + (optNoteB ? optNoteB.fit : 0) + (vorpNoteB ? vorpNoteB.fit : 0);

    const verdict = Vault.historyVerdict(pctDiffNeed, dValueAdjA, combinedFitA, combinedFitB, teamA.teamName, teamB.teamName, avgAdj, fitA, fitB, timelineA, timelineB);
    const anyMissingValue = [...toA, ...toB].some(a => a.value <= 0);

    return { tx, teamA, teamB, toA, toB, pctDiff, pctDiffNeed, dValueAdjA, fitA, fitB, timelineA, timelineB, archA, archB, riskA, riskB, dOptA, dOptB, optNoteA, optNoteB, dVorpA, dVorpB, vorpNoteA, vorpNoteB, combinedFitA, combinedFitB, verdict, anyMissingValue, created: tx.created };
  },

  /* Full fetch-build-grade pipeline for a league's real trade history — shared by
     Trade Grades and the Manager page so both read the exact same graded trades
     instead of running two copies of this fetch that could drift apart. */
  async fetchAndGradeAllTrades(leagueId) {
    const { league, isSF, teams, slots, replacementLevels } = await Vault.buildLeagueTeams(leagueId);
    const [playersDb, ktcData, projData, rosters, traded, ...weeks] = await Promise.all([
      fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json()),
      Vault.fetchKtcValues(),
      Vault.fetchProjections(),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`).then(r => r.json()),
      ...[...Array(18)].map((_, i) => fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${i + 1}`).then(r => r.json()).catch(() => []))
    ]);
    const valMap = Vault.buildKtcValueMap(ktcData, isSF, league.scoring_settings?.bonus_rec_te);
    const ppgMap = Vault.buildProjectedPpgMapById(projData, league.scoring_settings);

    const teamById = new Map(teams.map(t => [t.rosterId, t]));

    const seen = new Set();
    const trades = weeks.flat().filter(t => t && t.type === 'trade' && t.status === 'complete' && (t.roster_ids || []).length === 2 && !seen.has(t.transaction_id) && seen.add(t.transaction_id));

    // teams[].picks only covers the LIVE future-tradeable window (Vault.futurePickYears)
    // — a completed draft correctly drops that year from it entirely, since it's no
    // longer a real asset you could trade today. But a real historical trade can
    // reference a year that was future AT THE TIME and has since drafted (e.g. a
    // 2026 pick traded before the 2026 rookie draft) — pricing that off teams[].picks
    // silently returns 0 once the year rolls off, which read as "missing value" on
    // otherwise-real completed trades. Build a separate pick index scoped to
    // whatever years actually show up in the real trade log instead, using the same
    // ownership-tracking + tier + value methodology buildLeagueTeams uses for the
    // live window, just not limited to it.
    const referencedYears = [...new Set(trades.flatMap(tx => (tx.draft_picks || []).map(pk => +pk.season)))];
    const pickValueByKey = new Map();
    if (referencedYears.length) {
      const pickMap = Vault.buildKtcPickMap(ktcData, isSF, referencedYears, league.scoring_settings?.bonus_rec_te);
      const ROUNDS = VAULT_CONFIG.PICK_ROUNDS;
      const pickOwner = new Map();
      referencedYears.forEach(y => ROUNDS.forEach(r => rosters.forEach(ro => pickOwner.set(`${y}-${r}-${ro.roster_id}`, ro.roster_id))));
      traded.filter(p => referencedYears.includes(+p.season)).forEach(p => {
        const to = Number(p.owner_id);
        if (to && to !== p.roster_id) pickOwner.set(`${p.season}-${p.round}-${p.roster_id}`, to);
      });

      // Draft slot (and so tier/value) depends on standings-based draft order — this
      // app doesn't reconstruct the real order as of each historical draft, it uses
      // current Opt PPG rank as one consistent proxy for pricing any pick anywhere,
      // same as the live window does.
      const n = teams.length;
      const draftRank = new Map([...teams].sort((a, b) => b.opt - a.opt).map((t, k) => [t.rosterId, n - k]));
      pickOwner.forEach((ownerRosterId, key) => {
        const [season, round, originalRosterId] = key.split('-').map(Number);
        const rank = draftRank.get(originalRosterId) || 1;
        const overall = (round - 1) * n + rank;
        const { round: ktcRound, tier } = Vault.ktcPickSlot(overall);
        pickValueByKey.set(key, { value: pickMap.get(`${season}-${ktcRound}-${tier}`) || 0, tier });
      });
    }

    const allGraded = trades.map(tx => Vault.gradeTrade(tx, teamById, playersDb, valMap, pickValueByKey, teams, ppgMap, slots, replacementLevels)).filter(Boolean);
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
        teamName: team.teamName, rosterId: team.rosterId, record: team.record,
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
        const bucket = g.pctDiffNeed >= VAULT_CONFIG.LOPSIDED_PCT ? 'lopsided' : g.pctDiffNeed >= VAULT_CONFIG.FAIR_PCT ? 'borderline' : 'fair';
        s[bucket]++;
        if (bucket === 'lopsided') { if (dVal > 0) s.lopsidedFor++; else s.lopsidedAgainst++; }
        const rec = { opp, dVal, pctDiffNeed: g.pctDiffNeed, created: g.tx.created };
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
  },

  /* ---------- Career (all-time) record ----------
     Sleeper's roster.settings.wins/losses only cover the CURRENT season — a
     manager's real history spans however many seasons this league has run,
     chained backward through each league's own previous_league_id. Rosters
     (and roster_ids) get reshuffled/recreated every season, but a manager's
     Sleeper user_id doesn't, so career totals are keyed by owner_id, not
     roster_id — see buildOverallRecords. Capped at 25 seasons back purely as
     a runaway-loop guard; no real dynasty league is anywhere close to that. */
  async fetchLeagueHistory(league) {
    const seasons = [];
    // Sleeper sets previous_league_id to the STRING "0" (truthy in JS) for a
    // league's first season, not null/empty — without this check that fetches
    // a guaranteed-404 /league/0 every time a brand-new league loads this page.
    let prevId = league.previous_league_id;
    if (prevId === '0') prevId = null;
    let guard = 0;
    while (prevId && guard < 25) {
      guard++;
      let lg, rosters;
      try {
        [lg, rosters] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${prevId}`).then(r => r.json()),
          fetch(`https://api.sleeper.app/v1/league/${prevId}/rosters`).then(r => r.json())
        ]);
      } catch { break; }
      if (!lg || lg.error) break;
      seasons.push({ season: lg.season, rosters: rosters || [] });
      prevId = lg.previous_league_id === '0' ? null : lg.previous_league_id;
    }
    return seasons;
  },

  // owner_id -> { wins, losses, ties, seasons } summed across the current season's
  // teams (from buildLeagueTeams — already carries ownerId + record) plus every
  // past season fetchLeagueHistory found. A manager who joined partway through
  // the league's history just accumulates fewer seasons, same as a real career
  // record would.
  buildOverallRecords(currentTeams, pastSeasons) {
    const byOwner = new Map();
    const add = (ownerId, rs) => {
      if (!ownerId) return;
      const rec = byOwner.get(ownerId) || { wins: 0, losses: 0, ties: 0, seasons: 0 };
      rec.wins += rs.wins || 0; rec.losses += rs.losses || 0; rec.ties += rs.ties || 0; rec.seasons++;
      byOwner.set(ownerId, rec);
    };
    (currentTeams || []).forEach(t => add(t.ownerId, t.record || {}));
    (pastSeasons || []).forEach(s => s.rosters.forEach(r => add(r.owner_id, r.settings || {})));
    return byOwner;
  },

  /* ---------- Rest-of-season simulation ----------
     Projected record / playoff odds / championship odds, Monte Carlo'd against
     the league's REAL remaining schedule (not a random pairing) — Sleeper
     generates the full-season matchup grid up front, so future weeks' roster
     pairings are already known even though they haven't been played. A week
     counts as "remaining" if nobody has posted points yet; anything already
     played is left alone since it's already baked into the real win/loss record. */
  async fetchRemainingSchedule(leagueId, league) {
    const playoffStart = league.settings?.playoff_week_start || 15;
    const startWeek = Math.max(1, (league.settings?.leg || 1));
    const weeks = [];
    for (let w = startWeek; w < playoffStart; w++) weeks.push(w);
    if (!weeks.length) return [];
    const results = await Promise.all(weeks.map(w =>
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${w}`).then(r => r.json()).catch(() => [])
    ));
    return weeks.map((w, i) => {
      const entries = results[i] || [];
      const played = entries.some(m => (m.points || 0) > 0);
      if (played) return null;
      const byMatchup = new Map();
      entries.forEach(m => {
        if (m.matchup_id == null) return;
        if (!byMatchup.has(m.matchup_id)) byMatchup.set(m.matchup_id, []);
        byMatchup.get(m.matchup_id).push(m.roster_id);
      });
      const pairs = [...byMatchup.values()].filter(a => a.length === 2);
      return pairs.length ? { week: w, pairs } : null;
    }).filter(Boolean);
  },

  // Standard normal draw (Box-Muller) — the only randomness source for the
  // season/bracket simulation below.
  _randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  },

  // One simulated single-elimination bracket from a seed list (best seed first).
  // Byes go to the top seeds when the field isn't a power of two — e.g. 6 seeds
  // reduces to seeds 1-2 on a bye, 3v6 and 4v5 playing it out — the standard
  // convention most fantasy platforms use, then reseeds the survivors by their
  // original seed each round. Sleeper doesn't expose a way to query its own
  // bracket's exact pairing ahead of the playoffs actually starting, so this is
  // an approximation — close enough that simulated title odds track team
  // strength correctly even if one specific pairing differs from Sleeper's own.
  simulateBracket(seeds, strength, sigmaPct) {
    const drawScore = id => {
      const mean = strength.get(id) || 0;
      return Math.max(0, mean + Vault._randn() * mean * sigmaPct);
    };
    let remaining = seeds.slice();
    while (remaining.length > 1) {
      const n = remaining.length;
      const p = Math.pow(2, Math.ceil(Math.log2(n)));
      const byes = p - n;
      const byeTeams = remaining.slice(0, byes);
      const playing = remaining.slice(byes);
      const winners = [];
      for (let i = 0; i < playing.length / 2; i++) {
        const a = playing[i], b = playing[playing.length - 1 - i];
        winners.push(drawScore(a) >= drawScore(b) ? a : b);
      }
      remaining = [...byeTeams, ...winners];
    }
    return remaining[0];
  },

  /* Main entry point: Monte Carlo the rest of the regular season plus the
     playoff bracket, `trials` times. Team "strength" is held fixed at each
     team's current Opt PPG for the whole simulation (no in-season strength
     drift modeled) with a flat +/-22% per-week standard deviation — a rough
     but honest stand-in for real week-to-week fantasy variance, not fitted
     against this league's actual scoring spread. Regular-season standings use
     Sleeper's own tiebreak (wins, then total points).

     If the league plays a median ("league average") game — league.settings.
     league_average_match === 1 — every remaining week awards a SECOND win or
     loss per team based on whether their score beat the field's median that
     week, same as Sleeper itself scores it live (real season/career records
     already reflect this since they're read straight from Sleeper's own
     wins/losses — only the forward-looking simulation needs to model it).
     That doubles the games-per-week for the rest of this projection, same as
     it does in the real standings.

     Returns rosterId -> { projWins, projLosses, projTies, playoffPct, championshipPct }. */
  simulateSeason(teams, league, remainingWeeks, opts = {}) {
    const trials = opts.trials || 2000;
    const sigmaPct = opts.sigmaPct || 0.22;
    const playoffSpots = Math.min(teams.length, league.settings?.playoff_teams || 6);
    const medianGame = league.settings?.league_average_match === 1;
    const rosterIds = teams.map(t => t.rosterId);
    const strength = new Map(teams.map(t => [t.rosterId, t.opt]));
    const baseWins = new Map(teams.map(t => [t.rosterId, t.record?.wins || 0]));
    const baseLosses = new Map(teams.map(t => [t.rosterId, t.record?.losses || 0]));
    const baseTies = new Map(teams.map(t => [t.rosterId, t.record?.ties || 0]));
    const baseFpts = new Map(teams.map(t => [t.rosterId, t.record?.fpts || 0]));

    const totals = new Map(rosterIds.map(id => [id, { winsSum: 0, lossesSum: 0, tiesSum: 0, playoffCount: 0, champCount: 0 }]));
    const drawScore = id => {
      const mean = strength.get(id) || 0;
      return Math.max(0, mean + Vault._randn() * mean * sigmaPct);
    };

    for (let trial = 0; trial < trials; trial++) {
      const wins = new Map(baseWins), losses = new Map(baseLosses), ties = new Map(baseTies), fpts = new Map(baseFpts);
      remainingWeeks.forEach(wk => {
        // One score per roster for the week — reused for both the head-to-head
        // result AND the median comparison, since it's the same real game.
        const weekScores = new Map(rosterIds.map(id => [id, drawScore(id)]));
        wk.pairs.forEach(([a, b]) => {
          const sa = weekScores.get(a), sb = weekScores.get(b);
          fpts.set(a, fpts.get(a) + sa); fpts.set(b, fpts.get(b) + sb);
          if (sa > sb) { wins.set(a, wins.get(a) + 1); losses.set(b, losses.get(b) + 1); }
          else if (sb > sa) { wins.set(b, wins.get(b) + 1); losses.set(a, losses.get(a) + 1); }
          else { ties.set(a, ties.get(a) + 1); ties.set(b, ties.get(b) + 1); }
        });
        if (medianGame) {
          const sorted = [...weekScores.values()].sort((x, y) => x - y);
          const mid = sorted.length / 2;
          const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[mid - 1] + sorted[mid]) / 2;
          rosterIds.forEach(id => {
            const s = weekScores.get(id);
            if (s > median) wins.set(id, wins.get(id) + 1);
            else if (s < median) losses.set(id, losses.get(id) + 1);
            else ties.set(id, ties.get(id) + 1);
          });
        }
      });
      const standings = [...rosterIds].sort((x, y) => (wins.get(y) - wins.get(x)) || (fpts.get(y) - fpts.get(x)));
      const seeds = standings.slice(0, playoffSpots);
      seeds.forEach(id => totals.get(id).playoffCount++);
      rosterIds.forEach(id => {
        const t = totals.get(id);
        t.winsSum += wins.get(id); t.lossesSum += losses.get(id); t.tiesSum += ties.get(id);
      });
      if (seeds.length >= 2) {
        const champ = Vault.simulateBracket(seeds, strength, sigmaPct);
        totals.get(champ).champCount++;
      }
    }

    const out = new Map();
    rosterIds.forEach(id => {
      const t = totals.get(id);
      out.set(id, {
        projWins: t.winsSum / trials, projLosses: t.lossesSum / trials, projTies: t.tiesSum / trials,
        playoffPct: t.playoffCount / trials * 100, championshipPct: t.champCount / trials * 100
      });
    });
    return out;
  }
};
