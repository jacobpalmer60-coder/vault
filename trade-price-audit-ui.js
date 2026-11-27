/* Reconciliation UI shared by browser and deterministic Node checks.
 * The additive market sum determines today's trade price grade; the older accepted-trade consolidation curve is shown only as historical research context. */
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
    const livePackage=prices.primaryBasis==='raw-power-2';
    const note = livePackage ? (prices.materialDisagreement?`<p class="mt-2 text-[12px] text-amber-200">Package and additive prices disagree by ${prices.divergencePct.toFixed(0)} percentage points. The live package price ${favors(prices.market.signedPct)}; additive prices remain a separate comparison.</p>`:'') : prices.materialDisagreement ? `
      <div class="mt-2 pl-3 border-l-2 border-amber-400/60 text-[12px] leading-relaxed text-zinc-300" role="note">
        <strong class="text-amber-200">Large pricing-model disagreement (${prices.divergencePct.toFixed(0)} percentage points).</strong>
        <strong>Today's price grades use the additive market sum</strong>,
        which ${favors(prices.market.signedPct)} by ${pct(prices.market.signedPct)}.
        The old accepted-trade package curve ${favors(prices.package.signedPct)}
        by ${pct(prices.package.signedPct)}, but <strong>does not determine today's price grade</strong>.
        A model trained to make accepted trades look even cannot prove future market value.
        ${marginalText}
        <span class="text-zinc-400">Consolidation benefits are instead evaluated from
        both teams' starters, depth and timelines—not by erasing the price of an included player.</span>
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
              ${livePackage?row('Vault package price (live)',prices.market):''}
              ${row('Market prices added', prices.additive||prices.market)}
              ${row('Legacy package curve (reference)', prices.package)}
              ${prices.ktc ? row('KTC-calculator approximation', prices.ktc) : ''}
            </tbody>
          </table>
        </div>
        <p class="mt-2 leading-relaxed text-zinc-500">${livePackage?'Standard SF/1QB uses the provisional power-2 curve on raw listed prices. Additive market estimates remain a separate comparison.':'Recent trade premiums adjust individual KTC prices. The market-price sum (no consolidation) is the live grading baseline.'}
          Vault's retired nonlinear consolidation curve and KTC's separate adjustment
          are displayed only for comparison. These are overlapping-model estimates,
          not four independent price surveys. Roster impact is measured separately.</p>
      </details>
    </div>`;
  }
  return {html};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = VaultPriceAuditUI;
