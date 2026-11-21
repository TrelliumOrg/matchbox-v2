import { readFile } from "node:fs/promises"
import { expect, type Page, test } from "@playwright/test"

// Download CSV on Activity and Rewards (src/data/history-export.server.ts):
// a plain link to `/<address>/activity.csv` or `rewards.csv` that saves the
// wallet's whole history, with no script and no new page. On fixtures the
// file is built from the history fixtures (src/data/fixture-history.ts):
// a claim every epoch from Epoch 1, the first two with no price that day,
// claims under 3 days old carrying an estimate, and the rest MEZO at $0.184.

const long = `0x5050${"0".repeat(32)}0050`
const pending = `0x5050${"0".repeat(32)}0051`
/** Its downloads are refused, as the API's limit refuses one. */
const busy = `0x5050${"0".repeat(32)}0429`

const header =
  "date_utc,epoch,claimed_in_epoch,type,tx_hash,token_symbol,token_address,amount,usd_value_at_time,price_usd,price_source,price_date_utc,gauge,lock_id"

async function download(
  page: Page,
  name: RegExp,
): Promise<{
  file: string
  text: string
}> {
  const link = page.getByRole("link", { name: "Download CSV" })
  // A plain link: the file is an attachment, and a refusal is a page.
  await expect(link).not.toHaveAttribute("download")
  const pages = page.context().pages().length
  const saved = page.waitForEvent("download")
  await link.click()
  const file = await saved
  expect(file.suggestedFilename()).toMatch(name)
  // Saved where it was: no new page or tab.
  expect(page.context().pages()).toHaveLength(pages)
  const path = await file.path()
  return { file: file.suggestedFilename(), text: await readFile(path, "utf8") }
}

/** UTF-8's byte order mark, which the file starts with for Excel. */
const bom = 0xfeff

/** The file's lines, after the byte order mark. */
function lines(text: string): string[] {
  expect(text.charCodeAt(0)).toBe(bom)
  expect(text.endsWith("\r\n")).toBe(true)
  return text.slice(1, -2).split("\r\n")
}

test("Activity downloads the wallet's whole history", async ({ page }) => {
  await page.goto(`/${long}/activity`)
  const { text } = await download(
    page,
    /^matchbox-0x5050-0050-activity-\d{4}-\d{2}-\d{2}\.csv$/,
  )
  const rows = lines(text)
  expect(rows[0]).toBe(header)
  // Every vote, every claim and the lock made before Epoch 0: far more than
  // the page loaded.
  expect(rows.length).toBeGreaterThan(90)
  expect(rows.filter((row) => row.includes(",vote,")).length).toBeGreaterThan(
    45,
  )
  expect(rows.at(-1)).toMatch(/^2025-12-04T01:00:00Z,,,lock-create,/)
  // Values when claimed, the price used and its source and time.
  expect(text).toMatch(
    /,claim,0x[0-9a-f]{64},MEZO,0x7b7c0{35}1,2\.717391,0\.50,0\.184,CoinGecko daily,\d{4}-\d{2}-\d{2}T00:00:00Z,Kiln Labs,veMEZO #5050\r\n/,
  )
  // The first two claims had no price that day: said, never $0.
  expect(
    rows.filter((row) => row.includes(",claim,") && row.includes("No price")),
  ).toHaveLength(2)
  expect(text).not.toContain("History still being added")
})

test("Rewards downloads every claim and says what Earned counts", async ({
  page,
}) => {
  await page.goto(`/${long}/rewards`)
  await expect(page.getByText("Earned, value when claimed")).toBeVisible()
  await expect(page.getByText(/^No price for 2 claims/)).toBeVisible()
  const { text } = await download(
    page,
    /^matchbox-0x5050-0050-rewards-\d{4}-\d{2}-\d{2}\.csv$/,
  )
  const rows = lines(text)
  expect(rows[0]).toBe(header)
  expect(rows.slice(1).every((row) => row.includes(",claim,"))).toBe(true)
  expect(rows.length).toBeGreaterThanOrEqual(1 + 48)
})

test("A history still being added says so at the end of the file", async ({
  page,
}) => {
  await page.goto(`/${pending}/activity`)
  const { text } = await download(page, /-activity-/)
  expect(lines(text).at(-1)).toBe(
    "Note: history still being added. Older rows are not in this file yet.",
  )
})

test("A refused download comes back to the page and says why", async ({
  page,
}) => {
  await page.goto(`/${busy}/rewards`)
  const link = page.getByRole("link", { name: "Download CSV" })
  await expect(link).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(new RegExp(`/${busy}/rewards[?]download=busy$`))
  await expect(page.getByRole("alert")).toHaveText(
    "Too many downloads. Try again in a minute.",
  )
  // Never a file of error text: a redirect back to the page.
  const response = await page.request.get(`/${busy}/activity.csv`, {
    maxRedirects: 0,
  })
  expect(response.status()).toBe(303)
  expect(response.headers().location).toBe(`/${busy}/activity?download=busy`)
})

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })

  test("the link is a plain file download", async ({ page }) => {
    await page.goto(`/${long}/rewards`)
    const link = page.getByRole("link", { name: "Download CSV" })
    await expect(link).toHaveAttribute("href", `/${long}/rewards.csv`)
    await expect(link).not.toHaveAttribute("download")
    const response = await page.request.get(`/${long}/rewards.csv`)
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toBe("text/csv; charset=utf-8")
    expect(response.headers()["content-disposition"]).toMatch(
      /^attachment; filename="matchbox-0x5050-0050-rewards-/,
    )
    expect(
      (await response.text()).startsWith(
        `${String.fromCharCode(bom)}${header}\r\n`,
      ),
    ).toBe(true)
  })

  test("a refused download's message needs no script", async ({ page }) => {
    await page.goto(`/${busy}/activity?download=busy`)
    await expect(page.getByRole("alert")).toHaveText(
      "Too many downloads. Try again in a minute.",
    )
  })
})
