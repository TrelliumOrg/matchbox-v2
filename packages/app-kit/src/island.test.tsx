import { act, cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { island } from "./island"

afterEach(cleanup)

/**
 * Regression test for Pro's 0.23 CLS: a section still waiting to hydrate
 * that receives new props is thrown away and rendered again from an empty
 * fallback. Parents re-render with equal data after hydration (a live query
 * settling), so an island must only re-render when its data really changes.
 */

let renders = 0

type Props = { stats: { epoch: number; voters: string[] }; label: string }

function Stats({ stats, label }: Props): ReactNode {
  renders += 1
  return (
    <p>
      {label} {stats.epoch} {stats.voters.join(",")}
    </p>
  )
}

const Island = island<Props>("stats", async () => Stats)

describe("island memoisation", () => {
  it("does not re-render for equal data in new objects", async () => {
    renders = 0
    const { rerender } = render(
      <Island stats={{ epoch: 47, voters: ["a", "b"] }} label="Epoch" />,
    )
    expect(await screen.findByText("Epoch 47 a,b")).toBeTruthy()
    const settled = renders
    // A live query settles: same values, new object identities.
    for (let pass = 0; pass < 5; pass += 1) {
      await act(async () => {
        rerender(
          <Island stats={{ epoch: 47, voters: ["a", "b"] }} label="Epoch" />,
        )
      })
    }
    expect(renders).toBe(settled)
  })

  it("re-renders when the data really changes", async () => {
    renders = 0
    const { rerender } = render(
      <Island stats={{ epoch: 47, voters: ["a"] }} label="Epoch" />,
    )
    await screen.findByText("Epoch 47 a")
    const settled = renders
    await act(async () => {
      rerender(<Island stats={{ epoch: 48, voters: ["a"] }} label="Epoch" />)
    })
    expect(screen.getByText("Epoch 48 a")).toBeTruthy()
    expect(renders).toBe(settled + 1)
  })
})
