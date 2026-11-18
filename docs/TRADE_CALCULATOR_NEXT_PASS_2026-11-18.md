# Trade Calculator next pass — 2026-11-18

## Delivered in code

**Both-team explanation.** The existing engine already recomputes the
participating roster's current player value, pick value, total assets,
optimal PPG, depth, and window. The same `VaultTradeImpact.pair` is used
for team A and B. `VaultTradeImpact.explain` now produces a consistent,
short plain-English read for *each* manager using only calculated data:
lineup points, players, and current draft capital, plus context about
contending or rebuilding. These are facts, not predicted acceptance.

**Phone usability and accessibility.** The four trade tabs now use
`aria-controls` mapped to real regions, roving `tabIndex`, and keyboard
navigation with ArrowLeft, ArrowRight, Home, and End. The new helper has a
versioned browser script tag to avoid cached logic. Two tests cover this:
`node scripts/check-trade-mobile-tabs.js` (keyboard behavior) and
`node scripts/smoke-trade-flow.js <SleeperLeagueID>` (populated trade
and overflow at 1280, 375, and 320 CSS-pixel widths).

**Historical rookie research.** New `scripts/benchmark-rookie-pick-outcomes.js`
and `scripts/summarize-rookie-pick-outcomes.js` observe historical
one-year KTC outcomes for distinct drafted rookies by season, format and
round. Every season/format/rookie ID contributes at most one observation
regardless of how many leagues drafted him. Missing values are reported
separately. Outcomes include quantiles (p10, p25, median, p75, p90),
observed count, missing count, and pre-draft mid-pick reference prices.


## November 18 local-results audit and rookie-cohort correction

The local run reported **134,358 eligible spring drafts** and **18,468
distinct season/format/player identities**, but a large majority of
observations had no one-year KTC price, and the pre-draft price column was
unavailable for every format. Those aggregates must **not** be used to set
draft-pick valuations. Selection in a March–August league draft does not
establish that a selected player is an NFL rookie; startup and supplemental
drafts can include veterans.

The benchmark now requires an explicit Sleeper NFL draft/rookie year equal
to the spring draft season, in addition to QB/RB/WR/TE eligibility. Veteran,
unverifiable, missing-player and non-fantasy selections are counted as
exclusions. Without verified rookie-year metadata, an observation is
excluded rather than accepted as a rookie. This is an intentionally
**conservative filter**: if the stored Sleeper metadata does not contain a
draft or rookie year, the benchmark can have zero usable cohorts. A zero
cohort is a clear blocker, not a reason to silently revert to the old
mixing rule.

The per-round distribution remains **research-only** because historical
pre-draft pick-price snapshots are absent in the existing local outcome
summary and league draft type is not yet reliably identified. Exact draft
slot and the owner's return remain unvalidated. No live trade, draft pick
or team valuation was modified.

## What has been tested

- JS syntax for new analysis, tests and modified calculator inline script.
- Isolated test fixtures verifying duplicate rookie selections, observed
  zero outcomes, and true missing prices.
- Pure two-team impact invariance when teams A and B are swapped; ledger
  preservation and plain-language parity.
- Simulated DOM tab behavior and keyboard arrow wrapping.

**Full browser smoke and the full draft archive research run have not
been executed in this environment.** They require a browser connected to
an actual league and the historical compressed draft archive. Do not
claim all live device states or numerical pick distributions are verified
until those runs complete.

## Key limitations and safeguards

- Drafted-player one-year KTC price is not the same thing as one-year
  on-field fantasy points. Neither is a final rookie-value model.
- One observed rookie's unique outcome is not an independent sample
  of all picks across the many leagues that selected him; repeat
  selections are not counted as independent evidence.
- Round-level research is not slot-level prediction. The dataset does not
  yet establish each draft's 1.01, 1.02, ... within-round probabilities.
- Pick pricing should not use future player outcomes as though they were
  known on trade day, and missing values must not become automatic zeros.
- Actual league roster ownership, contender/rebuilder states and the
  NFL production outcomes need separate historical reconstruction.
- Existing live `Vault.tradeSideValues`, team modes, championship
  projections and historical age curve have not been changed.

## Next decision gates

A calibrated future pick model should be based on a prior-period training
set and a later untouched holdout, be evaluated separately by 1QB, SF
and TEP, preserve unique observation units, disclose the risk of missing
outcomes, and refrain from presenting deterministic rookie values.
The test should demonstrate reliability by round *and* slot before any
precision is displayed in the live calculator.

Commands for local Windows verification:

```powershell
cd "$env:USERPROFILE\Desktop\vault"
git pull
node scripts/check-team-impact.js
node scripts/check-trade-mobile-tabs.js
node scripts/check-calculator-deep.js
node scripts/check-rookie-pick-outcomes.js
node --max-old-space-size=6144 scripts/benchmark-rookie-pick-outcomes.js > rookie-outcomes.json
node scripts/summarize-rookie-pick-outcomes.js rookie-outcomes.json > rookie-summary.txt
Get-Content rookie-summary.txt
```

The existing `scripts/smoke.js` still supports site-wide phone and
desktop smoke checks. Run the additional trade-flow browser smoke with
real league ID after serving the repo locally.
