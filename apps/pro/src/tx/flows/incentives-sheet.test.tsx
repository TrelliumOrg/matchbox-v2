import { render } from "@testing-library/react"
import type { Config } from "@wagmi/core"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { GaugeSummary } from "../../data/view-models"
import { gaugesSample } from "../../features/samples"
import { IncentivesSheet } from "./incentives-sheet"

/**
 * The add-incentives sheet says what a gauge already holds as its tile
 * does: "Unpriced" for tokens without a USD value, never "$0.00".
 */

vi.mock("../../live/live-context", () => ({
  useLive: () => ({
    market: { prices: {}, epoch: { number: 49, endsAt: 1_795_000_000 } },
  }),
}))
vi.mock("./parts", () => ({
  useChainRead: () => ({ data: null, failed: false }),
  AmountField: () => null,
}))
vi.mock("../tx-sheet", () => ({
  TxSheet: ({ form }: { form: { content: ReactNode } }) => form.content,
}))

function sheet(fields: Partial<GaugeSummary>) {
  const base = gaugesSample.gauges[0]
  if (base === undefined) throw new Error("sample")
  return render(
    <IncentivesSheet
      request={{ flow: "incentives", gauge: { ...base, ...fields } }}
      config={{} as Config}
      account={`0x${"ab".repeat(20)}`}
    />,
  )
}

describe("the add-incentives sheet", () => {
  it("shows unpriced incentives as the tile does", () => {
    const unpriced = sheet({
      incentivesUsd: "0.00",
      priced: false,
      unpriced: 1,
    })
    expect(unpriced.getAllByText("Unpriced").length).toBe(2)
    expect(unpriced.queryByText("$0.00")).toBeNull()
    unpriced.unmount()
    const mixed = sheet({ incentivesUsd: "1.15", priced: true, unpriced: 2 })
    expect(mixed.container.textContent).toContain("$1.15 + 2 unpriced")
    mixed.unmount()
    const priced = sheet({ incentivesUsd: "120.00", priced: true, unpriced: 0 })
    expect(priced.getAllByText("$120.00").length).toBe(2)
  })
})
