#!/usr/bin/env node
/* Exact lineup assignment, pinned trade parity, and two-side insights. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadVault } = require('./lib-market');
const Vault = loadVault();
const page = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');
const piece = (start, end) => {
  const i = page.indexOf(start), j = page.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, 'missing source ' + start);
  return page.slice(i, j);
};
const player = (id, pos, ppg, avail = '1'.repeat(18)) =>
  ({ id, name: id, pos, ppg, vorp: ppg / 2, avail });
function brute(players, slots) {
  const can = slots.map(s => Vault.slotAllows(s)), used = new Set();
  function solve(slot) {
    if (slot >= slots.length) return 0;
    let best = solve(slot + 1);
    for (let k = 0; k < players.length; k++) {
      if (used.has(k) || !can[slot].includes(players[k].pos)) continue;
      used.add(k);
      best = Math.max(best, players[k].ppg + solve(slot + 1));
      used.delete(k);
    }
    return best;
  }
  return solve(0);
}
const two = [player('rb', 'RB', 20), player('wr', 'WR', 19)];
const lineup = Vault.optimalLineupDetail(two, ['FLEX', 'RB']);
assert.equal(lineup.total, 39);
assert.equal(lineup.starters[0].id, 'wr');
assert.equal(lineup.starters[1].id, 'rb');
assert.equal(lineup.vorpTotal, 19.5);
assert.equal(Vault.seasonLineupDetail(two, ['FLEX', 'RB'], [11, 12]).total, 39);
assert.equal(Vault.optimalLineupDetail(two, ['RB', 'FLEX']).total, 39);
console.log('PASS flex-first slot order is optimized');
const mixed = [player('rb', 'RB', 22), player('wr', 'WR', 20), player('te', 'TE', 18)];
assert.equal(Vault.optimalLineupDetail(mixed, ['WRRB_FLEX', 'REC_FLEX', 'RB']).total, 60);
console.log('PASS nonnested flex slot assignment');
let seed = 31;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const positions = ['QB', 'RB', 'WR', 'TE'];
const slotKinds = [...positions, 'FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX'];
for (let t = 0; t < 350; t++) {
  const n = 2 + Math.floor(rnd() * 6), m = 1 + Math.floor(rnd() * 5);
  const roster = Array.from({ length: n }, (_, i) => player(String(i),
    positions[Math.floor(rnd() * positions.length)], 1 + Math.floor(rnd() * 24)));
  const slots = Array.from({ length: m }, () => slotKinds[Math.floor(rnd() * slotKinds.length)]);
  assert.ok(Math.abs(Vault.optimalLineup(roster, slots) - brute(roster, slots)) < 1e-6,
    'lineup optimization mismatch on trial ' + t);
}
console.log('PASS 350 deterministic trials against exhaustive assignment');
const weekOut = [
  player('rb', 'RB', 20, '1'.repeat(10) + '01' + '1'.repeat(6)),
  player('wr', 'WR', 19), player('rb2', 'RB', 11)
];
const projected = Vault.seasonLineupDetail(weekOut, ['FLEX', 'RB'], [11, 12]);
assert.equal(projected.byWeek.get(11), 30);
assert.equal(projected.byWeek.get(12), 39);
assert.equal(projected.total, 34.5);
console.log('PASS weekly availability and replacement lineups');
const curve = { RB: { 24: [1, 1, 1] }, WR: { 24: [1, 1, 1] } };
assert.equal(Vault.futureLineupValue([
  { type: 'player', pos: 'RB', age: 24, value: 2000 },
  { type: 'player', pos: 'WR', age: 24, value: 1900 }
], ['FLEX', 'RB'], 1, curve, 2026), 3900);
console.log('PASS future value uses correct position assignment');
const pinned = vm.runInNewContext(
  piece('function pinnedTradeKey(', 'function pinTrade()') + '\n({pinnedTradeKey, pinnedTradeOdds});',
  { remainingWeeks: [11], seasonBase: new Map([
    [1, { playoffPct: 30, championshipPct: 10 }],
    [2, { playoffPct: 60, championshipPct: 20 }]
  ]), tradeSeasonOdds: () => ({ next: new Map([
    [1, { playoffPct: 50, championshipPct: 15 }],
    [2, { playoffPct: 40, championshipPct: 16 }]
  ]) }), Map, Set }
);
assert.equal(pinned.pinnedTradeKey({ a: 1, b: 2, give: ['x', 'y'], get: ['z'] }),
  pinned.pinnedTradeKey({ a: 2, b: 1, give: ['z'], get: ['y', 'x'] }));
const odds = pinned.pinnedTradeOdds({ rosterId: 1 }, { rosterId: 2 }, [], []);
assert.equal(odds.length, 2);
assert.equal(odds[0].after.playoffPct, 50);
assert.equal(odds[1].after.championshipPct, 16);
assert.ok(page.includes('odds.map(o => line('));
console.log('PASS pinned offers dedupe and show both sides odds');
const boxes = { habitLineA: { innerHTML: '' }, habitLineB: { innerHTML: '' } };
const habits = vm.runInNewContext(
  piece('function paintHabitLine(', 'function renderAnalysis(') + '\npaintHabitLine;',
  {
    Vault: { escapeHtml: x => String(x), info: () => '' },
    Negotiation: { styles: new Map() }, Map,
    negHabitFit: id => ({
      habits: [{ say: id === 1 ? 'gets younger' : 'spends picks', n: 4, of: 5 }], fit: 1
    }),
    document: { getElementById: id => boxes[id] || null }
  }
);
habits('A', { rosterId: 1, teamName: 'North' }, [], []);
habits('B', { rosterId: 2, teamName: 'South' }, [], []);
assert.ok(boxes.habitLineA.innerHTML.includes('North gets younger'));
assert.ok(boxes.habitLineB.innerHTML.includes('South spends picks'));
assert.ok(page.includes("paintHabitLine('A'") && page.includes("paintHabitLine('B'"));
console.log('PASS manager tendencies on both sides');
const cornerstone = vm.runInNewContext(
  piece('function cornerstoneWarningsHtml(', 'function updateTrade()') + '\ncornerstoneWarningsHtml;',
  { Vault: { cornerstone: (t, a) => a.type === 'player' ? { rank: 1, share: .1 } : null,
    escapeHtml: x => String(x) } }
);
const notes = cornerstone({ teamName: 'North' }, { teamName: 'South' },
  [{ type: 'player', name: 'First' }], [{ type: 'player', name: 'Second' }]);
assert.ok(notes.includes('North') && notes.includes('South'));
assert.ok(notes.includes('First') && notes.includes('Second'));
console.log('PASS cornerstone warnings on both sides');
console.log('All trade calculator parity checks passed.');
