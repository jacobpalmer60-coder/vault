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
     fair (optional, 2026-10-18): the site's own trade value formula instead
     (Vault.tradeValueRatio): p from the best piece AND how close the other side's
     best piece is (VAULT_CONFIG.FAIR_CURVE table, at `strength`), and pieces beyond
     one more than the other side sends count at `extra` of their value
     (EXTRA_PIECE_WEIGHT). Our values scored 0.13 against KTC's 0.22 on the same
     simple curve, but KTC on the site's formula scored ~0.10: the gap was the formula.
     rankCurve (optional, 2026-10-18, user: "incorporate more 2-1 3-1 3-2 etc"): a
     formula learned with the values, from every trade shape, on the same loss.
     p = 1 + softplus(c0 + c1 z + c2 r + c3 r z), z = ln(the best piece's rank among
     that week's assets), r = closeness of the two sides' best pieces; pieces past
     one more than the other side sends count at sigmoid(e) of their value. By rank,
     so it doesn't depend on the value scale (the site's table is on KTC's scale).
     fitRank alternates values (Adam) and the formula's 5 numbers (coordinate search).
     Left free, the first test drifted to an extreme (extra pieces worth ~0 and
     close trades winner-take-all: trades "balance" trivially), so: pMax caps p
     (6, the site table's highest), fixE keeps the extra-piece weight where it
     was measured (25%), and each number stays within +-cMax.
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
  constructor(trades, { p = 1.5, pKnots = null, fair = null, rankCurve = null, extraWeight = null, lambda = 30, ridge = 0.002, delta = 0.25, minTrades = 15, trainUntilWeek = Infinity, prior = null, kappa = 0, kappaHalf = Infinity, kappaPick = null, keys = null } = {}) {
    Object.assign(this, { p, lambda, ridge, delta, kappa });
    this.pKnots = pKnots ? pKnots.map(([v, q]) => [Math.log(v), q]) : null;
    // extraWeight (2026-10-18): with pKnots, pieces past one more than the other side
    // sends count at this share (the site's EXTRA_PIECE_WEIGHT). By trade shape, our
    // values beat KTC on 1-for-1, 2-for-1, 2-for-2 and 3-for-2 but lost on 3-for-1,
    // 4+-for-1 and 4+-for-2, where every piece of a pile counted in full.
    this.lnExtraW = extraWeight ? Math.log(extraWeight) : null;
    this.rankCurve = rankCurve ? { c: [...rankCurve.c], e: rankCurve.e, pMax: rankCurve.pMax ?? 6, fixE: rankCurve.fixE ?? true, cMax: rankCurve.cMax ?? 6 } : null;
    this.fair = fair ? { ...fair, lv: fair.values.map(Math.log), lnExtra: Math.log(fair.extra ?? 1), strength: fair.strength ?? 1 } : null;
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
  // The site's fair curve (Vault.tradeValueP) at a best piece of display value topV and closeness r, at this.fair.strength.
  pFair(topV, r) {
    const F = this.fair;
    const seg = (xs, x) => { if (x <= xs[0]) return [0, 0, 0]; if (x >= xs[xs.length - 1]) return [xs.length - 1, xs.length - 1, 0]; let i = 0; while (x > xs[i + 1]) i++; return [i, i + 1, (x - xs[i]) / (xs[i + 1] - xs[i])]; };
    const [i0, i1, u] = seg(F.lv, Math.log(Math.max(topV, 1))), [j0, j1, v] = seg(F.closeness, r);
    const a = F.p[i0][j0] * (1 - v) + F.p[i0][j1] * v, b = F.p[i1][j0] * (1 - v) + F.p[i1][j1] * v;
    return 1 + F.strength * (a * (1 - u) + b * u - 1);
  }
  // For one trade under this.fair: its p, and each piece's offset (ln of the extra-piece weight
  // for pieces past one more than the other side sends, ranked by value within the side).
  fairSetup(xs, sides, weekTop, off) {
    let bestA = -Infinity, bestB = -Infinity, nA = 0, nB = 0;
    xs.forEach((x, i) => { if (sides[i] === 1) { nA++; if (x > bestA) bestA = x; } else { nB++; if (x > bestB) bestB = x; } });
    const top = Math.max(bestA, bestB), r = Math.exp(Math.min(bestA, bestB) - top);
    const p = nA === 1 && nB === 1 ? 1 : this.pFair(9999 * Math.exp(top - weekTop), r);
    for (const [side, nOther] of [[1, nB], [-1, nA]]) {
      const idx = xs.map((x, i) => i).filter(i => sides[i] === side).sort((i, j) => xs[j] - xs[i]);
      idx.forEach((i, rank) => { off[i] = rank >= nOther + 1 ? this.fair.lnExtra : 0; });
    }
    return p;
  }
  // rankCurve: each week's values, negated and sorted ascending (= highest first), for ranks.
  weekSorted(u) {
    const out = [];
    for (let w = 0; w < this.W; w++) { const col = new Float64Array(this.A); for (let a = 0; a < this.A; a++) col[a] = -u[a * this.W + w]; col.sort(); out.push(col); }
    return out;
  }
  rankIn(sorted, x) { let lo = 0, hi = sorted.length; const nx = -x; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < nx) lo = m + 1; else hi = m; } return lo + 1; }
  static softplus(x) { return x > 30 ? x : Math.log1p(Math.exp(x)); }
  rankP(z, r, c = this.rankCurve.c) { return Math.min(this.rankCurve.pMax, 1 + Model.softplus(c[0] + c[1] * z + c[2] * r + c[3] * r * z)); }
  // Per trade under rankCurve: z, r, and which pieces are extras (past one more than the other side sends).
  rankFeatures(xs, sides, sorted, extra) {
    let bestA = -Infinity, bestB = -Infinity, nA = 0, nB = 0;
    xs.forEach((x, i) => { if (sides[i] === 1) { nA++; if (x > bestA) bestA = x; } else { nB++; if (x > bestB) bestB = x; } });
    const top = Math.max(bestA, bestB), r = Math.exp(Math.min(bestA, bestB) - top);
    for (const [side, nOther] of [[1, nB], [-1, nA]]) {
      const idx = xs.map((x, i) => i).filter(i => sides[i] === side).sort((i, j) => xs[j] - xs[i]);
      idx.forEach((i, k) => { extra[i] = k >= nOther + 1 ? 1 : 0; });
    }
    return { z: Math.log(this.rankIn(sorted, top)), r, one: nA === 1 && nB === 1 };
  }
  // Which pieces are extras: past one more than the other side sends, by value within the side.
  extraFlags(xs, sides, extra) {
    let nA = 0, nB = 0;
    sides.forEach(sd => { if (sd === 1) nA++; else nB++; });
    for (const [side, nOther] of [[1, nB], [-1, nA]]) {
      const idx = xs.map((x, i) => i).filter(i => sides[i] === side).sort((i, j) => xs[j] - xs[i]);
      idx.forEach((i, k) => { extra[i] = k >= nOther + 1 ? 1 : 0; });
    }
  }
  // Each week's top log value (for pKnots), from the current values.
  weekTops(u) {
    const tops = new Float64Array(this.W).fill(-Infinity);
    for (let a = 0; a < this.A; a++) for (let w = 0; w < this.W; w++) { const x = u[a * this.W + w]; if (x > tops[w]) tops[w] = x; }
    return tops;
  }

  // log(side value) for the pieces in [from, to) on side s, with softmax weights into w.
  sideLog(u, w, from, to, side, week, out, p = this.p, off = null) {
    const xv = j => u[this.pAsset[j] * this.W + week] + (off ? off[j - from] : 0);
    let m = -Infinity;
    for (let j = from; j < to; j++) if (this.pSide[j] === side) { const x = p * xv(j); if (x > m) m = x; }
    let s = 0;
    for (let j = from; j < to; j++) if (this.pSide[j] === side) { const e = Math.exp(p * xv(j) - m); out[j] = e; s += e; }
    for (let j = from; j < to; j++) if (this.pSide[j] === side) out[j] /= s;
    return (m + Math.log(s)) / p;
  }

  lossAndGrad(grad) {
    const { u, W, delta, lambda, ridge } = this;
    grad.fill(0);
    const wts = new Float64Array(this.pAsset.length);
    let loss = 0;
    const tops = this.pKnots || this.fair ? this.weekTops(u) : null;
    const off = new Float64Array(64), ext = new Float64Array(64);
    const sorted = this.rankCurve ? this.weekSorted(u) : null, lnE = this.rankCurve ? Math.log(1 / (1 + Math.exp(-this.rankCurve.e))) : 0;
    for (let i = 0; i < this.n; i++) {
      const from = this.tStart[i], to = this.tStart[i + 1], wk = this.tWeek[i];
      let p = this.p, o = null;
      if (this.rankCurve) {
        const xs = [], sd = [];
        for (let j = from; j < to; j++) { xs.push(u[this.pAsset[j] * W + wk]); sd.push(this.pSide[j]); }
        const f = this.rankFeatures(xs, sd, sorted[wk], ext);
        p = f.one ? 1 : this.rankP(f.z, f.r);
        for (let k = 0; k < xs.length; k++) off[k] = ext[k] ? lnE : 0;
        o = off;
      } else if (this.fair) {
        const xs = [], sd = [];
        for (let j = from; j < to; j++) { xs.push(u[this.pAsset[j] * W + wk]); sd.push(this.pSide[j]); }
        p = this.fairSetup(xs, sd, tops[wk], off); o = off;
      } else if (tops) {
        let best = -Infinity; for (let j = from; j < to; j++) { const x = u[this.pAsset[j] * W + wk]; if (x > best) best = x; } p = this.pAt(best, tops[wk]);
        if (this.lnExtraW != null) {
          const xs = [], sd = [];
          for (let j = from; j < to; j++) { xs.push(u[this.pAsset[j] * W + wk]); sd.push(this.pSide[j]); }
          this.extraFlags(xs, sd, ext);
          for (let k = 0; k < xs.length; k++) off[k] = ext[k] ? this.lnExtraW : 0;
          o = off;
        }
      }
      const r = this.sideLog(u, wts, from, to, 1, wk, wts, p, o) - this.sideLog(u, wts, from, to, -1, wk, wts, p, o);
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

  // rankCurve: alternate the values (Adam) and the formula's numbers (coordinate
  // search on the trades' loss with the values held), rounds times.
  fitRank({ rounds = 4, iters = 150, lr = 0.05, warmIters = 60, log = null } = {}) {
    for (let k = 0; k < rounds; k++) {
      this.fit({ iters: k ? warmIters : iters, lr: k ? 0.02 : lr });
      this._feat = null;
      const before = this.tradeLossWith(this.rankCurve);
      this.searchCurve();
      if (log) log('  round ' + k + ': trade loss ' + (before / this.n).toFixed(5) + ' -> ' + (this.tradeLossWith(this.rankCurve) / this.n).toFixed(5) + ' c=' + this.rankCurve.c.map(x => x.toFixed(2)).join(',') + ' e=' + this.rankCurve.e.toFixed(2));
    }
    this.fit({ iters: warmIters, lr: 0.02 });
    this._sorted = null; this._feat = null;
  }
  // Huber loss over the trades only, for formula numbers rc, values held (features cached).
  tradeLossWith(rc) {
    if (!this._feat) this.cacheFeatures();
    const { z, r, one, xs, side, extra, start } = this._feat, lnE = Math.log(1 / (1 + Math.exp(-rc.e)));
    let loss = 0;
    for (let i = 0; i < this.n; i++) {
      const p = one[i] ? 1 : this.rankP(z[i], r[i], rc.c);
      let mA = -Infinity, mB = -Infinity;
      for (let j = start[i]; j < start[i + 1]; j++) { const v = p * (xs[j] + (extra[j] ? lnE : 0)); if (side[j] === 1) { if (v > mA) mA = v; } else if (v > mB) mB = v; }
      let sA = 0, sB = 0;
      for (let j = start[i]; j < start[i + 1]; j++) { const v = p * (xs[j] + (extra[j] ? lnE : 0)); if (side[j] === 1) sA += Math.exp(v - mA); else sB += Math.exp(v - mB); }
      const d = (mA + Math.log(sA)) / p - (mB + Math.log(sB)) / p, ad = Math.abs(d);
      loss += ad <= this.delta ? 0.5 * d * d : this.delta * (ad - 0.5 * this.delta);
    }
    return loss;
  }
  cacheFeatures() {
    const sorted = this.weekSorted(this.u), n = this.n, J = this.pAsset.length;
    const f = { z: new Float64Array(n), r: new Float64Array(n), one: new Uint8Array(n), xs: new Float64Array(J), side: this.pSide, extra: new Uint8Array(J), start: this.tStart };
    const ext = new Float64Array(64);
    for (let i = 0; i < n; i++) {
      const from = this.tStart[i], to = this.tStart[i + 1], wk = this.tWeek[i], xs = [], sd = [];
      for (let j = from; j < to; j++) { xs.push(this.u[this.pAsset[j] * this.W + wk]); sd.push(this.pSide[j]); f.xs[j] = xs[xs.length - 1]; }
      const ft = this.rankFeatures(xs, sd, sorted[wk], ext);
      f.z[i] = ft.z; f.r[i] = ft.r; f.one[i] = ft.one ? 1 : 0;
      for (let k = 0; k < xs.length; k++) f.extra[from + k] = ext[k];
    }
    this._feat = f;
  }
  searchCurve() {
    const rc = this.rankCurve, keys = rc.fixE ? [0, 1, 2, 3] : [0, 1, 2, 3, 'e'];
    const get = k => (k === 'e' ? rc.e : rc.c[k]), set = (k, v) => { if (k === 'e') rc.e = v; else rc.c[k] = v; };
    let best = this.tradeLossWith(rc), step = 0.5;
    while (step > 0.01) {
      let moved = false;
      for (const k of keys) for (const dir of [1, -1]) {
        const old = get(k), nv = old + dir * step;
        if (Math.abs(nv) > rc.cMax) continue;
        set(k, nv);
        const l = this.tradeLossWith(rc);
        if (l < best - 1e-9) { best = l; moved = true; } else set(k, old);
      }
      if (!moved) step /= 2;
    }
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
    if (this.rankCurve) {
      const w = Math.max(0, Math.min(this.W - 1, week - this.minWeek));
      if (!this._sorted) this._sorted = this.weekSorted(this.u);
      const xs = [...t.a, ...t.b].map(k => this.logValue(k, week));
      if (xs.some(x => x == null)) return null;
      const sd = [...t.a.map(() => 1), ...t.b.map(() => -1)], ext = new Array(xs.length);
      const f = this.rankFeatures(xs, sd, this._sorted[w], ext), lnE = Math.log(1 / (1 + Math.exp(-this.rankCurve.e)));
      p = f.one ? 1 : this.rankP(f.z, f.r);
      const side = s => { const v = xs.map((x, i) => (sd[i] === s ? p * (x + (ext[i] ? lnE : 0)) : -Infinity)), m = Math.max(...v); return (m + Math.log(v.reduce((acc, y) => acc + (y === -Infinity ? 0 : Math.exp(y - m)), 0))) / p; };
      return [side(1), side(-1)];
    }
    if (this.fair) {
      const w = Math.max(0, Math.min(this.W - 1, week - this.minWeek));
      if (!this._tops) this._tops = this.weekTops(this.u);
      const xs = [...t.a, ...t.b].map(k => this.logValue(k, week));
      if (xs.some(x => x == null)) return null;
      const sd = [...t.a.map(() => 1), ...t.b.map(() => -1)], off = new Array(xs.length);
      p = this.fairSetup(xs, sd, this._tops[w], off);
      const side = s => { const v = xs.map((x, i) => (sd[i] === s ? p * (x + off[i]) : -Infinity)), m = Math.max(...v); return (m + Math.log(v.reduce((acc, y) => acc + (y === -Infinity ? 0 : Math.exp(y - m)), 0))) / p; };
      return [side(1), side(-1)];
    }
    if (this.pKnots) {
      const w = Math.max(0, Math.min(this.W - 1, week - this.minWeek));
      if (!this._tops) this._tops = this.weekTops(this.u);
      const all = [...t.a, ...t.b].map(k => this.logValue(k, week)).filter(x => x != null);
      if (all.length) p = this.pAt(Math.max(...all), this._tops[w]);
      if (this.lnExtraW != null) {
        const xs = [...t.a, ...t.b].map(k => this.logValue(k, week));
        if (xs.some(x => x == null)) return null;
        const sd = [...t.a.map(() => 1), ...t.b.map(() => -1)], ext = new Array(xs.length);
        this.extraFlags(xs, sd, ext);
        const side = s2 => { const v = xs.map((x, i) => (sd[i] === s2 ? p * (x + (ext[i] ? this.lnExtraW : 0)) : -Infinity)), m = Math.max(...v); return (m + Math.log(v.reduce((acc, y) => acc + (y === -Infinity ? 0 : Math.exp(y - m)), 0))) / p; };
        return [side(1), side(-1)];
      }
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
