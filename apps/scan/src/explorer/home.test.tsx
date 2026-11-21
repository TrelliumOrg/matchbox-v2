import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { positionsTile } from "../data/scan/home-views"
import { HomeTiles } from "./home"

describe("Home's positions tile", () => {
  it("names what it counts, open MUSD loans, not Borrow's open positions", () => {
    const tile = positionsTile({ troves: 4, enclaves: 1, markets: 1 })
    if (tile === null) throw new Error("expected a tile")
    render(<HomeTiles tiles={[tile]} />)
    expect(screen.getByText("Open MUSD loans")).toBeTruthy()
    expect(screen.queryByText("Open positions")).toBeNull()
    expect(screen.getByText("1 Enclave, 1 MUSD Morpho")).toBeTruthy()
  })
})
