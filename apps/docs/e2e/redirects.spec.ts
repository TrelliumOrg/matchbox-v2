import { errorCodeSchema } from "@matchbox/contracts/errors"
import { legacyUrls } from "@matchbox/docs/redirects"
import { expect, test } from "@playwright/test"

/**
 * Every old docs URL in the redirect map, requested against the built
 * site: it must land on a page (200) in at most two hops. The error
 * anchors every API error body links to must exist on the errors page.
 */

test.describe.configure({ mode: "parallel" })

for (const url of legacyUrls) {
  test(`${url} lands on a page`, async ({ request }) => {
    const response = await request.get(url, {
      maxRedirects: 2,
      headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    })
    expect(response.status(), url).toBe(200)
    expect(response.headers()["x-docs-worker"], url).toBeUndefined()
  })
}

test("every API error code has its anchor", async ({ request }) => {
  const html = await (await request.get("/developer/errors")).text()
  for (const code of errorCodeSchema.options) {
    expect(html, code).toContain(`id="${code}"`)
  }
})

test("every redirect lands on a URL no Classic 301 can be cached for", async ({
  request,
}) => {
  // Netlify's old docs.matchbox.markets 301s carried no Cache-Control, so
  // a bare path here may be cached by a returning browser (README, cutover).
  for (const url of [
    "/docs",
    "/docs/guides/voting/",
    "/guides/voting",
    "/docs/zzz",
  ]) {
    const response = await request.get(url, { maxRedirects: 0 })
    expect(response.status(), url).toBe(301)
    expect(response.headers().location, url).toMatch(/\?from=matchdocs$/)
  }
})
