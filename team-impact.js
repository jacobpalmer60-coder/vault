/* Pure, side-neutral before/after impact summaries for Vault trades.
 * This is a description of engine-computed facts, NOT a new price model.
 * Both sides are evaluated from their own point of view, using the same math.
 * Draft capital uses CURRENT pick prices, not promised rookie outcomes.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VaultTradeImpact = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const val = n => Number.isFinite(Number(n)) ? Number(n) : 0;
  const sum = list => (list || []).reduce((s, p) => s + Math.max(0, val(p.value)), 0);
  const pickKey = p => [p.season, p.round, p.original].join('-');
  const pieces = list => ({
    players: (list || []).filter(a => a && a.type === 'player').length,
    picks: (list || []).filter(a => a && a.type === 'pick').length,
    playerValue: sum((list || []).filter(a => a && a.type === 'player')),
    pickValue: sum((list || []).filter(a => a && a.type === 'pick'))
  });
  function side(before, after, incoming, outgoing) {
    if (!before || !after) throw Error('Trade impact requires real before/after team snapshots');
    const incomingParts = pieces(incoming), outgoingParts = pieces(outgoing);
    const delta = (key) => val(after[key]) - val(before[key]);
    const beforePicks = (before.picks || []).map(pickKey);
    const afterPicks = (after.picks || []).map(pickKey);
    const beforeSet = new Set(beforePicks), afterSet = new Set(afterPicks);
    return {
      rosterId: before.rosterId,
      teamName: before.teamName,
      incoming: incomingParts,
      outgoing: outgoingParts,
      before: { playerValue: val(before.total), pickValue: val(before.picksValue), overall: val(before.overall), lineupPpg: val(before.opt), depth: (before.plist || []).length, pickCount: beforePicks.length },
      after: { playerValue: val(after.total), pickValue: val(after.picksValue), overall: val(after.overall), lineupPpg: val(after.opt), depth: (after.plist || []).length, pickCount: afterPicks.length },
      change: {
        playerValue: delta('total'), pickValue: delta('picksValue'), overall: delta('overall'),
        lineupPpg: delta('opt'), playerCount: (after.plist || []).length - (before.plist || []).length,
        pickCount: afterPicks.length - beforePicks.length
      },
      picksAdded: afterPicks.filter(k => !beforeSet.has(k)),
      picksRemoved: beforePicks.filter(k => !afterSet.has(k))
    };
  }
  // Describe effects, not whether a manager should accept an offer.
  // Never imply a price change is a guaranteed win or future pick outcome.
  function explain(impact, mode) {
    const d=impact.change, phrases=[];
    const pp=Math.abs(d.lineupPpg).toFixed(1);
    if (d.lineupPpg >= 0.5) phrases.push('adds '+pp+' projected starting-lineup points per week');
    else if (d.lineupPpg <= -0.5) phrases.push('gives up '+pp+' projected starting-lineup points per week');
    else phrases.push('has little effect on projected starting-lineup points');
    if (d.pickValue > 0) phrases.push('adds '+Math.round(d.pickValue).toLocaleString('en-US')+' in current draft-pick value');
    else if (d.pickValue < 0) phrases.push('spends '+Math.round(-d.pickValue).toLocaleString('en-US')+' in current draft-pick value');
    if (d.playerValue > 0) phrases.push('gains '+Math.round(d.playerValue).toLocaleString('en-US')+' in current player value');
    else if (d.playerValue < 0) phrases.push('loses '+Math.round(-d.playerValue).toLocaleString('en-US')+' in current player value');
    if (mode === 'rebuild') phrases.push('evaluate future assets and timeline separately from this season’s points');
    if (mode === 'contend') phrases.push('check whether the immediate lineup effect justifies any draft capital spent');
    return phrases;
  }
  function pair(before, after, givenA, givenB) {
    return {
      A: side(before.A, after.A, givenB, givenA),
      B: side(before.B, after.B, givenA, givenB)
    };
  }
  return Object.freeze({side, pair, pieces, explain});
});
