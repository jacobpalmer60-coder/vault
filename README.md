# The Vault

Dynasty fantasy football tools for any Sleeper league: https://jacobpalmer60-coder.github.io/vault/

A static site on GitHub Pages. There's no server: pages read Sleeper's public API in the browser, plus
JSON files in `data/` that scheduled GitHub Actions refresh.

## How it fits together

**Pages.** Each `.html` file is one page with its own script inside. `index.html` is the way in: a
Sleeper username leads to a league, and a league id to a team. Every tool needs a league in the address
(`?league_id=`).

| Page | What it's for |
|---|---|
| `app.html` | League Overview. No trade content here, by design |
| `team-analyzer.html` | One team: overview, roster, this season, contend or rebuild |
| `trade.html` | Trade Calculator and Trade Coach, the core of the site |
| `trade_grades.html`, `managers.html` | Completed trades in your league |
| `trade_database.html`, `trade_lab.html` | Trades across all leagues |
| `market.html`, `player_rankings.html`, `compare.html` | Players and prices |
| `playoffs.html` | Playoff Race |
| `how_we_grade.html`, `patch_notes.html`, `status.html` | How it works, what changed, data freshness |

**Shared code.**

| File | Holds |
|---|---|
| `vault-core.js` | The math and shared helpers (`Vault`). **Also runs in Node** for the crawl and nightly update |
| `market-data.js` | Market prices from completed trades |
| `coach.js`, `negotiation.js`, `market.js` | Trade Coach, predicted answers, the calculator's market reads |
| `player-card.js` | Player and team pop-ups from any name |
| `season-report.js`, `timeline.js` | This season, and contend or rebuild |
| `vault-nav.js` | Navigation, your team, notices |

**Data jobs** (`.github/workflows`).

| Job | When | Does |
|---|---|---|
| Update data, full value history | daily | `player-value-history.json` lives on the `data-history` release, not in git; pages read `data/history/` |
| Crawl Sleeper trades | hourly, prices saved about every 6 hours | New completed trades, priced at KTC values of their own day |
| Refresh projections | every 3 hours | Sleeper projections, and injury details on game days |
| Update data | nightly | KTC values, value history, grade prices, slim files, season totals on Tuesdays |
| Market history | Mondays | Long-run market files |
| League pull | every 6 hours | Encrypted league data for research |
| Check site code | on push | `vault-core.js` still runs in Node, and the math hasn't moved |

**Research** lives next door in `../VaultValues`: local only, and only aggregates reach the site, through
scripts like `build-trade-lab.js`. Readable team data stays on the computer.

## Working on it

Rules that have bitten before:

- **`vault-core.js` runs in Node too.** Browser-only code at the top level stops the crawl. Use
  `globalThis.x?.()`, and run `node scripts/check-core-loads.js`.
- **The math has a saved test.** `node scripts/check-math.js` shows anything that moved. After a change
  you meant, run it with `--update`.
- **Tailwind is pre-built.** After changing classes, run
  `npx -y tailwindcss@3 -i tailwind.src.css -o tailwind.css --minify`. No class names built at runtime.
- **Asset stamps.** `node scripts/stamp-assets.js` before committing, or browsers keep the old files.
- **Words have one meaning.** New labels go in `Vault.GLOSSARY`, shown with `Vault.term` or `Vault.info`.
- **Names and teams.** Use `Vault.playerLink`, `Vault.teamLink`, `Vault.teamLabel` and `Vault.findSleeperId`.
  Team names only come through `Vault.teamLabel`, which is the security fix for names with script in them.
- **Trade values are relative.** `tradeSideValues` totals are never shown. Suggested trades pass
  `negJudgeFor`.
- **Every visible change** gets a plain-language line in `patch_notes.html`, and `how_we_grade.html` has
  to stay true.

## Long-term trade-value research

