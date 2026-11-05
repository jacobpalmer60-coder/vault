/* What each injury actually is, for the injury card and tags (user, 2026-11-04). Sleeper says
   "Knee" and "IR"; ESPN has the specific injury, the side and an expected return date. Love read
   "back week 10" from Sleeper's projections while ESPN had him on IR until December 6.

   Runs once a day and overwrites data/injury-details.json. No history is kept. Facts only: ESPN's
   written news is left out. ESPN's league-wide feed stops at 25 players a team and weighs 8.7 MB,
   so this reads each roster for who's hurt and then fetches only those players:
     { updated, players: { "<sleeper id>": { type, detail, side, back, week, season, date, last, games, min } } }
   week is the NFL week of back; season: true means not back this season. last and games come
   from data/weekly (the last week played and games played so far).
   min is the earliest week back from IR, which is rule rather than news: four missed games from
   the day of placement, and a bye isn't a game. ESPN's date is its last update (McLaurin's says
   Oct 30, on IR since Oct 20), so placement comes from our daily snapshots, which start 10/19.
   Anyone on IR since before then counts from the game after their last one played, at the
   latest 10/19's week, and if ESPN expects them sooner than that gives, ESPN wins: 18 players
   read a minimum later than ESPN's return when this used 10/19 alone. Those are estimates; the
   minimums have nearly all passed. IR players ESPN doesn't list still get a min.
   Reads data/sleeper-players.json and the snapshots, so it runs after snapshot-injuries.js. */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const POS = new Set(['QB', 'RB', 'WR', 'TE']);
const LAST_WEEK = 18;
const IR_GAMES = 4;
const ALIAS = { WSH: 'WAS' }; // ESPN's abbreviation where Sleeper's differs

