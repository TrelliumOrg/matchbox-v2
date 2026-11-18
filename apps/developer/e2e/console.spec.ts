import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  type APIResponse,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test"
import { devLogoBytes } from "../src/worker/dev-logos"

/**
 * Console flows a cutover must not break, on the memory store's seed
 * (worker/store/seed.ts): the dev account owns "Mallard Labs" and is a staff
 * reviewer; the teammate is a developer there. Sign-in and step-up use the
 * memory store's dev routes, sent from the page's own origin like the
 * browser would. Each test makes what it needs, so desktop and phone can run
 * one after the other against the same server.
 */

const origin = "http://localhost:5175"
const sameOrigin = { Origin: origin }

function watchConsole(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

async function signIn(page: Page, account?: "teammate"): Promise<void> {
  const response = await page.request.post("/api/auth/dev-sign-in", {
    headers: sameOrigin,
    ...(account === undefined ? {} : { data: { account } }),
  })
  expect(response.status()).toBe(200)
}

async function stepUp(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/dev-step-up", {
    headers: sameOrigin,
  })
  expect(response.status()).toBe(200)
}

/** Navigate and wait for hydration, so a click is React's, not a form post. */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "networkidle" })
}

async function api<T>(
  page: Page,
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await page.request.fetch(path, {
    method,
    headers: sameOrigin,
    ...(data === undefined ? {} : { data }),
  })
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(
    true,
  )
  return (await response.json()) as T
}

async function mallardLabs(page: Page): Promise<string> {
  const me = await api<{ organizations: { id: string; name: string }[] }>(
    page,
    "GET",
    "/api/me",
  )
  const org = me.organizations.find((entry) => entry.name === "Mallard Labs")
  if (org === undefined) throw new Error("seed organization missing")
  return org.id
}

/** A new app with test and live environments, so tests never share one. */
async function newApp(
  page: Page,
  name: string,
): Promise<{ id: string; test: string; live: string }> {
  const orgId = await mallardLabs(page)
  const app = await api<{ id: string }>(
    page,
    "POST",
    `/api/orgs/${orgId}/apps`,
    { name: `${name} ${Date.now()}` },
  )
  const env = async (kind: "test" | "live"): Promise<string> => {
    const found = await page.request.get(
      `/api/apps/${app.id}/environments/${kind}`,
    )
    if (found.ok()) return ((await found.json()) as { id: string }).id
    const created = await api<{ id: string }>(
      page,
      "POST",
      `/api/apps/${app.id}/environments/${kind}`,
    )
    return created.id
  }
  return { id: app.id, test: await env("test"), live: await env("live") }
}

/**
 * Invitation links sent so far: Miniflare's EMAIL binding writes each
 * message to a file and logs its path ("Text: <path>").
 */
function inviteLinks(): string[] {
  const log = readFileSync(".e2e-server.log", "utf8")
  const files = [...log.matchAll(/^Text: (.+\.txt)\s*$/gm)].map(
    (match) => match[1] ?? "",
  )
  return files
    .flatMap((file) => [
      ...readFileSync(file, "utf8").matchAll(
        /http:\/\/localhost:5175\/invite\/[A-Za-z0-9_-]+/g,
      ),
    ])
    .map((match) => match[0])
}

let errors: string[] = []

test.beforeEach(async ({ page }) => {
  errors = watchConsole(page)
  await signIn(page)
})

test.afterEach(() => {
  expect(errors).toEqual([])
})

test("signs in and shows the overview", async ({ page }) => {
  await open(page, "/")
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible()
})

test("shows the account page and the account menu", async ({ page }) => {
  await open(page, "/account")
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible()
  await expect(page.getByText("This device")).toBeVisible()
  await page.getByRole("button", { name: "Account menu" }).click()
  const signOut = page.getByRole("button", { name: "Sign out", exact: true })
  await expect(signOut).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(signOut).toBeHidden()
})

test("dates hydrate without errors on either side of the date line", async ({
  browser,
}) => {
  // At any hour one of these is on a different calendar day from UTC, the
  // server's zone: a page that formats dates locally while hydrating fails.
  for (const timezoneId of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    const context = await browser.newContext({
      timezoneId,
      baseURL: origin,
    })
    const page = await context.newPage()
    const seen = watchConsole(page)
    await signIn(page)
    const app = await newApp(page, "E2E dates")
    for (const path of [
      "/",
      "/account",
      "/organization",
      `/apps/${app.id}?env=test&tab=keys`,
      `/apps/${app.id}?env=test&tab=settings`,
      "/admin",
      "/admin/audit",
    ]) {
      await open(page, path)
    }
    expect({ timezoneId, errors: seen }).toEqual({ timezoneId, errors: [] })
    await context.close()
  }
})

