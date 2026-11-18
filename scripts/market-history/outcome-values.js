'use strict';
/*
 * Evaluate the original trade pieces at a later date. An observed price of 0
 * stays 0, but an absent/unpriced result is NOT proof of a loss. The score
 * is returned twice: a strict complete-case score (pct=null if any missing)
 * and a sensitivity score that treats unknown prices as 0 (pctImputed).
 *
 * Both-zero observed outcomes are uninformative and stay null, not 50/50.
 * This is a value-retention diagnostic, not a manager acceptance prediction.
 */
function laterOutcome(got, gave, date, book, tradeValueRatio) {
  const values = list => list.map(x => {
    const raw = book.later(x.k, date);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  });
  const a = values(got), b = values(gave);
  const missingCount = [...a,...b].filter(v => v === null).length;
  const score = (x,y) => {
    const sa = x.reduce((s,v) => s+v,0), sb = y.reduce((s,v) => s+v,0);
    if (!sa && !sb) return null;
    if (!sb) return 200;
    if (!sa) return -200;
    const ratio = tradeValueRatio(x,y);
    if (!(ratio > 0) || !Number.isFinite(ratio)) return null;
    const pct = 200 * (ratio - 1) / (ratio + 1);
    return Number.isFinite(pct) ? pct : null;
  };
  const cleanA = a.map(v => v ?? 0), cleanB = b.map(v => v ?? 0);
  const pctImputed = score(cleanA,cleanB);
  return {
    pct: missingCount ? null : pctImputed,
    pctImputed,
    missingCount,
    complete: missingCount === 0,
    got: a,
    gave: b
  };
}
module.exports = { laterOutcome };
