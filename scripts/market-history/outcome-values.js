'use strict';
/*
 * Price-retention label for the originally traded pieces, one year later.
 *
 * CRITICAL: The future winner must be independent of BOTH models being
 * evaluated. Use plain additive future KTC prices (sum received - sum
 * given), never Vault's nonlinear tradeValueRatio or consolidation rules.
 *
 * Known observed zero is zero; missing/delisted is unknown, not a loss.
 * Missing-excluded and explicitly zero-imputed sensitivity are separate.
 * Both-zero outcomes do not indicate a winner.
 *
 * Draft picks are handled by book.later(), which supplies historical
 * round-level rookie-price PROXIES. These are NOT the specific rookies
 * each manager later drafted. Prefer player-only cohorts for cleaner labels.
 */
function laterOutcome(got, gave, date, book) {
  const values = list => list.map(x => {
    const raw = book.later(x.k, date);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  });
  const a = values(got), b = values(gave);
  const missingCount = [...a, ...b].filter(v => v === null).length;
  const score = (x, y) => {
    const sa = x.reduce((s, v) => s + v, 0);
    const sb = y.reduce((s, v) => s + v, 0);
    if (sa === 0 && sb === 0) return null;
    // Symmetric [-200, +200] relative additive value difference.
    // Its SIGN is strictly determined by the future KTC price sums.
    const pct = 200 * (sa - sb) / (sa + sb);
    return Number.isFinite(pct) ? pct : null;
  };
  const cleanA = a.map(v => v ?? 0), cleanB = b.map(v => v ?? 0);
  const pctImputed = score(cleanA, cleanB);
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
