#!/usr/bin/env node
/* Regression checks for equal treatment of trade sides and historical honesty.
   Run: node scripts/check-audit-regressions.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadVault } = require('./lib-market');
const Vault = loadVault();
const root = path.join(__dirname, '..');
const tradeSource = fs.readFileSync(path.join(root, 'trade.html'), 'utf8');

function extract(from, to) {
  const start = tradeSource.indexOf(from);
  const end = tradeSource.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, 'missing trade helper: ' + from);
  return tradeSource.slice(start, end);
}
function player(value, id) {
  return { type: 'player', value, id, name: 'Player ' + id, pos: 'WR', age: 26 };
}
function equal(a, b, message) { assert.ok(Math.abs(a - b) < 1e-7, message); }

// Market-price calculations must not change just because teams are reversed.
for (const [A, B] of [
  [[player(8000, 'x')], [player(4000, 'y'), player(3500, 'z')]],
  [[player(6000, 'x'), player(3000, 'y')], [player(7000, 'z')]],
  [[player(1200, 'x'), player(900, 'y')], [player(2000, 'z')]]
]) {
  const a = Vault.tradeSideValues(A, B, { market: false });
  const b = Vault.tradeSideValues(B, A, { market: false });
  equal(a.valueA, b.valueB, 'A/B value swap');
  equal(a.valueB, b.valueA, 'B/A value swap');
}
console.log('PASS symmetric trade price math');

// An old trade can only be graded on point-in-time facts, not its participants'
// current roster strength and winning windows.
const teamA = { rosterId: 1, teamName: 'Team A', ownerId: 'ownerA', assets: [], plist: [], opt: 200 };
const teamB = { rosterId: 2, teamName: 'Team B', ownerId: 'ownerB', assets: [], plist: [], opt: 15 };
const teamById = new Map([[1, teamA], [2, teamB]]);
const people = {
  1: { first_name: 'First', last_name: 'Example', position: 'WR', age: 25 },
  2: { first_name: 'Second', last_name: 'Example', position: 'WR', age: 26 }
};
const values = new Map([['first example', 8000], ['second example', 4500]]);
const tx = { roster_ids: [1, 2], adds: { 1: 2, 2: 1 }, draft_picks: [], created: 1740000000000, status_updated: 1740000000000 };
const grade = (trade, fromA, fromB) => Vault.gradeTrade(
  trade, teamById, people, values, new Map(), [fromA, fromB],
  new Map(), ['WR'], { WR: 0, wr: 0 }, null, null
);
const g = grade(tx, teamA, teamB);
assert.equal(g.historyFitUnavailable, true);
assert.equal(g.dOptA, null);
assert.equal(g.dOptB, null);
equal(g.pctDiff, g.fairness.overallPct, 'past price is not contaminated by present fit');
const opposite = grade({ ...tx, roster_ids: [2, 1] }, teamA, teamB);
equal(g.pctDiff, opposite.pctDiff, 'past grade gap same on reversal');
equal(g.signedPctDiff, -opposite.signedPctDiff, 'past edge flips on reversal');
const swappedPower = grade(tx, { ...teamA, opt: 1 }, { ...teamB, opt: 999 });
equal(g.pctDiff, swappedPower.pctDiff, 'current team projections have no effect on old trade');
console.log('PASS historical trade grading and side inversion');

// An unknown price must not become an invented loss in a manager's win rate.
const stats = Vault.buildManagerStats([g, { ...g, anyMissingValue: true }], [teamA, teamB]);
for (const s of stats) {
  assert.equal(s.trades, 2);
  assert.equal(s.pricedTrades, 1);
  assert.equal(s.fitTrades, 0);
  assert.equal(s.ageTrades, 0);
}
const unknownOwner = { ...g, tx: { ...tx, _ownerAttributionUncertain: true } };
const cleanStats = Vault.buildManagerStats([g, unknownOwner], [teamA, teamB]);
assert.equal(cleanStats.find(s => s.rosterId === 1).trades, 1);
console.log('PASS manager history attribution and denominators');

// Future ranks must compare against the other side's new roster as well as ours.
const rankHelper = vm.runInNewContext(
  extract('function tradeFutureRankAgainst(', 'function futureRanksHtml(') + '\ntradeFutureRankAgainst;',
  { Map, Set }
);
const rosters = [
  { rosterId: 1, assets: [{ value: 10 }] },
  { rosterId: 2, assets: [{ value: 20 }] },
  { rosterId: 3, assets: [{ value: 30 }] }
];
const against = rankHelper(rosters, rosters[0], rosters[1], [{ value: 60 }], 1,
  (_id, assets) => assets.reduce((sum, a) => sum + a.value, 0));
assert.equal(against[0], 60);
assert.equal(against[1], 30);
console.log("PASS opponent post-trade value in future rank comparisons");

// Both teams may dislike a proposal. An equalizer must explore fixes in both
// directions, rather than hard-code the partner as the only side needing help.
const selectedA = new Set(['a1']), selectedB = new Set(['b1']);
const me = {
  rosterId: 1, lineup: [], assets: [
    { key: 'a1', type: 'player', value: 100 },
    { key: 'a2', type: 'player', value: 70 }
  ]
};
const other = {
  rosterId: 2, lineup: [], assets: [
    { key: 'b1', type: 'player', value: 20 },
    { key: 'b2', type: 'player', value: 70 },
    { key: 'b3', type: 'pick', value: 10 }
  ]
};
const sandbox = {
  teamOf: side => side === 'A' ? me : other,
  selectedA, selectedB, Map, Set, Math,
  EVEN_MAX_GAP: 8, EVEN_OPTIONS: 6, EVEN_PIECE_REPEATS: 2,
  Vault: { marketSideValues: (A, B) => ({
    valueA: A.reduce((v, a) => v + a.value, 0),
    valueB: B.reduce((v, b) => v + b.value, 0)
  }) },
  computeTradeAnalysis: (_a, _b, _A, _B, valueA, valueB) => ({ gap: 200 * Math.abs(valueA - valueB) / ((valueA + valueB) || 1) }),
  improvementOf: analysis => ({ level: analysis.gap <= 8 ? 'tossup' : 'bad', score: analysis.gap <= 8 ? 0 : -20 }),
  negContextFor: () => ({}),
  negJudgeFor: () => ({ accepts: true })
};
const even = vm.runInNewContext(extract('function evenPlan() {', '// The first fix in words') + '\nevenPlan;', sandbox);
const plan = even();
assert.ok(plan && plan.options.length > 0, 'a valid equalizer should be found');
assert.ok(plan.options.some(o => o.helpB === false), 'must also search the user side');
assert.ok(plan.options.some(o => o.add.length === 2), 'must try two-piece additions');
console.log('PASS two-direction, multi-piece trade equalizer');

// The injury stress scenario is presented for BOTH recipients, not just Team A.
const stressHtml = { innerHTML: '' };
const before = {
  A: { rosterId: 1, opt: 10, optByWeek: new Map([[11, 10]]) },
  B: { rosterId: 2, opt: 10, optByWeek: new Map([[11, 10]]) }
};
const after = {
  A: { rosterId: 1, opt: 20, optByWeek: new Map([[11, 20]]), plist: [{ id: 'x' }] },
  B: { rosterId: 2, opt: 20, optByWeek: new Map([[11, 20]]), plist: [{ id: 'y' }] }
};
const seasonInput = {
  before, after, depA: 0, depB: 0, lineA: 10, lineB: 10,
  next: new Map([[1, { championshipPct: 30 }], [2, { championshipPct: 35 }]])
};
const stress = vm.runInNewContext(
  extract('function scheduleStress(', 'function renderSeasonImpact(') + '\nscheduleStress;',
  {
    stressTimer: 0, clearTimeout: () => {}, setTimeout: fn => { fn(); return 1; },
    document: { getElementById: id => id === 'stressLine' ? stressHtml : null },
    remainingWeeks: [{ week: 11 }], tradeSeasonOdds: () => seasonInput,
    Vault: {
      seasonLineupDetail: () => ({ total: 0, byWeek: new Map([[11, 0]]) }),
      escapeHtml: x => x, info: () => ''
    },
    slots: ['WR'],
    seasonOdds: () => new Map([[1, { championshipPct: 10 }], [2, { championshipPct: 11 }]]),
    seasonBase: new Map([[1, { championshipPct: 20 }], [2, { championshipPct: 20 }]]),
    Map, Set, Math
  }
);
stress({ rosterId: 1, teamName: 'Alpha' }, { rosterId: 2, teamName: 'Beta' },
  [{ type: 'player', id: 'y', name: 'Y', value: 20 }],
  [{ type: 'player', id: 'x', name: 'X', value: 20 }]);
assert.ok(stressHtml.innerHTML.includes('Alpha'));
assert.ok(stressHtml.innerHTML.includes('Beta'));
console.log('PASS two-sided injury stress test');

console.log('All trade audit regression checks passed.');
