# Package valuation tournament — November 26, 2026

The preceding confidence-25 tournament compared additive KTC inputs with archived
Vault and rolling market prices. It did not establish superiority to KTC VBA.
This follow-up uses Vault's existing local ktcVerdict reconstruction as an
explicit baseline; no new provider API or scraper. Historical base prices are
blended proxies, pick slots are mid-round proxies, and the VBA reference ceiling
is approximated from the preceding day's matched historical player universe.
No claim of an official KTC historical quote.

## Prespecified research
- Same complete rows for all 15 models: raw additive, estimated VBA, archived
  Vault additive, confidence-25 additive, raw and confidence power curves
  (1.1, 1.25, 1.5, 2), confidence secondary-piece discounts (10%, 25%, 50%).
- March–December 2024 training on non-held-out league keys. January–October
  2026 evaluation on held-out league keys. Only earlier-day, non-held-out
  completed trades may contribute to rolling confidence premiums. 1/5 evidence
  sampling and 1/10 evaluation sampling, frozen for this experiment.
- 2026 has previously been examined for other Vault models. This is not a
  globally untouched validation period. No promotion based on retrospective
  agreement alone.
- Select on training mean absolute symmetric imbalance. Report identical-row
  test metrics, league-cluster intervals and breakdowns by shape, asset type,
  star band and month. Compare with all four baselines. A candidate needs
  sufficient evidence and improvement over confidence additive, estimated VBA,
  raw additive and archived Vault before even entering a fresh shadow test.
- Confidence premiums are fitted to additive side ratios. Applying a package
  discount may double-count concentration. The additive baseline remains
  eligible; a curve is not guaranteed to win.
- Both independent package functions preserve a single asset's value and never
  decrease the same side's price when a positive asset is added.
- No strategic, roster, age or manager-acceptance weights are changed.
  Historical roster and lineup constraints are unavailable in the trade-only
  archive. League size alone is not an actual free roster slot count.

## Before production
Require a new frozen prospective package evaluation, separate year-later
asset-retention or return checks, sensitivity to low-liquidity prices, coverage,
and actual roster-slot/replacement analysis where valid. Completed-trade
imbalance is descriptive and cannot establish fair value or causality.
Respect data-provider usage permissions; no new data collection is authorized
by this research. No automatic rollout and no changes to existing shadow model.

Run locally with existing 2024/2025/2026 archives under data/sleeper-trades:
`node scripts/check-package-tournament.js`, then
`BENCHMARK_FORMAT=sf node --max-old-space-size=5632 scripts/benchmark-valuation-tournament.js --packages`
(or set the environment variable in PowerShell). GitHub Actions performs the
same six-format replay. No private league data or private runner is needed.
