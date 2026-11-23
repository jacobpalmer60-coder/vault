# Vault site-wide follow-through — November 22, 2026

## Shipped
Merged [PR #15](https://github.com/jacobpalmer60-coder/vault/pull/15) into `main`.
- New Draft Center: all teams' Sleeper Max Points For, pick ownership (origin versus holder), draft capital and season filter; no fabricated official draft order
- Proof page separates current additive-price diagnostic evidence from archived previous-model calibration
- Player Market splits rising/cooling from peer highs/lows
- League Overview and Player Market charts accept touch; league value chart also supports keyboard navigation and focusable manager legend
- Shared phone text and controls improved
- Managers/Trade Grades use bounded (8 concurrent) week requests, one retry, progress updates and missing-week disclosure
- Content-addressed asset stamps synchronized across every HTML page

## Must verify in the user's real Windows checkout
```powershell
cd "$env:USERPROFILE\Desktop\vault"
git switch main
git pull --ff-only
node scripts/check-sitewide-quality.js
node scripts/check-manager-trade-freshness.js
node scripts/check-market-price-rollout.js
node scripts/check-calculator-deep.js
node scripts/check-core-loads.js
node scripts/stamp-assets.js --check
```
The branch implementation was syntax-checked for all 21 HTML pages; a 38-week synthetic transaction test recovered a transient error, retained a persistently failed week, and reached 8 simultaneous requests; simulated Draft Center exercised real pick ownership data shapes. **This is not a substitute for full Windows Node, actual Sleeper responses or device browser QA.**

## Priority 0 — acceptance and real-data correctness
- Verify a recent completed trade on *both* managers' pages, including unpriced or formerly unmapped historical trades, duplicate week entries, and pending transactions
- Test draft picks from actual dynasty leagues, including 2027/2028 traded picks and missing player values. Confirm Sleeper `ppts/ppts_decimal` matches MPF displayed in Sleeper
- Browser acceptance at 320, 390, 768, 1280 and 1440 px; touch, keyboard, screen reader, dynamic charts, dropdowns, Trade Coach, modal focus and no horizontal overflow
- Check published GitHub Pages assets have the latest SHA1 stamps; error and loading states remain clear
- Do not present retired model tiers or retrospective prices as independent proof of today's current additive trade model

## Priority 1 — all-team consistency, UI, performance
- Audit every page for the same calculations whether the user selects their own or any other league team. Pay special attention to Value Over Time trade markers, manager counts, player charts, league standing links, picks, trade history and playoff scenarios
- Profile long-running league transaction requests and season replay: time to first useful content, cache hit rates, missing weeks and API rate limits
- Unify page state for freshness, partial coverage, retry and offline errors; unknown values must never silently become zero or empty activity
- Improve shared UI hierarchy and accessibility for every tab group; standardize page summaries, chart legends/touch affordances, table density and large-screen layout
- Add contextual bridges: manager to a calculator with that partner, player value to trade evidence, draft pick owner to manager/team analysis

## Priority 2 — major features
- Commissioner-configurable rookie draft rules: MPF among non-playoff teams, playoff elimination-round locks, traded-pick origin/holder, and snake/linear/3RR settings; label projections separately from confirmed results
- League-wide activity timeline for every manager: trades, acquisitions, drops, draft selections and roster changes; link completed trades to Trade Grades
- Calibrate live additive price-grade cutoffs and manager negotiation with untouched chronological manager/league-aware evaluations, including declined offers where opt-in data exists. No invented acceptance probabilities

## Release definition
Do not mark the remaining work shipped until there is evidence from real leagues and populated browser sizes, not only source or stub tests. Preserve symmetrical results for both teams and keep source data/estimation/model confidence distinct.
