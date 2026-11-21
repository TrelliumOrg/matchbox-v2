import { expect, test } from "@playwright/test"
import {
  fixtureAddress as address,
  fixtureBlock,
  fixtureTx as hash,
} from "../scripts/routes.mjs"

/**
 * Link previews: the HTML of the pages people paste names the page's own
 * title and the 1200x630 card at an absolute address (the Worker adds them,
 * src/share-card.ts), and the build serves that card. Every page also
 * hydrates without a console error with those tags in its head
 * (smoke.spec.ts).
 */

const paths = [
  "/",
  "/gauges",
  "/network/transactions",
  "/epochs/47",
  `/tx/${hash}`,
  `/block/${fixtureBlock}`,
  `/address/${address}`,
  "/locks/vebtc/604",
]

/** The `content` of each `<meta property|name="key">` in the HTML. */
function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>()
  for (const [tag] of html.matchAll(/<meta\s[^>]*>/g)) {
    const key = /(?:property|name)="([^"]+)"/.exec(tag)?.[1]
    const content = /content="([^"]*)"/.exec(tag)?.[1]
    if (key !== undefined && content !== undefined) tags.set(key, content)
  }
  return tags
}

for (const path of paths) {
  test(`${path} shares its own title on the card`, async ({ request }) => {
    const response = await request.get(path)
    expect(response.status()).toBe(200)
    const html = await response.text()
    const tags = metaTags(html)
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]
    expect(title).toMatch(/Matchscan$/)
    expect(tags.get("og:title")).toBe(title)
    expect(tags.get("twitter:title")).toBe(title)
    expect(tags.get("og:description")).toBeTruthy()
    expect(tags.get("og:url")).toBe(`https://scan.matchbox.markets${path}`)
    expect(tags.get("og:type")).toBe("website")
    expect(tags.get("og:image")).toBe("https://scan.matchbox.markets/og.png")
    expect(tags.get("og:image:width")).toBe("1200")
    expect(tags.get("og:image:height")).toBe("630")
    expect(tags.get("og:image:alt")).toBeTruthy()
    expect(tags.get("twitter:card")).toBe("summary_large_image")
  })
}

test("the card the pages name is in the build, 1200x630", async ({
  request,
}) => {
  const served = await request.get("/og.png")
  expect(served.status()).toBe(200)
  expect(served.headers()["content-type"]).toBe("image/png")
  const bytes = await served.body()
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630])
})

/** What each pasted page's preview says, in its own words. */
const descriptions: [string, RegExp][] = [
  [
    `/tx/${hash}`,
    /^Swapped 5\.00 mUSDC in mUSDC\/MUSD Stable 0x45e0962d…0db66988, a Mezo transaction$/,
  ],
  [
    `/address/${address}`,
    /on Mezo: tokens, transactions, locks, votes and loans$/,
  ],
  ["/locks/vebtc/604", /^Lock #604, veBTC, on Mezo: /],
  ["/epochs/47", /^Epoch 47 on Mezo: /],
  [`/block/${fixtureBlock}`, /^Block 13,118,064 on Mezo: /],
  ["/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159", / gauge on Mezo: /],
]

for (const [path, words] of descriptions) {
  test(`${path} describes itself in its preview`, async ({ request }) => {
    const tags = metaTags(await (await request.get(path)).text())
    const description = tags.get("og:description") ?? ""
    expect(description).toMatch(words)
    expect(tags.get("description")).toBe(description)
    expect(tags.get("twitter:description")).toBe(description)
  })
}
