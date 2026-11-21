import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { manifest } from "@matchbox/docs/manifest"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { clockAt, countdown } from "./content/epoch-clock"
import { PathText } from "./content/reference"
import { Body } from "./content/render"
import pageTitle from "./shell/page-title"

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = join(directory, name)
    return statSync(full).isDirectory() ? files(full) : [full]
  })
}

describe("static docs", () => {
  it("has no server functions or server loaders", () => {
    // A server function or a data loader would make a page view or a client
    // navigation reach the Worker. Every page must be a static asset.
    for (const file of files(join(process.cwd(), "src"))) {
      if (!/\.(ts|tsx)$/.test(file) || file.endsWith(".test.tsx")) continue
      const source = readFileSync(file, "utf8")
      expect(source, file).not.toMatch(/createServerFn|createServerOnlyFn/)
      if (!file.endsWith("server.ts"))
        expect(source, file).not.toContain("cloudflare:workers")
    }
  })
})

describe("the epoch clock", () => {
  it("numbers epochs from Thu 11 Dec 2025", () => {
    // Thu 5 Nov 2026 00:00 UTC starts Epoch 47 (matchbox-v3, Decided 9 Nov).
    expect(clockAt(1_793_836_800)).toMatchObject({
      epoch: 47,
      start: 1_793_836_800,
      end: 1_794_441_600,
    })
    expect(clockAt(1_793_836_799).epoch).toBe(46)
    expect(clockAt(1_765_411_200).epoch).toBe(0)
  })

  it("counts down in days and hours", () => {
    expect(countdown(2 * 86_400 + 14 * 3_600 + 59)).toBe("2d 14h")
    expect(countdown(3 * 3_600 + 5 * 60)).toBe("3h 5m")
    expect(countdown(-5)).toBe("0m")
  })
})

describe("the renderer", () => {
  it("makes the first paragraph the lead and renders tables and callouts", () => {
    render(
      <Body
        nodes={[
          { t: "p", c: ["Lead text."] },
          {
            t: "callout",
            p: { tone: "note", title: "Votes carry over" },
            c: [{ t: "p", c: ["Body."] }],
          },
          {
            t: "table",
            c: [
              { t: "thead", c: [{ t: "tr", c: [{ t: "th", c: ["Type"] }] }] },
              {
                t: "tbody",
                c: [
                  { t: "tr", p: { id: "row" }, c: [{ t: "td", c: ["veBTC"] }] },
                ],
              },
            ],
          },
        ]}
      />,
    )
    expect(screen.getByText("Lead text.").className).toContain("text-[18px]")
    expect(
      screen.getByRole("complementary", { name: "Votes carry over" })
        .textContent,
    ).toContain("Votes carry over. Body.")
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeTruthy()
    expect(document.getElementById("row")).not.toBeNull()
  })
})

describe("the API reference", () => {
  it("keeps an operation's path whole, breaking only before a slash", () => {
    const path = "/gauges/{network}/{gaugeAddress}/epochs"
    const { container } = render(
      <span>
        <PathText path={path} />
      </span>,
    )
    expect(container.textContent).toBe(path)
    expect(container.querySelectorAll("wbr")).toHaveLength(4)
    for (const wbr of container.querySelectorAll("wbr"))
      expect(wbr.nextSibling?.textContent?.startsWith("/")).toBe(true)
    const reference = readFileSync(
      join(process.cwd(), "src/content/reference.tsx"),
      "utf8",
    )
    expect(reference).not.toMatch(/truncate[^"]*font-mono/)
  })
})

describe("page titles", () => {
  it("are unique, naming the product where a concept shares the title", () => {
    const pages = Object.values(manifest.pages)
    const titles = pages.map((page) => pageTitle(page, manifest.pages))
    expect(new Set(titles).size).toBe(titles.length)
    const at = (path: string): string => {
      const page = manifest.pages[path]
      if (page === undefined) throw new Error(`${path} is not a page`)
      return pageTitle(page, manifest.pages)
    }
    expect(at("/pro/locks")).toBe("Locks in Matchbox Pro, Matchbox Docs")
    expect(at("/concepts/locks")).toBe("Locks, Matchbox Docs")
    expect(at("/scan/borrow")).toBe("Borrow in Matchscan, Matchbox Docs")
    expect(at("/pro/vote")).toBe("Vote, Matchbox Docs")
  })
})