test("creates, renames, rotates and revokes an API key, showing each key once", async ({
  page,
}) => {
  await stepUp(page)
  const app = await newApp(page, "E2E keys")
  await open(page, `/apps/${app.id}?env=test&tab=keys`)
  await page.getByRole("button", { name: "New key" }).click()
  await page.getByLabel("Name").fill("E2E key")
  // /0 is accepted, as Classic accepted it, but the page warns.
  const allowed = page.getByLabel("Allowed IPs")
  await allowed.fill("0.0.0.0/0")
  await expect(page.getByRole("status")).toContainText("allows every address")
  await allowed.fill("")
  await page.getByRole("button", { name: "Create key" }).click()
  await expect(page.getByText("Shown once")).toBeVisible()
  const done = page.getByRole("button", { name: "Done" })
  await expect(done).toHaveAttribute("aria-disabled", "true")
  await page.getByLabel("Stored securely").check()
  await done.click()
  const row = page.getByRole("row", { name: /E2E key/ })
  await expect(row).toBeVisible()

  await row.getByRole("button", { name: "Manage" }).click()
  await page.getByLabel("Name").fill("E2E key renamed")
  // Classic's expiry choices: shorten to 30 days in the same save.
  await page.getByLabel("Expires", { exact: true }).selectOption("30d")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
  const renamed = page.getByRole("row", { name: /E2E key renamed/ })
  await expect(renamed).toBeVisible()

  await renamed.getByRole("button", { name: "Manage" }).click()
  await page.getByRole("button", { name: "Rotate" }).click()
  await expect(page.getByText("Shown once")).toBeVisible()
  await page.getByLabel("Stored securely").check()
  await page.getByRole("button", { name: "Done" }).click()

  await page
    .getByRole("row", { name: /E2E key renamed/ })
    .first()
    .getByRole("button", { name: "Revoke" })
    .click()
  await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
})

test("creates a client secret, shown once", async ({ page }) => {
  await stepUp(page)
  const app = await newApp(page, "E2E secrets")
  await open(page, `/apps/${app.id}?env=test&tab=secrets`)
  await page.getByRole("button", { name: "New secret" }).click()
  await expect(page.getByText("Shown once")).toBeVisible()
  await expect(page.getByText(/^mbx_cs_/).first()).toBeVisible()
})

/** The full key or secret in the "Shown once" dialog. */
async function shownOnceValue(page: Page): Promise<string> {
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Shown once").first()).toBeVisible()
  const value = (await dialog.locator("p.font-mono").first().textContent())
    ?.trim()
    .replace(/^[A-Z_]+=/, "")
  if (value === undefined || !value.startsWith("mbx_")) {
    throw new Error(`no secret in the dialog: ${value}`)
  }
  await dialog.getByLabel("Stored securely").check()
  await dialog.getByRole("button", { name: "Done" }).click()
  await expect(dialog).toBeHidden()
  return value
}

test("a new key and client secret are shown once, then appear nowhere", async ({
  page,
}) => {
  await stepUp(page)
  const app = await newApp(page, "E2E shown once")
  const orgId = await mallardLabs(page)

  await open(page, `/apps/${app.id}?env=test&tab=keys`)
  await page.getByRole("button", { name: "New key" }).click()
  await page.getByLabel("Name").fill("Shown once key")
  await page.getByRole("button", { name: "Create key" }).click()
  const key = await shownOnceValue(page)

  await open(page, `/apps/${app.id}?env=test&tab=secrets`)
  await page.getByRole("button", { name: "New secret" }).click()
  const secret = await shownOnceValue(page)
  // Done drops it from the page at once, before any reload.
  expect(await page.content()).not.toContain(secret)

  // Every response the pages and their server functions fetch from here.
  const bodies: Promise<{ url: string; body: string }>[] = []
  page.on("response", (response) => {
    bodies.push(
      response
        .text()
        .then((body) => ({ url: response.url(), body }))
        .catch(() => ({ url: response.url(), body: "" })),
    )
  })
  const pages: { url: string; body: string }[] = []
  for (const env of ["test", "live"]) {
    for (const tab of [
      "environment",
      "keys",
      "secrets",
      "oauth",
      "usage",
      "settings",
    ]) {
      const path = `/apps/${app.id}?env=${env}&tab=${tab}`
      const response = await page.goto(path, { waitUntil: "networkidle" })
      // The HTML as served (with its hydration data) and as rendered.
      pages.push({ url: path, body: (await response?.text()) ?? "" })
      pages.push({ url: `${path} (DOM)`, body: await page.content() })
    }
  }
  for (const path of [
    `/api/environments/${app.test}/api-keys`,
    `/api/environments/${app.test}/client-secrets`,
    `/api/environments/${app.test}`,
    `/api/apps/${app.id}`,
    `/api/orgs/${orgId}/apps`,
  ]) {
    pages.push({ url: path, body: await (await page.request.get(path)).text() })
  }
  const seen = [...pages, ...(await Promise.all(bodies))]
  expect(seen.length).toBeGreaterThan(30)
  const leaks = seen
    .filter((entry) => entry.body.includes(key) || entry.body.includes(secret))
    .map((entry) => entry.url)
  expect(leaks).toEqual([])
  // The lists still name both, by prefix only.
  const keys = await (
    await page.request.get(`/api/environments/${app.test}/api-keys`)
  ).text()
  expect(keys).toContain("Shown once key")
})

