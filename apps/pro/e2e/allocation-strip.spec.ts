import { expect, type Locator, type Page, test } from "@playwright/test"

/**
 * A lock that voted across many gauges (lock #6033 on the live site voted
 * for 30, 19 Nov 2026). Its strip of gauge pictures ran past the lock
 * card's edge, and on a phone pushed the activity row's title out
 * entirely. The fixture wallet's lock #700 voted for every validator and
 * pool gauge (see `boostedWallet` in src/data/fixture-api.ts).
 */
const wallet = "/0x6033000000000000000000000000000000000003"

const sizes = [
  { name: "360x740", width: 360, height: 740, phone: true },
  { name: "1440x900", width: 1440, height: 900, phone: false },
] as const

type Box = { x: number; y: number; width: number; height: number }

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (found === null) throw new Error("not on screen")
  return found
}

/** No more than four marks: a few pictures, then "+N". */
async function expectCapped(mark: Locator): Promise<void> {
  const more = mark.locator("[data-allocation-more]")
  await expect(more).toHaveText(/^\+\d+$/)
  const marks = await mark
    .locator(':scope > [aria-hidden="true"]')
    .first()
    .locator(":scope > span")
    .count()
  expect(marks).toBeLessThanOrEqual(4)
}

/** The text is whole: not cut and not squeezed to nothing. */
async function expectWhole(text: Locator): Promise<void> {
  await expect(text).toBeVisible()
  const [client, scroll] = await text.evaluate((element) => [
    element.clientWidth,
    element.scrollWidth,
  ])
  expect(client).toBeGreaterThan(0)
  expect(scroll).toBeLessThanOrEqual(client)
}

async function open(page: Page, path: string): Promise<string[]> {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(path)
  await page.waitForLoadState("networkidle")
  return errors
}

for (const size of sizes) {
  test.describe(size.name, () => {
    test.skip(
      ({ isMobile }) => isMobile !== size.phone,
      "phone sizes on the phone project, desktop on desktop",
    )
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
    })

    test("a lock card's gauge strip stays inside the card", async ({
      page,
    }) => {
      const errors = await open(page, wallet)
      const card = page
        .locator("section[aria-label='Locks'] > *")
        .filter({ hasText: "#700" })
        .first()
      const line = card.locator("[data-vote-line]").filter({ visible: true })
      await line.scrollIntoViewIfNeeded()
      const mark = card
        .locator('span[role="img"][tabindex="0"]')
        .filter({ has: page.locator("[data-allocation-more]") })
      await expectCapped(mark)
      // "16 gauges" is shown whole, and nothing runs past the card.
      await expectWhole(line)
      const edge = await box(card)
      for (const part of [await box(mark), await box(line)]) {
        expect(part.x).toBeGreaterThanOrEqual(edge.x)
        expect(part.x + part.width).toBeLessThanOrEqual(edge.x + edge.width)
      }
      expect(errors).toEqual([])
    })

    test("an activity row keeps its title beside a long gauge strip", async ({
      page,
    }) => {
      const errors = await open(page, `${wallet}/activity`)
      const row = page.getByRole("listitem").filter({ hasText: "Voted with" })
      const title = row.getByText("Voted with #700", { exact: true })
      await expectWhole(title)
      await expectCapped(
        row
          .locator('span[role="img"][tabindex="0"]')
          .filter({ has: page.locator("[data-allocation-more]") }),
      )
      // The row fits the page: nothing scrolls sideways.
      const [inner, scroll] = await page.evaluate(() => [
        window.innerWidth,
        document.documentElement.scrollWidth,
      ])
      expect(scroll).toBeLessThanOrEqual(inner)
      const value = await box(row.getByText("2.4000 veBTC"))
      expect(value.x + value.width).toBeLessThanOrEqual(size.width)
      expect(errors).toEqual([])
    })
  })
}
