import { strict as assert } from "node:assert"
import { describe, expect, test } from "vitest"
import {
  currentAndNextEpoch,
  describeEpoch,
  EARN_LAUNCH_EPOCH_START,
  EPOCH_SECONDS,
  EPOCH_ZERO_START,
  EPOCH_ZERO_START_BIGINT,
  enumerateEpochs,
  enumerateEpochsForWindow,
  epochClosesSinceLaunch,
  epochIndexFor,
  epochLabel,
  epochNumberFor,
  epochStartFor,
  epochStartForIndex,
  epochStartOf,
  epochStartOfBigint,
  isEpochStart,
  LAUNCH_EPOCH_START,
  resolveWindow,
  rewardedVoteEpochFor,
  snapToThursdayUTC,
  voteWindowCloseFor,
  WEEK,
} from "./epoch"

// Ported from apps/webapp/src/lib/mezoGauges/epochs.test.ts (node:test).

test("voteWindowCloseFor closes Wed 23:00 UTC", () => {
  assert.equal(voteWindowCloseFor(1_788_393_600), 1_788_994_800)
  assert.equal(voteWindowCloseFor(1_788_393_600 + WEEK), 1_789_599_600)
  assert.equal(voteWindowCloseFor(1_788_393_600 + 2 * WEEK), 1_790_204_400)
})

test("epochIndexFor numbers E0 from Thu 11 Dec 2025", () => {
  assert.equal(EPOCH_ZERO_START, Date.UTC(2025, 11, 11) / 1000)
  assert.equal(epochIndexFor(EPOCH_ZERO_START), 0)
  assert.equal(epochIndexFor(EPOCH_ZERO_START + WEEK), 1)
  assert.equal(epochIndexFor(EPOCH_ZERO_START + 2 * WEEK), 2)
})

test("Mezo Earn launched in Epoch 38 and Thu 5 Nov 2026 starts Epoch 47", () => {
  assert.equal(epochIndexFor(EARN_LAUNCH_EPOCH_START), 38)
  assert.equal(LAUNCH_EPOCH_START, EARN_LAUNCH_EPOCH_START)
  assert.equal(epochIndexFor(Date.UTC(2026, 10, 5) / 1000), 47)
  assert.equal(epochStartForIndex(47), Date.UTC(2026, 10, 5) / 1000)
})

test("rewardedVoteEpochFor attributes flip-time distributions to the prior vote epoch", () => {
  // E1 starts 1_788_998_400 (10 Sep); the 10 Sep 00:19 distribution pays
  // for E0's votes.
  const e1Start = LAUNCH_EPOCH_START + WEEK
  assert.equal(rewardedVoteEpochFor(e1Start + 1_140), LAUNCH_EPOCH_START)
  assert.equal(rewardedVoteEpochFor(e1Start + 2 * WEEK), e1Start + WEEK)
})

test("epochClosesSinceLaunch excludes the open epoch", () => {
  // Before E0 closes: nothing
  assert.deepEqual(epochClosesSinceLaunch(1_788_994_799), [])
  // Exactly at E0 close: [E0 close]
  assert.deepEqual(epochClosesSinceLaunch(1_788_994_800), [1_788_994_800])
  // Mid E1: still only E0's close
  assert.deepEqual(epochClosesSinceLaunch(1_789_000_000), [1_788_994_800])
  // After E1 close: both
  assert.deepEqual(
    epochClosesSinceLaunch(1_789_599_600),
    [1_788_994_800, 1_789_599_600],
  )
})

// The merged module's other entry points had no tests in Matchbox.

