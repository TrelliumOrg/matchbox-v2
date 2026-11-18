import { readFileSync } from "node:fs"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { axe, spokenText, watch } from "./helpers"

/**
 * The homepage built and served by workerd with the fixture figures
 * (playwright.config.ts). Desktop runs at 1440 and phone on a Pixel 7;
 * the 1024 checks set their own viewport. Nothing here asserts how long
 * anything takes: waits are on conditions.
 */

async function recordShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shifts: number[] = []
    ;(window as unknown as { shifts: number[] }).shifts = shifts
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        shifts.push((entry as unknown as { value: number }).value)
      }
    }).observe({ type: "layout-shift", buffered: true })
  })
}

/** What a screen reader reads, with every run of spaces as one space. */
async function spoken(locator: Locator): Promise<string> {
  return (await spokenText(locator)).replace(/\s+/g, " ")
}

async function shifts(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { shifts: number[] }).shifts)
}

test("paints every figure from the snapshot on first paint", async ({
  page,
}) => {
  const errors = watch(page)
  await page.goto("/")
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Use Mezo with Matchbox",
    }),
  ).toBeVisible()
  await expect(page.locator('[data-live="pro.incentivesTotal"]')).toHaveText(
    "$14,820",
  )
  await expect(page.locator('[data-live="scan.vebtcLocked"]')).toContainText(
    "BTC",
  )
  // Borrowed is in MUSD, abbreviated, never in dollars.
  const borrowed = page.locator('[data-live="scan.borrowed"]')
  await expect(borrowed).toBeVisible()
  await expect.poll(() => spoken(borrowed)).toBe("4.06M MUSD")
  await expect
    .poll(() => spoken(page.locator('[data-live="scan.borrowedEnclaves"]')))
    .toBe("98.6%")
  await expect(page.locator('[data-live="scan.borrowedSeries"]')).toBeVisible()
  const stat = page.locator(".st").filter({ has: borrowed })
  expect(await stat.textContent()).not.toContain("$")
  // The countdown morphs: read what a screen reader reads, not the
  // morph's hidden letters as well.
  await expect
    .poll(() => spokenText(page.locator('[data-computed="epoch.countdown"]')))
    .toMatch(/^(\d+d( \d+h)?|\d+h \d+m|\d+m)$/)
  await expect(page.getByText("Ask about your locks.")).toBeVisible()
  expect(errors).toEqual([])
})

test("never shows a skeleton, a spinner or a zero", async ({ page }) => {
  await page.goto("/")
  const text = (await page.locator("main").textContent()) ?? ""
  expect(text).not.toMatch(/Loading|\$0\b/)
  await expect(page.locator("[data-skeleton], [aria-busy=true]")).toHaveCount(0)
})

test("moves nothing when the fresh figures swap in", async ({ page }) => {
  // The first fresh read lands on the snapshot the page was rendered from
  // (it is under 15 s old), so the figures change at the first new block
  // once they are 30 s old (page/live.tsx), when the fixtures have moved
  // the latest blocks on. Wait for that swap.
  test.setTimeout(90_000)
  await recordShifts(page)
  await page.goto("/")
  const first = page.locator('[data-live="scan.block1.number"]')
  const painted = await spokenText(first)
  await expect
    .poll(() => spokenText(first), { timeout: 60_000 })
    .not.toBe(painted)
  expect(await shifts(page)).toEqual([])
  // Once the counts roll, each count's digits still sit on its unit's
  // line: NumberFlow, mounted now, keeps the baseline of the text it
  // replaced.
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll(".br .a")].map((cell) => {
          const flow = cell.querySelector(".tc number-flow-react")
          const digit = flow?.shadowRoot?.querySelector('[part~="digit"]')
          const unit = cell.querySelector('.tu > [aria-hidden="false"]')
          if (!digit || !unit?.firstChild) return "not rolled"
          const range = document.createRange()
          range.selectNodeContents(unit.firstChild)
          const off =
            digit.getBoundingClientRect().top -
            range.getBoundingClientRect().top
          return Math.abs(off) < 0.5 ? "aligned" : `off by ${off}`
        }),
      ),
    )
    .toEqual(["aligned", "aligned", "aligned"])
})

