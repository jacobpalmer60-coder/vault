# Trade Calculator four-area pass — November 22, 2026

## Shipped to development branch

1. **Correctness:** Shared trade-policy math reports additive market values and consolidated trade-package values separately. The negotiation response now uses the same receiving-team benefit method as the calculator, while preserving the crucial distinction that a manager might accept a deal Vault grades poorly. A disagreement becomes an explicit warning, not a hidden contradiction or a forced rejection.
2. **Search quality:** Even It Out considers individual additions, removals, pairs, triples, and mixed add/remove swaps, with deduplication and a diversified capped shortlist. Its actual final decision still requires the original market-gap threshold, both teams' benefit requirements, and affirmative simulated willingness from each manager.
3. **Evidence:** Manager-specific trade history is disclosed as sample size, not presented as a calibrated acceptance probability. Forecast language explicitly says a simulated response is neither a Sleeper message nor an observed decision. Current acceptance weights, trade grades and historical pricing have not been refitted on leaked retrospective data.
4. **Interface:** The top calculator result keeps both independent team verdicts and adds a clear market-only price read (additive versus package gap), plus a separate, unconfirmed negotiation read. Both-team impact and What-if panels are unchanged.

## Verified from connected source in an isolated JavaScript runner

- Syntax compilation: `vault-core.js`, `trade-policy.js`, `negotiation.js`, the main `trade.html` inline script, and new/updated regression scripts.
- Policy regression: additive versus package gap, A/B reversal with unchanged original assets, roster-cap constraints, search deduplication and swap selection, evidence tiers, and acceptance/benefit disagreement.
- Deep calculator regression: 100 brute-force lineup comparisons, weekly/future lineup checks, two-manager approval of Even It Out, triple package repairs, bidirectional starter treatment, target matching, two-side cornerstone warnings, and Coach/negotiation consistency.

**Limit:** this was an in-memory JavaScript execution of the actual source with test stubs, not a Node test run on the repository checkout and not a populated real-browser session. It is not an empirical market prediction benchmark.

## Run before final live release

From the Vault checkout, run:

```powershell
git fetch
git switch chatgpt/trade-calculator-four-phase-20261122
git pull --ff-only
node scripts/check-trade-decision-policy.js
node scripts/check-calculator-deep.js
node scripts/check-trade-reliability-pass.js
node scripts/check-trade-stress.js
node scripts/check-trade-stress-ui.js
node scripts/check-trade-mobile-tabs.js
node scripts/check-trade-price-separation.js
node scripts/stamp-assets.js --check
```

Then, with the actual populated league and Chrome/Edge at desktop, phone and narrow-phone widths:

- Build a 1-for-1, 2-for-1, 3-for-1, and player-for-picks deal.
- Reverse manager A/B, preserving the exact assets and comparing the market price and both independent roster benefit results.
- Verify the market-only label can remain Fair while a team verdict is bad; do not suppress that difference.
- Verify Even It Out's alternate offers don't repeat a single piece excessively and that newly found mixed swaps actually apply both add and remove.
- Open Trade Coach with and without manager history; verify evidence labels, warnings, and whether it actually changes the selected trade.
- Switch both teams' timeline overrides independently, then repeat both-direction calculations.
- Change What-if assumptions and verify original grades remain unchanged.
- Check that browser-cache stamps load the new policy and negotiation scripts without runtime errors.
- Exercise trade link sharing, reloading a prior offer, keyboard/mobile tabs, and visual overflow.

Use `node scripts/smoke-trade-flow.js <SleeperLeagueID>` with the local server and Puppeteer configured as described in the README.

## Predictive accuracy is not yet proven

A completed trade is positive evidence of acceptance, but the absence of a trade is not a confirmed rejection. Archived completed trades also lack the historical manager-specific rosters and all declined offers that would be needed to validate per-manager acceptance probabilities. No acceptance percentage should be claimed. For future empirical work, collect opt-in actual offer/result pairs with timestamp, league format, trade shape and manager anonymization, split chronologically by league and manager, evaluate calibration and rejection/acceptance rates on untouched future data, and only then tune live weights.

Retrospective value-preservation comparisons remain separate from manager acceptance and must follow the strict chronology and missing-outcome rules already documented in the repository.

## Release notes

No new asset valuation curve, ranking weights, predictive model or source-of-truth trade grade was added. The known limitations are untested live UI behavior, no complete local Node suite in this remote environment, and no independent acceptance benchmark with rejected offers. Do not mark those as verified.
