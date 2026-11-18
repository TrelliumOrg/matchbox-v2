# Matchbench

bench.matchbox.markets: a public leaderboard of how Claude models perform
inside Stuart, Matchbox's assistant for the Mezo network. TanStack Start on
Cloudflare Workers like the other apps, but every page is prerendered at
build time from one committed file, `data/results.json`, and served as a
static asset. No page view, client navigation or control calls an API or
reaches the Worker.

Pages: the leaderboard (`/`, Doop canvas `hFp5UsQ4BA`, frame `DOXM2YuhbJ`),
every published question (`/questions`), the method (`/method`) and this
run's details (`/runs`).

## Commands

```sh
pnpm --filter @matchbox/bench build    # check data/results.json, prerender, postbuild
pnpm --filter @matchbox/bench preview  # workerd on :4203
pnpm --filter @matchbox/bench test     # unit tests (the data-to-view logic)
pnpm --filter @matchbox/bench e2e      # every page hard-loaded on desktop 1440 and Pixel 7
pnpm --filter @matchbox/bench measure  # initial JS and HTML per page, with the preview running
pnpm --filter @matchbox/bench lhci     # Lighthouse through the brotli proxy on :4204
pnpm --filter @matchbox/bench dev      # :3007
```

Run `pnpm build` before `e2e`. Ports 4203 and 4204 keep it clear of the
other apps' previews.

## Updating the data

The benchmark runner (`apps/stuart`) writes a results file in the shape of
the contract `@matchbox/contracts/bench` (`packages/contracts/src/bench/results.ts`).
`data/results.json` is a byte for byte copy of the runner's published file,
`apps/stuart/bench/published/results.json`: today the real run
`matchbench2-final` (15 entries, three runs each, 143 questions, 51
published). To publish a run:

1. Copy the runner's published file over `data/results.json`.
2. `pnpm --filter @matchbox/bench build`. Before the first page renders, the
   prerender parses the file with `src/data/schema.ts`: the contract (strict
   objects, so an unknown field fails too) plus the page's own cross-checks
   (one score per finished run, every kind and failure type an entry or a
   question names is listed). Any problem fails the build with the schema's
   message.
3. `pnpm --filter @matchbox/bench test` and `e2e`. Both check the real
   run's figures (leaders, the findings' text, the track's range, the
   fingerprint), so update them when the data changes. The unit tests also
   cover a 15 entry matrix, long medians, template answers, an entry with
   one run, and a sample file (noindex).
4. If the run's answers were made in more than one pass, add its line to
   `runProvenance` in `src/view/method.ts` (keyed on `run.id`). The Runs
   page shows it under the run's facts. A run without a line shows none.
5. Commit the file and deploy (below).

While the file has `"sample": true` in `run`, every page shows a "Sample
figures" notice and carries noindex. The real run has no such flag, so
neither shows: never publish sample figures without it.

What the page does with the file:

- A block "What this run shows" leads the page with up to four findings
  computed from the file (`src/view/findings.ts`): who leads on each score,
  how often Stuart did not show the model's sentence and why, what effort
  changed, and what max effort costs in time. A finding is left out when
  the data does not bear it out, and entries closer than their own runs
  vary (the gap is less than the larger of the two entries' run spreads)
  are named as level rather than ranked.
- Three scores, each explained in one line above the leaderboard:
  "Inside Stuart" (`score`, the main one and the default), "Ignoring
  length" (`scoreIgnoringLength`, Stuart's length limits set aside) and
  "Within 20 s" (`scoreWithinStuartLimit`, production Stuart's time and
  token limits as well). The "Rank by" control picks one, and the board,
  each model's best entry, the charts' vertical axis and the by kind grid
  follow it. The grid has no per kind figure within 20 s, so it shows
  Inside Stuart then and says so.
- The leaderboard draws the chosen score on a track that does not start at
  zero: it runs over the nearest tens around every entry (and every run), at
  least 20 points wide, and the range is printed in the header and under
  the table. For Inside Stuart, a grey line spans the entry's best and worst
  run. The grid tints one hue over its own stated range.
- Every entry is listed, ties broken on the other scores, then cost. One
  colour per model family (Haiku, Sonnet, Opus), one fixed marker shape per
  effort level (low circle, medium square, high diamond, extra high
  triangle, max ring), and the entry with `runsStuart: true` is marked
  "runs Stuart today". An entry with fewer `runs` than `run.runsPerEntry`
  says so.
- The reader can hide models (everywhere) and pick which entries the grid,
  the two cards and the question show: each model's best entry (the
  default), one effort level, or all of them.
