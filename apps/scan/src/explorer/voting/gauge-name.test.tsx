import { demoGauges } from "@matchbox/contracts/read-models/fixtures"
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { gaugeIdentity } from "../../data/scan/voting-views"
import { GaugeName } from "./parts"

describe("pool gauges that share a pair", () => {
  it("carry the pool type from the gauge reference", () => {
    expect(gaugeIdentity(demoGauges.btcMusd).poolLabel).toBe("Volatile")
    expect(gaugeIdentity(demoGauges.btcMusdCl).poolLabel).toBe("CL200")
    expect(gaugeIdentity(demoGauges.musdcMusd).poolLabel).toBe("Stable")
    expect(gaugeIdentity(demoGauges.smusd).poolLabel).toBeNull()
    expect(gaugeIdentity(demoGauges.kilnLabs).poolLabel).toBeNull()
  })

  it("are named with it wherever Matchscan names a gauge", () => {
    const volatile = render(
      <GaugeName gauge={gaugeIdentity(demoGauges.btcMusd)} />,
    )
    expect(volatile.container.textContent).toBe("BTC/MUSD Volatile")
    const cl = render(<GaugeName gauge={gaugeIdentity(demoGauges.btcMusdCl)} />)
    expect(cl.container.textContent).toBe("BTC/MUSD CL200")
    const kiln = render(
      <GaugeName gauge={gaugeIdentity(demoGauges.kilnLabs)} />,
    )
    expect(kiln.container.textContent).toBe("Kiln Labs")
  })

  it("never repeat a type the name already ends with", () => {
    const named = {
      ...gaugeIdentity(demoGauges.btcMusdCl),
      name: "BTC/MUSD CL200",
    }
    const view = render(<GaugeName gauge={named} />)
    expect(view.container.textContent).toBe("BTC/MUSD CL200")
  })
})
