# @matchbox/motion

Motion for the apps: animated numbers, count-ups, morphing text, presence
and list transitions, skeletons, page motion and haptics, all of which
respect reduced motion. `@matchbox/motion/testing` turns motion off in
tests. The rules are in
[agent-instructions/performance-and-motion.md](../../agent-instructions/performance-and-motion.md).

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/motion test       # unit tests (Vitest)
pnpm --filter @matchbox/motion typecheck
```

The tests need no network, keys or services.
