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

To check every page before pushing, see the top of `scripts/smoke.js`.
