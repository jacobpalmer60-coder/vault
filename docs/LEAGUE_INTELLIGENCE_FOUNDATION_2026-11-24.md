# Vault league intelligence foundation

## First implementation
- Price coverage: each skipped in-format trade records exactly one combination of missing historical player price, missing player metadata, missing pick price, or empty non-negligible side. Counts reconcile by year and format; no changes to price eligibility or live weights. The current Trade Lab facts expose these aggregate diagnostics after a successful six-format rebuild. Legacy snapshots explicitly say not measured. Records with no recognized league format are outside the existing market count and this diagnostic.
- Shared pure browser/Node prototype: normalized as-of inputs (starter PPG, priced player value, priced pick value, value-weighted age, complete evidence flag), unique roster IDs, symmetric peer ranks and neutral handling of ties. Complete cohort required; no missing values treated as zero. Four-plus teams required.
- Archetypes are provisional descriptive labels from explicit thresholds, NOT inferred intent, calibrated predictions, or an override to current teamMode. A roster can change classification without the manager changing plans. No UI integration or historical outcome training yet.

## Next gates
1. Verify new production coverage from real six-format runs. Audit archive rows missing league format independently.
2. Measure snapshot completeness from collector receipts and decrypted private data on the research computer. Never publish IDs, roster snapshots or private keys. Current collector knows league hashes, not historical roster truth. Today's snapshot may not substitute for the state before an older trade.
3. Add adapter from existing Vault league-team data and test live leagues across scoring formats, roster completeness, season phases, and both selected/unselected teams.
4. Build as-of historical features only when the private snapshots establish pre-trade chronology. Hold out future periods and leagues for outcomes; benchmark against current team mode and naive baselines. Reject offers and inferred acceptance remain unvalidated.
5. Add manager tendencies with sample size and missing data, then trade finder using separate market price and both-team roster benefit. No change to current price or recommendation weights before evaluation.

The snapshot collector remains unified and rate limits/privacy unchanged. No new public raw dataset.
