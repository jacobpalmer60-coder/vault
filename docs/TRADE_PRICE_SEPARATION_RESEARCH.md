# Trade valuation separation — research prototype (November 2026)

**Not deployed.** The live Trade Calculator, Even It Out, Trade Coach, and
manager-acceptance predictions have not been reweighted. All research code
lives in `scripts/`, not in browser-loaded modules.

## Four independently reported questions

1. **What are the pieces worth today?** Add each received asset's price,
   per side, and display an unadjusted two-sided percentage. This is the
   current-market-price baseline, not a prediction of which manager wins.
2. **How does consolidation change the package?** Show Vault's existing
   nonlinear package comparison separately, along with the percentage-point
   difference from additive market prices. Do **not** silently add this
   adjustment to underlying prices or call it guaranteed future value.
3. **What happens to each team's roster?** Use authoritative **before/after
   snapshots** for both managers: projected starters, depth, roster fit, and
   respective contend/rebuild windows. The research module requires explicit
   results from a roster simulation; if missing, prints **NOT MEASURED**.
   Historical completed-trade archives used here do **not** reconstruct
   historical team rosters, so **no historical roster benefit is inferred**.
4. **Would each manager plausibly agree?** Preserve independent manager
   acceptance/negotiation judgments for **both** sides. Do not derive
   willingness to accept from prices or from future return comparisons. If
   missing, print **UNKNOWN**.

The `assessment` helper emits no overall recommendation unless both
teams have supplied roster and acceptance evidence. Even then, it returns
the evidence for review, not a synthetic combined score.

## Historical research

`benchmark-separated-trade-pricing.js` uses the same historical archive,
ID-stable sample, 365-day maturity rule and independent additive KTC future
label as `benchmark-trade-value-outcomes.js`. It compares the **trade-day
price direction**, with weight zero = additive price and weight one = Vault's
existing consolidation adjustment. Intermediate, **predeclared** weights
(0.1, 0.25, 0.5, 0.75) are research sensitivity checks, not automatically
chosen live coefficients. It reports 2024 and 2025 separately, plus
player-only package shapes to exclude round-average pick return proxies.

**Limits:** Completed trades only, no rejected offers; historical team
snapshots are missing; and Vault's consolidation curve may already have been
calibrated against overlapping trades. Separating calendar years does not
create a sealed holdout. A high match rate to later KTC prices does **not**
prove better roster outcomes, title odds, or actual trade utility.
Performance metrics may have repeated players/trades across leagues.

## Commands (run from Vault root)

```powershell
node scripts/check-trade-price-separation.js
node scripts/review-trade-separation.js docs/trade-separation-example.json
node --max-old-space-size=6144 scripts/benchmark-separated-trade-pricing.js > separated-pricing.json
node scripts/report-separated-trade-pricing.js separated-pricing.json > separated-pricing-report.txt
Get-Content separated-pricing-report.txt
```

The example is synthetic, with no roster or acceptance evidence. To explore
a specific trade, prepare another JSON file with `sideA` and `sideB`
arrays containing the assets **received** by each manager and their current
`value`; optionally include `rosterImpact` and `acceptance` with *both*
`A` and `B` keys, obtained from real simulation/negotiation calculations.

## Criteria before any live change

- An untouched chronological **and manager-aware** evaluation must show
  improvement in the declared primary objective, not simply a retrospective
  improvement on the same source used for calibration.
- Compare one-for-one, 1-for-2, 2-for-3, balanced package shapes; exclude
  unmeasured pick returns in a separate player-only analysis.
- Do not sacrifice roster-fit, lineup impact, timeline correctness, or
  predicted counterparty willingness for a better market-price match.
- Both teams receive the same evaluation rules, independently applied.
- Run the calculator deep checks, trade-stress checks, phone tabs, research
  checks and populated desktop/phone browser smoke before deploying.

**There is no automatic deployment or parameter update in this work.**
