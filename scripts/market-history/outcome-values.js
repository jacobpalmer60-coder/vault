'use strict';
// Values of every originally traded asset at the outcome date. A player or
// pick falling to zero remains in the outcome; excluding it biases the sample
// towards winning trades. A both-zero outcome is uninformative and omitted.
// The price book returns 0 for unavailable values as well as delistings, so
// consumers must disclose that limitation rather than claim full coverage.
function laterOutcome(got, gave, date, book, tradeValueRatio) {
  const values = list => list.map(x => {
    const n = Number(book.later(x.k, date));
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const a = values(got), b = values(gave);
  const sumA = a.reduce((s, v) => s + v, 0);
  const sumB = b.reduce((s, v) => s + v, 0);
  if (!sumA && !sumB) return null;
  if (!sumB) return { pct: 200, got: a, gave: b };
  if (!sumA) return { pct: -200, got: a, gave: b };
  const ratio = tradeValueRatio(a, b);
  const pct = 200 * (ratio - 1) / (ratio + 1);
  return Number.isFinite(pct) ? { pct, got: a, gave: b } : null;
}
module.exports = { laterOutcome };
