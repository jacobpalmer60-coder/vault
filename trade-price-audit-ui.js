/* Reconciliation UI shared by browser and deterministic Node checks.
 * A package price is a model prediction, not additive market cash value. */
const VaultPriceAuditUI = (() => {
  function html(prices, teamA, teamB, esc = x => String(x)) {
    if (!prices || prices.market.signedPct == null || prices.package.signedPct == null) return '';
    const n = v => Math.round(v).toLocaleString('en-US');
    const pct = v => Number.isFinite(v) ? Math.abs(v).toFixed(1) + '%' : 'not available';
    // A is the assets sent by team A, which means the RECIPIENT is team B.
    const favors = v => Math.abs(v || 0) < 0.05 ? 'approximately even'
      : 'favors ' + esc((v > 0 ? teamB : teamA).teamName);
    const row = (label, v) => `<tr>
      <th scope="row" class="text-left font-normal text-zinc-300 py-1 pr-2">${label}</th>
      <td class="text-right tabular-nums py-1 px-2">${n(v.valueA)}</td>
      <td class="text-right tabular-nums py-1 px-2">${n(v.valueB)}</td>
      <td class="text-right text-zinc-400 py-1 pl-2">${pct(v.signedPct)}</td>
    </tr>`;
    const item = prices.marginal;
    const marginalText = item && Number.isFinite(item.retainedPct)
      ? ` For this two-for-one, <strong>${esc(item.assetName)}</strong> is worth about ${n(item.marketPrice)}
        individually, but its implied incremental contribution to this package is only about
        ${n(item.equivalent)} (${item.retainedPct.toFixed(1)}%). That is how the curve compares
        these specific pieces, <strong>not</strong> the player's actual trade price.` : '';
    const note = prices.materialDisagreement ? `
      <div class="mt-2 pl-3 border-l-2 border-amber-400/60 text-[12px] leading-relaxed text-zinc-300" role="note">
        <strong class="text-amber-200">Large pricing-model disagreement (${prices.divergencePct.toFixed(0)} percentage points).</strong>
        The additive market-price sum ${favors(prices.market.signedPct)} by ${pct(prices.market.signedPct)};
        Vault's consolidation-adjusted model ${favors(prices.package.signedPct)}
        by ${pct(prices.package.signedPct)}.
        The adjustment was fitted to completed trades, which does not independently prove
        what a trade is worth to either manager.${marginalText}
        <span class="text-zinc-400">Treat a low package gap as model-dependent, not proof the deal is fair.</span>
      </div>` : '';
    return `<div id="priceReconciliation" class="max-w-[740px]">
      ${note}
      <details class="mt-2 text-[12px] text-zinc-400">
        <summary class="cursor-pointer hover:text-zinc-200">Compare how the pricing methods value this trade</summary>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-[12px]">
            <caption class="text-left mb-1 text-zinc-500">The larger group favors the OTHER team's received assets. These are asset groups sent, not roster-impact scores.</caption>
            <thead><tr><th class="text-left font-normal">Pricing method</th>
              <th class="text-right font-normal px-2">${esc(teamA.teamName)} sends</th>
              <th class="text-right font-normal px-2">${esc(teamB.teamName)} sends</th>
              <th class="text-right font-normal">Gap</th></tr></thead>
            <tbody>
              ${row('KTC listed values', prices.listed)}
              ${row('Market prices added', prices.market)}
              ${row('Vault package model', prices.package)}
              ${prices.ktc ? row('KTC-calculator approximation', prices.ktc) : ''}
            </tbody>
          </table>
        </div>
        <p class="mt-2 leading-relaxed text-zinc-500">Recent trade premiums adjust individual KTC
          prices. Vault then applies its own nonlinear consolidation curve, while KTC's
          calculator uses another rule (including small adjustments it may not show).
          These are competing assumptions on overlapping underlying data, not four
          independent price surveys. Neither adjustment is guaranteed future value.</p>
      </details>
    </div>`;
  }
  return {html};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = VaultPriceAuditUI;
