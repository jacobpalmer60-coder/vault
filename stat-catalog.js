/* ============================================================
   STAT CATALOG
   Every fantasy stat the Compare page can show, by position, computed from
   data/weekly/<season>.json (Sleeper's weekly box scores + advanced fields,
   plus team totals). Grouped the way the industry does (PlayerProfiler,
   FantasyPros, PFF): fantasy production, consistency, usage, efficiency,
   big plays, scoring, ball security, and plain box score.

   Not here because Sleeper doesn't carry the tracking data: routes run
   (YPRR / TPRR / route share), evaded tackles, juke rate, EPA, CPOE,
   carries inside the 5, time to throw, pressure rate. Also not here: aDOT,
   targeted air yards share, WOPR, and RACR — Sleeper's air yards
   (rec_air_yd / pass_air_yd) only count COMPLETED passes (air yards + yards
   after catch = receiving yards exactly), and those four are defined on
   air yards for every target. The air-yard stats below are labeled for
   what they really are.

   Each stat:
     id, label, cat, pos (positions it applies to), def (positions where
     it's on by default), better ('high' | 'low' | null), kind:
       'count' — a counting stat: per game in Per game mode, summed in Totals
       'rate'  — a ratio/percentage: the same in both modes
       'weeks' — a count of games: % of games in Per game mode, count in Totals
       'max'   — a single best/longest value
     fmt ('int' | 'd1' | 'd2' | 'pct' | 'ord'), calc(A) → number | null,
     den(A) → the volume a rate stat rests on (for rank qualification),
     tip — plain-English definition.

   A (the aggregate for one player over the chosen games):
     s     summed stat keys          mx   per-week maxima (longest plays)
     gp    games played              pts  fantasy points (league scoring)
     tdPts points from touchdowns    wk   [{ pts, finish }] per game
     tm    team totals over those games (rec_tgt, rec_air_yd, rush_att, ...)
     starters  how many players at this position start in the league
   ============================================================ */