test("is axe clean in light and dark", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto("/")
    await expect(page.locator("h1")).toBeVisible()
    expect(await axe(page)).toEqual([])
  }
})

test("is axe clean and fits at 1024 and 390 wide, light and dark", async ({
  page,
}) => {
  for (const width of [1024, 390]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto("/")
      await expect(page.locator("h1")).toBeVisible()
      expect(await axe(page), `${width} ${scheme}`).toEqual([])
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(overflow, `${width} ${scheme}`).toBeLessThanOrEqual(0)
      await expect(page.locator('[data-live="scan.borrowed"]')).toContainText(
        "MUSD",
      )
      expect(await clippedFigures(page), `${width} ${scheme}`).toEqual([])
    }
  }
})

test("swaps Borrowed between Not available and values without moving anything", async ({
  page,
}) => {
  // The page paints the fixture's value; the slot is then set to each
  // state it can show, in place, and every box on the card is measured.
  // A value that arrives later, or changes, takes the same room. Every
  // abbreviated value is at most four digits and a suffix ("888.9M"),
  // which fits at every width: on phones the subline goes under it.
  const widths = [
    { width: 1440, widest: true },
    { width: 1024, widest: true },
    { width: 390, widest: true },
    { width: 412, widest: true },
    { width: 360, widest: true },
  ]
  for (const { width, widest } of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const borrowed = page.locator('[data-live="scan.borrowed"]')
    await expect(borrowed).toContainText("MUSD")
    const states = await page.evaluate((widest) => {
      const slot = document.querySelector<HTMLElement>(
        '[data-live="scan.borrowed"]',
      )
      const stat = slot?.closest<HTMLElement>(".st")
      const card = slot?.closest<HTMLElement>(".hc")
      const subline = stat?.querySelector<HTMLElement>(".s")
      if (!slot || !stat || !card || !subline) return null
      const boxes = (): string[] =>
        [...card.querySelectorAll<HTMLElement>(".st, .st .h, .st .v, .blk")]
          .map((box) => {
            const rect = box.getBoundingClientRect()
            // The value's own box may widen beside an empty subline; its
            // start and height must not move.
            const width = box.matches(".v") ? "" : rect.width
            return `${rect.left},${rect.top},${width},${rect.height}`
          })
          .concat(
            `${slot.getBoundingClientRect().left}`,
            `${slot.getBoundingClientRect().top}`,
          )
      const clipped = (): boolean =>
        [slot, slot.parentElement, stat].some(
          (box) => box !== null && box.scrollWidth > box.clientWidth,
        )
      const painted = { boxes: boxes(), clipped: clipped() }
      const sublineHtml = subline.innerHTML
      const results: Record<string, { boxes: string[]; clipped: boolean }> = {}
      const set = (value: string | null, share: boolean): void => {
        slot.innerHTML =
          value === null
            ? '<span class="na ">Not available</span>'
            : `<span class=" ">${value}&nbsp;MUSD</span>`
        subline.innerHTML = share ? sublineHtml : ""
      }
      const values: [string, string | null, boolean][] = [
        ["not available", null, false],
        ["no share", "4.06M", false],
        ["three digits", "9.99M", true],
        ["thousands", "999k", true],
      ]
      if (widest) values.push(["four digits", "888.9M", true])
      for (const [name, value, share] of values) {
        set(value, share)
        results[name] = { boxes: boxes(), clipped: clipped() }
      }
      return { painted, results }
    }, widest)
    if (states === null) throw new Error("no Borrowed stat")
    expect(states.painted.clipped, `${width}`).toBe(false)
    for (const [name, state] of Object.entries(states.results)) {
      expect(state.boxes, `${width} ${name}`).toEqual(states.painted.boxes)
      expect(state.clipped, `${width} ${name}`).toBe(false)
    }
  }
})

