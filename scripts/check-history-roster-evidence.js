#!/usr/bin/env node
/* Conservative historical roster replay; no historical lineup-fit scoring. */
const assert = require('node:assert/strict');
const { loadVault } = require('./lib-market');
const Vault = loadVault();
const rosters = [
  { roster_id: 1, players: ['beta'] },
  { roster_id: 2, players: ['gamma'] },
  { roster_id: 3, players: ['outsider'] }
];
const trade = {
  type: 'trade', transaction_id: 'trade-200', status: 'complete',
  status_updated: 200, created: 190, roster_ids: [1, 2],
  adds: { alpha: 2, beta: 1 }, drops: { alpha: 1, beta: 2 },
  draft_picks: []
};
const waiver = {
  type: 'free_agent', transaction_id: 'waiver-300', status: 'complete',
  status_updated: 300, roster_ids: [2],
  adds: { gamma: 2 }, drops: { alpha: 2 }
};
const full = Vault.replayTradeRosters(rosters, [trade, waiver], { minTimestamp: 100 });
const evidence = full.get('trade-200');
assert.equal(evidence.status, 'replayed');
assert.deepEqual([...evidence.rosterCountsBefore], [1, 1]);
assert.equal(evidence.movedPlayers, 2);
console.log('PASS both pre-trade rosters reconciled after reversing later waiver');

// A missing subsequent move must NEVER be silently treated as verified history.
const incomplete = Vault.replayTradeRosters(rosters, [trade], { minTimestamp: 100 });
assert.equal(incomplete.get('trade-200').status, 'partial');
console.log('PASS missing transactions do not produce trusted roster evidence');

// Transactions earlier than a completed rookie draft require a draft replay.
const preDraft = Vault.replayTradeRosters(rosters, [trade, waiver], { minTimestamp: 250 });
assert.equal(preDraft.get('trade-200').status, 'before-draft');
const offline = Vault.replayTradeRosters(rosters, [trade], { minTimestamp: Infinity });
assert.equal(offline.get('trade-200').status, 'unavailable');
console.log('PASS pre-draft and unavailable source data are explicitly marked');

// Picks-only trades can be graded on historical prices without claiming
// transferable-player evidence that does not exist.
const pickOnly = {
  type: 'trade', status: 'complete', transaction_id: 'pick-400',
  status_updated: 400, roster_ids: [1, 3], adds: null, drops: null,
  draft_picks: [{ season: '2027', round: 1, roster_id: 1, owner_id: 3 }]
};
const picks = Vault.replayTradeRosters(rosters, [pickOnly], { minTimestamp: 100 });
assert.equal(picks.get('pick-400').status, 'no-player-transfers');
console.log('PASS picks-only trades remain distinct from player reconciliation');

// Order must follow completion time rather than when an owner first proposed a deal.
const lateAcceptance = { ...trade, transaction_id: 'late', created: 50, status_updated: 200 };
const accepted = Vault.replayTradeRosters(rosters, [lateAcceptance, waiver], { minTimestamp: 100 });
assert.equal(accepted.get('late').status, 'replayed');
console.log('PASS completion timestamp governs time-of-trade replay');
console.log('All historical roster evidence tests passed.');
