# Valuation model tournament (2026-11-26)
Research-only. No live pricing, roster fit, negotiation or historical grade changes.

## Design
- Six independent QB/TE-premium format reports. Training evaluation is March–December 2024 on non-held-out league-season keys; test evaluation is August–December 2025 on held-out keys. Selection only on training MAE.
- All evaluated assets use KTC as of the preceding UTC day (backward-only, seven-day maximum source age). Picks require the exact year/round and use mid-round prices. Current metadata name collisions are excluded.
- Prior 45 calendar days of non-held-out completed trade evidence only. No same-day comparisons. Deduplicate transactions and avoid treating a repeated round token as multiple observations. Main-piece premiums reflect additive side cost ratios; comparable asset prices must be within a factor of 1.5.
- Deterministic default sample: 1/5 of eligible evidence and 1/10 of evaluation transactions. Sample count is not an independent trade count; recency-discounted count is only a heuristic. Other QB-matched TE formats may supply fallback evidence, unless a candidate requires exact format.
- Twenty prespecified candidates: raw KTC, lagged reconstructed Vault archive comparator, rolling full premium, caps, count shrinkage, weighted medians, combined variants and a separate pick prior. Four package exponents reported separately; not used in candidate selection.
- Reports contain coverage, paired league-cluster intervals, package/asset-type/month breakdowns and explicit insufficient-evidence statuses. An apparent retrospective winner cannot publish prices.

## Promotion gates
1. Retrospective candidate beats both raw and archived price agreement on identical held-out rows, with sufficient sample and exploratory paired interval.
2. Investigate major player/pick discrepancies in the separate KTC/Roster Audit/Dynasty Daddy provider reports. Provider values are not historical ground truth; no FantasyCalc integration.
3. Build the same candidate on full current trade evidence and freeze its prices before future transactions. Compare on sealed append-only prospective snapshots; test all formats, trade shapes and low-liquidity assets, and check subsequent market-value retention separately.
4. Evaluate roster utility independently (completed-trade parity is not utility or acceptance). No automatic deployment. If evidence is inadequate, retain existing production basis.
5. Only then publish a shared pricing table; verify calculator, coach, manager analysis, trade history, rankings and browser parity.

Limitations: historical KTC series and historical Vault premiums are reconstructed; current metadata can introduce survivorship bias. League-season keys may not link successor leagues. Completed trade agreement cannot establish fair prices, rejected-offer probability or fantasy outcomes. No historical external snapshots for competitors are assumed. Package diagnostic is a simple shape comparison, not a league-depth/replacement-value model.
