# Vault: all-team consistency and browser acceptance

**Scope:** Every manager and original draft pick, not just the user's saved team.

## Central contracts
- Trade price and each manager's roster verdict are distinct. The live additive-market basis stays authoritative; historical package curves remain archival.
- Completed transactions are never filtered out of **League Activity** because a price could not be determined. The other manager receives the same event; transaction IDs are deduplicated.
- A failed Sleeper transaction week is unknown, **not zero trades**. The loaded-week count and missing week IDs are shown.
- Historical team names come from that season's Sleeper rosters/users. A new owner is not automatically credited with a prior owner's deal.
- Value Over Time marks trades for every manager in the chart's series; the saved team only changes highlighting.
- Draft Center computes each pick's **original-team** slot while showing its independent current holder; changing holders cannot change the pick's original selection position.
- Non-playoff MPF, playoff placement, manual commissioner overrides and future-year projections are explicitly labeled. A partially played bracket yields an elimination range where possible, not an invented final pick.

## Cross-page coverage
| View | Default | Other-team contract |
|---|---|---|
| League Overview and Value Over Time | All teams | Every team plotted; trade markers included for all trading participants |
| Team Analyzer | Saved team | Team picker and query parameter work for every team; same calculations |
| Draft Center | All teams | MPF, holdings, original pick owners; manual rule changes apply league-wide |
| League Activity | All teams | Filter any manager and any linked season; original transactions remain visible |
| Trade Grades | All graded trades | Manager filter; missing prices surfaced rather than counted as successful grades |
| Managers | Every manager | Activity, paid premiums and graded records remain symmetrical |
| Trade Calculator / Coach | Your team and partner | Two independent verdicts and shared market prices, not arbitrary unequal discounts |

## Automated evidence
`node scripts/check-leaguewide-parity.js`, `node scripts/check-manager-record-parity.js` and `node scripts/check-draft-activity.js` cover marker parity, manager records, original-vs-current pick ownership, playoff brackets, missing MPF, 3RR/snake, missing transaction weeks, pending versus completed, duplicates and team selectors. The browser fixture workflow covers 320/390/768/1280px.

## Not independently verified by fixtures
Physical iOS Safari, Android Chrome, real league commissioner draft rules, live historical Sleeper edge cases, full site accessibility with assistive technology, and market-model chronological calibration. These require actual-device and real-league acceptance; no automated fixture can certify them.

Official source references: https://docs.sleeper.com/ (rosters, transactions, winners bracket, traded picks).
