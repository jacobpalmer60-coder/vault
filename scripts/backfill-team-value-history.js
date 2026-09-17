// Backfills real team-value history for League Overview's trend chart by
// replaying this league's actual roster-building history — the startup draft,
// the rookie draft, and every real trade/waiver/free-agent move since — rather
// than only having the ~12 days our own daily snapshot has tracked on its own.
//
// This league has no prior season (previous_league_id is 0 — confirmed live),
// so "day zero" is simply whenever its real startup draft happened this year,
// not some arbitrary lookback window. Two of its five Sleeper draft objects
// have zero actual picks (abandoned/restarted attempts) and are ignored; the
// real ones are the 300-pick startup draft and the 40-pick rookie draft.
//
// For each day from the startup draft through today, replays every
// roster-changing event (draft picks, trade/waiver/free-agent/commissioner
// adds+drops — all share the same {adds, drops} shape) up to that day, then
// prices whoever's on each roster using the real per-player value history
// backfill-player-value-history.js already produced.
//
// Writes to a `playerValue` field, NOT `total` — the existing daily snapshot's
// `total` is actually playerValue + picksValue combined (confirmed by reading
// snapshot-value-history.js itself, not assumed: `t.total = t.playerValue +
// t.picksValue`). Backfilling picks needs historical pick-ownership tracking
// (traded_picks only reflects current ownership) plus KTC's pick-tier grid
// rolling forward over time — a separate, larger piece of work. Writing a
// player-only number into `total` produced a ~20K same-roster jump at the
// boundary between backfilled and real days on first attempt (confirmed by
// diffing per-player values directly) — this field name keeps the two honest
// instead of quietly gluing an apples number to an apples-plus-oranges series.
// app.html's chart already treats a missing field as a real gap, not a crash,
// so `total`/`picksValue` are simply left unset on backfilled days (picks are
// handled separately by backfill-picks-value-history.js).
//
// optPpg IS backfilled, with one disclosed simplification: each player's PPG
// is held at TODAY's real season-long projection rather than whatever was
// actually projected on that historical day — Sleeper has no archive of past
// projection snapshots the way it archives real completed-week stats, so
// there's nothing truer to fall back to. This means optPpg's movement here
// reflects real roster changes (trades/waivers/draft) against a fixed
// production baseline, not projection drift over the season — the same
// "today's numbers applied to a past state" tradeoff Trade Grades already
// makes for KTC prices, disclosed the same way.
//
// Validates itself: the roster reconstructed for TODAY must exactly match
// Sleeper's real current rosters, or this refuses to write anything — a
// silent replay bug would otherwise produce a plausible-looking but wrong
// chart with no way to notice.
//
// Run manually, after backfill-player-value-history.js:
//   node scripts/backfill-team-value-history.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LEAGUE_ID = '1313454100225990656';
const TEAM_HISTORY_PATH = path.join(DATA_DIR, 'team-value-history.json');
const PLAYER_HISTORY_PATH = path.join(DATA_DIR, 'player-value-history.json');

