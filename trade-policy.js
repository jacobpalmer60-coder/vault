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
  // A request for alternative packages on an already-passable trade should
  // improve the ONLY price used by Vault's decision engine: summed market value.
  // A better historical package curve number is never a reason to give a
  // valuable player away. Both sides' independent roster verdicts must survive.
  function evenImprovement({before, after, priceBefore, priceAfter}) {
    const gainA = after.A.score - before.A.score, gainB = after.B.score - before.B.score;
    const priceGain = priceBefore - priceAfter;
    if (![gainA, gainB, priceGain].every(Number.isFinite)) return null;
    if (after.A.level === 'bad' || after.B.level === 'bad' ||
        gainA < -0.5 || gainB < -0.5 || priceGain < -1) return null;
    if (!(priceGain >= 2 ||
      (Math.max(gainA,gainB) >= 3 && Math.min(gainA,gainB) >= -0.25))) return null;
    return {gainA, gainB, priceGain};
  }

  function ledger(Vault, giveA, giveB) {
    const sum = (xs, fn) => xs.reduce((s,x)=>s+n(fn(x)),0);
    const market = xs => sum(xs,x=>Vault.gradeValue(x));
    const priced = Vault.tradeSideValues(giveA,giveB); // retired historical curve, reference only
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
  // The market baseline and the package model answer different questions.
  // Treat both as measurements, NOT as proof that an accepted trade was fair:
  // the fair curve was fitted to completed (selected) trades.
  function priceAudit(Vault, sendA, sendB) {
    const book = ledger(Vault, sendA, sendB);
    const signed = (a,b) => a+b > 0 ? 200*(a-b)/(a+b) : null;
    const listedA = sendA.reduce((s,a)=>s+n(a.ktcPrice ?? a.value),0);
    const listedB = sendB.reduce((s,a)=>s+n(a.ktcPrice ?? a.value),0);
    const ktc = typeof Vault.ktcVerdict === 'function' && sendA.length && sendB.length
      ? Vault.ktcVerdict(sendA,sendB) : null;
    const ktcA = ktc ? listedA + ktc.adjustA : null;
    const ktcB = ktc ? listedB + ktc.adjustB : null;
    const listed = {valueA:listedA,valueB:listedB,signedPct:signed(listedA,listedB)};
    const additive = {valueA:book.marketA,valueB:book.marketB,signedPct:signed(book.marketA,book.marketB)};
    const active = typeof Vault.marketSideValues==='function'?Vault.marketSideValues(sendA,sendB):null;
    const primaryBasis = active?.basis||'additive-market';
    const market = primaryBasis==='raw-power-2'?{valueA:active.valueA,valueB:active.valueB,signedPct:signed(active.valueA,active.valueB)}:additive;
    const packaged = {valueA:book.packageA,valueB:book.packageB,
      signedPct:signed(book.packageA,book.packageB),
      bonusA:book.packageA-book.marketA,bonusB:book.packageB-book.marketB};
    const ktcAdjusted = ktc ? {valueA:ktcA,valueB:ktcB,
      signedPct:signed(ktcA,ktcB),bonusA:ktc.adjustA,bonusB:ktc.adjustB} : null;
    const comparison = primaryBasis==='raw-power-2'?additive:packaged;
    const delta = market.signedPct === null || comparison.signedPct === null
      ? null : comparison.signedPct - market.signedPct;
    // Illustrate how the curve treats the SECOND piece in a 2-for-1. Its
    // contribution is expressed on the single-piece side's market-price scale;
    // it is a ratio equivalent, not a sale price or a prediction of a manager.
    let marginal = null;
    const two = sendA.length === 2 && sendB.length === 1 ? sendA
      : sendB.length === 2 && sendA.length === 1 ? sendB : null;
    const one = two === sendA ? sendB : sendA;
    if (two && one.length === 1 && typeof Vault.tradeValueRatio === 'function') {
      const pieces = two.map(asset=>({asset,price:n(Vault.gradeValue(asset))}))
        .sort((x,y)=>y.price-x.price);
      const other = one.map(asset=>n(Vault.gradeValue(asset)));
      if (other[0] > 0 && pieces.every(x=>x.price>0)) {
        const fullRatio = Vault.tradeValueRatio(pieces.map(x=>x.price),other);
        const leadRatio = Vault.tradeValueRatio([pieces[0].price],other);
        const equivalent = other[0]*(fullRatio-leadRatio);
        if (Number.isFinite(equivalent)) {
          marginal = {sendSide:two===sendA?'A':'B',assetName:pieces[1].asset.name || 'Second piece',
            marketPrice:pieces[1].price,equivalent,
            retainedPct:100*equivalent/pieces[1].price};
        }
      }
    }
    return {listed,market,additive,package:packaged,ktc:ktcAdjusted,marginal,
      marketFeedAvailable:!!Vault._gradeMarket,
      primaryBasis,historicalCurveOnly:true,
      divergencePct:delta===null?null:Math.abs(delta),
      // Threshold is descriptive UI guidance, not fitted statistical evidence.
      materialDisagreement:delta!==null && Math.abs(delta)>=15};
  }
  return {receiverDecision,evidence,evenCandidates,evenShortlist,evenImprovement,ledger,priceAudit};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = VaultTradePolicy;
