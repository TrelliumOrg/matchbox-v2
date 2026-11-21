import * as SigningSteps from "@matchbox/ui/signing-steps"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { applyStepEvent, startSigning, stepDetail, stepLink } from "./steps"
import { TxLinks } from "./tx-links"

afterEach(() => {
  cleanup()
})

const hash = `0x${"ab".repeat(32)}` as const

describe("a transaction's links", () => {
  it("offers Matchscan as the button and Mezo Explorer beside it (success)", () => {
    render(<TxLinks hash={hash} />)
    const scan = screen.getByRole("link", { name: "View on Matchscan" })
    const explorer = screen.getByRole("link", { name: "Mezo Explorer" })
    expect(scan.getAttribute("href")).toBe(
      `https://scan.matchbox.markets/tx/${hash}`,
    )
    expect(explorer.getAttribute("href")).toBe(
      `https://explorer.mezo.org/tx/${hash}`,
    )
    for (const link of [scan, explorer]) {
      expect(link.getAttribute("target")).toBe("_blank")
      expect(link.getAttribute("rel")).toBe("noreferrer noopener")
    }
    // The button first; the explorer smaller and quieter.
    expect(scan.compareDocumentPosition(explorer)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(scan.className).toContain("h-11")
    expect(explorer.className).toContain("text-[14px]")
    expect(explorer.className).toContain("text-sec")
  })

  it("links a step while it waits for its block (pending)", () => {
    let steps = startSigning([{ id: "vote", label: "Vote with #2207" }])
    steps = applyStepEvent(steps, { type: "wallet", id: "vote" })
    steps = applyStepEvent(steps, { type: "submitted", id: "vote", hash })
    const [step] = steps
    if (step === undefined) throw new Error("no step")
    render(
      <SigningSteps.Root>
        <SigningSteps.Step
          index={1}
          label={step.label}
          status={step.status}
          detail={stepDetail(step)}
          link={stepLink(step)}
        />
      </SigningSteps.Root>,
    )
    expect(
      screen
        .getByRole("link", { name: "view on Matchscan" })
        .getAttribute("href"),
    ).toBe(`https://scan.matchbox.markets/tx/${hash}`)
    expect(
      screen.getByRole("link", { name: "Mezo Explorer" }).getAttribute("href"),
    ).toBe(`https://explorer.mezo.org/tx/${hash}`)
  })
})
