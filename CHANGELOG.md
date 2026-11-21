# Changelog

Releases of this repository, newest first. Each release is one commit and
one tag on [TrelliumOrg/matchbox-v2](https://github.com/TrelliumOrg/matchbox-v2).
Changes to the public Matchbox API, the SDK and Matchbox Developer are
listed in the API changelog on the docs site
([packages/docs/content/developer/changelog.md](packages/docs/content/developer/changelog.md)).

## v1.1.0 (21 Nov 2026)

- Matchbox Pro shows a wallet's whole history. Activity and Rewards page
  back to the wallet's first epoch with "Show earlier epochs", from a
  stored history the jobs Worker fills from the warehouse.
- Matchbox Pro values each claim at the price on the day it was claimed
  (CoinGecko daily history for BTC and MEZO, pegs by registry address),
  "Earned" uses that value, and Activity and Rewards have a CSV download
  of the whole history. A claim in its first three days shows an
  estimate. MEZO claims before 1 Apr 2026 have no price.
- Matchscan shows a transaction as soon as it is mined, read live from
  the chain until its own copy catches up. After a transaction, Matchbox
  Pro links to Matchscan and to the Mezo explorer, and every link leaving
  Pro opens in a new tab.
- Matchbox Pro on phones has a More tab (Protocol, Boost calculator,
  Documentation, Matchbox Classic). Vote opens on the most funded gauge
  type. One shared rule decides when a gauge is funded and when an APY is
  shown: at least $1 of priced incentives and 0.001 veBTC or 10,000 veMEZO
  of votes, with incentives under a cent treated as dust and unpriced
  tokens shown as "Unpriced". Stuart ranks by the same rule.
- Matchscan: pools are named by their pair ("BTC/MUSD Volatile"), amounts
  are no longer cut on phones, controls have 40 px tap targets,
  transaction, address, lock, epoch and gauge pages have their own link
  preview text, and each card of an address page has its own deadline so
  one slow read no longer fails the page.
- Wallet figures are fresher: live wallet reads no longer fail for
  wallets voting many gauges, and a stale wallet someone views is rebuilt
  first in the next sweep.
- The homepage, Matchbox ID, Matchbox Developer, the docs and Matchbench:
  figures and API paths are no longer cut, footers match and have 40 px
  tap targets, the ID sign-in page says what Matchbox ID is, and every
  docs page has its own title and description.
- `pnpm db:seed:local` fills the API's local read models, so the local
  stack answers with data. It refuses anything but a local database.
- A README in every app and package: what it is, how to run and test it
  without credentials, and what needs keys of your own.
- `pnpm check:links`, part of `pnpm lint`: relative links in public
  Markdown files must point at files that exist.
- Contributing: complete DCO sign-off steps, setup on a fresh clone, and
  the pull request and issue templates point at them.
- Stuart no longer prices a token by its symbol. Incentive and reward
  tokens are priced by contract address only, through the
  `@matchbox/chain` token registry, as the API already did. A token named
  "7777USD", "FAKEBTC" or "MUSD" at an address the registry does not list
  is unpriced: it counts as zero for totals, APY, ranking and the
  optimizer, and Stuart says it exists without giving it a dollar value.
  Vault and staking shares Stuart used to price by symbol at $1 or the BTC
  price (sMUSD, sUSDat, mlvBTC-mUSDC and mbhBTC) are now unpriced in
  Stuart.
- Stuart: "optimize my votes" with no priced target says why (no
  incentives, only unpriced incentives, or a missing MEZO or BTC price)
  instead of saying the wallet has no lock. "Most consistently funded"
  counts an epoch as funded only on priced incentives of a cent or more.
- The `@matchbox/chain` token registry adds the bridged BTC wrappers
  mSolvBTC, mxSolvBTC and mcbBTC at the BTC price. The API and Matchbox Pro
  now price gauge incentives paid in them, which were unpriced, so USD
  values and APR rise for those gauges. Epochs already stored keep them
  unpriced until a backfill is re-run, so a chart can show a step at the
  change. See the API changelog
  ([packages/docs/content/developer/changelog.md](packages/docs/content/developer/changelog.md)).

## v1.0.2 (18 Nov 2026)

- Matchbox Pro: the phone ballot bar leaves spare room for "Projected" at
  360px wide. With one lock the label fitted with no pixels to spare, and
  text that renders slightly wider (as on GitHub's Ubuntu runners) cut it
  short.

## v1.0.1 (18 Nov 2026)

- Tests: the indexer suites allow more time to start Postgres and apply
  migrations, which passed the 10 s default hook timeout on shared CI
  runners.
- Tests: the Pro ballot bar test waits for the web font before it measures
  the labels.

## v1.0.0 (18 Nov 2026)

First public release, under the GNU Affero General Public License v3.0
only.

- Apps: Matchbox Pro, Matchscan, Stuart, Matchbench, the docs site, the
  homepage, Matchbox ID, Matchbox Developer, the Matchbox API, the indexer,
  the jobs and feedback Workers, the component kit and the platform spike.
- Packages: the shared libraries under `packages/`, and the SDK published
  to npm as `@matchbox-dev/sdk`.
- Every app runs locally without production credentials, on recorded
  fixtures, an in-memory store or a local database.
- Public CI on GitHub-hosted runners: lint, typecheck, unit tests, build,
  the public boundary and secrets checks, and end-to-end tests for Pro,
  Matchscan, ID and Developer.
- Security reports go to GitHub's private vulnerability reporting or
  <contact@trellium.org> ([SECURITY.md](SECURITY.md)). Contributions are
  signed off under the Developer Certificate of Origin
  ([CONTRIBUTING.md](CONTRIBUTING.md)).