const getJson = async url => {
  const res = await fetch(url.replace(/^http:/, 'https:'));
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};
// One at a time per slot, so ESPN sees a handful of calls at once rather than hundreds.
async function eachLimit(list, limit, run) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (i < list.length) await run(list[i++]); }));
}
// As Vault.normalizeName: both sites spell names a little differently.
const norm = s => String(s || '').toLowerCase().replace(/[.']/g, '').replace(/ jr$| sr$| ii$| iii$| iv$| v$/, '').trim();

// Week 1's Sunday is the Sunday after Labor Day (the first Monday of September).
function weekOf(date, season) {
  const sep1 = new Date(Date.UTC(season, 8, 1)), labor = 1 + ((8 - sep1.getUTCDay()) % 7);
  const first = Date.UTC(season, 8, labor + 6);
  return Math.round((Date.parse(date.slice(0, 10)) - first) / (7 * 864e5)) + 1;
}
// The week a date falls in, counted Tuesday to Monday: moved to IR on a Tuesday, the first game
// missed is that week's.
function weekOfDay(date, season) {
  const sep1 = new Date(Date.UTC(season, 8, 1)), labor = 1 + ((8 - sep1.getUTCDay()) % 7);
  const days = (Date.parse(date.slice(0, 10)) - Date.UTC(season, 8, labor + 6)) / 864e5;
  return Math.max(1, Math.floor((days + 5) / 7) + 1);
}
// The first game back after missing IR_GAMES from week `first`, skipping the bye.
function irMinimum(first, bye) {
  let week = first;
  for (let missed = 0; missed < IR_GAMES; week++) if (week !== bye) missed++;
  return week === bye ? week + 1 : week;
}
const known = v => (v && v !== 'Not Specified' ? v : undefined);

(async () => {
  const sleeper = JSON.parse(fs.readFileSync(path.join(DATA, 'sleeper-players.json'), 'utf8'));
  const hurt = new Map();
  for (const [id, p] of Object.entries(sleeper)) {
    if (p.injury_status && POS.has(p.position)) hurt.set(`${norm(`${p.first_name} ${p.last_name}`)}|${p.position}`, id);
  }

  const now = new Date(), season = now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const weekly = JSON.parse(fs.readFileSync(path.join(DATA, 'weekly', `${season}.json`), 'utf8'));
  const snaps = weekly.keys.indexOf('off_snp') + 3; // each row starts team, opponent, away
  const played = id => Object.entries(weekly.players[id]?.w || {}).filter(([, row]) => row[snaps] > 0).map(([w]) => +w);

  const snapshots = fs.readFileSync(path.join(DATA, 'history', `injuries-${season}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  // The first day of this stretch on IR, or null if it began before the first snapshot.
  const onIrSince = id => {
    let i = snapshots.length;
    while (i > 0 && snapshots[i - 1].s[id] === 'IR') i--;
    if (i === 0) return null;
    return i === snapshots.length ? now.toISOString().slice(0, 10) : snapshots[i].date;
  };
  const minWeek = (id, games, bye, expected) => {
    const since = onIrSince(id), latest = weekOfDay(snapshots[0].date, season);
    const first = since ? weekOfDay(since, season) : Math.min(latest, games.length ? Math.max(...games) + 1 : 1);
    const week = irMinimum(first, bye);
    const floor = !since && expected && expected < week ? expected : week;
    return floor <= LAST_WEEK ? floor : undefined;
  };

  const teams = (await getJson(`${SITE}/teams?limit=40`)).sports[0].leagues[0].teams.map(t => t.team);
  const wanted = []; // { sleeperId, ref, bye }
  const byes = {}; // by Sleeper's team abbreviation
  await eachLimit(teams, 4, async ({ id: team, abbreviation }) => {
    const [roster, list, schedule] = await Promise.all([getJson(`${SITE}/teams/${team}/roster`), getJson(`${CORE}/teams/${team}/injuries?limit=200`), getJson(`${SITE}/teams/${team}/schedule`)]);
    const bye = schedule.byeWeek;
    byes[ALIAS[abbreviation] || abbreviation] = bye;
    const newest = new Map(); // ESPN athlete id -> their newest injury
    for (const { $ref } of list.items || []) {
      const m = $ref.match(/athletes\/(\d+)\/injuries\/(\d+)/);
      if (m && !(+m[2] <= newest.get(m[1])?.n)) newest.set(m[1], { n: +m[2], ref: $ref });
    }
    for (const a of roster.athletes.flatMap(g => g.items || [])) {
      const sleeperId = hurt.get(`${norm(a.displayName)}|${a.position?.abbreviation}`);
      if (sleeperId && a.injuries?.length && newest.has(a.id)) wanted.push({ sleeperId, ref: newest.get(a.id).ref, bye });
    }
  });

  const players = {};
  let failed = 0;
  await eachLimit(wanted, 6, async ({ sleeperId, ref, bye }) => {
    try {
      const { details: d = {}, date } = await getJson(ref);
      const back = d.returnDate, week = back ? weekOf(back, season) : null, games = played(sleeperId);
      players[sleeperId] = {
        type: known(d.type), detail: known(d.detail), side: known(d.side), back: back && week <= LAST_WEEK ? back : undefined,
        week: week != null && week <= LAST_WEEK ? week : undefined, season: week > LAST_WEEK ? true : undefined,
        date: date?.slice(0, 10), last: games.length ? Math.max(...games) : undefined, games: games.length,
        min: sleeper[sleeperId].injury_status === 'IR' ? minWeek(sleeperId, games, bye, week) : undefined,
      };
    } catch { failed++; }
  });
  for (const id of hurt.values()) {
    const p = sleeper[id], games = played(id);
    if (players[id] || p.injury_status !== 'IR' || byes[p.team] == null) continue;
    players[id] = { min: minWeek(id, games, byes[p.team]), last: games.length ? Math.max(...games) : undefined, games: games.length };
  }

  const count = Object.keys(players).length;
  // A bad day at ESPN shouldn't wipe the cards: yesterday's file is better than none.
  if (count < 40) throw new Error(`Only ${count} injuries found (${failed} failed), keeping the last file`);
  fs.writeFileSync(path.join(DATA, 'injury-details.json'), JSON.stringify({ updated: now.toISOString(), players }));
  console.log(`injury-details.json: ${count} of ${hurt.size} hurt players (${failed} failed)`);
})().catch(e => { console.error(e.message); process.exit(1); });