Run `node scripts/diagnose-value-aggregates.js` to reproduce the published
retrospective diagnostic from the checked-in Player Market, research insights,
and proof data. The saved November 17 output is
`data/market-history/value-diagnostic-2026-11-17.json` (428 player records
with 3.58 million headline-trade observations; **not** independent examples).
It documents existing weaknesses and is **not** a new full raw-data run.


Run `node scripts/benchmark-future-values.js` to compare the unchanged-value baseline
with a position/age model trained on 2022-2023 outcomes and evaluated on 2025 origins
with full one-year follow-up. The existing age curve is shown only as a **retrospective**
reference: it was built using 2026 data and must not be treated as independent
holdout evidence. The benchmark reports errors both excluding missing one-year prices
and treating them as zero, because an absent KTC listing cannot always prove the
asset became worthless. It also has survivor bias: the current player catalog is
needed to recover historical ages. Run with `--write` only when you deliberately
want to save the dated benchmark snapshot.

`node scripts/check-historical-outcomes.js` validates preservation of zero-value
pieces and mirror outcomes. The corrected Player Market one-year results require a
rebuild from the archived raw Sleeper transactions:
`node --max-old-space-size=6144 scripts/market-history/build-player-history.js`
after restoring the `sleeper-trades` release assets to `data/sleeper-trades/`.
Do not update live valuation weights based solely on this benchmark: it studies
historical player prices, not team strategy, acceptance probabilities or trades
that never happened.

### November 17: follow-up analysis (no live math changes)

The next diagnostic separates **confirmed zero** follow-up values from **unknown**
ones, because a missing player price cannot prove a complete loss. The
completed-trade script now shows both **strict complete-case** and **missing
as zero** sensitivity results and groups them by year, calendar quarter/month,
scoring format, trade shape, largest asset's position and original raw-value gap:

```powershell
cd "$env:USERPROFILE\Desktop\vault"
git pull
node scripts/check-historical-outcomes.js
node --max-old-space-size=6144 scripts/benchmark-trade-value-outcomes.js *> trade-cohorts.txt
node scripts/benchmark-rebuild-horizon.js *> rebuild-horizons.txt
node scripts/summarize-value-research.js > research-summary.txt
```

The forecasting tests now enforce **strict as-of outcome availability** for
every test month: an origin from 2021 whose 3-year result is not known until
2024 cannot train a prediction made in 2023. The old 3-year result therefore
had temporal leakage and must not be quoted as a clean holdout. Run
`node scripts/check-rebuild-forecast-chronology.js` to validate chronology,
zero-versus-missing prices, and format isolation. Inspect each horizon's
`trainingCoverage` and `groups.formatAndPosition`; especially the 3-year
forecast's early-2023 months may have very few available training outcomes.
**Do not promote this forecast based on the old benchmark output.**

The rebuilding experiment evaluates price preservation after **1, 2 and 3
years**, with earlier-year training and later-year evaluation and breakdowns
by position, age and league format. It measures **players only**: picks,
original rebuilding-team rosters and manager decisions are not represented,
so it must not be advertised as a rebuild-success prediction.

The Market History builder now omits trades with unknown later prices from
its complete-case player summaries; true observed zeros still count. Rebuild
its published aggregates using the raw trade archive before claiming the
published win rates incorporate this change. The original 2024/2025 reversal
is descriptive and may be affected by season mix, pick conversion,
different follow-up coverage and overlap with the curve's training data.

To compare **completed trade packages** rather than individual player values, restore
the same archive and run
`node --max-old-space-size=6144 scripts/benchmark-trade-value-outcomes.js`.
It deterministically samples roughly one in ten trades by ID; set `SAMPLE_MOD=1`
to process the full archive. The output compares Vault's trade-price winner with
the raw KTC-sum winner against one-year-later asset value, with separate counts
for missing later prices. This is a *retrospective diagnostic*, not a
true untouched holdout: some of those completed trades informed Vault's
existing trade-price curve. Do not make claims of improvement until an
independent prospective split is available.

To check every page before pushing, see the top of `scripts/smoke.js`.