- The speed chart draws `run.limits.stuartBudgetMs` as a dashed line. It is
  linear while the medians sit near that line, a log scale from 1 s (ticks
  1, 2, 5, 10, 20 s) when they spread widely (the real run's 3.3 s to
  23.7 s), and a log scale up to the answer budget when a median runs well
  past the line. `overStuartBudgetShare` shows under the median time.
- Counts summed across runs are read against `answers` (every question once
  per finished run), so an entry with fewer runs does not look safer.
  Safety fails shows "x of N answers". "How they fail" shows failed checks
  per 100 answers (one answer can fail several checks). The Method page
  says so.
- Scores print with one decimal and rank on exactly that printed value, so
  equal prints share a rank and a lower print never sits above a higher
  one. No score below 1 prints as 100.0%, none above 0 as 0.0%, and shares
  in a split add up to 100%.
- "How they fail" gives safety types their own reds and the seven most
  frequent other types their own colours (counted over every entry, so a
  colour never moves). The rest share "Other", which the legend names.
  Bars are `@matchbox/ui/split-bar`, normalised so each fills its track,
  and a share above zero keeps a visible sliver.
- "Answers Stuart did not show" gives each entry's `rejectedShare`, split by
  the shares in `rejectionReasons`, in the order and with the labels of
  `rejectionTypes`. The Method page explains the rules (section
  `#not-shown`), from `apps/stuart/src/query/sourced.ts`.
- An entry with `agreement: null` (fewer than two runs) is left out of the
  agreement card, with a note naming it. A kind with no questions is left
  out of the grid and the counts.
- Each published answer is one run per entry (the first whose pass or fail
  matches the entry's majority on that question, a tie counting as a
  pass), and the page says so. An answer with `answerFrom: "template"` is
  labelled as Stuart's own text with the reason, and `modelText` (the
  model's words, from the same run) beside it. Where `passedIgnoringLength`
  differs from `passed`, the card says "Passes ignoring length" or "Fails
  ignoring length". An answer with `onCard: true` is labelled as given as a
  clarification card.
- Each answer leads with the sentence the user read, and the rest of what
  Stuart's response showed sits behind a collapsed "What the card showed".
  The runner writes `shown` one part per line in a fixed order (`shownText`
  in `apps/stuart/bench/grade.ts`): the title, the answer sentence, then the
  why lines, card prompts and options, ballot and ranking rows, structured
  blocks as JSON, and the facts. So `splitShown` (`src/view/model.ts`) takes
  the second line as the sentence (the model's own, or Stuart's when
  `answerFrom` is `"template"`). The card lists the title, then short values
  in a grid, longer lines on their own, and each repeated line once. A unit
  test checks every published answer has that shape (all 765 in this run):
  if the runner changes the order, the test fails rather than the page
  leading with the wrong line.
- The Method page defines the three scores, says the answer text and
  `modelText` come from one run, and lists the limits of this benchmark
  (Claude only, one harness, display rules, rejected answers that held only
  figures the model had been shown, questions and checks written by the
  Matchbox team, three runs so small differences are noise, style rules,
  Mezo only).
- The Method and Runs pages state the limits, that fallbacks are off, that
  API errors are retried and never scored, that timeouts count at their
  elapsed time, how cost is estimated, and `run.unmeteredCostUsd` when it
  is above zero (`src/view/method.ts`). The Runs page shows the commit and
  `run.fingerprint`.
- Model answers (`shown`) and the model's own words (`modelText`) are
  untrusted text. They render through `@matchbox/ui/untrusted-text`
  (direction isolated, hidden characters shown as escapes) as text only:
  nothing in them becomes HTML or a link. An empty answer reads "No text
  was shown". Their `failures` are failure type ids, named from
  `failureTypes`.

## The published answers load on demand

`publicQuestions` is most of the file (about 24 kB brotli for 51 questions
times 15 entries), so no page carries it on first load:

- `src/data/results.ts` imports every top-level key but `publicQuestions`.
- `scripts/question-index.mjs` (a Vite plugin, also in `vitest.config.ts`)
  builds two modules from the file: `virtual:bench-question-index`, the
  questions without their answers plus the first question in full, and
  `virtual:bench-answers`, every answer. Only `src/data/questions.ts`
  imports the second, and only through a dynamic import
  (`src/ui/answers.ts`).