test("edits redirect URIs and scopes", async ({ page }) => {
  const app = await newApp(page, "E2E oauth")
  await open(page, `/apps/${app.id}?env=test&tab=oauth`)
  const uri = "http://localhost:9000/callback"
  await page.getByLabel("Add to Redirect URIs").fill(uri)
  await page.getByRole("button", { name: "Add" }).first().click()
  await expect(page.getByText(uri)).toBeVisible()
  await page.getByRole("button", { name: `Remove ${uri}` }).click()
  await expect(page.getByText(uri)).toBeHidden()
  // Scopes are saved together on the Environments tab, as in Classic.
  await open(page, `/apps/${app.id}?env=test&tab=environment`)
  const wallet = page.getByRole("checkbox", { name: /^wallet/ })
  const before = await wallet.isChecked()
  await wallet.click()
  await page.getByRole("button", { name: "Save scopes" }).click()
  await expect(page.getByRole("button", { name: "Save scopes" })).toBeDisabled()
  await expect(wallet).toBeChecked({ checked: !before })
})

test("submits and withdraws a review for a live scope", async ({ page }) => {
  const app = await newApp(page, "E2E review")
  await api(page, "PUT", `/api/environments/${app.live}/scopes`, {
    requestedScopes: ["openid", "discord:profile"],
  })
  await open(page, `/apps/${app.id}?env=live&tab=environment`)
  const submit = page.getByRole("button", { name: "Submit for review" })
  await page.getByLabel("Note for reviewers").fill("E2E")
  await submit.click()
  const withdraw = page.getByRole("button", { name: "Withdraw" })
  await expect(withdraw).toBeVisible()
  await expect(page.getByText(/^Open since/)).toBeVisible()
  // Classic: an open review freezes its scopes until it is withdrawn.
  await expect(
    page.getByRole("checkbox", { name: /^discord:profile/ }),
  ).toBeDisabled()
  await withdraw.click()
  await expect(submit).toBeVisible()
})

/** Hex SHA-256 of the fixture logo the memory store serves for a URL. */
function fixtureLogoSha(url: string): string {
  return createHash("sha256")
    .update(devLogoBytes(new URL(url)))
    .digest("hex")
}

test("staff approve only the pinned logo: another logo's hash is refused, and the URL is frozen", async ({
  page,
}) => {
  await stepUp(page)
  const app = await newApp(page, "E2E approve")
  const pinnedUrl = "https://logos.example.com/e2e-approve.png?v=1"
  const changedUrl = "https://logos.example.com/e2e-approve.png?v=2"
  await api(page, "PATCH", `/api/apps/${app.id}`, { logoUrl: pinnedUrl })
  await api(page, "PUT", `/api/environments/${app.live}/scopes`, {
    requestedScopes: ["openid", "discord:profile"],
  })
  const submitted = await api<{ review: { id: string } }>(
    page,
    "POST",
    `/api/environments/${app.live}/submit-review`,
    {},
  )
  const reviewId = submitted.review.id

  // The console pinned the logo's bytes at submission.
  const pinned = await api<{ logo: { sha256: string } | null }>(
    page,
    "GET",
    `/api/admin/reviews/${reviewId}/logo`,
  )
  expect(pinned.logo?.sha256).toBe(fixtureLogoSha(pinnedUrl))

  // While the live review is open the logo URL cannot change.
  const moved = await page.request.patch(`/api/apps/${app.id}`, {
    headers: sameOrigin,
    data: { logoUrl: changedUrl },
  })
  expect(moved.status()).toBe(409)

  // An approval naming any other logo (or none) is refused, and nothing
  // is decided.
  for (const logoSha256 of [fixtureLogoSha(changedUrl), null]) {
    const refused = await page.request.post(
      `/api/admin/reviews/${reviewId}/decision`,
      { headers: sameOrigin, data: { decision: "approve", logoSha256 } },
    )
    expect(refused.status()).toBe(409)
  }

  // Staff see the pinned copy and approve it.
  await open(page, `/admin/reviews/${reviewId}`)
  await expect(page.getByAltText(/logo as pinned/)).toBeVisible()
  await page.getByRole("button", { name: "Approve" }).click()
  await expect(
    page.locator("main aside").getByText("Approved", { exact: true }),
  ).toBeVisible()
  const live = await api<{ verifiedAt: string | null }>(
    page,
    "GET",
    `/api/environments/${app.live}`,
  )
  expect(live.verifiedAt).not.toBeNull()
})

