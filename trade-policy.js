/* Trade policy shared by the calculator, Even It Out and negotiation.
 * Pure functions so the same decision rules can be regression-tested in Node.
 * Neither manager's history is presented as an empirical acceptance probability. */
const VaultTradePolicy = (() => {
  const n = x => Number.isFinite(+x) ? +x : 0;
  const unique = a => [...new Map(a.map(x => [x.key, x])).values()];
  const sortByTarget = (pool, value) => [...pool].sort((a,b) =>
    Math.abs(n(a.value) - value) - Math.abs(n(b.value) - value));

  function receiverDecision({will, ask, drops = 0, level}) {
    // Willingness to accept and whether the recipient benefits are different
    // questions. Historical trades include accepted deals graded poorly for one
    // manager, so don't manufacture false rejections just to match the grade.
    const accepts = Number.isFinite(will) && Number.isFinite(ask) &&
      will >= ask && drops <= 1;
    return {accepts, gradeConflict:accepts && level === 'bad',
      receiverLevel:level || 'unknown'};
  }

  function evidence(ctx) {
    const count = Math.max(0, Math.floor(n(ctx?.style?.trades)));
    const history = ctx?.basis === 'history' && count >= 2;
    const sample = count >= 12 ? 'Meaningful league sample' :
      count >= 4 ? 'Limited league sample' :
      count >= 2 ? 'Very small league sample' : 'No usable league sample';
    return {
      count, history, sample,
      note: history
        ? sample + ' (' + count + ' completed trades). Heuristic response, not a measured acceptance probability.'
        : 'Based mostly on market patterns and roster needs; no dependable manager-specific acceptance estimate.'
    };
  }

  function evenCandidates(pool, has, deficit) {
    // Always consider straightforward pieces, then mixed remove-and-add swaps.
    // Bounded pools keep expensive full-roster simulations away from combinatorial growth.
    const cands = [], seen = new Set(), selected = new Set(has.map(x => x.key));
    const offer = (add, drop) => {
      if (!add.length && !drop.length) return;
      const keys = [...add.map(x => 'a:' + x.key), ...drop.map(x => 'd:' + x.key)].sort();
      const key = keys.join('|');
      if (!seen.has(key)) { seen.add(key); cands.push({add, drop}); }
    };
    const near = sortByTarget(pool, deficit / 2).slice(0, 18);
    const top = [...pool].sort((a,b) => n(b.value)-n(a.value)).slice(0,8);
    const small = [...pool].sort((a,b) => n(a.value)-n(b.value)).slice(0,6);
    const pair = unique([...near,...top,...small]);
    const triple = sortByTarget(pool, deficit / 3).slice(0,14);
    pool.forEach(a=>offer([a],[]));
    if (has.length > 1) has.forEach(a=>offer([],[a]));
    if (has.length > 2) has.forEach((a,i)=>has.slice(i+1).forEach(b=>offer([],[a,b])));
    pair.forEach((a,i)=>pair.slice(i+1).forEach(b=>offer([a,b],[])));
    triple.forEach((a,i)=>triple.slice(i+1).forEach((b,j)=>
      triple.slice(i+j+2).forEach(c=>offer([a,b,c],[]))));
    if (has.length > 1) {
      // Swap an existing traded asset for a different one without
      // requiring the user to rebuild their offer manually.
      const swaps = unique([
        ...sortByTarget(pool, deficit).slice(0,12),
        ...top, ...small
      ]);
      for (const old of has) for (const fresh of swaps) {
        if (!selected.has(fresh.key)) offer([fresh],[old]);
      }
      // A two-piece replacement for a traded piece is common in dynasty.
      const smallPairs = sortByTarget(pool, deficit / 2).slice(0,10);
      for (const old of has) smallPairs.forEach((a,i)=>
        smallPairs.slice(i+1).forEach(b=>offer([a,b],[old])));
    }
    return cands;
  }

  function evenShortlist(priced, limit = 80) {
    const ordered = [...priced].sort((a,b)=>a.preScore-b.preScore);
    const keep = [], seen = new Set();
    const add = c => {
      const key = [...c.add.map(x=>'a'+x.key),...c.drop.map(x=>'d'+x.key)].sort().join('|');
      if (keep.length < limit && !seen.has(key)) {seen.add(key);keep.push(c);}
    };
    // Keep the original full-simulation budget while reserving room for swaps.
    ordered.slice(0,40).forEach(add);
    const type = c => c.add.length && c.drop.length ? 'swap' :
      c.drop.length ? 'drop' : c.add.length > 1 ? 'package' : 'single';
    for (const t of ['swap','drop','package','single'])
      ordered.filter(c=>type(c)===t).slice(0,10).forEach(add);
    ordered.forEach(add);
    return keep;
  }

  // Is this actually an improvement on a trade already rated Toss-up or
  // better for both sides? A higher score for one team alone is not enough:
  // a gratuitous throw-in can make a manager worse even if their headline tier
  // stays unchanged. Treat package price, additive price and both independent
  // roster verdicts as separate non-substitutable signals.
  function evenImprovement({before, after, packageBefore, packageAfter, additiveBefore, additiveAfter}) {
    const gainA = after.A.score - before.A.score;
    const gainB = after.B.score - before.B.score;
    const packageGain = packageBefore - packageAfter;
    const additiveGain = additiveBefore - additiveAfter;
    if (![gainA, gainB, packageGain, additiveGain].every(Number.isFinite)) return null;
    // Neither manager should sacrifice a meaningful amount of benefit simply
    // so the other side can extract another asset.
    if (after.A.level === 'bad' || after.B.level === 'bad' ||
        gainA < -0.5 || gainB < -0.5) return null;
    // Package consolidation should not be used to mask a new lopsided raw
    // price. The already-nearly-even Boston + Kiner/Kittle scenario exposed
    // gratuitous add-ons that widened the 35% raw price gap.
    if (additiveGain < -2 || packageGain < -1) return null;
    const worthChanging = packageGain >= 2 ||
      (Math.max(gainA, gainB) >= 3 && Math.min(gainA, gainB) >= -0.25);
    if (!worthChanging) return null;
    return {gainA, gainB, packageGain, additiveGain};
  }

  function ledger(Vault, giveA, giveB) {
    const sum = (xs, fn) => xs.reduce((s,x)=>s+n(fn(x)),0);
    const market = xs => sum(xs,x=>Vault.gradeValue(x));
    const priced = Vault.tradeSideValues(giveA,giveB);
    const raw = Vault.tradeSideValues(giveA,giveB,{market:false});
    const average = (a,b) => (a+b)/2 || 1;
    return {
      rawA:sum(giveA,x=>x.value), rawB:sum(giveB,x=>x.value),
      marketA:market(giveA), marketB:market(giveB),
      packageA:priced.valueA, packageB:priced.valueB,
      additiveGap:200*(market(giveA)-market(giveB))/average(market(giveA),market(giveB))/2,
      packageGap:200*(priced.valueA-priced.valueB)/(priced.valueA+priced.valueB || 1),
      unadjustedPackageA:raw.valueA, unadjustedPackageB:raw.valueB
    };
  }
  return {receiverDecision,evidence,evenCandidates,evenShortlist,evenImprovement,ledger};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = VaultTradePolicy;
