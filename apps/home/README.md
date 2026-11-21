# Matchbox homepage (`matchbox.markets`)

The Matchbox homepage: TanStack Start on a Cloudflare Worker, one page.
The design is final and lives in `docs/design/home-final/` (desktop, phone,
dark, the Classic card and the live data spec).

## Local development

```sh
cp apps/home/.dev.vars.example apps/home/.dev.vars   # fixtures, no backend
pnpm --filter @matchbox/home dev                      # http://localhost:3006
pnpm --filter @matchbox/home test                     # unit tests
pnpm --filter @matchbox/home build && pnpm --filter @matchbox/home e2e
pnpm --filter @matchbox/home preview                  # port 4193, then:
pnpm --filter @matchbox/home measure                  # JS, HTML and loader budgets
pnpm --filter @matchbox/home lhci                     # LCP and CLS, mobile
```

## Live figures

The Pro and Matchscan cards show live figures (live-data-spec):

- **First paint** is the last snapshot, rendered by the Worker. The page
  never waits for an upstream read: the snapshot sits in the Cache API
  (`src/data/figures.server.ts`), served as it is for 15 s, then served
  stale while one refresh runs in the background. With no snapshot at all
  (a cold colo) the slots say "Not available" until the browser's first
  fresh read fills them with a 200 ms fade.
- **The snapshot's cache key carries the build's id** (`__HOME_BUILD_ID__`,
  `vite.config.ts`), as Scan's page cache does, so a deploy never reads a
  snapshot an earlier build stored in another shape. A new deploy starts
  from no snapshot and fills it on its first refresh.
- **The Cache API does nothing on `workers.dev`**: `cache.put` and
  `cache.match` are no-ops there, so the `preview` Worker at its
  workers.dev address keeps a snapshot only in each isolate's memory. A
  cold isolate renders "Not available" in every slot until the first
  browser read fills it (a second or so after load); after that, pages
  from that isolate paint figures. On a custom domain (`matchbox.markets`)
  the snapshot is shared through the colo's cache as described above.
- **Each upstream read has a 3 s deadline**, and a slot whose read fails
  keeps its last value and the time it was last read. The five figure
  reads (summary, gauges, veBTC series, blocks, borrow totals) each keep
  their own time. The borrow totals are read at most once a minute
  (Borrowed, below), and the validator names that label the latest
  blocks every five minutes (Validator names, below).
- **In the browser**, one fresh read once the page is idle (at most a
  second after load), then a re-read when a new block lands through
  `@matchbox/live` (BlockHub over `/live/heads`; while it is down the
  fallback poll is the figures read itself, so one request tells the head
  and refreshes the cards)
  and the figures are 30 s old, and at each epoch boundary. Only while the
  tab is visible.
- **"As of HH:MM"** shows on a card when a figure it displays is older than
  that figure's threshold: 3 minutes for the latest blocks, 5 for the Pro
  summary and gauges and for Borrowed, an hour for the veBTC sparkline (the reasons are in
  `staleAfterMs`, `src/data/figures.ts`). It goes by when each figure was
  last read, not by whether the browser's request answered, because the
  edge answers with its last values when its own reads fail. It waits for
  the first fresh request (its answer, or its 5 s deadline), so first
  paint never shows it.
- The epoch number and countdown are computed in the browser from
  `@matchbox/domain/epoch`, never fetched.

| Figure                         | Source                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Incentives this epoch          | `GET /internal/pro/summary`, `incentives.usd`                                     |
| Most incentives (three gauges) | `GET /internal/pro/gauges?sort=incentives&funded=true&limit=3`                    |
| veBTC locked, and in USD       | `GET /internal/pro/summary`, `stats.vebtcLocked`, `stats.vebtcLockedUsd`          |
| veBTC locked sparkline         | `GET /internal/scan/series?metric=escrow.supply&dimension=vebtc`, last 30 days    |
| Latest blocks                  | Blockscout proxy, `GET /internal/blockscout/api/v2/main-page/blocks`, first three |
| Latest blocks' validator names | `GET /internal/scan/validators`, `name`, else `label`, by `address` (below)       |
| Borrowed, Enclaves share       | `GET /internal/scan/borrow/totals`, `total`, `enclaves_share` (below)             |
| Borrowed sparkline             | `GET /internal/scan/borrow/totals`, `history.points[].total`, last 30 days        |