- The front page's question card renders the first question from the
  index and loads the rest when the reader steps (or points at the step
  buttons). On `/questions`, each question's answers load when it is
  opened, once for every question. The prerendered HTML and the hydration
  both render without the answers, so the two always agree.

The unit tests check that the split loses nothing, and the e2e checks that
no page loads the answers before a reader asks.

## How a page is served

1. `vite build` builds the client and the Worker, then
   TanStack Start's prerenderer requests every page from a preview of that
   Worker, writing `dist/client/<path>/index.html`. `/404` becomes
   `dist/client/404.html`.
2. `scripts/postbuild.mjs` gives every page a `<meta>` CSP whose
   `script-src` lists the SHA-256 of each inline script on it (no
   `unsafe-inline`), `connect-src 'self'`, strips the router from 404.html,
   and checks every link and fragment in the built HTML.
3. Cloudflare serves matching assets before any Worker code runs
   (`run_worker_first: false`); navigation misses get 404.html.
4. The Worker (`src/server.ts`) only sees non-navigation requests that match
   nothing and answers them with the static 404. It renders only for the
   prerender crawler, which carries this build's token.

## Design and house rules

Built from `@matchbox/ui` where a shared component fits: Callout (the sample
notice), SegmentedControl (Rank by), FilterTabs (the effort picker),
SplitBar (the two cards' bars) and UntrustedText (model answers). The model
filter is a multi-select toggle with no shared equivalent, and the charts,
the leaderboard table and the lockup are this site's own. The approved
Doop design is an explainer for readers outside Matchbox, so it keeps
short explanatory sentences that the terse house copy rule would cut. It
follows the other copy rules: no dashes, middle dots or semicolons in UI
text, and no decorative pills (the grader's checks are a plain list).

## Appearance

The pre-paint script from `@matchbox/tokens` reads the shared
`mbx-appearance` cookie on .matchbox.markets, then this browser's storage,
then the system setting, so a theme picked in Pro or Matchscan shows here
with no flash. The chart colours have their own light and dark values in
`src/styles.css`.

## Budgets

LCP under 1.2 s and CLS 0 (Lighthouse, mobile, simulated), under 120 kB
brotli of initial JS and 40 kB brotli of HTML per page. Measured on
17 Nov 2026 with the real run `matchbench2-final` (15 entries, 51 public
questions), on a Windows PC: LCP 0.77 to 0.94 s, CLS 0, initial JS 102.1 to
114.7 kB, HTML 6.2 to 14.3 kB. Before the answers loaded on demand, the
real file put every page at 124 to 135 kB. The schema check runs only in
the Worker, so zod never reaches the browser.

## Deploy

Never from a laptop, and never as part of a pull request. Two Workers, both
in `wrangler.jsonc`:

- **Production**: `matchbox-bench` on bench.matchbox.markets
  (`workers_dev: false`, a custom domain route). Build with no
  `CLOUDFLARE_ENV`, then deploy the generated `dist/server/wrangler.json`
  with Wrangler.
- **Preview**: `matchbox-bench-preview` on workers.dev only, for checking a
  build first. Build with `CLOUDFLARE_ENV=preview`, then deploy the same way.

The repository holds no Cloudflare account id: whoever deploys picks the
account (`CLOUDFLARE_ACCOUNT_ID`). Before each deploy, check the generated
`dist/server/wrangler.json`: the production build names `matchbox-bench`
with the bench.matchbox.markets route, the preview build names
`matchbox-bench-preview` with `"routes": []`. Wrangler creates or takes over
the hostname's DNS record on the first production deploy without asking
when it cannot prompt (CI, agents), so run that one on purpose.

## Search and link previews

While `data/results.json` has `"sample": true`, every page carries
`<meta name="robots" content="noindex">` and the asset headers add
`X-Robots-Tag: noindex` (`scripts/robots.mjs`, run by postbuild). The real
run's build has neither (checked in the built HTML and by the e2e), and
postbuild fails if a page disagrees with the file. `public/robots.txt`
allows crawling. Each page has a canonical link and Open Graph tags for
https://bench.matchbox.markets (`src/data/site.ts`), with `public/og.png`
(1200 by 630, made from the design) as the preview image.