function normalizeName(s) {
  if (!s) return '';
  return s.toString().toLowerCase()
    .replace(/\./g, '')
    .replace(/'/g, '')
    .replace(/ jr$| sr$| ii$| iii$| iv$| v$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log('Fetching league, rosters, players, transactions, drafts...');
  const [league, rosters, sleeperPlayers, drafts] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`).then(r => r.json()),
    fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/drafts`).then(r => r.json())
  ]);
  const weeks = await Promise.all(
    [...Array(18)].map((_, i) => fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/transactions/${i + 1}`).then(r => r.json()).catch(() => []))
  );
  const transactions = weeks.flat().filter(t => t && t.status === 'complete');

  // Real drafts only — the other three "complete" draft objects on this league
  // have zero actual picks (abandoned/restarted attempts).
  const realDrafts = [];
  for (const d of drafts) {
    const picks = await fetch(`https://api.sleeper.app/v1/draft/${d.draft_id}/picks`).then(r => r.json());
    if (picks.length > 0) realDrafts.push({ draft: d, picks });
  }
  if (!realDrafts.length) throw new Error('No draft with real picks found.');
  console.log(`Found ${realDrafts.length} real draft(s):`, realDrafts.map(r => `${r.picks.length} picks on ${dateStr(new Date(r.draft.start_time))}`));

  const nameOf = pid => {
    const p = sleeperPlayers[String(pid)];
    return p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : null;
  };
  // Normalized at the source — player-value-history.json is keyed by
  // normalized name (KTC has no Sleeper IDs), so every downstream Set/lookup
  // needs to work in that same key space from the start.
  const normNameOf = pid => { const n = nameOf(pid); return n ? normalizeName(n) : null; };

  // One flat chronological list of {date, adds: [names], drops: [names]} events
  // — draft picks and every transaction type share the same add/drop shape.
  // Carries the raw Sleeper pid alongside the normalized name: value lookups
  // join on name (KTC has no Sleeper IDs), but PPG/position for optPpg join on
  // pid, so both need tracking off the exact same events.
  const events = [];
  realDrafts.forEach(({ draft, picks }) => {
    const date = new Date(draft.start_time);
    picks.forEach(pk => {
      const name = normNameOf(pk.player_id);
      if (name) events.push({ date, rosterId: pk.roster_id, add: name, pid: String(pk.player_id) });
    });
  });
  transactions.forEach(t => {
    const date = new Date(t.created);
    Object.entries(t.adds || {}).forEach(([pid, rosterId]) => {
      const name = normNameOf(pid);
      if (name) events.push({ date, rosterId, add: name, pid: String(pid) });
    });
    Object.entries(t.drops || {}).forEach(([pid, rosterId]) => {
      const name = normNameOf(pid);
      if (name) events.push({ date, rosterId, drop: name, pid: String(pid) });
    });
  });
  events.sort((a, b) => a.date - b.date);

  const dayZero = realDrafts.reduce((min, r) => Math.min(min, +new Date(r.draft.start_time)), Infinity);
  const startDate = new Date(dayZero);
  const today = new Date();
  console.log(`Replaying from ${dateStr(startDate)} to ${dateStr(today)} (${events.length} roster-changing events)...`);

  // rosterId -> Set of normalized player names currently held (value lookups)
  // and, in parallel, -> Set of raw pids (PPG/position lookups for optPpg).
  const rosterOf = new Map(rosters.map(r => [r.roster_id, new Set()]));
  const rosterOfPid = new Map(rosters.map(r => [r.roster_id, new Set()]));

  // optPpg inputs — today's live projections applied to the real historical
  // roster (see module comment for why this is the honest tradeoff here).
  const projData = await readJson(path.join(DATA_DIR, 'projections.json'));
  function scoreStats(stats, scoringSettings) {
    let total = 0;
    for (const [k, w] of Object.entries(scoringSettings || {})) total += (stats[k] || 0) * w;
    return total;
  }
  const ppgByPid = new Map();
  Object.entries(projData.players || {}).forEach(([pid, p]) => {
    if (p.stats?.gp) ppgByPid.set(pid, scoreStats(p.stats, league.scoring_settings) / p.stats.gp);
  });
  const slots = (league.roster_positions || []).filter(s => !['BN', 'IR', 'TAXI'].includes(s));
  function optimalLineup(plist) {
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
  }

  const playerHistory = await readJson(PLAYER_HISTORY_PATH);
  const byDate = new Map(playerHistory.snapshots.map(s => [s.date, s.players]));
  const allValueDates = playerHistory.snapshots.map(s => s.date).sort();

  // A player's own value history can start a few days after they're actually
  // added to a roster (KTC's tracking lag) — fall back to the nearest date
  // within a month rather than silently contributing 0.
  function valueOn(name, date) {
    const exact = byDate.get(date)?.[name]?.value;
    if (Number.isFinite(exact)) return exact;
    let best = null, bestDiff = Infinity;
    for (const d of allValueDates) {
      const diff = Math.abs(new Date(d) - new Date(date));
      if (diff < bestDiff) { bestDiff = diff; best = d; }
    }
    const MAX_MS = 31 * 24 * 60 * 60 * 1000;
    if (best && bestDiff <= MAX_MS) return byDate.get(best)?.[name]?.value ?? 0;
    return 0;
  }

  // teamName comes from league users, not rosters directly.
  const users = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`).then(r => r.json());
  const userById = new Map(users.map(u => [u.user_id, u]));
  const teamNameOf = new Map(rosters.map(r => {
    const u = userById.get(r.owner_id) || {};
    return [r.roster_id, u.metadata?.team_name || u.display_name || `Team ${r.roster_id}`];
  }));

  // Strictly UTC day arithmetic throughout — Date's plain getDate/setDate/
  // setHours all operate in the machine's LOCAL timezone, which silently
  // shifted every day's cursor by this environment's UTC offset and dropped
  // the very last real event (a same-day re-add) off the end of the replay.
  // toISOString/getUTCFullYear etc. are the only date operations used below.
  const startDay = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const todayDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const DAY_MS = 24 * 60 * 60 * 1000;

  const backfillSnapshots = [];
  let eventIdx = 0;
  for (let dayStart = startDay; dayStart <= todayDay; dayStart += DAY_MS) {
    const cursor = new Date(dayStart + DAY_MS - 1); // last ms of this UTC day
    while (eventIdx < events.length && events[eventIdx].date <= cursor) {
      const e = events[eventIdx];
      const set = rosterOf.get(e.rosterId);
      if (set) {
        if (e.add) set.add(e.add);
        if (e.drop) set.delete(e.drop);
      }
      const pidSet = rosterOfPid.get(e.rosterId);
      if (pidSet) {
        if (e.add) pidSet.add(e.pid);
        if (e.drop) pidSet.delete(e.pid);
      }
      eventIdx++;
    }
    const date = dateStr(new Date(dayStart));
    const teams = [...rosterOf.entries()].map(([rosterId, names]) => {
      const plist = [...rosterOfPid.get(rosterId)].map(pid => {
        const p = sleeperPlayers[pid];
        if (!p) return null;
        return { id: pid, pos: p.position || '', ppg: ppgByPid.get(pid) || 0 };
      }).filter(Boolean);
      return {
        rosterId,
        teamName: teamNameOf.get(rosterId),
        playerValue: Math.round([...names].reduce((s, n) => s + valueOn(n, date), 0)),
        optPpg: +optimalLineup(plist).toFixed(1)
      };
    });
    backfillSnapshots.push({ date, teams });
  }

  // Self-check: the LAST reconstructed day must match Sleeper's real current
  // rosters exactly, or this whole replay can't be trusted.
  let mismatches = 0;
  rosters.forEach(r => {
    const real = new Set((r.players || []).map(normNameOf).filter(Boolean));
    const reconstructed = rosterOf.get(r.roster_id);
    const missing = [...real].filter(n => !reconstructed.has(n));
    const extra = [...reconstructed].filter(n => !real.has(n));
    if (missing.length || extra.length) {
      mismatches++;
      console.log(`MISMATCH roster ${r.roster_id} (${teamNameOf.get(r.roster_id)}): missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`);
    }
  });
  if (mismatches > 0) {
    throw new Error(`${mismatches} roster(s) don't match Sleeper's real current state — refusing to write a replay that can't be trusted. See mismatches above.`);
  }
  console.log('Self-check passed: reconstructed rosters exactly match Sleeper\'s real current rosters.');

  const existing = await readJson(TEAM_HISTORY_PATH);
  const existingByDate = new Map(existing.snapshots.map(s => [s.date, s]));
  const newSnapshots = backfillSnapshots.filter(s => !existingByDate.has(s.date));

  // A date already in the file (either an original real day, or one this
  // script itself backfilled on an earlier run) never gets a whole new entry
  // — but it can still be missing optPpg specifically, either because it's a
  // previously-backfilled day (this field didn't exist until now) or because
  // playerValue/total came from this script while optPpg is genuinely absent.
  // Patched in per-team, per-field, and only when actually missing, so a real
  // day's real optPpg (from the true daily snapshot) is never touched.
  backfillSnapshots.forEach(s => {
    const existingSnap = existingByDate.get(s.date);
    if (!existingSnap) return;
    s.teams.forEach(t => {
      const existingTeam = existingSnap.teams.find(x => x.rosterId === t.rosterId);
      if (existingTeam && existingTeam.optPpg == null) existingTeam.optPpg = t.optPpg;
    });
  });

  // The existing real days never wrote a bare playerValue (only the combined
  // total = playerValue + picksValue) — derive it so the Player Value metric
  // reads as one continuous series instead of a gap on the most recent days.
  existing.snapshots.forEach(s => {
    s.teams.forEach(t => {
      if (t.playerValue == null && t.total != null && t.picksValue != null) {
        t.playerValue = t.total - t.picksValue;
      }
    });
  });

  const merged = {
    ...existing,
    snapshots: [...newSnapshots, ...existing.snapshots].sort((a, b) => a.date < b.date ? -1 : 1)
  };
  await fs.writeFile(TEAM_HISTORY_PATH, JSON.stringify(merged));
  console.log(`Added ${newSnapshots.length} new backfilled team-value days (${existing.snapshots.length} existing days kept/patched).`);
  console.log(`New range: ${merged.snapshots[0]?.date} to ${merged.snapshots[merged.snapshots.length - 1]?.date}, ${merged.snapshots.length} total days.`);
}

main().catch(e => { console.error(e); process.exit(1); });