test("keeps room for a transaction count to gain a digit", async ({ page }) => {
  // A count going from 9 to 10 must not widen its cell and move it: each
  // count's box is at least as wide as "100" set in the same font.
  await page.goto("/")
  await expect(page.locator(".br .tc")).toHaveCount(3)
  const short = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".br .tc")].flatMap((cell) => {
      const probe = document.createElement("span")
      probe.textContent = "100"
      probe.style.position = "absolute"
      probe.style.visibility = "hidden"
      cell.parentElement?.appendChild(probe)
      const room = cell.getBoundingClientRect().width
      const needs = probe.getBoundingClientRect().width
      probe.remove()
      return room + 0.5 < needs ? [`${room} < ${needs}`] : []
    }),
  )
  expect(short).toEqual([])
})

/**
 * The fixture validators (src/data/fixtures.ts, `validatorsFixture`): each
 * name and the short address its blocks show without it. A fifth
 * proposer has no name.
 */
const longName =
  "Northern Hemisphere Validators Collective and Staking Cooperative of Mezo Nodes"
const validators: readonly (readonly [string, string])[] = [
  ["Northfield Nodes", "0x6e35…23b5"],
  ["Harbor Stake", "0x41b1…0971"],
  ["Copperline", "0x9c0f…b8c9"],
  [longName, "0x2f6d…9c1e"],
]
const unnamedProposer = "0xd056…0247"

const validatorSlots = '[data-live^="scan.block"][data-live$=".validator"]'

test("names each block's validator, else its short address", async ({
  page,
}) => {
  await page.goto("/")
  const slots = page.locator(validatorSlots)
  await expect(slots).toHaveCount(3)
  const shown = await Promise.all((await slots.all()).map(spoken))
  const known = [...validators.map(([name]) => name), unnamedProposer]
  for (const text of shown) expect(known).toContain(text)
  // Three blocks in a row are three of the five proposers' turns, so at
  // least two have a name: names show from first paint.
  expect(
    shown.filter((text) => text === unnamedProposer).length,
  ).toBeLessThanOrEqual(1)
  // The full name is there on hover, however much the row shows.
  for (const [index, slot] of (await slots.all()).entries()) {
    expect(await slot.getAttribute("title")).toBe(shown[index])
  }
})

type RowBoxes = {
  boxes: string[]
  /** Each name's line: one line high, its morph no wider than the cell. */
  lines: string[]
}

/** Every box in the latest blocks, and how each name sits in its cell. */
function rowBoxes(page: Page): Promise<RowBoxes> {
  return page.evaluate(() => {
    const at = (box: Element): string => {
      const rect = box.getBoundingClientRect()
      return `${rect.left},${rect.top},${rect.width},${rect.height}`
    }
    const rows = [...document.querySelectorAll<HTMLElement>(".blk .br")]
    return {
      boxes: rows.flatMap((row) =>
        [row, ...row.querySelectorAll(".bi, .n, .s, .a, .tc, .tu")].map(at),
      ),
      lines: rows.map((row) => {
        const cell = row.querySelector<HTMLElement>(".s")
        const root = cell?.querySelector<HTMLElement>("[torph-root]")
        if (!cell || !root) return "no morph"
        const tall = cell.getBoundingClientRect().height
        const wide = root.getBoundingClientRect().width
        const cut = root.scrollWidth > root.clientWidth
        const ellipsis = getComputedStyle(root).textOverflow === "ellipsis"
        return [
          tall === 18 ? "one line" : `${tall} high`,
          wide <= cell.clientWidth + 0.5 ? "fits" : `${wide} wide`,
          cut ? (ellipsis ? "cut with an ellipsis" : "cut bare") : "whole",
        ].join(", ")
      }),
    }
  })
}

/**
 * The page painted as if the edge knew no names yet (each fixture name
 * written over with its short address, in the markup and in the seed
 * alike), and the browser's fresh read held until the text morph has
 * loaded, then let through with every name made the long one: each named
 * row's address swaps for a name too long for it, through the morph.
 * Under reduced motion the morph renders no pieces of its own, so the
 * wait is for its chunk instead (`torphChunk`).
 */
