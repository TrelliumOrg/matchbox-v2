# @matchbox/perf

Performance gates shared by Matchbox's frontends (Pro, Scan, Docs):

- `measure` checks each route's first-paint JavaScript (120 kB brotli) and its server loader time.
- `lighthouse` builds a Lighthouse CI config: mobile emulation, simulated throttling, three runs per URL, LCP judged on the median run, CLS 0 on every run.
- `matchbox-lhci` runs Lighthouse CI the way `lhci autorun` does (collect, assert, upload), with the LCP timestamp tie rule below applied before the runs are judged. Each app's `lhci` script calls it.
- `compressing-proxy` serves the preview brotli-compressed, as the edge would, for Lighthouse.
- `vite` holds the shared chunking (the framework chunk) for the apps' builds.

## The LCP timestamp tie rule

Lighthouse simulates a slow phone and network from a trace of one fast page load. When a page's largest paint is text drawn in the same frame as its first paint, Lighthouse reports the simulated first paint as the LCP, but only if the trace's two timestamps are exactly equal. Chrome sometimes stamps the largest paint one microsecond after the first paint for that same frame. Lighthouse then simulates every request started before it, the page's scripts included, and reports about twice the time.

We found this on Scan's CI runs in November 2026. Across 120 runs, the 116 whose timestamps were exactly equal were all fast (about 0.78 s), and the 4 whose timestamps were 1 µs apart were all slow (1.58 to 1.59 s against a 1.2 s budget). All 4 had painted their heading in the first frame, at 238 to 248 ms in the real load.

So `matchbox-lhci` judges a run on its simulated first paint, the value Lighthouse gives an exact tie, when all of these hold:

- the first paint and largest paint timestamps in the trace are within 1 ms of each other;
- the largest paint is text, not an image (for an image, Lighthouse's longer estimate models the image's own download, which is real);
- the simulated LCP is later than the simulated first paint.

Every other run is judged exactly as Lighthouse reported it. No budget changes, and lhci's own assertions and median-run choice decide the result.

It is never silent. Each run the rule covers prints one line in the job log, with its route, its simulated LCP, the simulated first paint it is judged on, its observed LCP and the two timestamps, followed by a count:

```text
LCP tie allowance: /; simulated LCP 1584 ms judged as simulated FCP 781 ms; observed LCP 248 ms; FCP ts 8508164258, LCP ts 8508164259 (1 µs apart)
LCP tie allowance used in 1 of 60 runs
```

The saved report keeps what Lighthouse measured: a covered run's result carries `matchboxLcpTie` with the simulated LCP, and its LCP display says it was judged under the allowance.

The tests in `src/lcp-tie.test.ts` use recorded results in `src/fixtures/lcp-tie/`. Three are Scan's Home from CI with the 1 µs gap; they fail `lhci assert` without the rule and pass with it. Three are a genuinely slow page, Scan's MEZO token page before its coin was drawn inline: an image LCP at 1.52 to 1.65 s with its timestamps tied exactly. They still fail.

## Tests

```sh
pnpm --filter @matchbox/perf test
pnpm --filter @matchbox/perf typecheck
```

The tests need no network, keys or browser. Running an app's `measure`
needs that app's preview running, and `lhci` needs Chrome installed, or
`CHROME_PATH` pointing at a Chromium.