### Borrowed

The Matchscan card's **Borrowed** stat reads `GET /internal/scan/borrow/totals`
(`apps/api/README.md`, "Borrow totals"), validated with
`scanBorrowTotalsResponseSchema` from `@matchbox/contracts/scan`
(`src/data/borrow.ts`).

- **What it covers:** MUSD owed across Mezo's three borrow venues: open
  troves (principal plus interest), Enclave positions (principal), and
  Morpho markets that lend MUSD (total borrow assets). Markets lending
  another token (BTC / mUSDC) are not in it.
- **Enclave interest is not included.** EnclaveDebtManager accrues it on
  chain with no event, and nothing reads it yet, so the figure is a little
  under what Enclaves really owe.
- **In MUSD, not dollars.** Nothing prices MUSD, and no stablecoin is
  taken as $1, so the value reads as an abbreviated MUSD amount
  ("4.06M MUSD", `compactAmount` in `src/data/figures.ts`, from the
  answer's base units and its own `unit.decimals`, in bigint). The design
  frames' "$4,130,114" assumed $1 per MUSD and counted mUSDC.
- **The subline** is the Enclaves share, one decimal ("98.6% in Enclaves"),
  left out when the answer has no share.
- **Width.** An abbreviated value has at most four digits and a suffix.
  It fits at every width: on phones the subline goes under the value
  (the owner's choice over the 390 frame, which set it beside the value
  and left room for only three digits). veBTC locked keeps the frame's
  layout down to 390 (`styles.css`).
- **The sparkline** is the daily totals. A day with no total (a venue
  missing that day, or closes that start later) is a gap, never a zero;
  with fewer than two days to draw there is no sparkline.
- **No total, no figure.** An answer whose `total` is null (a venue it
  could not read; `missing` names it) counts as a failed read: the stat
  keeps its last value, share and sparkline and their time, so "As of"
  shows once they are 5 minutes old, and with nothing known it says "Not
  available". It never shows a partial sum.
- **How often:** the route is cached per five-minute snapshot slot with
  `max-age=60`, so the edge reads it at most once a minute (whether the
  last read answered or not, `borrowEveryMs` in
  `src/data/figures.server.ts`), on the page's 30 s re-reads.
- **Fixtures** (`src/data/fixtures.ts`, `borrowTotalsFixtures`): a normal
  answer (fixture mode paints it), one with `total` null and the troves
  missing, and one with gaps in the history.

### Validator names

Blockscout names no proposer on Mezo (`miner.name` is null), so each of
the latest blocks would show a short address ("0x6E35…23b5"). The edge
names them from `GET /internal/scan/validators` (`apps/api/README.md`),
the route Matchscan's validators pages read, validated with
`scanValidatorsSchema` from `@matchbox/contracts/scan`
(`src/data/validators.ts`).

- **Which name:** the one Matchscan shows for the validator: Pro's
  directory name (profile, else ValidatorPool moniker), else Scan's label
  for the address. A proposer with neither shows its short address, in
  Blockscout's case. Never blank, never "Unknown".
- **How often:** names change when a validator joins or renames, so the
  edge reads them every five minutes (`namesEveryMs` in
  `src/data/figures.server.ts`), with its own 3 s deadline, not with
  each block. A shown block whose proposer has no name brings the read
  forward, to no sooner than a minute after the last (`namesRetryMs`):
  a proposer no read names costs a read a minute at most.
- **What it costs:** one answer with a row per known validator (address,
  name, label, gauge, status, the day's block counts; a few hundred
  bytes each). The API serves it from its Cache API under the data's
  version (the last jobs run and the gauge directory's etag) after two
  small version reads; it is rebuilt only when those change.
- **Where they live:** in the edge snapshot, beside the figures, with
  the time they were last read. They never go to the browser: the
  blocks are named at the edge, each block carrying its proposer's
  address so a name read later names the blocks already shown. A names
  read that fails keeps the last names and their time; one that lacks a
  validator (the API could not read Pro's directory, say) keeps that
  validator's last name.
- **On the page:** a name that arrives after first paint swaps in with
  the text morph (static under reduced motion). The row's height is
  fixed; a long name stays on one line and ends in an ellipsis rather
  than wrapping or moving the transaction count, and shows in full on
  hover (`title`).
- **Fixtures** (`src/data/fixtures.ts`, `validatorsFixture`): two
  directory names, one label only, a name too long for its row, a blank
  name, and a proposer in no row; fixture mode names its blocks from it.

## Search

The Matchscan card's search is a plain GET form to this Worker's
`/search?q=…`, so it works without JavaScript. `/search` redirects (302,
never cached) by the query's shape, by the rules of Matchscan's own search
(`apps/scan/src/search/detect.ts`), taking only the shapes with one
reading: a 32 byte hash to `/tx/…`, an address (checksum checked) to
`/address/…`, and a labelled block number, or a bare one above 1,000,000,
to `/block/…`. Anything else, and an empty query, goes to Matchscan's home
page, whose palette offers every reading. The origin is fixed and the
path is built only from normalised hex or digits (`src/search.ts`), so it
is never an open redirect.

## Environments

| Environment | Worker                  | Where             | API binding                                         |
| ----------- | ----------------------- | ----------------- | --------------------------------------------------- |
| (top level) | `matchbox-home`         | local builds only | `matchbox-api-v2-preview`                           |
| `preview`   | `matchbox-home-preview` | matchbox.markets  | `matchbox-api-v2-preview`, entrypoint `InternalApi` |

`preview` is production, named and bound as Matchscan's is. Its routes
are the homepage's paths on `matchbox.markets` (Deploy, step 3).

## Deploy (humans only)

Agents never deploy. In order:

1. **API first.** `matchbox-api-v2-preview` must be deployed with its
   `InternalApi` entrypoint, as for Matchscan.
2. **Build and deploy to workers.dev:**

   ```sh
   CLOUDFLARE_ENV=preview pnpm --filter @matchbox/home build
   pnpm --filter @matchbox/home exec wrangler deploy --dry-run   # check
   pnpm --filter @matchbox/home exec wrangler deploy
   ```

   The build bakes the environment in (`dist/server/wrangler.json`), so
   deploy takes no `--env`. Check the page on its workers.dev address:
   figures fill in, the theme switch works, the search form reaches
   Matchscan.

3. **Attach `matchbox.markets`.** Today `matchbox.markets/` is Classic's
   landing page and every other path there is sent to
   `app.matchbox.markets` at the same path. This Worker keeps the second
   half: a path it does not have goes to Classic, path and query kept
   (`src/classic-paths.ts`, checked in `e2e/smoke.spec.ts`), so old links,
   `/privacy` and `/dashboard` keep working after the move.

   Classic's Worker (`matchbox`) holds the route `matchbox.markets/*`,
   set in the Cloudflare dashboard. The homepage does not take that route:
   `env.preview` in `wrangler.jsonc` lists routes for the homepage's own
   paths (`/`, `/assets/*`, `/_serverFn/*`, `/search*`, `/live/heads`,
   `/favicon.svg`, `/og.png`). A more specific route wins, so those reach this Worker
   and every other path stays with Classic. A new path this app serves
   needs a route there too.

   To go back, remove the `routes` from `env.preview` and deploy: Classic's
   landing page answers `/` again at once. The zone's redirect rule for
   `/docs` runs before any Worker and is unaffected.
   `www.matchbox.markets` is not covered and still shows Classic's landing
   page.

## Open questions

- **Terms.** There is no Terms page: `matchbox.markets/terms` goes on to
  `app.matchbox.markets/terms`, and Classic has no such page (404). The
  footer links none until one is published.
- **Privacy.** `matchbox.markets/privacy` goes on (308) to Classic's
  page at `app.matchbox.markets/privacy`, which answers but loads
  slowly and requests a font that is not found. This Worker could serve
  its own page, but the repository holds no approved privacy text for
  v2. Serving it needs that text (with the sections ID and Developer
  link, `#matchbox-id` and `#matchbox-developer`), a route for
  `/privacy` here, and the route `matchbox.markets/privacy` in
  `env.preview` (Deploy, step 3).
- **Footer links.** Every footer link is a route this Worker serves or an
  address on the reviewed list in `src/page/reviewed-links.ts`; the unit
  and e2e tests fail on any other. Check a new address by hand (it must
  answer 200, after redirects) before adding it.