async function nameArrivesLater(
  page: Page,
  motion: "full" | "reduced",
): Promise<{
  release: () => void
  named: number[]
}> {
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      const response = await route.fetch()
      let html = await response.text()
      // In the title and the seed with spaces, in the text with no-break
      // spaces (cards.tsx).
      for (const [name, short] of validators) {
        html = html
          .replaceAll(name, short)
          .replaceAll(name.replaceAll(" ", " "), short)
      }
      const headers = { ...response.headers() }
      delete headers["content-encoding"]
      delete headers["content-length"]
      await route.fulfill({ response, headers, body: html })
    },
  )
  let release = (): void => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/_serverFn/**", async (route) => {
    await released
    const response = await route.fetch()
    let body = await response.text()
    for (const [name] of validators) body = body.replaceAll(name, longName)
    const headers = { ...response.headers() }
    delete headers["content-encoding"]
    delete headers["content-length"]
    await route.fulfill({ response, headers, body })
  })
  await page.goto("/")
  await expect(page.locator(validatorSlots)).toHaveCount(3)
  // The morph has taken every name over, as it has by a later swap.
  if (motion === "full") {
    await expect(page.locator(`${validatorSlots} [torph-root]`)).toHaveCount(3)
  } else {
    const chunk = torphChunk()
    await expect
      .poll(() =>
        page.evaluate(
          (name) =>
            performance
              .getEntriesByType("resource")
              .some((entry) => entry.name.endsWith(`/${name}`)),
          chunk,
        ),
      )
      .toBe(true)
  }
  const painted = await Promise.all(
    (await page.locator(validatorSlots).all()).map(spoken),
  )
  const named = painted.flatMap((text, index) =>
    text === unnamedProposer ? [] : [index],
  )
  for (const index of named) {
    expect(validators.map(([, short]) => short)).toContain(painted[index])
  }
  return { release, named }
}

/** The build's chunk that holds the text morph (torph). */
function torphChunk(): string {
  const modules = JSON.parse(
    readFileSync(
      new URL("../dist/chunk-modules.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, string[]>
  const chunk = Object.entries(modules).find(([, files]) =>
    files.some((file) => file.includes("/torph/")),
  )?.[0]
  if (chunk === undefined) throw new Error("no chunk holds torph")
  return chunk
}

async function swapped(page: Page, named: readonly number[]): Promise<void> {
  const slots = await page.locator(validatorSlots).all()
  for (const index of named) {
    const slot = slots[index]
    if (slot === undefined) throw new Error(`no row ${index + 1}`)
    await expect.poll(() => spoken(slot)).toBe(longName)
  }
}

test("swaps a name in for its address in place, cut with an ellipsis, at 1440, 1024 and 390", async ({
  page,
}) => {
  await recordShifts(page)
  for (const width of [1440, 1024, 390]) {
    await page.unrouteAll({ behavior: "wait" })
    await page.setViewportSize({ width, height: 900 })
    const { release, named } = await nameArrivesLater(page, "full")
    const before = await rowBoxes(page)
    release()
    await swapped(page, named)
    // Once the morph has settled.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            [...document.querySelectorAll(".blk .s")]
              .flatMap((cell) => cell.getAnimations({ subtree: true }))
              .filter((animation) => animation.playState === "running").length,
        ),
      )
      .toBe(0)
    const after = await rowBoxes(page)
    expect(after.boxes, `${width}`).toEqual(before.boxes)
    expect(before.lines, `${width}`).not.toContain("no morph")
    for (const [index, line] of after.lines.entries()) {
      expect(line, `${width} row ${index + 1}`).toBe(
        named.includes(index)
          ? "one line, fits, cut with an ellipsis"
          : "one line, fits, whole",
      )
    }
    expect(await clippedFigures(page), `${width}`).toEqual([])
    expect(await shifts(page), `${width}`).toEqual([])
  }
})

test("swaps a name in without motion under reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  const { release, named } = await nameArrivesLater(page, "reduced")
  // Every animation that starts in a name's cell, from the swap on.
  await page.evaluate(() => {
    const started: string[] = []
    ;(window as unknown as { started: string[] }).started = started
    document.addEventListener(
      "animationstart",
      (event) => started.push(String(event.type)),
      true,
    )
    new MutationObserver(() => {
      for (const cell of document.querySelectorAll(".blk .s")) {
        for (const animation of cell.getAnimations({ subtree: true })) {
          started.push(animation.constructor.name)
        }
      }
    }).observe(document.querySelector(".blk") ?? document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
  })
  release()
  await swapped(page, named)
  expect(
    await page.evaluate(
      () => (window as unknown as { started: string[] }).started,
    ),
  ).toEqual([])
})

/**
 * Every live or computed figure whose text runs past a box that clips it,
 * from the figure up to its card: "key: needs > has". A validator's name
 * ends in an ellipsis in its own cell instead (the names tests).
 */
async function clippedFigures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const clipped: string[] = []
    const figures = document.querySelectorAll<HTMLElement>(
      "[data-live], [data-computed]",
    )
    for (const figure of figures) {
      if (!(figure instanceof HTMLElement)) continue
      const key =
        figure.getAttribute("data-live") ?? figure.getAttribute("data-computed")
      // A validator's name is cut with an ellipsis on purpose, inside its
      // cell; nothing around it may clip it.
      const cut = key?.endsWith(".validator") === true
      for (
        let box: HTMLElement | null = cut ? figure.parentElement : figure;
        box !== null && !box.classList.contains("hc");
        box = box.parentElement
      ) {
        if (box !== figure && getComputedStyle(box).overflowX === "visible") {
          continue
        }
        if (box.scrollWidth > box.clientWidth) {
          clipped.push(`${key}: ${box.scrollWidth} > ${box.clientWidth}`)
          break
        }
      }
    }
    return clipped
  })
}

