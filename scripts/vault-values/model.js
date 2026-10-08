/* Vault values: the model. Production copy of the VaultValues research
   project's src/model.js (keep the two in step).

   Trade-implied values.

   Every completed trade says the two sides were about even to the two
   managers who made it. We solve for each asset's value, week by week, that
   makes all the trades balance best.

   - Values are learned as logs: u[asset][week], value = e^u.
   - A side's value is (sum of value^p)^(1/p). With p > 1, one star is worth
     more than two pieces that add up to the same total: our own consolidation
     curve, learned from how managers actually trade (p is chosen by holdout).
     pKnots (optional): p set per trade by its best piece, like the site's
     calibrated trade value curve (Vault.tradeValueP): [[value, p], ...] on a
     0-9,999 scale (the week's top asset = 9,999), straight lines in ln(value).
     2026-10-08: one p for every trade scored well behind the site's curve.
   - Each trade's error is log(side A) - log(side B), scored with a Huber loss
     so lopsided trades and fleeces count, but can't dominate.
   - Values drift: a penalty on each week-to-week change (lambda) keeps them
     smooth, so a few odd trades can't swing a value, while a steady run of
     trades at a new price moves it within a week or two.
   - A small pull toward 0 pins the overall scale (the trades only fix values
     relative to each other).
   - Optional prior (kappa): each week's value is also pulled toward a starting
     guess for that asset (prior.js: position, age, projected points). The pull
     is the same every week, so it only matters where trades are few.

   Fit with Adam over all trades at once (full batch). A fit can start from an
   earlier one (warmFrom), which the day-by-day test uses. */

class Model {
  constructor(trades, { p = 1.5, pKnots = null, lambda = 30, ridge = 0.002, delta = 0.25, minTrades = 15, trainUntilWeek = Infinity, prior = null, kappa = 0, kappaHalf = Infinity, kappaPick = null, keys = null } = {}) {
    Object.assign(this, { p, lambda, ridge, delta, kappa });
    this.pKnots = pKnots ? pKnots.map(([v, q]) => [Math.log(v), q]) : null;
    // Assets common enough to rate (counted in the training trades only).
    const count = new Map();
    for (const t of trades) if (t.week < trainUntilWeek) for (const k of [...t.a, ...t.b]) count.set(k, (count.get(k) || 0) + 1);
    this.keys = keys ? keys.filter(k => count.has(k)) : [...count.keys()].filter(k => count.get(k) >= minTrades);
    this.index = new Map(this.keys.map((k, i) => [k, i]));
    this.counts = this.keys.map(k => count.get(k));
    const usable = trades.filter(t => t.week < trainUntilWeek && [...t.a, ...t.b].every(k => this.index.has(k)));
    this.minWeek = usable.reduce((m, t) => Math.min(m, t.week), Infinity);
    this.maxWeek = usable.reduce((m, t) => Math.max(m, t.week), -Infinity);
    this.W = this.maxWeek - this.minWeek + 1;
    this.A = this.keys.length;
    // Flat trade arrays.
    const n = usable.length, pieces = usable.reduce((s, t) => s + t.a.length + t.b.length, 0);
    this.n = n;
    this.tWeek = new Int32Array(n);
    this.tStart = new Int32Array(n + 1);
    this.pAsset = new Int32Array(pieces);
    this.pSide = new Int8Array(pieces);
    let j = 0;
    usable.forEach((t, i) => {
      this.tWeek[i] = t.week - this.minWeek;
      this.tStart[i] = j;
      for (const k of t.a) { this.pAsset[j] = this.index.get(k); this.pSide[j++] = 1; }
      for (const k of t.b) { this.pAsset[j] = this.index.get(k); this.pSide[j++] = -1; }
    });
    this.tStart[n] = j;
    this.u = new Float64Array(this.A * this.W);
    // Prior log value per asset (NaN = none), from a Map key -> log value.
    this.prior = new Float64Array(this.A).fill(NaN);
    if (prior) this.keys.forEach((k, a) => { const v = prior.get(k); if (Number.isFinite(v)) this.prior[a] = v; });
    if (prior) this.keys.forEach((k, a) => { if (Number.isFinite(this.prior[a])) this.u.fill(this.prior[a], a * this.W, (a + 1) * this.W); });
    // Each asset's pull toward its prior fades with its trade count (kappaHalf = trades at half strength).
    // kappaPick: picks' pull instead, the same however often they're traded (their
    // trades are mostly throw-ins that say little about them; see prior.js).
    this.kappaA = new Float64Array(this.A).map((_, a) => (kappaPick != null && this.keys[a][0] === 'p' ? kappaPick : kappa / (1 + this.counts[a] / kappaHalf)));
  }

  // Start from another fit: same asset, same calendar week (later weeks repeat its last week).
  warmFrom(other) {
    this.keys.forEach((k, a) => {
      const b = other.index.get(k);
      if (b == null) return;
      for (let w = 0; w < this.W; w++) {
        const ow = Math.max(0, Math.min(other.W - 1, w + this.minWeek - other.minWeek));
        this.u[a * this.W + w] = other.u[b * other.W + ow];
      }
    });
    return this;
  }

