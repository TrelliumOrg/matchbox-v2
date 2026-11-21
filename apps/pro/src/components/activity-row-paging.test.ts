import { EPOCH_SECONDS, EPOCH_ZERO_START } from "@matchbox/domain"
import { describe, expect, it } from "vitest"
import type { ActivityEvent } from "../data/view-models"
import { epochSpan, epochZeroStart, pendingLine } from "./activity-row"

function event(epoch: number, at: number): ActivityEvent {
  return {
    id: `${epoch}-${at}`,
    status: "confirmed",
    at,
    epoch,
    block: 1,
    tx: `0x${"1".repeat(64)}`,
    detail: { kind: "own", label: "Vote" },
  }
}

const start = (epoch: number) => EPOCH_ZERO_START + epoch * EPOCH_SECONDS

describe("epochSpan", () => {
  it("dates Epoch 0 as the domain does", () => {
    expect(epochZeroStart).toBe(EPOCH_ZERO_START)
  })

  it("names one epoch, a range, or nothing", () => {
    expect(epochSpan([])).toBe("")
    expect(epochSpan([event(49, start(49) + 60)])).toBe("Epoch 49")
    expect(
      epochSpan([event(49, start(49) + 60), event(32, start(32) + 60)]),
    ).toBe("Epoch 32 to 49")
  })

  it("counts Epoch 0 from its first second", () => {
    expect(epochSpan([event(0, EPOCH_ZERO_START)])).toBe("Epoch 0")
    expect(epochSpan([event(38, start(38)), event(0, EPOCH_ZERO_START)])).toBe(
      "Epoch 0 to 38",
    )
  })

  it("never numbers what came before Epoch 0", () => {
    // The adapter files such events under Epoch 0; their time says earlier.
    const early = event(0, EPOCH_ZERO_START - 1)
    expect(epochSpan([early])).toBe("Before Epoch 0")
    expect(epochSpan([event(12, start(12) + 1), early])).toBe(
      "Before Epoch 0 to Epoch 12",
    )
  })
})

describe("pendingLine", () => {
  it("names the oldest epoch on the list, never before Epoch 0", () => {
    expect(
      pendingLine([event(49, start(49) + 60), event(19, start(19) + 60)]),
    ).toBe("Epoch 19 and earlier are still being added")
    expect(pendingLine([event(0, EPOCH_ZERO_START)])).toBe(
      "Epoch 0 and earlier are still being added",
    )
    expect(pendingLine([event(0, EPOCH_ZERO_START - 1)])).toBe(
      "Earlier activity is still being added",
    )
    expect(pendingLine([])).toBe("Earlier activity is still being added")
  })
})
