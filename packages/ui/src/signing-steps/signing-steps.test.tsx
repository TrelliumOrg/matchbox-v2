import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import * as Toast from "../toast"
import * as SigningSteps from "./index"

afterEach(() => {
  cleanup()
})

const href = `https://scan.matchbox.markets/tx/0x${"ab".repeat(32)}`

describe("signing steps", () => {
  it("links a signed step inline and a failed step on its own line", () => {
    render(
      <SigningSteps.Root>
        <SigningSteps.Step
          index={1}
          label="Claim 958.96 MEZO"
          status="done"
          detail="Signed"
          link={{ href, label: "view on Matchscan" }}
        />
        <SigningSteps.Step
          index={2}
          label="Add to veMEZO #2930"
          status="failed"
          detail="Failed on chain, lock expired"
          link={{ href, label: "View on Matchscan" }}
        />
      </SigningSteps.Root>,
    )
    const [signed, failed] = screen.getAllByRole("listitem")
    expect(signed?.textContent).toContain("Signed, view on Matchscan")
    expect(failed?.textContent).toContain("Failed on chain, lock expired")
    const links = screen.getAllByRole("link")
    expect(links.map((link) => link.getAttribute("href"))).toEqual([href, href])
    expect(links[1]?.parentElement?.className).toContain("block")
  })
})

describe("toast", () => {
  it("draws a red countdown line for a failure", () => {
    const { container } = render(
      <Toast.Root
        title="Failed on chain, lock expired"
        tone="negative"
        duration={6000}
        onClose={() => undefined}
      />,
    )
    const line = [...container.querySelectorAll("span")].find((span) =>
      span.className.includes("h-[3px]"),
    )
    expect(line?.className).toContain("bg-neg")
  })
})