(function () {
  const pct = (a, b) => (b > 0 ? a / b : null);
  const per = (a, b) => (b > 0 ? a / b : null);
  const sum = (A, ...keys) => keys.reduce((t, k) => t + (A.s[k] || 0), 0);
  const quantile = (arr, q) => {
    if (!arr.length) return null;
    const s = [...arr].sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  const ALL = ['QB', 'RB', 'WR', 'TE'], SKILL = ['RB', 'WR', 'TE'], REC = ['WR', 'TE'];

  // NFL passer rating from summed box-score numbers.
  function passerRating(A) {
    const att = A.s.pass_att || 0;
    if (!att) return null;
    const c = v => Math.max(0, Math.min(2.375, v));
    const a = c(((A.s.pass_cmp || 0) / att - 0.3) * 5), b = c(((A.s.pass_yd || 0) / att - 3) * 0.25);
    const t = c((A.s.pass_td || 0) / att * 20), i = c(2.375 - (A.s.pass_int || 0) / att * 25);
    return (a + b + t + i) / 6 * 100;
  }

  const CATS = [
    ['fantasy', 'Fantasy production'],
    ['consistency', 'Consistency'],
    ['usage', 'Usage and opportunity'],
    ['efficiency', 'Efficiency'],
    ['bigplay', 'Big plays'],
    ['scoring', 'Touchdowns'],
    ['security', 'Ball security'],
    ['box', 'Box score']
  ];

  const S = [
    // ---- Fantasy production (your league's scoring) ----
    { id: 'fp', label: 'Fantasy points', cat: 'fantasy', pos: ALL, def: ALL, better: 'high', kind: 'count', fmt: 'd1', calc: A => A.pts, tip: 'Fantasy points in your league\'s scoring.' },
    { id: 'finish', label: 'Position finish', cat: 'fantasy', pos: ALL, def: ALL, better: 'low', kind: 'rank', fmt: 'ord', calc: A => A.finish ?? null, tip: 'Rank by total fantasy points at the position over these games.' },
    { id: 'fpOpp', label: 'Points per opportunity', cat: 'fantasy', pos: SKILL, def: [], better: 'high', kind: 'rate', fmt: 'd2', calc: A => per(A.pts, sum(A, 'rush_att', 'rec_tgt')), den: A => sum(A, 'rush_att', 'rec_tgt'), tip: 'Fantasy points per carry or target — how much each touch chance is worth.' },
    { id: 'fpDb', label: 'Points per dropback', cat: 'fantasy', pos: ['QB'], def: [], better: 'high', kind: 'rate', fmt: 'd2', calc: A => per(A.pts, sum(A, 'pass_att', 'pass_sack', 'rush_att')), den: A => sum(A, 'pass_att', 'pass_sack'), tip: 'Fantasy points per pass attempt, sack, or run.' },
    { id: 'rushShare', label: 'Rushing share of points', cat: 'fantasy', pos: ['QB'], def: ['QB'], better: null, kind: 'rate', fmt: 'pct', calc: A => pct(A.rushPts, A.pts), den: A => A.gp, tip: 'Share of fantasy points from running — a floor that doesn\'t depend on the passing game.' },

    // ---- Consistency (weekly finishes in your league's scoring) ----
    { id: 'top5', label: 'Top-5 weeks', cat: 'consistency', pos: ALL, def: [], better: 'high', kind: 'weeks', fmt: 'int', calc: A => A.wk.filter(w => w.finish <= 5).length, tip: 'Games finishing top 5 at the position that week.' },
    { id: 'top12', label: 'Top-12 weeks', cat: 'consistency', pos: ALL, def: ALL, better: 'high', kind: 'weeks', fmt: 'int', calc: A => A.wk.filter(w => w.finish <= 12).length, tip: 'Games finishing top 12 at the position that week.' },
    { id: 'top24', label: 'Top-24 weeks', cat: 'consistency', pos: ALL, def: [], better: 'high', kind: 'weeks', fmt: 'int', calc: A => A.wk.filter(w => w.finish <= 24).length, tip: 'Games finishing top 24 at the position that week.' },
    { id: 'starterWk', label: 'Starter weeks (your league)', cat: 'consistency', pos: ALL, def: ALL, better: 'high', kind: 'weeks', fmt: 'int', calc: A => A.starters ? A.wk.filter(w => w.finish <= A.starters).length : null, tip: 'Games finishing inside the number of players at this position your league starts each week.' },
    { id: 'floor', label: 'Floor (25th percentile)', cat: 'consistency', pos: ALL, def: [], better: 'high', kind: 'rate', fmt: 'd1', calc: A => quantile(A.wk.map(w => w.pts), 0.25), den: A => A.gp, tip: 'A typical bad week: 1 in 4 games is at or below this.' },
    { id: 'ceiling', label: 'Ceiling (90th percentile)', cat: 'consistency', pos: ALL, def: [], better: 'high', kind: 'rate', fmt: 'd1', calc: A => quantile(A.wk.map(w => w.pts), 0.9), den: A => A.gp, tip: 'A typical great week: 1 in 10 games is at or above this.' },
    { id: 'best', label: 'Best week', cat: 'consistency', pos: ALL, def: [], better: 'high', kind: 'max', fmt: 'd1', calc: A => A.wk.length ? Math.max(...A.wk.map(w => w.pts)) : null, tip: 'Most fantasy points in a single game.' },
    { id: 'swing', label: 'Week-to-week swing', cat: 'consistency', pos: ALL, def: [], better: 'low', kind: 'rate', fmt: 'd1', calc: A => { const x = A.wk.map(w => w.pts); if (x.length < 2) return null; const m = x.reduce((a, b) => a + b, 0) / x.length; return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length); }, den: A => A.gp, tip: 'Standard deviation of weekly points — lower is steadier.' },

    // ---- Usage and opportunity ----
    { id: 'snapPct', label: 'Snap share', cat: 'usage', pos: ALL, def: SKILL, better: 'high', kind: 'rate', fmt: 'pct', calc: A => A.s.off_snp ? pct(A.s.off_snp, A.s.tm_off_snp) : null, den: A => A.gp, tip: 'Share of the team\'s offensive snaps played (2019 on).' },
    { id: 'snaps', label: 'Snaps', cat: 'usage', pos: ALL, def: [], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.off_snp || null, tip: 'Offensive snaps played.' },
    { id: 'opp', label: 'Opportunities', cat: 'usage', pos: SKILL, def: ['RB'], better: 'high', kind: 'count', fmt: 'd1', calc: A => sum(A, 'rush_att', 'rec_tgt'), tip: 'Carries plus targets.' },
    { id: 'wopp', label: 'Weighted opportunities', cat: 'usage', pos: SKILL, def: [], better: 'high', kind: 'count', fmt: 'd1', calc: A => 1.5 * (A.s.rec_tgt || 0) + (A.s.rush_att || 0), tip: 'Targets count 1.5× a carry, since a target is worth about that much in PPR.' },
    { id: 'carryShare', label: 'Carry share', cat: 'usage', pos: ['QB', 'RB'], def: ['RB'], better: 'high', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.rush_att || 0, A.tm.rush_att), den: A => A.gp, tip: 'Share of the team\'s carries.' },
    { id: 'tgtShare', label: 'Target share', cat: 'usage', pos: SKILL, def: SKILL, better: 'high', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.rec_tgt || 0, A.tm.rec_tgt), den: A => A.gp, tip: 'Share of the team\'s targets.' },
    { id: 'aySharePct', label: 'Caught air yards share', cat: 'usage', pos: SKILL, def: REC, better: 'high', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.rec_air_yd || 0, A.tm.rec_air_yd), den: A => A.gp, tip: 'Share of the team\'s air yards on completed passes — how much of the downfield passing game runs through him. (Sleeper only tracks air yards on catches, so this isn\'t the usual air yards share.)' },
    { id: 'rzShare', label: 'Red zone share', cat: 'usage', pos: SKILL, def: [], better: 'high', kind: 'rate', fmt: 'pct', calc: A => pct(sum(A, 'rush_rz_att', 'rec_rz_tgt'), (A.tm.rush_rz_att || 0) + (A.tm.rec_rz_tgt || 0)), den: A => A.gp, tip: 'Share of the team\'s red-zone carries and targets.' },
    { id: 'rzCarry', label: 'Red zone carries', cat: 'usage', pos: ['QB', 'RB'], def: ['RB'], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.rush_rz_att || 0, tip: 'Carries inside the opponent\'s 20.' },
    { id: 'rzTgt', label: 'Red zone targets', cat: 'usage', pos: SKILL, def: REC, better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.rec_rz_tgt || 0, tip: 'Targets inside the opponent\'s 20.' },
    { id: 'rzPass', label: 'Red zone pass attempts', cat: 'usage', pos: ['QB'], def: [], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.pass_rz_att || 0, tip: 'Pass attempts inside the opponent\'s 20.' },
    { id: 'dropbacks', label: 'Dropbacks', cat: 'usage', pos: ['QB'], def: [], better: 'high', kind: 'count', fmt: 'd1', calc: A => sum(A, 'pass_att', 'pass_sack'), tip: 'Pass attempts plus sacks.' },
    { id: 'dom', label: 'Dominator rating', cat: 'usage', pos: REC, def: [], better: 'high', kind: 'rate', fmt: 'pct', calc: A => { const y = pct(A.s.rec_yd || 0, A.tm.rec_yd), t = pct(A.s.rec_td || 0, A.tm.rec_td); return y == null ? null : (y + (t ?? y)) / 2; }, den: A => A.gp, tip: 'Average of the player\'s share of team receiving yards and receiving TDs.' },

    // ---- Efficiency ----
    { id: 'cmpPct', label: 'Completion %', cat: 'efficiency', pos: ['QB'], def: ['QB'], better: 'high', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.pass_cmp || 0, A.s.pass_att), den: A => A.s.pass_att || 0, tip: 'Completions per pass attempt.' },
    { id: 'ypa', label: 'Yards per attempt', cat: 'efficiency', pos: ['QB'], def: ['QB'], better: 'high', kind: 'rate', fmt: 'd1', calc: A => per(A.s.pass_yd || 0, A.s.pass_att), den: A => A.s.pass_att || 0, tip: 'Passing yards per attempt.' },
    { id: 'tdRate', label: 'TD rate', cat: 'efficiency', pos: ['QB'], def: ['QB'], better: 'high', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.pass_td || 0, A.s.pass_att), den: A => A.s.pass_att || 0, tip: 'Passing TDs per attempt.' },
    { id: 'intRate', label: 'INT rate', cat: 'efficiency', pos: ['QB'], def: [], better: 'low', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.pass_int || 0, A.s.pass_att), den: A => A.s.pass_att || 0, tip: 'Interceptions per attempt.' },
    { id: 'sackRate', label: 'Sack rate', cat: 'efficiency', pos: ['QB'], def: [], better: 'low', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.pass_sack || 0, sum(A, 'pass_att', 'pass_sack')), den: A => A.s.pass_att || 0, tip: 'Sacks per dropback.' },
    { id: 'ayPa', label: 'Air yards per completion', cat: 'efficiency', pos: ['QB'], def: [], better: null, kind: 'rate', fmt: 'd1', calc: A => per(A.s.pass_air_yd || 0, A.s.pass_cmp), den: A => A.s.pass_cmp || 0, tip: 'How far completed passes travel in the air, on average — a sign of how aggressive he is. (Sleeper only tracks air yards on completions.)' },
    { id: 'rating', label: 'Passer rating', cat: 'efficiency', pos: ['QB'], def: [], better: 'high', kind: 'rate', fmt: 'd1', calc: passerRating, den: A => A.s.pass_att || 0, tip: 'The NFL passer rating, from completions, yards, TDs, and interceptions.' },
    { id: 'passFdPct', label: 'First downs per attempt', cat: 'efficiency', pos: ['QB'], def: [], better: 'high', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.pass_fd || 0, A.s.pass_att), den: A => A.s.pass_att || 0, tip: 'Passing first downs per attempt — how often he moves the chains.' },
    { id: 'ypc', label: 'Yards per carry', cat: 'efficiency', pos: ['QB', 'RB'], def: ['RB'], better: 'high', kind: 'rate', fmt: 'd2', calc: A => per(A.s.rush_yd || 0, A.s.rush_att), den: A => A.s.rush_att || 0, tip: 'Rushing yards per carry.' },
    { id: 'yaco', label: 'Yards after contact per carry', cat: 'efficiency', pos: ['RB'], def: ['RB'], better: 'high', kind: 'rate', fmt: 'd2', calc: A => per(A.s.rush_yac || 0, A.s.rush_att), den: A => A.s.rush_att || 0, tip: 'Rushing yards gained after first contact, per carry — what the runner creates himself. Charted by Sportradar via Sleeper, on a lower scale than PFF\'s, so compare players here to each other rather than to PFF numbers.' },
    { id: 'btkl', label: 'Broken tackles', cat: 'efficiency', pos: ['RB', 'WR'], def: ['RB'], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.rush_btkl || 0, tip: 'Broken tackles on runs (Sportradar charting via Sleeper).' },
    { id: 'stuff', label: 'Stuffed rate', cat: 'efficiency', pos: ['RB'], def: [], better: 'low', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.rush_tkl_loss || 0, A.s.rush_att), den: A => A.s.rush_att || 0, tip: 'Share of carries stopped behind the line.' },
    { id: 'rushFdPct', label: 'First downs per carry', cat: 'efficiency', pos: ['RB'], def: [], better: 'high', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.rush_fd || 0, A.s.rush_att), den: A => A.s.rush_att || 0, tip: 'Rushing first downs per carry.' },
    { id: 'catchRate', label: 'Catch rate', cat: 'efficiency', pos: SKILL, def: REC, better: 'high', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.rec || 0, A.s.rec_tgt), den: A => A.s.rec_tgt || 0, tip: 'Catches per target.' },
    { id: 'ypt', label: 'Yards per target', cat: 'efficiency', pos: SKILL, def: REC, better: 'high', kind: 'rate', fmt: 'd2', calc: A => per(A.s.rec_yd || 0, A.s.rec_tgt), den: A => A.s.rec_tgt || 0, tip: 'Receiving yards per target — the best simple receiving efficiency stat.' },
    { id: 'ypr', label: 'Yards per catch', cat: 'efficiency', pos: SKILL, def: [], better: 'high', kind: 'rate', fmt: 'd1', calc: A => per(A.s.rec_yd || 0, A.s.rec), den: A => A.s.rec || 0, tip: 'Receiving yards per catch.' },
    { id: 'airPerRec', label: 'Air yards per catch', cat: 'efficiency', pos: SKILL, def: REC, better: null, kind: 'rate', fmt: 'd1', calc: A => per(A.s.rec_air_yd || 0, A.s.rec), den: A => A.s.rec || 0, tip: 'How far downfield his catches are made, on average — his role, not a grade. (Close to aDOT, but Sleeper only tracks air yards on catches, not every target.)' },
    { id: 'yac', label: 'Yards after catch per catch', cat: 'efficiency', pos: SKILL, def: [], better: 'high', kind: 'rate', fmt: 'd1', calc: A => per(A.s.rec_yar || 0, A.s.rec), den: A => A.s.rec || 0, tip: 'Yards gained after the catch, per catch.' },
    { id: 'dropRate', label: 'Drop rate', cat: 'efficiency', pos: SKILL, def: [], better: 'low', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.rec_drop || 0, A.s.rec_tgt), den: A => A.s.rec_tgt || 0, tip: 'Drops per target.' },
    { id: 'recFdPct', label: 'First downs per target', cat: 'efficiency', pos: SKILL, def: [], better: 'high', kind: 'rate', fmt: 'pct', calc: A => pct(A.s.rec_fd || 0, A.s.rec_tgt), den: A => A.s.rec_tgt || 0, tip: 'Receiving first downs per target.' },

    // ---- Big plays ----
    { id: 'pass40', label: '40+ yard completions', cat: 'bigplay', pos: ['QB'], def: [], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.pass_cmp_40p || 0, tip: 'Completions of 40 or more yards.' },
    { id: 'g300', label: '300-yard games', cat: 'bigplay', pos: ['QB'], def: [], better: 'high', kind: 'weeks', fmt: 'int', calc: A => A.games.filter(g => (g.pass_yd || 0) >= 300).length, tip: 'Games with 300+ passing yards.' },
    { id: 'rush40', label: '40+ yard runs', cat: 'bigplay', pos: ['QB', 'RB'], def: [], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.rush_40p || 0, tip: 'Runs of 40 or more yards.' },
    { id: 'rec20', label: '20+ yard catches', cat: 'bigplay', pos: SKILL, def: [], better: 'high', kind: 'count', fmt: 'd1', calc: A => sum(A, 'rec_20_29', 'rec_30_39', 'rec_40p'), tip: 'Catches of 20 or more yards.' },
    { id: 'rec40', label: '40+ yard catches', cat: 'bigplay', pos: SKILL, def: [], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.rec_40p || 0, tip: 'Catches of 40 or more yards.' },
    { id: 'g100', label: '100-yard games', cat: 'bigplay', pos: SKILL, def: [], better: 'high', kind: 'weeks', fmt: 'int', calc: A => A.games.filter(g => (g.rush_yd || 0) + (g.rec_yd || 0) >= 100).length, tip: 'Games with 100+ rushing plus receiving yards.' },
    { id: 'long', label: 'Longest play', cat: 'bigplay', pos: ALL, def: [], better: 'high', kind: 'max', fmt: 'int', calc: A => Math.max(A.mx.rush_lng || 0, A.mx.rec_lng || 0, A.mx.pass_lng || 0) || null, tip: 'Longest run, catch, or completion.' },

    // ---- Touchdowns ----
    { id: 'tds', label: 'Total TDs', cat: 'scoring', pos: SKILL, def: SKILL, better: 'high', kind: 'count', fmt: 'd1', calc: A => sum(A, 'rush_td', 'rec_td'), tip: 'Rushing plus receiving touchdowns.' },
    { id: 'tdDep', label: 'TD dependency', cat: 'scoring', pos: ALL, def: SKILL, better: null, kind: 'rate', fmt: 'pct', calc: A => pct(A.tdPts, A.pts), den: A => A.gp, tip: 'Share of fantasy points from touchdowns. High shares tend to regress — touchdowns are the least repeatable part of scoring.' },
    { id: 'tdPerOpp', label: 'TDs per opportunity', cat: 'scoring', pos: SKILL, def: [], better: 'high', kind: 'rate', fmt: 'pct', calc: A => pct(sum(A, 'rush_td', 'rec_td'), sum(A, 'rush_att', 'rec_tgt')), den: A => sum(A, 'rush_att', 'rec_tgt'), tip: 'Touchdowns per carry or target.' },
    { id: 'rzTdPct', label: 'Red zone TD rate', cat: 'scoring', pos: SKILL, def: [], better: 'high', kind: 'rate', fmt: 'pct', calc: A => pct(sum(A, 'rush_td', 'rec_td'), sum(A, 'rush_rz_att', 'rec_rz_tgt')), den: A => sum(A, 'rush_rz_att', 'rec_rz_tgt'), tip: 'Touchdowns per red-zone carry or target (most TDs come from the red zone).' },
    { id: 'firstTd', label: 'First TD of the game', cat: 'scoring', pos: ALL, def: [], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.first_td || 0, tip: 'Games where he scored the first touchdown (2026 on).' },

    // ---- Ball security ----
    { id: 'fumLost', label: 'Fumbles lost', cat: 'security', pos: ALL, def: [], better: 'low', kind: 'count', fmt: 'd1', calc: A => A.s.fum_lost || 0, tip: 'Fumbles lost to the defense.' },
    { id: 'drops', label: 'Drops', cat: 'security', pos: SKILL, def: [], better: 'low', kind: 'count', fmt: 'd1', calc: A => A.s.rec_drop || 0, tip: 'Dropped passes.' },
    { id: 'sacks', label: 'Sacks taken', cat: 'security', pos: ['QB'], def: [], better: 'low', kind: 'count', fmt: 'd1', calc: A => A.s.pass_sack || 0, tip: 'Times sacked.' },

    // ---- Box score ----
    { id: 'passAtt', label: 'Pass attempts', cat: 'box', pos: ['QB'], def: ['QB'], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.pass_att || 0, tip: '' },
    { id: 'passYd', label: 'Pass yards', cat: 'box', pos: ['QB'], def: ['QB'], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.pass_yd || 0, tip: '' },
    { id: 'passTd', label: 'Pass TDs', cat: 'box', pos: ['QB'], def: ['QB'], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.pass_td || 0, tip: '' },
    { id: 'passInt', label: 'Interceptions', cat: 'box', pos: ['QB'], def: ['QB'], better: 'low', kind: 'count', fmt: 'd1', calc: A => A.s.pass_int || 0, tip: '' },
    { id: 'rushAtt', label: 'Carries', cat: 'box', pos: ['QB', 'RB'], def: ['QB', 'RB'], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.rush_att || 0, tip: '' },
    { id: 'rushYd', label: 'Rush yards', cat: 'box', pos: ALL, def: ['QB', 'RB'], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.rush_yd || 0, tip: '' },
    { id: 'rushTd', label: 'Rush TDs', cat: 'box', pos: ['QB', 'RB'], def: ['QB'], better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.rush_td || 0, tip: '' },
    { id: 'tgt', label: 'Targets', cat: 'box', pos: SKILL, def: SKILL, better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.rec_tgt || 0, tip: '' },
    { id: 'rec', label: 'Receptions', cat: 'box', pos: SKILL, def: SKILL, better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.rec || 0, tip: '' },
    { id: 'recYd', label: 'Receiving yards', cat: 'box', pos: SKILL, def: SKILL, better: 'high', kind: 'count', fmt: 'd1', calc: A => A.s.rec_yd || 0, tip: '' },
    { id: 'scrimYd', label: 'Scrimmage yards', cat: 'box', pos: SKILL, def: ['RB'], better: 'high', kind: 'count', fmt: 'd1', calc: A => sum(A, 'rush_yd', 'rec_yd'), tip: 'Rushing plus receiving yards.' }
  ];

  window.StatCatalog = { CATS, STATS: S, byId: new Map(S.map(s => [s.id, s])) };
})();