test("invites a member, shows it pending, resends, and the invitee accepts", async ({
  page,
  context,
}) => {
  await stepUp(page)
  const org = await api<{ id: string }>(page, "POST", "/api/orgs", {
    name: `E2E Org ${Date.now()}`,
  })
  const sentBefore = inviteLinks().length
  await open(page, `/organization?org=${org.id}`)
  await page.getByLabel("Email").fill("teammate@matchbox.local")
  await page.getByRole("button", { name: "Send invite" }).click()
  const row = page
    .getByRole("listitem")
    .filter({ hasText: "teammate@matchbox.local" })
  await expect(row.getByText("Pending")).toBeVisible()
  await row.getByRole("button", { name: "Resend" }).click()
  await expect(row).toHaveCount(1)

  // The resend replaced the first invitation: only the newest link works.
  await expect
    .poll(() => inviteLinks().length, { timeout: 5_000 })
    .toBe(sentBefore + 2)
  const link = inviteLinks().at(-1) ?? ""
  await context.clearCookies()
  await signIn(page, "teammate")
  await open(page, new URL(link).pathname)
  await page.getByRole("button", { name: "Accept invitation" }).click()
  await expect(page).toHaveURL(new RegExp(`/organization\\?org=${org.id}`))
  await expect(
    page.getByRole("listitem").filter({ hasText: "teammate@matchbox.local" }),
  ).not.toContainText("Pending")
})