  // p for a best piece at log value x in a week whose top asset is at top (pKnots), else the fixed p.
  pAt(x, top) {
    if (!this.pKnots) return this.p;
    const k = this.pKnots, lv = Math.log(Math.max(500, 9999 * Math.exp(x - top)));
    if (lv <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) if (lv <= k[i][0]) return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * (lv - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
    return k[k.length - 1][1];
  }
  // Each week's top log value (for pKnots), from the current values.
  weekTops(u) {
    const tops = new Float64Array(this.W).fill(-Infinity);
    for (let a = 0; a < this.A; a++) for (let w = 0; w < this.W; w++) { const x = u[a * this.W + w]; if (x > tops[w]) tops[w] = x; }
    return tops;
  }

  // log(side value) for the pieces in [from, to) on side s, with softmax weights into w.
  sideLog(u, w, from, to, side, week, out, p = this.p) {
    let m = -Infinity;
    for (let j = from; j < to; j++) if (this.pSide[j] === side) { const x = p * u[this.pAsset[j] * this.W + week]; if (x > m) m = x; }
    let s = 0;
    for (let j = from; j < to; j++) if (this.pSide[j] === side) { const e = Math.exp(p * u[this.pAsset[j] * this.W + week] - m); out[j] = e; s += e; }
    for (let j = from; j < to; j++) if (this.pSide[j] === side) out[j] /= s;
    return (m + Math.log(s)) / p;
  }

  lossAndGrad(grad) {
    const { u, W, delta, lambda, ridge } = this;
    grad.fill(0);
    const wts = new Float64Array(this.pAsset.length);
    let loss = 0;
    const tops = this.pKnots ? this.weekTops(u) : null;
    for (let i = 0; i < this.n; i++) {
      const from = this.tStart[i], to = this.tStart[i + 1], wk = this.tWeek[i];
      let p = this.p;
      if (tops) { let best = -Infinity; for (let j = from; j < to; j++) { const x = u[this.pAsset[j] * W + wk]; if (x > best) best = x; } p = this.pAt(best, tops[wk]); }
      const r = this.sideLog(u, wts, from, to, 1, wk, wts, p) - this.sideLog(u, wts, from, to, -1, wk, wts, p);
      const ar = Math.abs(r);
      loss += ar <= delta ? 0.5 * r * r : delta * (ar - 0.5 * delta);
      const g = ar <= delta ? r : delta * Math.sign(r);
      for (let j = from; j < to; j++) grad[this.pAsset[j] * W + wk] += g * this.pSide[j] * wts[j];
    }
    for (let a = 0; a < this.A; a++) {
      const o = a * W;
      for (let w = 0; w < W; w++) {
        const x = u[o + w];
        loss += ridge * x * x; grad[o + w] += 2 * ridge * x;
        const pr = this.prior[a];
        const ka = this.kappaA[a];
        if (ka && pr === pr) { const d = x - pr; loss += ka * d * d; grad[o + w] += 2 * ka * d; }
        if (w > 0) { const d = x - u[o + w - 1]; loss += lambda * d * d; grad[o + w] += 2 * lambda * d; grad[o + w - 1] -= 2 * lambda * d; }
      }
    }
    return loss;
  }

  fit({ iters = 400, lr = 0.05, log = null } = {}) {
    const P = this.u.length, grad = new Float64Array(P), m = new Float64Array(P), v = new Float64Array(P);
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    let loss = 0;
    for (let it = 1; it <= iters; it++) {
      loss = this.lossAndGrad(grad);
      const c1 = 1 - Math.pow(b1, it), c2 = 1 - Math.pow(b2, it);
      for (let k = 0; k < P; k++) {
        m[k] = b1 * m[k] + (1 - b1) * grad[k];
        v[k] = b2 * v[k] + (1 - b2) * grad[k] * grad[k];
        this.u[k] -= lr * (m[k] / c1) / (Math.sqrt(v[k] / c2) + eps);
      }
      if (log && (it % 50 === 0 || it === 1)) log(`  iter ${it}: loss ${(loss / this.n).toFixed(4)} per trade`);
    }
    this._tops = null; // sides() recomputes the week tops from the fitted values
    return loss / this.n;
  }

  // An asset's log value in a week (clamped to the fitted range); null if unrated.
  logValue(key, week) {
    const a = this.index.get(key);
    if (a == null) return null;
    const w = Math.max(0, Math.min(this.W - 1, week - this.minWeek));
    return this.u[a * this.W + w];
  }

  // [log(side A), log(side B)] for a trade at a given week, or null if any piece is unrated.
  sides(t, week) {
    let p = this.p;
    if (this.pKnots) {
      const w = Math.max(0, Math.min(this.W - 1, week - this.minWeek));
      if (!this._tops) this._tops = this.weekTops(this.u);
      const all = [...t.a, ...t.b].map(k => this.logValue(k, week)).filter(x => x != null);
      if (all.length) p = this.pAt(Math.max(...all), this._tops[w]);
    }
    const side = keys => {
      const xs = keys.map(k => this.logValue(k, week));
      if (xs.some(x => x == null)) return null;
      const m = Math.max(...xs.map(x => p * x));
      return (m + Math.log(xs.reduce((s, x) => s + Math.exp(p * x - m), 0))) / p;
    };
    const a = side(t.a), b = side(t.b);
    return a == null || b == null ? null : [a, b];
  }
}

module.exports = { Model };