test("clips no figure at 1024 wide, before or after the swap", async ({
  page,
}) => {
  // Matchscan's two stats stack below 1180 wide: "1,404.32 BTC" needs
  // 186 px and side by side has 161 at 1024. The wait is for the first
  // swap, as in "moves nothing when the fresh figures swap in".
  test.setTimeout(90_000)
  await recordShifts(page)
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto("/")
  await expect(page.locator('[data-live="scan.vebtcLocked"]')).toContainText(
    "BTC",
  )
  // The check covers Borrowed's value too, now that it has one.
  await expect(page.locator('[data-live="scan.borrowed"]')).toContainText(
    "MUSD",
  )
  expect(await clippedFigures(page)).toEqual([])
  const first = page.locator('[data-live="scan.block1.number"]')
  const painted = await spokenText(first)
  await expect
    .poll(() => spokenText(first), { timeout: 60_000 })
    .not.toBe(painted)
  expect(await clippedFigures(page)).toEqual([])
  expect(await shifts(page)).toEqual([])
})

test("the theme switch changes and keeps the theme", async ({
  page,
  isMobile,
}) => {
  // On the phone the switch is in the menu (the 390 frame's header has
  // only the menu button).
  const open = async (): Promise<void> => {
    if (isMobile) await page.getByRole("button", { name: "Menu" }).click()
  }
  await page.goto("/")
  await open()
  await page.getByRole("radio", { name: "Dark" }).check()
  const dark = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme"),
  )
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-theme", dark ?? "")
  await open()
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked()
})

