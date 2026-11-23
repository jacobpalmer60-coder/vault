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

## Why we're isolating near-equal lead-player trades (Nov 22)

In the live Skat Pack / TURBONUTZ case, Boston + Kiner for Kittle has
about a **35% additive market-price gap** but only a **1.4% package gap**.
Kiner is worth ~1,863 individually but adds only ~37 to this particular
package's modeled ratio. The same extreme suppression appears in controlled
synthetic two-for-one packages when the two best pieces are within 5%:
a 4,500 piece + 1,800 piece vs. 4,275, for example, gives the
1,800 secondary piece a modeled incremental contribution of ~32 (1.8%).
This is a **systemic behavior of the existing fitted curve**, not an
isolated missing-value or rounding error.

The benchmark below now adds 2-for-1, **player-only**, trade-day-defined
cohorts. It reports all 1-for-2 trades; lead pieces within 5%, 5-15%,
or more than 15% apart; and near-equal lead packages where the smaller
piece is at least 25% or 40% of the larger bundled piece. All cohorts
are evaluated **twice**: pooled and separated by trade year.
Overlapping cohorts are explicitly not independent samples.

Each cohort compares current additive price, partial consolidation,
and full Vault consolidation **against the additive KTC price direction
365 days after the completed trade**. The ranking answers one narrow
question: *which trade-day price direction agrees more often with the
subsequent market price direction?* It does not answer lineup value,
playoff chances, whether the offer was fair, or whether a manager
would have accepted a different offer. A completed-trade-only dataset
does not reveal rejected packages, and overlapping model-training
trades cannot serve as a sealed holdout.

The current model weights should **not** be automatically changed
based on this diagnostic. The result can identify how much additional
independent data and scrutiny are necessary before modifying the
live grade.

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

## Large-archive performance and progress

The original benchmark loaded multiple historical price books and inflated
whole archive years, then created an additional `Object.entries()` copy of
the entire trade index and retained all trade IDs, including the 90% excluded
by `SAMPLE_MOD=10`. On a large Windows checkout this can cause substantial
memory pressure and a long silent wait. The benchmark now walks the index
without duplicating it, samples IDs *before* storing them for deduplication,
and logs file loading, format-book loading, sampled trade counts and memory
usage to **stderr**. The JSON output redirected to stdout stays valid.

**Start with a focused diagnostic, not the full archive:**

```powershell
$env:SAMPLE_MOD = "25"
$env:BENCHMARK_YEAR = "2025"
$env:BENCHMARK_FORMAT = "sf_tep"
$env:NEAR_PEER_ONLY = "1"
node --max-old-space-size=6144 scripts/benchmark-separated-trade-pricing.js > separated-pricing-focused.json
if ($LASTEXITCODE -ne 0) { throw "Benchmark did not complete" }
node scripts/report-separated-trade-pricing.js separated-pricing-focused.json > separated-pricing-focused-report.txt
Get-Content separated-pricing-focused-report.txt
```

This is a *small, 2025-only Superflex/TE-premium player-only two-for-one
sample* (roughly 4% of eligible trades). The report labels these restrictions.
It is intended to check whether the research completes and provides plausible
data **before** broader runs. It may not contain enough near-equal packages
for statistically meaningful conclusions. Progress can pause during synchronous
decompression or historical price-book construction; if the same stage shows
zero CPU and no I/O for a prolonged period, stop and diagnose before retrying.
After successful smaller runs, clear the filter environment variables to run
the broader historical comparison.

```powershell
Remove-Item Env:BENCHMARK_YEAR,Env:BENCHMARK_FORMAT,Env:NEAR_PEER_ONLY -ErrorAction SilentlyContinue
```

## Commands (run from Vault root)

```powershell
node scripts/check-trade-price-separation.js
node scripts/review-trade-separation.js docs/trade-separation-example.json
node --max-old-space-size=6144 scripts/benchmark-separated-trade-pricing.js > separated-pricing.json
node scripts/report-separated-trade-pricing.js separated-pricing.json > separated-pricing-report.txt
# The report now includes near-equal lead-player 2-for-1 groups, by 2024/2025.
# Check exact classification and synthetic benchmark before a large archive run:
node scripts/check-trade-price-separation.js
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
