import { describe, expect, it } from "vitest"
import classic from "./fixtures/classic-5c657b5.json"
import { createHarness } from "./test/harness"

/**
 * Every staff route answers a signed-in developer who is not staff exactly
 * as Classic's console did (fixtures/README.md: captured from Classic's own
 * harness). The pages gate on the same staff role and show Not found, as
 * Classic's admin layout did.
 */
describe("staff routes for a developer who is not staff", () => {
  it("answer what Classic answered", async () => {
    const harness = createHarness()
    const developer = await harness.account("not-staff@example.com")
    const cookie = await harness.signIn(developer)
    const answers = Object.entries(classic.staffRoutesForNonStaff)
    expect(answers.length).toBeGreaterThan(10)
    for (const [route, expected] of answers) {
      const [method = "GET", path = "/"] = route.split(" ")
      const response = await harness.request(method, path, {
        cookie,
        ...(method === "GET" || method === "DELETE" ? {} : { body: {} }),
      })
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string }
      } | null
      expect({
        route,
        status: response.status,
        code: body?.error?.code ?? null,
      }).toEqual({
        route,
        ...expected,
      })
    }
  })
})