test("the phone menu reaches every product, by keyboard too", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "the menu button is the phone header's")
  const menu = page.locator("#home-menu")
  const button = page.getByRole("button", { name: "Menu" })
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto("/")
    await expect(page.locator("header .r > .ts")).toBeHidden()
    await expect(menu).toBeHidden()
    await button.focus()
    await page.keyboard.press("Enter")
    await expect(menu).toBeVisible()
    for (const name of ["Pro", "Matchscan", "ID", "Developer", "Docs"]) {
      await expect(menu.getByRole("link", { name, exact: true })).toBeVisible()
    }
    // The menu follows its button in the tab order.
    await page.keyboard.press("Tab")
    await expect(menu.getByRole("link", { name: "Pro" })).toBeFocused()
    expect(await axe(page)).toEqual([])
    await page.keyboard.press("Escape")
    await expect(menu).toBeHidden()
    await expect(button).toBeFocused()
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test("the phone's ID and Developer row scrolls sideways, by keyboard too", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "the row is the 390 frame's")
  await page.goto("/")
  const row = page.locator("section.b2")
  const layout = await row.evaluate((element) => {
    const cards = [...element.querySelectorAll<HTMLElement>(".pc")]
    return {
      scrolls: element.scrollWidth > element.clientWidth,
      widths: cards.map((card) => card.getBoundingClientRect().width),
      developerLeft: cards[1]?.getBoundingClientRect().left ?? 0,
      snap: getComputedStyle(element).scrollSnapType,
    }
  })
  expect(layout.scrolls).toBe(true)
  expect(layout.widths).toEqual([300, 300])
  // Developer peeks in from the right.
  expect(layout.developerLeft).toBeLessThan(page.viewportSize()?.width ?? 0)
  expect(layout.snap).toContain("x mandatory")
  // Reaching Developer's link with the keyboard brings its card in.
  const link = page.getByRole("link", { name: "Open Matchbox Developer" })
  await page.getByRole("link", { name: "Open Matchbox ID" }).focus()
  await page.keyboard.press("Tab")
  await expect(link).toBeFocused()
  await expect
    .poll(() => row.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0)
  await expect(link).toBeInViewport({ ratio: 1 })
  // The row scrolls, never the page.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })

  test("the phone menu opens", async ({ page, isMobile }) => {
    test.skip(!isMobile, "the menu button is the phone header's")
    await page.goto("/")
    await page.getByRole("button", { name: "Menu" }).click()
    await expect(
      page.locator("#home-menu").getByRole("link", { name: "Docs" }),
    ).toBeVisible()
  })

  test("the page is complete and the search form lands on Matchscan", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.locator('[data-live="pro.incentivesTotal"]')).toHaveText(
      "$14,820",
    )
    const form = page.locator("search form")
    await expect(form).toHaveAttribute("action", "/search")
    await page.route("https://scan.matchbox.markets/**", (route) =>
      route.fulfill({ body: "matchscan" }),
    )
    // An address, a transaction and a block go to their pages; anything
    // else to Matchscan's home.
    const searches = [
      [
        "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
        "/address/0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
      ],
      [`0x${"ab".repeat(32)}`, `/tx/0x${"ab".repeat(32)}`],
      ["block 13,078,795", "/block/13078795"],
      ["//evil.example", "/"],
    ] as const
    for (const [query, path] of searches) {
      await page.goto("/")
      await form.getByRole("searchbox").fill(query)
      await form.getByRole("searchbox").press("Enter")
      await expect(page).toHaveURL(`https://scan.matchbox.markets${path}`)
    }
  })
})

test("sends a nonce CSP that lets the search form reach Matchscan", async ({
  request,
}) => {
  const response = await request.get("/")
  const policy = response.headers()["content-security-policy"] ?? ""
  expect(policy).toMatch(/script-src 'nonce-[^']+' 'strict-dynamic'/)
  expect(policy).toContain("form-action 'self' https://scan.matchbox.markets")
  expect(policy).toContain("frame-ancestors 'none'")
})

test("Open Matchscan sits with the search and links to Matchscan", async ({
  page,
}, testInfo) => {
  await page.goto("/")
  const open = page.getByRole("link", { name: "Open Matchscan" })
  await expect(open).toHaveAttribute("href", "https://scan.matchbox.markets")
  const search = page.getByRole("searchbox", { name: "Search Matchscan" })
  const [button, field] = await Promise.all([
    open.boundingBox(),
    search.boundingBox(),
  ])
  if (button === null || field === null) throw new Error("not laid out")
  const wide = (page.viewportSize()?.width ?? 0) > 900
  if (wide) {
    // One line: the button to the right of the field, centres level.
    expect(button.x).toBeGreaterThan(field.x + field.width)
    expect(
      Math.abs(button.y + button.height / 2 - (field.y + field.height / 2)),
    ).toBeLessThanOrEqual(1)
  } else {
    expect(button.y).toBeGreaterThan(field.y + field.height)
  }
  await open.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath("open-matchscan.png") })
})

test("a path the page lacks goes to Classic, path and query kept", async ({
  request,
}) => {
  const response = await request.get("/dashboard?tab=locks", {
    maxRedirects: 0,
  })
  expect(response.status()).toBe(307)
  expect(response.headers().location).toBe(
    "https://app.matchbox.markets/dashboard?tab=locks",
  )
  const privacy = await request.get("/privacy", { maxRedirects: 0 })
  expect(privacy.headers().location).toBe(
    "https://app.matchbox.markets/privacy",
  )
  expect((await request.get("/", { maxRedirects: 0 })).status()).toBe(200)
})