describe("epoch starts", () => {
  const thursday = 1_788_393_600
  const midWeek = thursday + 3 * 86_400 + 1_234

  test("every flavour agrees on Thursday 00:00 UTC", () => {
    expect(new Date(thursday * 1000).getUTCDay()).toBe(4)
    expect(epochStartOf(midWeek)).toBe(thursday)
    expect(epochStartFor(midWeek)).toBe(thursday)
    expect(epochStartOfBigint(BigInt(midWeek))).toBe(BigInt(thursday))
    expect(epochStartOf(thursday)).toBe(thursday)
  })

  test("only the guarded flavour clamps bad input", () => {
    expect(epochStartFor(-5)).toBe(0)
    expect(epochStartFor(Number.NaN)).toBe(0)
    // Unguarded, a negative timestamp truncates toward zero.
    expect(epochStartOf(-EPOCH_SECONDS - 5)).toBe(-EPOCH_SECONDS)
  })

  test("snaps up to the next boundary unless already on one", () => {
    expect(snapToThursdayUTC(midWeek, "up")).toBe(thursday + EPOCH_SECONDS)
    expect(snapToThursdayUTC(thursday, "up")).toBe(thursday)
  })

  test("validates epoch starts", () => {
    expect(isEpochStart(thursday)).toBe(true)
    expect(isEpochStart(0)).toBe(true)
    expect(isEpochStart(thursday + 1)).toBe(false)
    expect(isEpochStart(-EPOCH_SECONDS)).toBe(false)
    expect(isEpochStart(thursday + 0.5)).toBe(false)
  })
})

describe("describeEpoch", () => {
  const start = LAUNCH_EPOCH_START

  test("pads the vote window by an hour at each end", () => {
    expect(describeEpoch(start, start)).toEqual({
      start,
      end: start + EPOCH_SECONDS,
      voteStart: start + 3_600,
      voteEnd: start + EPOCH_SECONDS - 3_600,
      status: "current",
    })
    expect(describeEpoch(start, start).voteEnd).toBe(voteWindowCloseFor(start))
  })

  test("derives the status from now", () => {
    expect(describeEpoch(start, start - 1).status).toBe("upcoming")
    expect(describeEpoch(start, start + EPOCH_SECONDS - 1).status).toBe(
      "current",
    )
    expect(describeEpoch(start, start + EPOCH_SECONDS).status).toBe("closed")
  })

  test("returns the current and next epochs", () => {
    const { current, next } = currentAndNextEpoch(start + 10)
    expect(current.start).toBe(start)
    expect(current.status).toBe("current")
    expect(next.start).toBe(start + EPOCH_SECONDS)
    expect(next.status).toBe("upcoming")
  })
})

describe("epoch numbers", () => {
  test("counts from Epoch 0 and has none before it", () => {
    expect(epochNumberFor(EPOCH_ZERO_START_BIGINT)).toBe(0)
    expect(epochNumberFor(EPOCH_ZERO_START_BIGINT + 604_800n * 47n)).toBe(47)
    expect(epochNumberFor(EPOCH_ZERO_START_BIGINT - 604_800n)).toBeNull()
    expect(epochNumberFor(undefined)).toBeNull()
    expect(epochIndexFor(EPOCH_ZERO_START - EPOCH_SECONDS)).toBe(-1)
  })

  test("labels epochs", () => {
    expect(epochLabel(EPOCH_ZERO_START_BIGINT + 604_800n * 47n)).toBe(
      "Epoch 47",
    )
    expect(epochLabel(undefined)).toBe("Epoch")
  })
})

describe("epoch windows", () => {
  const e0 = LAUNCH_EPOCH_START

  test("enumerates closed epochs in the window", () => {
    expect(enumerateEpochs(e0 + 10, e0 + 2 * WEEK + 10)).toEqual([
      e0,
      e0 + WEEK,
    ])
    expect(enumerateEpochs(e0 + WEEK, e0)).toEqual([])
  })

  test("adds the open epoch on request", () => {
    expect(
      enumerateEpochsForWindow(e0, e0 + WEEK + 10, { includeOpenEpoch: true }),
    ).toEqual([e0, e0 + WEEK])
    expect(
      enumerateEpochsForWindow(e0, e0 + WEEK, { includeOpenEpoch: true }),
    ).toEqual([e0])
    expect(enumerateEpochsForWindow(e0, e0 + WEEK + 10)).toEqual([e0])
  })

  test("defaults to the last eight epochs", () => {
    expect(resolveWindow(null, null, e0 + 10 * WEEK + 5)).toEqual({
      fromTs: e0 + 2 * WEEK,
      toTs: e0 + 10 * WEEK,
    })
    expect(resolveWindow(String(e0 + 3), String(e0 + 2 * WEEK + 3), 0)).toEqual(
      { fromTs: e0, toTs: e0 + 2 * WEEK },
    )
    expect(resolveWindow("x", null, e0 + 10 * WEEK)).toEqual({
      fromTs: e0 + 2 * WEEK,
      toTs: e0 + 10 * WEEK,
    })
  })
})
