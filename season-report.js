/* ============================================================
   SEASON REPORT
   How each team's season is going, from Sleeper alone:
   - Luck: wins against the wins its weekly scores would earn against
     every other team each week (all-play), median games included.
   - Injuries: what players being out cost its best lineup each week, on
     their typical projection (byes counted apart).
   - Lineup calls: the lineup started against the best lineup that week's
     projections called for, both on what they really scored.
   - Over/under: what it scored against what it was projected to score.

   Vault.seasonReport(leagueId, { onProgress }) returns everything for every
   team, so other pages (a contend/rebuild timeline) can reuse it; the Teams
   page shows it with Vault.renderSeasonReport (below). Weekly
   Sleeper data (matchups, projections, who played, the NFL schedule) is
   cached for the browser session: completed weeks never change.

   Sleeper's projections for a past week are its final pre-game ones, so a
   player ruled out before kickoff projects 0. They're re-scored here in the
   league's own scoring (Vault.scoreProjection).
   Requires vault-core.js.
   ============================================================ */
(function () {
  const SR = {
    CLOSE_GAME: 5,          // points: a game decided by this little is a close one
    CLOSE_CALL: 1.5,        // projected points: a start/sit this close is about a coin flip (Start/Sit page), so the manager's pick stands
    LUCK_MIN_WINS: 1,       // Lucky/Unlucky: at least this many wins off, and at least one standard deviation
    // Tag lines, as a share of the lineup so they mean the same with 8 starters
    // or 21 (IDP). Set from 9 test leagues of every format: each tags about the
    // top 10-20% of teams.
    INJURY_TAG_PCT: 3.5,    // Injury-hit: injuries cost the best lineup this % of its points
    LINEUP_TAG_PCT: 3,      // Lineup leaks: started lineups scored this % less than the projections' pick...
    LINEUP_TAG_GAP: 2,      // ...and were projected this many points a week worse before the games
    PERF_TAG_PCT: 7,        // Over/Underperforming: this % above or below projections, beyond the league's average
                            // (Sleeper underrates some positions, IDP most, so the whole league runs over)
    PLAYERS_SHOWN: 3
  };
  const API = 'https://api.sleeper.app';
  const NOT_STARTABLE = ['BN', 'IR', 'TAXI'];

  /* ---------- Weekly data, cached for the session ---------- */
  const mem = new Map();
  async function cached(key, load) {
    if (mem.has(key)) return mem.get(key);
    let hit = null;
    try { const s = sessionStorage.getItem(key); if (s) hit = JSON.parse(s); } catch {}
    if (hit) { mem.set(key, hit); return hit; }
    const p = load().then(v => {
      try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* full: keep it in memory only */ }
      mem.set(key, v);
      return v;
    }).catch(e => { mem.delete(key); throw e; });
    mem.set(key, p);
    return p;
  }
  const getJson = u => fetch(u).then(r => { if (!r.ok) throw new Error(`Sleeper ${r.status}`); return r.json(); });
  const JUNK = /^(adp_|pos_adp_|pos_rank_|rank_|pts_|cmp_pct$|gp$|gs$|gms_active$)/;
  // A week's projections: player id -> projected stat counts (players with any).
  // Sleeper's v1 endpoint holds the same numbers as the per-position one the
  // Start/Sit page calls, every position at once and far smaller.
  const weekProjections = (season, week) => cached(`vault_sr_proj_${season}_${week}`, async () => {
    const raw = await getJson(`${API}/v1/projections/nfl/regular/${season}/${week}`);
    const out = {};
    for (const [pid, st] of Object.entries(raw || {})) {
      let s = null;
      for (const [k, v] of Object.entries(st || {})) if (v && !JUNK.test(k)) (s = s || {})[k] = v;
      if (s) out[pid] = s;
    }
    return out;
  });
  // Who played that week (any player with a game played).
  const weekPlayed = (season, week) => cached(`vault_sr_played_${season}_${week}`, async () => {
    const raw = await getJson(`${API}/v1/stats/nfl/regular/${season}/${week}`);
    return Object.keys(raw || {}).filter(pid => (raw[pid].gp || 0) > 0 || (raw[pid].gms_active || 0) > 0);
  });
  // NFL teams with a game each week (the rest are on bye).
  const nflSchedule = season => cached(`vault_sr_sched_${season}`, async () => {
    const games = await getJson(`${API}/schedule/nfl/regular/${season}`);
    const byWeek = {};
    (games || []).forEach(g => { (byWeek[g.week] = byWeek[g.week] || []).push(g.home, g.away); });
    return byWeek;
  });
  // Each team's matchup entry for one week, cut to what the report reads.
  const leagueWeek = (leagueId, week) => cached(`vault_sr_mu_${leagueId}_${week}`, async () => {
    const raw = await getJson(`${API}/v1/league/${leagueId}/matchups/${week}`);
    return (raw || []).map(m => ({
      r: m.roster_id, m: m.matchup_id, pts: m.custom_points != null ? m.custom_points : (m.points || 0),
      s: (m.starters || []).map(String), pl: (m.players || []).map(String), pp: m.players_points || {}
    }));
  });
  // A past season: players' NFL teams then (today's teams are wrong for it).
  // One season-stats call, only for an old season's report.
  const seasonTeams = (season, positions) => cached(`vault_sr_teams_${season}`, async () => {
    const q = positions.map(p => `position[]=${encodeURIComponent(p)}`).join('&');
    const rows = await getJson(`${API}/stats/nfl/${season}?season_type=regular&${q}`);
    const out = {};
    (rows || []).forEach(r => { if (r && r.player_id && r.team) out[r.player_id] = r.team; });
    return out;
  });

  /* ---------- Scoring and lineups ---------- */
  // Sleeper's projections leave out a few stats its real stat lines carry
  // (receptions by position for TE premium, first downs by position, missed
  // field goals in all, field goal yards past 30). They follow from stats the
  // projections do have, so add them before scoring.
  function projectionStats(st, pos) {
    const s = { ...st };
    const put = (k, v) => { if (s[k] == null && v) s[k] = v; };
    const fd = (s.pass_fd || 0) + (s.rush_fd || 0) + (s.rec_fd || 0);
    if (pos === 'TE') { put('bonus_rec_te', s.rec); put('bonus_fd_te', fd); }
    if (pos === 'WR') { put('bonus_rec_wr', s.rec); put('bonus_fd_wr', fd); }
    if (pos === 'RB') { put('bonus_rec_rb', s.rec); put('bonus_fd_rb', fd); }
    if (pos === 'QB') put('bonus_fd_qb', fd);
    if (pos === 'K') {
      // Kicks of 50+ often have no bucket of their own: they're the makes the
      // shorter buckets don't account for.
      const under50 = (s.fgm_0_19 || 0) + (s.fgm_20_29 || 0) + (s.fgm_30_39 || 0) + (s.fgm_40_49 || 0);
      if (s.fgm_50p == null && s.fgm_50_59 == null && s.fgm_60p == null) put('fgm_50p', Math.max(0, (s.fgm || 0) - under50));
      put('fgm_50p', (s.fgm_50_59 || 0) + (s.fgm_60p || 0));
      if (s.fgm_50_59 == null && s.fgm_60p == null) put('fgm_50_59', s.fgm_50p);
      put('fgmiss', Object.keys(s).filter(k => k.startsWith('fgmiss_')).reduce((a, k) => a + s[k], 0));
      // Yards past 30 from each bucket's middle distance.
      put('fgm_yds_over_30', 5 * (s.fgm_30_39 || 0) + 15 * (s.fgm_40_49 || 0) + 25 * (s.fgm_50_59 != null ? s.fgm_50_59 : (s.fgm_50p || 0)) + 32 * (s.fgm_60p || 0));
    }
    return s;
  }
  const IDP_GROUP = { DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DB: 'DB' };
  const SLOT_ELIG = { FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'], IDP_FLEX: ['DL', 'LB', 'DB'] };
  // The slots a player can fill: his position and its IDP group (a DE fills DL).
  function eligOf(pos) {
    const s = new Set([pos]);
    if (IDP_GROUP[pos]) s.add(IDP_GROUP[pos]);
    if (pos === 'SS' || pos === 'FS') s.add('S');
    if (pos === 'NT') s.add('DT');
    return s;
  }
  const fits = (slot, elig) => (SLOT_ELIG[slot] || [slot]).some(p => elig.has(p));
  // Best lineup for the league's slots: the most restrictive slots are filled
  // first, each with the best player left who can play it.
  function bestLineup(pool, slots) {
    const order = slots.map((s, i) => [s, i]).sort((a, b) => (SLOT_ELIG[a[0]] || [a[0]]).length - (SLOT_ELIG[b[0]] || [b[0]]).length || a[1] - b[1]);
    const sorted = pool.filter(p => p.v > 0).sort((a, b) => b.v - a.v);
    const used = new Set(), ids = [];
    let total = 0;
    for (const [slot] of order) {
      const p = sorted.find(x => !used.has(x.id) && fits(slot, x.elig));
      if (!p) continue;
      used.add(p.id); ids.push(p.id); total += p.v;
    }
    return { total, ids };
  }

  /* ---------- Which season, which weeks ---------- */
  // Completed regular-season weeks of this league's season: through last week
  // while it's on, all of them once the regular season is over.
  function completedWeeks(league, state) {
    const s = league.settings || {};
    const first = s.start_week || 1;
    const lastRegular = (s.playoff_week_start || 15) - 1;
    let last = 0;
    const sameSeason = String(league.season) === String(state.season);
    if (league.status === 'complete' || +league.season < +state.season) last = lastRegular;
    else if (sameSeason && state.season_type === 'regular') last = Math.min(lastRegular, (+state.week || 1) - 1);
    else if (sameSeason && (state.season_type === 'post' || state.season_type === 'off')) last = lastRegular;
    const weeks = [];
    for (let w = first; w <= last; w++) weeks.push(w);
    return weeks;
  }

  /* ---------- The report ---------- */
  async function seasonReport(leagueId, { onProgress } = {}) {
    const [state, players] = await Promise.all([getJson(`${API}/v1/state/nfl`), Vault.fetchSleeperPlayers()]);
    let league = await getJson(`${API}/v1/league/${leagueId}`);
    if (!league || league.error) throw new Error('League not found.');
    let weeks = completedWeeks(league, state), fromPrevious = null;
    // Before this season's first game: last season's report, when there is one.
    if (!weeks.length) {
      const prevId = league.previous_league_id;
      const prev = prevId && prevId !== '0' ? await getJson(`${API}/v1/league/${prevId}`).catch(() => null) : null;
      const prevWeeks = prev && !prev.error ? completedWeeks(prev, state) : [];
      if (!prevWeeks.length) return { league, empty: true, season: league.season };
      fromPrevious = { season: league.season, name: league.name };
      league = prev; weeks = prevWeeks;
    }
    const lid = league.league_id, season = league.season;
    const [users, rosters] = await Promise.all([getJson(`${API}/v1/league/${lid}/users`), getJson(`${API}/v1/league/${lid}/rosters`)]);
    const scoring = league.scoring_settings || {};
    const set = league.settings || {};
    const slots = (league.roster_positions || []).filter(p => !NOT_STARTABLE.includes(p));
    const bestBall = set.best_ball === 1, median = set.league_average_match === 1;
    const oldSeason = +season < +(state.season || season);

    // Weekly data, a few weeks at a time.
    let done = 0;
    const total = weeks.length + 1;
    const tick = () => onProgress && onProgress(++done, total);
    const startPositions = [...new Set(slots.flatMap(s => SLOT_ELIG[s] || [s]))];
    const [sched, pastTeams] = await Promise.all([
      nflSchedule(season),
      oldSeason ? seasonTeams(season, startPositions.filter(p => p !== 'DEF')).catch(() => ({})) : Promise.resolve(null)
    ]);
    tick();
    const byWeek = new Map();
    for (let i = 0; i < weeks.length; i += 4) {
      await Promise.all(weeks.slice(i, i + 4).map(async w => {
        const [mu, proj, played] = await Promise.all([leagueWeek(lid, w), weekProjections(season, w), weekPlayed(season, w)]);
        byWeek.set(w, { mu, proj, played: new Set(played), playing: new Set(sched[w] || []) });
        tick();
      }));
    }

    // Players: position, slots, NFL team, and this week's projection in league scoring.
    const info = new Map();
    const playerOf = pid => {
      let p = info.get(pid);
      if (p) return p;
      const s = players[pid] || {};
      const isDef = s.position === 'DEF' || /^[A-Z]{2,3}$/.test(pid);
      const pos = isDef ? 'DEF' : (s.position || '');
      const team = isDef ? pid : (pastTeams ? pastTeams[pid] || null : s.team || null);
      const name = isDef ? `${s.first_name || pid} ${s.last_name || ''}`.trim() : (`${s.first_name || ''} ${s.last_name || ''}`.trim() || pid);
      p = { id: pid, pos, elig: eligOf(pos), team, name, proj: new Map() };
      info.set(pid, p);
      return p;
    };
    const projOf = (p, w) => {
      if (p.proj.has(w)) return p.proj.get(w);
      const st = byWeek.get(w).proj[p.id];
      const v = st ? Math.round(Vault.scoreProjection(st, scoring, p.pos) * 100) / 100 : 0;
      p.proj.set(w, v);
      return v;
    };
    // Typical projection: his average across the weeks he was projected to play.
    weeks.forEach(w => byWeek.get(w).mu.forEach(e => e.pl.forEach(pid => projOf(playerOf(pid), w))));
    info.forEach(p => {
      const vals = [...p.proj.values()].filter(v => v > 0.5);
      p.typ = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });
    // Where he stood that week: on bye, out (projected 0 before the game, his
    // team played and he didn't), or a late scratch (projected to play, didn't).
    const statusOf = (p, w) => {
      const W = byWeek.get(w);
      const played = W.played.has(p.id), proj = projOf(p, w);
      if (!p.team) return played ? 'ok' : 'noteam';
      if (!W.playing.has(p.team) && !played && !(proj > 0)) return 'bye';
      if (played) return 'ok';
      return proj > 0 ? 'scratch' : 'out';
    };

    // Teams.
    const userById = new Map((users || []).map(u => [u.user_id, u]));
    const teams = (rosters || []).map(r => {
      const u = userById.get(r.owner_id) || {};
      return {
        rosterId: r.roster_id, ownerId: r.owner_id,
        name: u.metadata?.team_name || u.display_name || `Team ${r.roster_id}`,
        taxi: new Set((r.taxi || []).map(String)),
        weeks: [], h2h: { w: 0, l: 0, t: 0 }, med: { w: 0, l: 0, t: 0 }, allPlay: { w: 0, l: 0, t: 0 }, close: { w: 0, l: 0, t: 0 },
        expWins: 0, actWins: 0, variance: 0, pf: 0, pa: 0, games: 0,
        inj: { cost: 0, bye: 0, healthy: 0, players: new Map() },
        lineup: { started: 0, byProj: 0, gap: 0, hindsight: 0, calls: [], scratches: [], gameTime: [], weeksOff: 0 },
        perf: { actual: 0, projected: 0, players: new Map() }
      };
    });
    const teamById = new Map(teams.map(t => [t.rosterId, t]));
    const rec = (r, a, b) => { if (a > b) r.w++; else if (a < b) r.l++; else r.t++; };

    for (const w of weeks) {
      const { mu } = byWeek.get(w);
      const scores = mu.map(e => e.pts);
      const n = mu.length;
      const sortedPts = [...scores].sort((a, b) => a - b);
      const mid = n % 2 ? sortedPts[(n - 1) / 2] : (sortedPts[n / 2 - 1] + sortedPts[n / 2]) / 2;
      // The weekly scores of everyone but this team, for the best-ball lift (below).
      const weekRows = [];
      for (const e of mu) {
        const t = teamById.get(e.r);
        if (!t) continue;
        const row = { week: w, pts: e.pts };
        // Luck: head to head, the median game, and against everyone.
        const opp = e.m != null ? mu.find(o => o !== e && o.m === e.m) : null;
        let p = 0;
        mu.forEach(o => { if (o !== e) { rec(t.allPlay, e.pts, o.pts); p += e.pts > o.pts ? 1 : e.pts === o.pts ? 0.5 : 0; } });
        p = n > 1 ? p / (n - 1) : 0.5;
        row.allPlayPct = p;
        if (opp) {
          rec(t.h2h, e.pts, opp.pts);
          t.actWins += e.pts > opp.pts ? 1 : e.pts === opp.pts ? 0.5 : 0;
          t.expWins += p; t.variance += p * (1 - p); t.games++;
          t.pa += opp.pts;
          row.opp = opp.r; row.oppPts = opp.pts; row.result = e.pts > opp.pts ? 'W' : e.pts < opp.pts ? 'L' : 'T';
          if (Math.abs(e.pts - opp.pts) <= SR.CLOSE_GAME) rec(t.close, e.pts, opp.pts);
        }
        if (median) {
          rec(t.med, e.pts, mid);
          t.actWins += e.pts > mid ? 1 : e.pts === mid ? 0.5 : 0;
          t.expWins += p; t.variance += p * (1 - p); t.games++;
          row.medResult = e.pts > mid ? 'W' : e.pts < mid ? 'L' : 'T';
        }
        t.pf += e.pts;

        // This week's pool: everyone on the roster who could start (not taxi).
        const pool = e.pl.filter(pid => !t.taxi.has(pid)).map(playerOf);
        const st = new Map(pool.map(p => [p.id, statusOf(p, w)]));
        const act = pid => +e.pp[pid] || 0;

        // Injuries, on typical projections: everyone but byes, against everyone available.
        const withTyp = pool.filter(p => p.typ > 0).map(p => ({ id: p.id, elig: p.elig, v: p.typ }));
        const full = bestLineup(withTyp, slots);
        const healthyPool = withTyp.filter(p => st.get(p.id) !== 'bye');
        const healthy = bestLineup(healthyPool, slots);
        const avail = bestLineup(healthyPool.filter(p => st.get(p.id) !== 'out'), slots);
        row.byeCost = full.total - healthy.total;
        row.injCost = healthy.total - avail.total;
        t.inj.bye += row.byeCost; t.inj.cost += row.injCost; t.inj.healthy += healthy.total;
        pool.forEach(p => {
          if (st.get(p.id) !== 'out' || !(p.typ > 0)) return;
          const cost = healthy.ids.includes(p.id) ? healthy.total - bestLineup(healthyPool.filter(x => x.id !== p.id), slots).total : 0;
          const a = t.inj.players.get(p.id) || { id: p.id, name: p.name, pos: p.pos, cost: 0, missed: 0, startsMissed: 0 };
          a.cost += cost; a.missed++; if (cost > 0) a.startsMissed++;
          t.inj.players.set(p.id, a);
        });

        // Lineup calls: what the started lineup scored against what the
        // projections' best lineup scored. Then perfect hindsight, for context.
        // A game-time call: listed out before kickoff (projected 0) but he played.
        // Starting or sitting him was a judgment the projections can't grade, so
        // a started one keeps his slot in both lineups and a benched one sits in both.
        const starters = e.s;
        const gameTime = pid => { const p = playerOf(pid); return p.typ > 0 && !(projOf(p, w) > 0) && byWeek.get(w).played.has(pid); };
        const locked = new Set(starters.map((pid, i) => (pid && pid !== '0' && gameTime(pid) ? i : -1)).filter(i => i >= 0));
        const open = starters.map((pid, i) => i).filter(i => !locked.has(i) && i < slots.length);
        const lockedAct = [...locked].reduce((a, i) => a + act(starters[i]), 0);
        const startedAct = starters.reduce((a, pid) => a + (pid && pid !== '0' ? act(pid) : 0), 0);
        const startedProj = open.reduce((a, i) => a + (starters[i] && starters[i] !== '0' ? projOf(playerOf(starters[i]), w) : 0), 0);
        // Close calls (within CLOSE_CALL projected points) count as the manager's
        // pick: the projections' lineup only swaps a starter out when it's clearly better.
        const startedSet = new Set(open.map(i => starters[i]));
        const byProj = bestLineup(pool.filter(p => !gameTime(p.id)).map(p => ({ id: p.id, elig: p.elig, v: projOf(p, w) + (startedSet.has(p.id) && projOf(p, w) > 0 ? SR.CLOSE_CALL : 0) })), open.map(i => slots[i]));
        byProj.total = byProj.ids.reduce((a, pid) => a + projOf(playerOf(pid), w), 0);
        const byProjAct = byProj.ids.reduce((a, pid) => a + act(pid), 0) + lockedAct;
        const hind = bestLineup(pool.map(p => ({ id: p.id, elig: p.elig, v: act(p.id) })), slots);
        row.startedAct = startedAct; row.startedProj = startedProj; row.byProjAct = byProjAct; row.byProjProj = byProj.total; row.hindsight = hind.total;
        row.lockedAct = lockedAct;
        if (!bestBall) {
          t.lineup.started += startedAct; t.lineup.byProj += byProjAct; t.lineup.gap += byProj.total - startedProj; t.lineup.hindsight += hind.total - startedAct;
          if (byProj.total - startedProj > 0.05) t.lineup.weeksOff++;
          slots.forEach((slot, i) => {
            const pid = starters[i];
            if (!pid || pid === '0') { t.lineup.calls.push({ week: w, slot, why: 'empty' }); return; }
            const p = playerOf(pid), s = statusOf(p, w);
            if (s === 'bye' || s === 'out') t.lineup.calls.push({ week: w, slot, id: pid, name: p.name, pos: p.pos, why: s });
            else if (s === 'scratch') t.lineup.scratches.push({ week: w, id: pid, name: p.name, pos: p.pos, proj: projOf(p, w) });
            else if (locked.has(i)) t.lineup.gameTime.push({ week: w, id: pid, name: p.name, pos: p.pos, pts: act(pid) });
          });
        }

        // Over/under: who was counted on, against what he scored. In best ball
        // every rostered player with a projection counts (any of them can score).
        const counted = bestBall ? pool.filter(p => projOf(p, w) > 0).map(p => p.id) : starters.filter(pid => pid && pid !== '0' && projOf(playerOf(pid), w) > 0);
        counted.forEach(pid => {
          const p = playerOf(pid), d = act(pid) - projOf(p, w);
          const a = t.perf.players.get(pid) || { id: pid, name: p.name, pos: p.pos, diff: 0, weeks: 0, actual: 0, projected: 0 };
          a.diff += d; a.weeks++; a.actual += act(pid); a.projected += projOf(p, w);
          t.perf.players.set(pid, a);
        });
        weekRows.push([t, row]);
        t.weeks.push(row);
      }
      // Team over/under. Best ball keeps each week's top scorers after the fact,
      // which beats any lineup picked in advance, so there it's measured against
      // the projections' best lineup plus the league's average lift that week.
      // Game-time calls are left out of both sides (they had no real projection).
      weekRows.forEach(([, r]) => { r.perfAct = r.startedAct - r.lockedAct; });
      if (bestBall) {
        const lifts = weekRows.map(([, r]) => r.perfAct - r.byProjProj);
        const avgLift = lifts.reduce((a, b) => a + b, 0) / (lifts.length || 1);
        weekRows.forEach(([, r]) => { r.perfProj = r.byProjProj + avgLift; });
      } else {
        weekRows.forEach(([, r]) => { r.perfProj = r.startedProj; });
      }
      weekRows.forEach(([t, r]) => { t.perf.actual += r.perfAct; t.perf.projected += r.perfProj; });
    }

    // Per team: totals, a week's worth, the players behind each, tags, and a verdict.
    const nW = weeks.length;
    teams.forEach(t => {
      t.luck = t.actWins - t.expWins;
      t.luckSd = Math.sqrt(t.variance);
      t.record = { w: t.h2h.w + t.med.w, l: t.h2h.l + t.med.l, t: t.h2h.t + t.med.t };
      t.injury = {
        perWeek: t.inj.cost / nW, total: t.inj.cost, byePerWeek: t.inj.bye / nW,
        pct: t.inj.healthy ? t.inj.cost / t.inj.healthy * 100 : 0,
        players: [...t.inj.players.values()].filter(p => p.cost > 0.05).sort((a, b) => b.cost - a.cost),
        gamesMissed: [...t.inj.players.values()].reduce((a, p) => a + p.startsMissed, 0)
      };
      t.lineupReport = bestBall ? null : {
        leak: (t.lineup.byProj - t.lineup.started), perWeek: (t.lineup.byProj - t.lineup.started) / nW,
        pct: t.lineup.started ? (t.lineup.byProj - t.lineup.started) / t.lineup.started * 100 : 0,
        gapPerWeek: t.lineup.gap / nW, hindsightPerWeek: t.lineup.hindsight / nW, weeksOff: t.lineup.weeksOff,
        calls: t.lineup.calls, scratches: t.lineup.scratches, gameTime: t.lineup.gameTime
      };
      const pl = [...t.perf.players.values()];
      t.performance = {
        actual: t.perf.actual, projected: t.perf.projected, perWeek: (t.perf.actual - t.perf.projected) / nW,
        pct: t.perf.projected ? (t.perf.actual / t.perf.projected - 1) * 100 : 0,
        over: pl.filter(p => p.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, SR.PLAYERS_SHOWN),
        under: pl.filter(p => p.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, SR.PLAYERS_SHOWN)
      };
      t.pfPerWeek = t.pf / nW;
      t.paPerWeek = t.games ? t.pa / (t.h2h.w + t.h2h.l + t.h2h.t || 1) : 0;
      delete t.inj; delete t.lineup; delete t.perf; delete t.taxi; delete t.variance;
    });
    // Ranks across the league (1 = luckiest, most injury-hit, most lineup points lost, most over projections, most points against).
    const rank = (key, get, desc = true) => {
      const vals = teams.filter(t => get(t) != null).sort((a, b) => (desc ? get(b) - get(a) : get(a) - get(b)));
      vals.forEach((t, i) => { (t.ranks = t.ranks || {})[key] = i + 1; });
    };
    rank('luck', t => t.luck);
    rank('injury', t => t.injury.perWeek);
    if (!bestBall) rank('lineup', t => t.lineupReport.perWeek);
    const avgPct = teams.reduce((a, t) => a + t.performance.pct, 0) / (teams.length || 1);
    teams.forEach(t => { t.performance.leaguePct = avgPct; t.performance.vsLeague = t.performance.pct - avgPct; });
    rank('perf', t => t.performance.vsLeague);
    rank('pa', t => t.pa);
    rank('pf', t => t.pf);
    rank('allPlay', t => t.allPlay.w + t.allPlay.t / 2);
    teams.forEach(t => { t.tags = tagsOf(t); t.verdict = verdictOf(t, { median }); });

    return {
      league, season, weeks, teams, fromPrevious, bestBall, median, slots,
      leagueAvgPf: teams.reduce((a, t) => a + t.pfPerWeek, 0) / (teams.length || 1),
      config: SR
    };
  }

  /* ---------- Tags and the one-line verdict ---------- */
  const injuryHit = t => t.injury.pct >= SR.INJURY_TAG_PCT;
  const lineupLeaks = t => !!t.lineupReport && t.lineupReport.pct >= SR.LINEUP_TAG_PCT && t.lineupReport.gapPerWeek >= SR.LINEUP_TAG_GAP;
  function tagsOf(t) {
    const tags = [];
    const luckBar = Math.max(SR.LUCK_MIN_WINS, t.luckSd);
    if (t.luck >= luckBar) tags.push('Lucky');
    if (t.luck <= -luckBar) tags.push('Unlucky');
    if (injuryHit(t)) tags.push('Injury-hit');
    if (lineupLeaks(t)) tags.push('Lineup leaks');
    if (t.performance.vsLeague >= SR.PERF_TAG_PCT) tags.push('Overperforming');
    if (t.performance.vsLeague <= -SR.PERF_TAG_PCT) tags.push('Underperforming');
    return tags;
  }
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const pctWord = v => (Math.abs(v) < 0.5 ? 'right on' : `${Math.round(Math.abs(v))}% ${v > 0 ? 'over' : 'under'}`);
  const recText = r => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;
  function verdictOf(t, { median }) {
    const rec = recText(t.record);
    const exp = Math.round(t.expWins * 2) / 2;
    const expLosses = Math.max(0, t.games - exp);
    const fmtW = v => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    const should = `${fmtW(exp)}-${fmtW(expLosses)}`;
    const luckBar = Math.max(SR.LUCK_MIN_WINS, t.luckSd);
    let head;
    if (t.luck >= luckBar) head = `${rec}, but its scores earn about ${should}: the schedule has been kind.`;
    else if (t.luck <= -luckBar) head = `${rec}, but its scores earn about ${should}: the schedule has been cruel.`;
    else if (Math.abs(t.luck) >= 0.75) head = `${rec}, a little ${t.luck > 0 ? 'better' : 'worse'} than its scores earn (${should}).`;
    else head = `${rec}, about what its scores earn (${should}).`;
    // The biggest thing beyond luck, if any crosses its tag line.
    const parts = [];
    if (injuryHit(t)) parts.push([t.injury.pct / SR.INJURY_TAG_PCT, `Injuries cost its best lineup ${f1(t.injury.perWeek)} pts a week.`]);
    if (lineupLeaks(t)) parts.push([t.lineupReport.pct / SR.LINEUP_TAG_PCT, `Lineup calls cost ${f1(t.lineupReport.perWeek)} pts a week against the projections' pick.`]);
    const perf = t.performance;
    if (Math.abs(perf.vsLeague) >= SR.PERF_TAG_PCT) parts.push([Math.abs(perf.vsLeague) / SR.PERF_TAG_PCT, `Its starters score ${pctWord(perf.pct)} projections (league ${pctWord(perf.leaguePct)}).`]);
    parts.sort((a, b) => b[0] - a[0]);
    return parts.length ? `${head} ${parts[0][1]}` : head;
  }

  /* ---------- The section on the Teams page ----------
     Vault.renderSeasonReport(mount, report, rosterId, { myId, onPickTeam }):
     the team's verdict and tags, the four parts, and a compact league table
     (a row click calls onPickTeam with that team's roster id). */
  const esc = s => Vault.escapeHtml(s == null ? '' : String(s));
  const fmtPts = v => (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const winsText = v => { const a = Math.abs(v); return `${a < 0.05 ? '0' : f1(a)} win${Math.abs(a - 1) < 0.05 ? '' : 's'}`; };
  const TAG_STYLE = {
    'Lucky': 'border-emerald-400/30 text-emerald-300',
    'Overperforming': 'border-emerald-400/30 text-emerald-300',
    'Unlucky': 'border-orange-400/30 text-orange-300',
    'Injury-hit': 'border-orange-400/30 text-orange-300',
    'Lineup leaks': 'border-orange-400/30 text-orange-300',
    'Underperforming': 'border-orange-400/30 text-orange-300'
  };
  const tagPill = t => `<span class="inline-block px-2 py-0.5 rounded-md border text-[12px] ${TAG_STYLE[t] || 'border-white/15 text-zinc-300'}">${esc(t)}</span>`;
  const part = (title, rank, big, bigTone, sub, body) => `<div class="bg-black/40 rounded-2xl p-4 border border-white/10 min-w-0">
      <div class="flex items-baseline justify-between gap-3"><div class="text-[11px] uppercase tracking-widest text-zinc-400">${title}</div>${rank ? `<div class="text-[12px] text-zinc-500">${rank}</div>` : ''}</div>
      <div class="num text-[28px] mt-1.5 ${bigTone}">${big}</div>
      <div class="text-[13px] text-zinc-400 mt-1">${sub}</div>
      ${body ? `<div class="mt-3">${body}</div>` : ''}
    </div>`;
  const statRow = (label, value) => `<div class="flex items-baseline justify-between gap-3 py-1.5 border-t border-white/5 text-[13px]"><span class="text-zinc-400">${label}</span><span class="text-zinc-100 mono text-right">${value}</span></div>`;
  const playerRow = (p, value, tone) => `<div class="flex items-baseline justify-between gap-3 py-1.5 border-t border-white/5 text-[13px]"><span class="min-w-0 truncate"><span class="text-zinc-100">${esc(p.name)}</span> <span class="text-[12px] text-zinc-500">${esc(p.pos)}</span></span><span class="mono shrink-0 ${tone}">${value}</span></div>`;
  const listTitle = t => `<div class="text-[12px] text-zinc-500 mt-3 mb-0.5">${t}</div>`;
  const HOW = `<details class="mt-4 text-[12px] text-zinc-400 leading-relaxed">
      <summary class="cursor-pointer text-zinc-300 hover:text-white">How it's measured</summary>
      <ul class="mt-2 space-y-1.5 list-disc pl-5 max-w-[860px]">
        <li><span class="text-zinc-300">Luck:</span> each week's score against every other team's that week (all-play) gives the wins a team's scores earn. Luck is its real wins minus those. In median leagues the weekly median game counts on both sides.</li>
        <li><span class="text-zinc-300">Projections</span> are Sleeper's final pre-game ones, re-scored to this league's scoring (custom scoring, TE premium, K, DEF and IDP included). A player ruled out before kickoff projects 0.</li>
        <li><span class="text-zinc-300">Injuries:</span> each week, the best lineup on players' typical projections (their average in the weeks they were projected to play), with everyone off bye against only those who were available. Players out are those projected 0 whose team played without them. Byes are counted apart.</li>
        <li><span class="text-zinc-300">Lineup calls:</span> the real points of the lineup started against the real points of the lineup the projections picked. Close calls (1.5 projected points or less, about a coin flip) count as the manager's pick. Late scratches (projected to play, ruled out on game day) and game-time calls (listed out before kickoff but played) aren't counted as mistakes.</li>
        <li><span class="text-zinc-300">Over/under:</span> what the starters scored against their projections. Sleeper underrates some positions (IDP most), so a team is over- or underperforming only against the league's average.</li>
        <li>Players on the taxi squad now are left out of every lineup.</li>
      </ul>
    </details>`;
  let tableSort = { key: 'luck', desc: true };

  function renderSeasonReport(mount, R, rosterId, { myId = null, onPickTeam } = {}) {
    if (!mount) return;
    const head = sub => `<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3"><h3 class="display text-[22px] text-zinc-100">This season</h3><div class="text-[12px] text-zinc-400">${sub}</div></div>`;
    if (!R) { mount.innerHTML = head('Loading Sleeper\'s weekly scores and projections…'); return; }
    if (R.error) { mount.innerHTML = head('') + `<div class="text-[13px] text-zinc-400">Couldn't load this season: ${esc(R.error)}</div>`; return; }
    if (R.empty) { mount.innerHTML = head('') + `<div class="text-[13px] text-zinc-400">The ${esc(R.season)} season hasn't played a week yet. This report starts after week 1.</div>`; return; }
    const t = R.teams.find(x => x.rosterId === rosterId);
    if (!t) { mount.innerHTML = ''; return; }
    const n = R.teams.length, C = R.config;
    const nameOf = id => (R.teams.find(x => x.rosterId === id) || {}).name || '';
    const avg = get => R.teams.reduce((a, x) => a + get(x), 0) / n;
    const w0 = R.weeks[0], w1 = R.weeks[R.weeks.length - 1];
    const sub = `${R.fromPrevious ? `${esc(R.season)} season · ` : ''}${w0 === w1 ? `week ${w0}` : `weeks ${w0}-${w1}`}${R.median ? ' · median games counted' : ''}${R.bestBall ? ' · best ball' : ''}`;

    // Luck.
    const luckBar = Math.max(C.LUCK_MIN_WINS, t.luckSd);
    const luckTone = t.luck >= luckBar ? 'text-emerald-300' : t.luck <= -luckBar ? 'text-orange-300' : 'text-zinc-100';
    const weekRows = t.weeks.map(w => `<tr class="border-t border-white/5">
        <td class="py-1.5 pr-2 text-zinc-500 mono">${w.week}</td>
        <td class="py-1.5 pr-2 mono text-right">${fmtPts(w.pts)}</td>
        <td class="py-1.5 pr-2 max-w-[140px] truncate text-zinc-400">${w.opp != null ? esc(nameOf(w.opp)) : '—'}</td>
        <td class="py-1.5 pr-2 mono text-right text-zinc-400">${w.oppPts != null ? fmtPts(w.oppPts) : ''}</td>
        <td class="py-1.5 pr-2 font-medium ${w.result === 'W' ? 'text-emerald-300' : w.result === 'L' ? 'text-orange-300' : 'text-zinc-300'}">${w.result || ''}${R.median ? `<span class="text-zinc-500 font-normal"> · ${w.medResult}</span>` : ''}</td>
        <td class="py-1.5 mono text-right text-zinc-300">${Math.round(w.allPlayPct * (n - 1))} of ${n - 1}</td>
      </tr>`).join('');
    const luck = part('Luck', `${ord(t.ranks.luck)} luckiest of ${n}`, Math.abs(t.luck) < 0.05 ? 'Even' : `${winsText(t.luck)} ${t.luck > 0 ? 'ahead' : 'behind'}`, luckTone,
      Math.abs(t.luck) < 0.05 ? 'Exactly the wins its scores earn.' : `${t.luck > 0 ? 'More' : 'Fewer'} wins than its scores earn: ${recText(t.record)} against about ${f1(t.expWins)} wins.`,
      statRow('All-play record (every team, every week)', `${recText(t.allPlay)} · ${ord(t.ranks.allPlay)}`) +
      (R.median ? statRow('Head to head · median games', `${recText(t.h2h)} · ${recText(t.med)}`) : '') +
      statRow('Points against', `${fmtPts(t.pa)} · ${ord(t.ranks.pa)} most`) +
      statRow('Points for', `${fmtPts(t.pf)} · ${ord(t.ranks.pf)} most`) +
      statRow(`Close games (${C.CLOSE_GAME} pts or less)`, t.close.w + t.close.l + t.close.t ? recText(t.close) : 'none') +
      `<div class="overflow-x-auto mt-3"><table class="w-full text-[13px]"><thead><tr class="text-[11px] uppercase tracking-wider text-zinc-500"><th class="text-left font-normal pb-1 pr-2">Wk</th><th class="text-right font-normal pb-1 pr-2">Score</th><th class="text-left font-normal pb-1 pr-2">Opponent</th><th class="text-right font-normal pb-1 pr-2">Opp</th><th class="text-left font-normal pb-1 pr-2">${R.median ? 'Result · Med' : 'Result'}</th><th class="text-right font-normal pb-1">Beat</th></tr></thead><tbody>${weekRows}</tbody></table></div>`);

    // Injuries.
    const inj = t.injury;
    const injuries = part('Injuries', `${ord(t.ranks.injury)} most hit of ${n}`, `${f1(inj.perWeek)} pts a week`, inj.pct >= C.INJURY_TAG_PCT ? 'text-orange-300' : 'text-zinc-100',
      `Lost from its best lineup to players out: ${f1(inj.pct)}% of it. League average ${f1(avg(x => x.injury.perWeek))}. Byes cost another ${f1(inj.byePerWeek)} a week.`,
      inj.players.length ? listTitle('Who it missed most (points its best lineup lost without him)') + inj.players.slice(0, 6).map(p => playerRow(p, `${fmtPts(p.cost)} pts · ${p.startsMissed} start${p.startsMissed === 1 ? '' : 's'} missed`, 'text-orange-200')).join('') : '<div class="text-[13px] text-zinc-400">No injury has cost it a starter this season.</div>');

    // Lineup calls.
    let lineup;
    if (!t.lineupReport) {
      lineup = part('Lineup calls', '', 'Best ball', 'text-zinc-100', "Sleeper sets best ball lineups automatically (each week's top scorers start), so there are no lineup calls to grade.", '');
    } else {
      const L = t.lineupReport;
      const leaks = t.tags.includes('Lineup leaks');
      const callList = L.calls.map(c => `<div class="flex items-baseline justify-between gap-3 py-1.5 border-t border-white/5 text-[13px]"><span class="min-w-0 truncate"><span class="text-zinc-500 mono">Wk ${c.week}</span> <span class="text-zinc-100">${c.name ? esc(c.name) : 'Empty spot'}</span> ${c.pos ? `<span class="text-[12px] text-zinc-500">${esc(c.pos)}</span>` : ''}</span><span class="shrink-0 text-orange-200">${c.why === 'bye' ? 'on bye' : c.why === 'out' ? 'out' : 'nobody started'}</span></div>`).join('');
      const notCounted = [
        L.scratches.length ? `${L.scratches.length} late scratch${L.scratches.length === 1 ? '' : 'es'} (projected to play, ruled out on game day)` : '',
        L.gameTime.length ? `${L.gameTime.length} game-time call${L.gameTime.length === 1 ? '' : 's'} (listed out before kickoff, played)` : ''
      ].filter(Boolean);
      lineup = part('Lineup calls', `${ord(n + 1 - t.ranks.lineup)} best of ${n}`, Math.abs(L.perWeek) < 0.05 ? 'Even' : `${f1(Math.abs(L.perWeek))} pts a week ${L.perWeek > 0 ? 'behind' : 'ahead'}`,
        leaks ? 'text-orange-300' : L.perWeek < -0.05 ? 'text-emerald-300' : 'text-zinc-100',
        `Real points of the lineups started against the lineups Sleeper's projections picked. ${L.gapPerWeek > 0.05 ? `Before the games, the projections had theirs ${f1(L.gapPerWeek)} pts a week better.` : 'The projections agreed with its lineups.'}`,
        statRow('Weeks the projections picked a different lineup', `${L.weeksOff} of ${R.weeks.length}`) +
        statRow('With perfect hindsight, left on the bench', `${f1(L.hindsightPerWeek)} a week · league ${f1(avg(x => x.lineupReport.hindsightPerWeek))}`) +
        (L.calls.length ? listTitle('Started while out or on bye') + callList : '') +
        (notCounted.length ? `<div class="text-[12px] text-zinc-500 mt-3">Not counted as mistakes: ${notCounted.join('; ')}.</div>` : ''));
    }

    // Over/under.
    const P = t.performance;
    const pctText = v => (Math.abs(v) < 0.5 ? 'On projections' : `${Math.round(Math.abs(v))}% ${v > 0 ? 'over' : 'under'}`);
    const perfList = (list, over) => list.map(p => playerRow(p, `${fmtPts(Math.abs(p.diff))} pts ${over ? 'over' : 'under'} · ${p.weeks} wk${p.weeks === 1 ? '' : 's'}`, over ? 'text-emerald-300' : 'text-orange-200')).join('');
    const perf = part('Over/under', `${ord(t.ranks.perf)} most over of ${n}`, pctText(P.pct),
      P.vsLeague >= C.PERF_TAG_PCT ? 'text-emerald-300' : P.vsLeague <= -C.PERF_TAG_PCT ? 'text-orange-300' : 'text-zinc-100',
      `${R.bestBall ? 'Best ball scores' : 'Its starters scored'} ${fmtPts(P.actual)} against ${fmtPts(P.projected)} projected. League average: ${pctText(P.leaguePct).toLowerCase()}.${R.bestBall ? " Measured against the projections' best lineup plus the lift every team gets from Sleeper keeping its top scorers." : ''}`,
      (P.over.length ? listTitle(`Beat projections most${R.bestBall ? '' : ' (weeks started)'}`) + perfList(P.over, true) : '') +
      (P.under.length ? listTitle(`Fell short most${R.bestBall ? '' : ' (weeks started)'}`) + perfList(P.under, false) : ''));

    mount.innerHTML = `${head(sub)}
      ${R.fromPrevious ? `<div class="text-[13px] text-zinc-400 mb-3">The ${esc(R.fromPrevious.season)} season hasn't played a week yet, so this is the ${esc(R.season)} season. This season's report starts after week 1.</div>` : ''}
      <p class="text-[15px] text-zinc-200 leading-snug">${esc(t.verdict)}</p>
      ${t.tags.length ? `<div class="flex flex-wrap gap-1.5 mt-2.5">${t.tags.map(tagPill).join('')}</div>` : ''}
      <div class="grid md:grid-cols-2 gap-4 mt-4">${luck}${injuries}${lineup}${perf}</div>
      <div id="srTable" class="mt-6"></div>
      ${HOW}`;
    renderTable(mount.querySelector('#srTable'), R, rosterId, { myId, onPickTeam });
  }

  // The league on each measure: compact, sortable, a row opens that team.
  const COLS = [
    { key: 'name', label: 'Team', get: t => t.name, text: true },
    { key: 'record', label: 'Record', get: t => t.record.w + t.record.t / 2 },
    { key: 'allPlay', label: 'All-play', get: t => t.allPlay.w + t.allPlay.t / 2 },
    { key: 'luck', label: 'Luck', title: 'Wins more (or fewer) than its scores earn', get: t => t.luck },
    { key: 'injury', label: 'Injury cost', title: 'Points a week lost from its best lineup to players out', get: t => t.injury.perWeek },
    { key: 'lineup', label: 'Lineup lost', title: 'Points a week behind the lineup the projections picked', get: t => (t.lineupReport ? t.lineupReport.perWeek : 0), bestBallHide: true },
    { key: 'perf', label: 'Vs proj.', title: 'Scored over or under projections', get: t => t.performance.pct }
  ];
  function renderTable(box, R, shown, opts) {
    if (!box) return;
    const cols = COLS.filter(c => !(c.bestBallHide && R.bestBall));
    const col = cols.find(c => c.key === tableSort.key) || cols[3];
    const rows = [...R.teams].sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      const d = col.text ? String(va).localeCompare(String(vb)) : va - vb;
      return tableSort.desc ? -d : d;
    });
    const sgn = (v, d = 1) => (Math.abs(v) < 0.5 * 10 ** -d ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`);
    const tone = (t, good, bad) => (t.tags.includes(good) ? 'text-emerald-300' : t.tags.includes(bad) ? 'text-orange-300' : '');
    const cell = (t, c) => {
      switch (c.key) {
        case 'name': return `<span class="text-zinc-100">${esc(t.name)}</span>${t.rosterId === opts.myId ? ' <span class="text-[11px] px-1 py-0.5 rounded bg-amber-400/15 text-amber-200">You</span>' : ''}`;
        case 'record': return recText(t.record);
        case 'allPlay': return recText(t.allPlay);
        case 'luck': return `<span class="${tone(t, 'Lucky', 'Unlucky')}">${sgn(t.luck)}</span>`;
        case 'injury': return `<span class="${tone(t, '', 'Injury-hit')}">${f1(t.injury.perWeek)}</span>`;
        case 'lineup': return `<span class="${tone(t, '', 'Lineup leaks')}">${sgn(t.lineupReport.perWeek)}</span>`;
        case 'perf': return `<span class="${tone(t, 'Overperforming', 'Underperforming')}">${sgn(t.performance.pct, 0)}%</span>`;
      }
      return '';
    };
    box.innerHTML = `
      <div class="text-[11px] uppercase tracking-widest text-zinc-400 mb-1">The league</div>
      <div class="text-[12px] text-zinc-500 mb-2">Luck in wins; injury cost and lineup in points a week. Tap a team to open it.</div>
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] whitespace-nowrap">
          <thead><tr class="text-[11px] uppercase tracking-wider text-zinc-500">${cols.map(c => `<th class="sortable font-normal pb-2 pr-3 cursor-pointer select-none hover:text-zinc-300 ${c.text ? 'text-left' : 'text-right'}" data-key="${c.key}" ${c.title ? `title="${esc(c.title)}"` : ''} aria-sort="${c.key === col.key ? (tableSort.desc ? 'descending' : 'ascending') : 'none'}">${c.label}${c.key === col.key ? (tableSort.desc ? ' ↓' : ' ↑') : ''}</th>`).join('')}<th class="font-normal pb-2 text-left">Tags</th></tr></thead>
          <tbody>${rows.map(t => `<tr class="team-row border-t border-white/5 cursor-pointer hover:bg-white/[0.03] ${t.rosterId === shown ? 'bg-white/[0.05]' : ''}" data-id="${t.rosterId}">
            ${cols.map(c => `<td class="py-2 pr-3 ${c.text ? 'text-left max-w-[200px] truncate' : 'text-right mono'}">${cell(t, c)}</td>`).join('')}
            <td class="py-2 text-left text-[12px] text-zinc-400">${t.tags.join(', ')}</td></tr>`).join('')}</tbody>
        </table>
      </div>`;
    box.querySelectorAll('th.sortable').forEach(th => { th.onclick = () => { const k = th.dataset.key; tableSort = tableSort.key === k ? { key: k, desc: !tableSort.desc } : { key: k, desc: k !== 'name' }; renderTable(box, R, shown, opts); }; });
    box.querySelectorAll('tr.team-row').forEach(tr => { tr.onclick = () => opts.onPickTeam && opts.onPickTeam(+tr.dataset.id); });
  }

  Object.assign(Vault, {
    seasonReport,
    renderSeasonReport,
    // A projection's points in a league's scoring: Vault.scoreStats after
    // filling in the stats Sleeper's projections leave out (projectionStats).
    scoreProjection(stats, scoringSettings, pos) { return Vault.scoreStats(projectionStats(stats || {}, pos), scoringSettings); },
    SEASON_REPORT: SR
  });
})();
