import { expect, type Page, test } from "@playwright/test"

/**
 * Security headers on pages, files and redirects, and a walk through the
 * main routes, the wallet drawer and Stuart with the Content Security
 * Policy on: no violation reported, whether the policy is enforced or
 * report-only (`PRO_CSP=report-only` in .dev.vars).
 */

const userAddress = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const user = `/${userAddress}`
const gauge = "/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159"
/** A veBTC lock with a boost gauge: its card server-renders a skeleton. */
const boosted = "/0x6033000000000000000000000000000000000003"

/** The drawer, search and Stuart's panel load their code on first use. */
const lazy = 15_000

const base = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
}

/** The CSP a response sends, enforced or report-only. */
function policy(headers: Record<string, string>): string {
  return (
    headers["content-security-policy-report-only"] ??
    headers["content-security-policy"] ??
    ""
  )
}

test.describe("headers", () => {
  test.skip(({ isMobile }) => isMobile, "headers do not depend on the device")

  test("a page carries every header and a nonce its scripts use", async ({
    request,
  }) => {
    const response = await request.get(`${user}/vote`)
    expect(response.status()).toBe(200)
    const headers = response.headers()
    expect(headers).toMatchObject({
      ...base,
      "cross-origin-opener-policy": "same-origin",
    })
    // Framing is always enforced, report-only or not: Safe{Wallet} only.
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'self' https://safe.mezo.org",
    )
    expect(headers["x-frame-options"]).toBeUndefined()
    const csp = policy(headers)
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1]
    expect(nonce).toBeDefined()
    expect(csp).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`)
    expect(csp).not.toContain("unsafe-eval")
    // Every script in the document, inline or not, carries it.
    const html = await response.text()
    const scripts = html.match(/<script\b[^>]*>/g) ?? []
    expect(scripts.length).toBeGreaterThan(4)
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`)
    // A fresh one for every response.
    const again = await request.get(`${user}/vote`)
    expect(policy(again.headers())).not.toContain(`'nonce-${nonce}'`)
  })

  test("a script file and the Safe App manifest carry the base headers", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text()
    const script = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
    expect(script).toBeDefined()
    const asset = await request.get(script ?? "")
    expect(asset.status()).toBe(200)
    expect(asset.headers()).toMatchObject(base)
    const manifest = await request.get("/manifest.json", {
      headers: { origin: "https://safe.mezo.org" },
    })
    expect(manifest.headers()).toMatchObject({
      ...base,
      "access-control-allow-origin": "https://safe.mezo.org",
    })
  })

  test("redirects, misses and HEAD carry them too", async ({ request }) => {
    const redirect = await request.get(`/vote?address=${userAddress}`, {
      maxRedirects: 0,
    })
    expect(redirect.status()).toBe(301)
    expect(redirect.headers()).toMatchObject(base)
    const missing = await request.get(`/gauges/0x${"0".repeat(40)}`)
    expect(missing.status()).toBe(404)
    expect(policy(missing.headers())).toContain("'strict-dynamic'")
    const head = await request.head("/")
    expect(head.headers()).toMatchObject(base)
    expect(head.headers()["content-security-policy"]).toContain(
      "frame-ancestors",
    )
  })
})

/** Every CSP violation the page reports, from the event and the console. */
async function watchPolicy(page: Page): Promise<string[]> {
  const violations: string[] = []
  await page.exposeFunction("__reportCsp", (text: string) =>
    violations.push(text),
  )
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = Reflect.get(window, "__reportCsp")
      if (typeof report === "function") {
        report(
          `${event.disposition} ${event.effectiveDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`,
        )
      }
    })
  })
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) {
      violations.push(message.text())
    }
  })
  return violations
}

for (const path of [
  user,
  `${user}/vote`,
  `${user}/rewards`,
  `${user}/activity`,
  boosted,
  `${boosted}/activity`,
  gauge,
]) {
  test(`${path} breaks no policy`, async ({ page }) => {
    const violations = await watchPolicy(page)
    await page.goto(path)
    await page.waitForLoadState("networkidle")
    expect(violations).toEqual([])
  })
}

test("client navigation breaks no policy", async ({ page }) => {
  const violations = await watchPolicy(page)
  await page.goto(user)
  await page.waitForLoadState("networkidle")
  const nav = page
    .getByRole("navigation", { name: "Pro" })
    .filter({ visible: true })
  // Each route's chunks load lazily, through 'strict-dynamic'.
  await nav.getByRole("link", { name: "Vote" }).click()
  await expect(page).toHaveURL(new RegExp(`${user}/vote$`))
  await nav.getByRole("link", { name: "Rewards" }).click()
  await expect(page.getByText("Ready to claim, Epoch 46")).toBeVisible()
  await page.waitForLoadState("networkidle")
  expect(violations).toEqual([])
})

test("the wallet drawer breaks no policy", async ({ page }) => {
  const violations = await watchPolicy(page)
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  await page
    .getByRole("button", { name: /^Connect/ })
    .first()
    .click()
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: lazy })
  await page.waitForLoadState("networkidle")
  expect(violations).toEqual([])
})

test("Stuart breaks no policy", async ({ page, isMobile }) => {
  const violations = await watchPolicy(page)
  await page.goto(`${user}/vote`)
  await page.waitForLoadState("networkidle")
  if (isMobile) {
    // Phones search from the top bar's sheet.
    await page.getByRole("button", { name: "Ask Stuart or search" }).click()
  }
  const box = page
    .getByRole("combobox", { name: /Ask Stuart or search/ })
    .filter({ visible: true })
    .first()
  await box.click()
  await box.fill("2207")
  await expect(
    page.getByRole("listbox", { name: "Search results" }),
  ).toBeVisible({ timeout: lazy })
  // A question opens the panel (the canned answers without a Stuart URL).
  await box.fill("Which gauges pay the most per vote?")
  await box.press("Enter")
  await expect(page.getByRole("dialog", { name: "Stuart" })).toBeVisible({
    timeout: lazy,
  })
  await page.waitForLoadState("networkidle")
  expect(violations).toEqual([])
})
