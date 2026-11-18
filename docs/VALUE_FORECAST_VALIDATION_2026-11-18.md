# Dynasty value validation — November 18, 2026

## What was actually executed

User ran the full local benchmark against compressed 2024–2026 Sleeper trade
archives, resulting in a 10% deterministic sample of 374,190 trades,
300,878 mature trades, and 299,824 complete follow-ups after missing-price
reclassification. The corrected historical outcome regression suite passed.

### Completed-trade diagnostic: same-month comparison

| Period | Completed decisions | Vault agreement | Raw KTC agreement | Vault margin (pp) |
|---|---:|---:|---:|---:|
| 2024 Q1 | 14,163 | 60.95% | 61.96% | -1.01 |
| 2024 Q2 | 36,897 | 66.47% | 67.76% | -1.29 |
| 2024 Q3 | 34,740 | 63.56% | 65.95% | -2.39 |
| 2024 Q4 | 43,640 | 64.25% | 66.03% | -1.78 |
| 2025 Q1 | 17,052 | 67.21% | 66.03% | +1.19 |
| 2025 Q2 | 54,996 | 71.63% | 69.23% | +2.40 |
| 2025 Q3 | 53,024 | 69.16% | 64.95% | +4.21 |
| 2025 Q4 | 45,279 | 68.29% | 64.34% | +3.95 |

Vault leads in every 2025 quarter and trails in every 2024 quarter;
thus the reversal is not explained solely by quarter-of-year mix.
These are **retrospective accepted-trade direction agreements**, not
independent performance or future manager acceptance probabilities.

### Earlier *unembargoed* player-forecast run (NOT deployment evidence)

| Horizon | Baseline MAE | Trained model MAE | Test origin | Status |
|---|---:|---:|---|---|
| 1 year | 704 | 672 | 2025 | Earlier training matured before test year; subject to survivorship |
| 2 years | 1,039 | 964 | 2024 | **Invalid as time-safe**: some 2022 outcomes mature during 2024 |
| 3 years | 1,406 | 1,206 | 2023 | **Invalid as time-safe**: 2021 outcomes mature during 2024 |

Under-24 in the original three-year run worsened from 1,374 to
1,419 MAE. This cohort regression is another reason not to
automatically replace the existing 3-year age curve.

## Corrective validation work

- Added `scripts/market-history/forecast-training.js` with an
  **outcomeDate strictly earlier than prediction origin** eligibility rule.
- Added `scripts/check-rebuild-forecast-chronology.js` with synthetic
  tests for as-of cutoff, missing outcomes, known zero outcomes, format
  isolation and order invariance. The tests were executed successfully.
- Updated `scripts/benchmark-rebuild-horizon.js` to refit once per test
  month using only time-eligible outcomes and disclose `trainingCoverage`.
- Synthetic end-to-end forecast smoke testing showed early 2023 has zero
  usable 3-year training samples while later months accumulate more.
  This **does not measure accuracy** against the actual historical archive.

## What is not established

A fully sealed chronological trade-pricing holdout; complete historical
player coverage (the player dataset is joined to today's catalog);
a validated pick-value forecast; a genuine reconstructed contending or
rebuilding roster test; and statistically independent player observations.
None of those claims should appear on the public site as achieved.

### Deployment decision

**Do not replace Vault's current trade-side valuation or rebuild
forecast** on the current evidence. First rerun the corrected horizon
script locally and review errors by age, position and scoring format,
especially the size of the eligible historical training sample.
