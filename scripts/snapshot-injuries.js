/* Daily injury statuses, kept so a "react to news" adjustment for Vault values can be
   tested one day (2026-10-19). KTC moves the day news hits; values learned from trades
   wait until people trade. To check whether nudging a value when a player's status
   changes would have helped, we need to know when statuses changed, and Sleeper's
   player list only says what they are now.

   Appends one line per day to data/history/injuries-<season>.jsonl:
     { "date": "2026-10-19", "s": { "<sleeper id>": "Out", ... } }
   QB / RB / WR / TE with any status (Questionable, Doubtful, Out, IR, PUP, Sus, ...).
   Reads the trimmed player list build-slim-data.js writes (run after it). A day
   already recorded is replaced, so re-runs are safe. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const players = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sleeper-players.json'), 'utf8'));
const list = players.players || players;
const date = new Date().toISOString().slice(0, 10);
const now = new Date(), season = now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const s = {};
for (const [id, p] of Object.entries(list)) {
  if (!p || !p.injury_status || !['QB', 'RB', 'WR', 'TE'].includes(p.position)) continue;
  s[id] = p.injury_status;
}
const file = path.join(ROOT, 'data', 'history', `injuries-${season}.jsonl`);
fs.mkdirSync(path.dirname(file), { recursive: true });
const kept = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l && !l.startsWith(`{"date":"${date}"`)) : [];
kept.push(JSON.stringify({ date, s }));
fs.writeFileSync(file, kept.join('\n') + '\n');
console.log(`injuries: ${Object.keys(s).length} players with a status on ${date} -> ${path.relative(ROOT, file)}`);
