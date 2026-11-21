# Epochs

`src/epoch.ts` is the one epoch module. Mezo Earn epochs last one week and
start Thursday 00:00 UTC. The Unix epoch was a Thursday, so the start of the
epoch containing `t` is `t - t % 604800`. Votes open one hour into an epoch and
close one hour before it ends (Wednesday 23:00 UTC).

## Numbering

- **Epoch 0** starts Thursday 11 December 2025 (`EPOCH_ZERO_START`), the
  first full week after Mezo's voters went live. This is the numbering the
  community and Dune use: the week starting Thursday 5 November 2026 is
  Epoch 47.
- **Mezo Earn launched** in Epoch 38, Thursday 3 September 2026
  (`EARN_LAUNCH_EPOCH_START`), the first vote epoch with veMEZO boosts and
  the Earn incentives. `LAUNCH_EPOCH_START` is a legacy name for it: use
  `EARN_LAUNCH_EPOCH_START`, or `EPOCH_ZERO_START` for numbering.

## Behaviour callers rely on

- **Invalid input.** `epochStartFor` returns 0 for non-finite or
  non-positive timestamps. `epochStartOf` has no guard: a negative timestamp
  truncates toward zero, and `isEpochStart` is the validator the API uses.
  Both exist because callers rely on each.
- **Number types.** Apps use `number` seconds. On-chain code uses `bigint`:
  `epochStartOfBigint`, `EPOCH_SECONDS_BIGINT`, `EPOCH_ZERO_START_BIGINT`
  and `EARN_LAUNCH_EPOCH_START_BIGINT`.
- **Epochs before Epoch 0.** `epochIndexFor` returns negative indexes.
  `epochNumberFor` returns null, and `epochLabel` then shows "Epoch".
- **Two names for the length.** `EPOCH_SECONDS` and `WEEK` are the same
  constant.
- **The vote window.** `VOTE_WINDOW_PADDING_SECONDS` is the hour at each
  end. `VOTE_WINDOW_CLOSE_OFFSET_SECONDS` is derived from it and the epoch
  length.
- **The API shape.** `describeEpoch` returns the plain `Epoch` type. The zod
  `epochSchema` and the `currentEpochResponse` envelope live in
  `@matchbox/contracts`, which builds them from `currentAndNextEpoch`.

## Tests

`src/epoch.test.ts` covers every helper above:
`pnpm --filter @matchbox/domain test`.
