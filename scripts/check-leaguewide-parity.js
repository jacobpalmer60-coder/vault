#!/usr/bin/env node
/* League-wide parity checks: features labeled league-wide must include other managers.
   Run: node scripts/check-leaguewide-parity.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function extract(file, a, b) {
  const s = source(file), i = s.indexOf(a), j = s.indexOf(b, i + a.length);
  assert.ok(i >= 0 && j > i, 'Cannot find ' + a + ' in ' + file);
  return s.slice(i, j);
}
const escapeHtml = x => String(x).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const marker = vm.runInNewContext(
  extract('app.html', 'function renderLeagueTradeMarks(', 'function chartTradeTooltip(') + '\nrenderLeagueTradeMarks;',
  { Vault: { escapeHtml }, Map, Set }
);
const day = '2026-11-16';
const series = [
  { id: 1, name: 'Owner', color: 'gold', mine: true, points: [100] },
  { id: 2, name: 'Rival B', color: 'blue', mine: false, points: [200] },
  { id: 3, name: 'Rival C', color: 'red', mine: false, points: [300] }
];
const tx = [
  { date: day, rosters: [2, 3], moves: [
    { from: 2, to: 3, what: 'Player One' },
    { from: 3, to: 2, what: 'Player Two' }
  ] },
  { date: day, rosters: [2, 3], moves: [
    { from: 2, to: 3, what: '2027 1st' },
    { from: 3, to: 2, what: '2028 2nd' }
  ] }
];
const { tradeMarks, eventsByDate } = marker(tx, [1, 2, 3], series, [{ date: day }],
  () => 10, v => v, 1);
assert.ok(tradeMarks.includes('data-series="2"'));
assert.ok(tradeMarks.includes('data-series="3"'));
assert.ok(!tradeMarks.includes('data-series="1"'));
assert.equal((tradeMarks.match(/<circle /g) || []).length, 2, 'one marker per team/date');
assert.equal(eventsByDate.get(day).length, 2);
assert.equal(eventsByDate.get(day)[0].details.length, 2, 'same-day trades grouped');
console.log('PASS all participants have Value Over Time trade markers');

const groups = vm.runInNewContext(
  extract('trade_lab.html', 'function rookiePickLandingGroups(', 'let leaguePicksDrawn = false;') + '\nrookiePickLandingGroups;',
  { Map, Set }
);
const owners = [
  { teamName: 'Manager A', picks: [{ season: 2027, round: 1, tier: 'early' }] },
  { teamName: 'Manager B', picks: [{ season: 2027, round: 2, tier: 'late' }] },
  { teamName: 'Manager C', picks: [] }
];
const picks = groups(owners, { buys: { '1-early': [1, 100], '2-late': [1, 60] } });
assert.equal(picks.length, 3);
assert.deepEqual([...picks].map(p => p.picks.length).sort(), [0, 1, 1]);
console.log('PASS all league teams appear in pick comparison');

const viewer = { teamName: 'Manager A', assets: [{ key: 'p_1', name: 'Alan One', type: 'player', value: 200 }] };
const rivalB = { teamName: 'Manager B', assets: [
  { key: 'p_2', name: 'Beth Runner', type: 'player', value: 400 },
  { key: 'k_b1', season: 2027, round: 1, tier: 'early', type: 'pick', value: 700 },
  { key: 'k_b2', season: 2027, round: 1, tier: 'early', type: 'pick', value: 600 }
] };
const rivalC = { teamName: 'Manager C', assets: [{ key: 'p_3', name: 'Carl Receiver', type: 'player', value: 600 }] };
const teams = [viewer, rivalB, rivalC];
const parser = vm.runInNewContext(
  extract('trade.html', 'const pasteNorm =', 'function openPaste()') + '\nparsePastedTrade;',
  { teams, teamOf: side => side === 'A' ? viewer : rivalC,
    Vault: { normalizeName: s => String(s).toLowerCase() }, Map, Set }
);
const rivals = parser('Beth Runner for Carl Receiver');
assert.equal(rivals.sideA, rivalB);
assert.equal(rivals.partner, rivalC);
assert.equal(rivals.give.length, 1);
assert.equal(rivals.get.length, 1);
const own = parser('Alan One for Carl Receiver');
assert.equal(own.sideA, viewer);
assert.equal(own.partner, rivalC);
const ambiguous = parser('Beth Runner and 2027 1st for Carl Receiver');
assert.equal(ambiguous.give.length, 1, 'ambiguous pick must not be silently inserted');
assert.ok(ambiguous.missed.some(x => x.includes('multiple matching picks')));
assert.ok(parser('Alan One and Beth Runner for Carl Receiver').error, 'do not silently drop a third team');
console.log('PASS any pair of managers can be pasted; ambiguous picks stay unresolved');

const analyzer = source('team-analyzer.html');
assert.ok(analyzer.includes('Explore a trade between these teams'));
assert.ok(analyzer.includes('&a=') && analyzer.includes('&b='));
console.log('PASS trade links are available on other-team analysis pages');
console.log('All league-wide parity tests passed.');
