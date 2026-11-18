# Epochs

`src/epoch.ts` is the one epoch module. Mezo Earn epochs last one week and
start Thursday 00:00 UTC. The Unix epoch was a Thursday, so the start of the
epoch containing `t` is `t - t % 604800`. Votes open one hour into an epoch and
close one hour before it ends (Wednesday 23:00 UTC).

## Sources

| Source in Matchbox                                                       | Branch           | What it had                                                                                                                      |
| ------------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/webapp/src/lib/mezoGauges/epochs.ts` (+ `constants.ts`)            | main             | `voteWindowCloseFor`, `epochIndexFor`, `epochClosesSinceLaunch`, `rewardedVoteEpochFor`, `LAUNCH_EPOCH_START`, close offset      |
| `apps/webapp/src/lib/academy/epoch.ts`                                   | main             | `WEEK`, `snapToThursdayUTC`, `epochStartFor`, `enumerateEpochs`, `enumerateEpochsForWindow`, `resolveWindow`                     |
| `packages/platform-contracts/src/market.ts`                              | main             | `epochSeconds`, `voteWindowPaddingSeconds`, `epochStartOf`, `isEpochStart`, `describeEpoch`, `currentEpochResponse`, zod schemas |
| `apps/matchbox-pro/src/lib/epoch.ts`                                     | feat/pro-rebuild | bigint `LAUNCH_EPOCH_START`, `epochNumberFor`, `epochLabel`                                                                      |
| `apps/matchbox-pro/src/worker/history/math.ts` (`EPOCH`, `epochStartOf`) | feat/pro-rebuild | bigint epoch start for on-chain timestamps                                                                                       |

All five agree on the boundary (Thursday 00:00 UTC), the length (604,800 s), the
vote window (one hour of padding at each end; Classic's close at
`start + 604800 - 3600` equals market's `voteEnd`) and the launch epoch
(1,788,393,600, Thu 3 Sep 2026).

## Differences kept

- **Invalid input.** `epochStartFor` (academy) returns 0 for non-finite or
  non-positive timestamps. `epochStartOf` (market) has no guard: a negative
  timestamp truncates toward zero, and `isEpochStart` is the validator the API
  uses. Both stay, under their original names, because callers rely on each.
- **Number types.** Apps use `number` seconds. On-chain code uses `bigint`:
  `epochStartOfBigint` (was history `epochStartOf`), `EPOCH_SECONDS_BIGINT` (was
  history `EPOCH`) and `LAUNCH_EPOCH_START_BIGINT` (was Pro's
  `LAUNCH_EPOCH_START`).
- **Epochs before launch.** Classic's `epochIndexFor` returns negative indexes.
  Pro's `epochNumberFor` returns null, and `epochLabel` then shows "Epoch".
- **Two names for the length.** `EPOCH_SECONDS` (market's `epochSeconds`) and
  `WEEK` (academy) are the same constant.
- **The API shape.** `describeEpoch` returns the plain `Epoch` type. The zod
  `epochSchema` and the `currentEpochResponse` envelope stay in
  `@matchbox/contracts`, which builds them from `currentAndNextEpoch`.

## Renamed

| Was                                       | Now                                           |
| ----------------------------------------- | --------------------------------------------- |
| market `epochSeconds`                     | `EPOCH_SECONDS`                               |
| market `voteWindowPaddingSeconds`         | `VOTE_WINDOW_PADDING_SECONDS`                 |
| webapp `VOTE_WINDOW_CLOSE_OFFSET_SECONDS` | unchanged, now derived from the two above     |
| Pro `LAUNCH_EPOCH_START` (bigint)         | `LAUNCH_EPOCH_START_BIGINT`                   |
| history `EPOCH`, `epochStartOf` (bigint)  | `EPOCH_SECONDS_BIGINT`, `epochStartOfBigint`  |
| market `currentEpochResponse` body        | `currentAndNextEpoch` (envelope in contracts) |

## Tests

`src/epoch.test.ts` keeps the four Classic tests from
`lib/mezoGauges/epochs.test.ts` verbatim (moved from `node:test` to vitest)
and adds tests for the academy, market and Pro helpers, which had none.
