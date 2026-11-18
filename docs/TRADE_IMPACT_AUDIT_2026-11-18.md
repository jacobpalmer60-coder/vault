# Trade impact and pick valuation audit — November 18, 2026

## Scope and baseline

Reviewed `trade.html`, `vault-core.js`, `coach.js`, `negotiation.js`,
`market-data.js`, and the deep calculator tests. The existing app already
has a **two-sided simulation**: `Vault.simulateTrade` removes and adds actual
players and picks for both teams; recalculates each side's player value,
pick value, total value, optimal lineup, VORP, archetype/standing, and
contention window; and holds all third-party league rosters fixed.
`trade.html` already displays both teams' individual verdicts, lineup
PPG, windows, season title odds, and future *player lineup* ranks.

### Finding: impact facts were fragmented

The detailed per-side cards did not place today's **player value, draft
capital, and total team value** alongside lineup PPG in a common,
both-teams-symmetrical before/after ledger. Users could reasonably mistake
projected future lineup rank for an overall dynasty ranking that includes
future draft picks.

### Fix delivered

- Added `team-impact.js`, a side-neutral, deterministic summary of the
  existing authoritative before/after snapshots. It does **not** calculate
  or replace fair market trade pricing.
- Integrated `VaultTradeImpact.pair` into **both** existing side cards.
  Each now presents the same four before/after measures: total team value,
  player value, draft capital (at today's prices), and optimal lineup PPG.
- Clarified that 1-, 2-, and 3-year *future rank* means the projected
  **player starting-lineup value rank** rather than a complete total-team
  or championship forecast. The original projection neither forecasts
  draft-pick rookie returns nor changes unrelated rosters.
- Added `scripts/check-team-impact.js`: side A/B reversal symmetry,
  player/rookie-pick value conservation, draft pick count, zero transfer,
  unchanged roster and lineup delta behavior. Executed the test in the
  connected code environment and confirmed passing results.
- Parsed `trade.html`'s main inline script after modifying it; syntax
  passed. Browser end-to-end rendering was not executed in this environment.

### Important limitations; no unsupported claims

- The **current draft-pick price** is not a forecast of future rookie
  production or a probabilistic expected payout.
- The forecast benchmarks still match past players to today's KTC catalog
  and have survivorship limitations. The corrected three-year as-of
  training sample was sparse in early 2023.
- `Vault.futureLineupValue` projects player values from age curves;
  historical draft capital is not reinvested into unknown future players.
- Team title-odds and future lineup-rank calculations are separate
  quantities and should never be aggregated as though they were calibrated
  outcomes of a joint dynasty Monte Carlo simulator.
- Existing `Vault.tradeSideValues`, `Vault.blendedFairness`, and
  `Vault.tradeValueRatio` remain unchanged. Neither side gets a special
  valuation rule because it is the user's team.

## Next research before a validated future-pick model

Time-align historical pick ownership, selections/rookies and future outcomes
to estimate round and slot-level rookie distributions. Separate
pre-draft pick prices from after-draft player returns. Reserve an untouched
chronological season for final testing, keep missing price distinct from
observed zero, and stratify by Superflex, 1QB and TEP. Do not publish a
precision estimate for future pick value until such a model has been tested.

## Regression commands

```powershell
cd "$env:USERPROFILE\Desktop\vault"
git pull
node scripts/check-team-impact.js
node scripts/check-calculator-deep.js
node scripts/check-historical-outcomes.js
node scripts/check-rebuild-forecast-chronology.js
```
