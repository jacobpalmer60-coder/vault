#!/usr/bin/env node
/* Every league manager gets an equivalent historical trade-record breakdown. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'managers.html'), 'utf8');
const start = html.indexOf('function managerTradeRecordGroups(');
const stop = html.indexOf('let managerRecordState = null;', start);
assert.ok(start > 0 && stop > start, 'missing league-wide manager trade helper');
const Vault = {
  gradedImprovement: (g, side) => ({ tier: side === 'A' ? 'slight' : 'leansbad' }),
  escapeHtml: x => String(x).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
};
const groups = vm.runInNewContext(html.slice(start, stop) + '\nmanagerTradeRecordGroups;', { Vault, Map, Set });
const trade = {
  tx: {}, teamA: { rosterId: 1 }, teamB: { rosterId: 2 },
  anyMissingValue: false, dValueAdjAToday: 120
};
const same = [trade, { ...trade, anyMissingValue: true },
  { ...trade, tx: { _ownerAttributionUncertain: true } }];
const first = groups(same, 1);
const second = groups(same, 2);
assert.equal(first.total, 1);
assert.equal(second.total, 1);
assert.equal(first.groups[0].ahead, 1);
assert.equal(second.groups[2].ahead, 0);
assert.equal(first.unavailable, 1);
assert.equal(second.unavailable, 1);
assert.equal(first.uncertain, 1);
assert.equal(second.uncertain, 1);
console.log('PASS both sides have symmetrical manager record coverage and exclusion rules');

const other = groups(same, 3);
assert.equal(other.total, 0);
assert.equal(other.uncertain, 0);
console.log('PASS non-trading team can be selected without inheriting other managers’ deals');

const selected = html.slice(html.indexOf('function renderManagerRecord('), html.indexOf('async function init() {'));
assert.ok(selected.includes('state.teams.find('));
assert.ok(selected.includes('state.teams].sort('));
assert.ok(selected.includes('No completed trades'));
assert.ok(html.includes('initManagerRecord(allGraded, teams, tradeActivity, pendingTrades)'), 'manager record must receive all unpriced activity and pending trades');
console.log('PASS manager dropdown and no-trade state are available');
assert.ok(html.includes('vault-manager-toggle'), 'manager row is a keyboard-accessible button');
assert.ok(html.includes('manager-sort-'), 'sorting controls are buttons');
assert.ok(html.includes('s.pricedTrades ? signedCell(s.netValue)'), 'unpriced trades must not display fake zero net value');
console.log('All manager trade-record parity checks passed.');