test("shows an environment's usage, filters its log and opens a request", async ({
  page,
}) => {
  const me = (await (await page.request.get("/api/me")).json()) as {
    organizations: { id: string }[]
  }
  const apps = (await (
    await page.request.get(`/api/orgs/${me.organizations[0]?.id}/apps`)
  ).json()) as { data: { id: string; name: string }[] }
  const seeded = apps.data.find((app) => app.name === "Gauge Board")
  if (seeded === undefined) throw new Error("seed app missing")
  await open(page, `/apps/${seeded.id}?env=live&tab=usage`)
  await expect(page.getByText("Requests, 7d")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Quota today" })).toBeVisible()
  await page.getByRole("radio", { name: "5xx" }).click()
  await page.getByRole("radio", { name: "All" }).click()
  const first = page.getByRole("button", { expanded: false }).filter({
    hasText: /GET/,
  })
  await first.first().click()
  await expect(page.getByText("Request ID")).toBeVisible()
})

test("staff look up an environment's quota overrides by id", async ({
  page,
}) => {
  const app = await newApp(page, "E2E quotas")
  await open(page, `/admin/quotas?environment=${app.live}`)
  await expect(page.getByRole("link", { name: "Quotas" })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await expect(
    page.getByRole("group", { name: "New quota override" }),
  ).toBeVisible()
})

test("another organization's app, a missing one and a bad id are Not found", async ({
  page,
  context,
}) => {
  // The teammate's own organization and app, which the dev account cannot see.
  await context.clearCookies()
  await signIn(page, "teammate")
  const org = await api<{ id: string }>(page, "POST", "/api/orgs", {
    name: `Teammate Org ${Date.now()}`,
  })
  const app = await api<{ id: string }>(
    page,
    "POST",
    `/api/orgs/${org.id}/apps`,
    { name: "Not yours" },
  )
  await context.clearCookies()
  await signIn(page)
  for (const id of [
    app.id,
    "6f1b3c0e-0000-4000-8000-00000000dead",
    "not-an-id",
  ]) {
    const response = await page.goto(`/apps/${id}`)
    expect({ id, status: response?.status() }).toEqual({ id, status: 404 })
    await expect(page.getByText("Not found").first()).toBeVisible()
  }
  // The browser reports each 404 document; nothing else may be logged.
  const unexpected = errors.filter((text) => !/status of 404/.test(text))
  expect(unexpected).toEqual([])
  errors.length = 0
})

test("signed out, staff pages send the visitor to sign in", async ({
  page,
  context,
}) => {
  await context.clearCookies()
  await page.goto("/admin")
  await expect(page).toHaveURL(/\/sign-in/)
})

/** The console session cookie set on a response, if any. */
function sessionCookieSet(response: APIResponse): string | null {
  return (
    response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .map((header) => header.value)
      .find((value) => value.startsWith("__Host-mbx_dev=")) ?? null
  )
}

/** A server-rendered page request, as a browser navigation sends it. */
function navigate(page: Page, path = "/"): Promise<APIResponse> {
  return page.request.get(path, {
    headers: { accept: "text/html" },
    maxRedirects: 0,
  })
}

/**
 * Moves time forward by `minutes` for the session: its row on the server
 * (the memory store's dev route) and, unless `browser` is false, the
 * cookie's expiry in the browser, as both clocks would have moved.
 */
async function travel(
  page: Page,
  context: BrowserContext,
  minutes: number,
  browser = true,
): Promise<void> {
  await api(page, "POST", "/api/auth/dev-travel", { minutes })
  if (!browser) return
  const cookie = (await context.cookies()).find(
    (entry) => entry.name === "__Host-mbx_dev",
  )
  if (cookie === undefined) return
  await context.clearCookies({ name: "__Host-mbx_dev" })
  await context.addCookies([
    { ...cookie, expires: cookie.expires - minutes * 60 },
  ])
}

test("a server-rendered page past the touch interval carries the slid cookie", async ({
  page,
  context,
}) => {
  // Within the touch interval nothing is refreshed.
  expect(sessionCookieSet(await navigate(page))).toBeNull()
  // Past it, the page's own response carries the slid cookie (12 h again).
  await travel(page, context, 6)
  const touched = await navigate(page)
  expect(touched.status()).toBe(200)
  expect(sessionCookieSet(touched)).toMatch(/Max-Age=4320\d\b/)
})

test("server-rendered pages alone keep a session alive past 12 hours", async ({
  page,
  context,
}) => {
  // 11 h idle, one page, then 2 h more: 13 h after sign-in with no direct
  // browser call to /api, and still signed in, because the page passed the
  // slid cookie on. Without it the browser's cookie would have run out.
  await travel(page, context, 11 * 60)
  expect((await navigate(page)).status()).toBe(200)
  await travel(page, context, 2 * 60)
  const later = await navigate(page)
  expect(later.status()).toBe(200)
  expect(later.headers().location).toBeUndefined()
})

test("a session idle past 12 hours is cleared by the next page", async ({
  page,
  context,
}) => {
  // A browser that still sends the cookie: the page clears it and sends the
  // visitor to sign in.
  await travel(page, context, 12 * 60 + 1, false)
  const expired = await navigate(page)
  expect(expired.status()).toBeGreaterThanOrEqual(300)
  expect(expired.status()).toBeLessThan(400)
  expect(expired.headers().location).toMatch(/\/sign-in/)
  expect(sessionCookieSet(expired)).toMatch(/^__Host-mbx_dev=;.*Max-Age=0/)
})

test("@slow a page after a real five-minute pause carries the slid cookie", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one real five-minute wait")
  test.setTimeout(8 * 60_000)
  // The session was signed in (beforeEach) before this point, so the wall
  // clock has moved at least as far since its last use as since here.
  const start = Date.now()
  expect(sessionCookieSet(await navigate(page, "/account"))).toBeNull()
  // sessionTouchIntervalMs is five minutes by the server's wall clock, the
  // one that stamps sessions. A timer is not that clock: on a busy VM the
  // wall clock was stepped back 12 s during a 5:05 wait, so wait until
  // 5:05 of wall-clock time has passed on this machine, which the server
  // shares.
  const pause = 5 * 60_000 + 5_000
  await page.waitForTimeout(pause)
  while (Date.now() - start < pause) await page.waitForTimeout(1_000)
  const touched = await navigate(page, "/account")
  expect(touched.status()).toBe(200)
  expect(sessionCookieSet(touched)).toMatch(/Max-Age=4320\d\b/)
  await open(page, "/account")
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible()
})
