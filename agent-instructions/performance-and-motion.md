# Performance and motion

## Budgets (enforced in CI)

- LCP under 1.5s on a mid-range Android over 4G (Matchscan SSR pages under 1.2s).
- INP under 100ms. CLS 0.
- Under 120 kB brotli (what Cloudflare serves) of JavaScript per route before a
  wallet connects. The Phase 0 spike measured about 100 kB brotli for React,
  the router and Start alone, so split aggressively and keep wallet code lazy.
  Pro's budget is 125 kB since 13 Nov 2026; the measurement behind it is in
  `apps/pro/scripts/measure.mjs`. A budget moves only with a measurement
  showing nothing of ours is left to take out, never to let a change through.
  Pro measures script files (125 kB) and the data inlined in the HTML apart
  since 13 Nov 2026: inlined data has its own limits, and Vote's is measured
  against a gauge directory the size of mainnet's. The figures and reasons
  are in the same script.
- Route change under 100ms to first frame.

## Rules

- Server render the first view of every route. Hydrate interactive islands.
- Never import wagmi, connectors or WalletConnect from a route module. They load
  behind the wallet drawer on first intent (hover or tap of Connect).
- Read data in route loaders from the API Worker (D1 read models). Never query
  Neon from a request path.
- No chart library: use the SVG primitives in `@matchbox/ui`.
- The logo is an inline SVG. Never load Martian Mono.
- Self-host Figtree and DM Mono, subset, and preload only the weights the first
  view uses.
- Resolve the theme before first paint with the inline script from
  `@matchbox/tokens`.
- Preload routes on intent (hover or touchstart).

## Motion

- Use `@matchbox/motion`: NumberFlow for numbers, torph for text that changes in
  place, Skullet for loading states, web-haptics for phone ticks, Motion
  (`LazyMotion`) for layout, and View Transitions for route changes.
- Animate transform and opacity only. Keep motion under 400ms.
- Honour `prefers-reduced-motion` everywhere.
- Nothing animates on first load except skeleton reveals.
- Haptics: only inside a user gesture, through the Haptics setting, at full
  intensity with the patterns in `@matchbox/motion` (pick, success, error,
  nudge). Never on load, scroll or timers.
- Every loading state is a Skullet `Skeleton` with a `sample` and an `id`.
