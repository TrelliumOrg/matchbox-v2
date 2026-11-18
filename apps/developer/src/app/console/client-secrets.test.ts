import { maxActiveClientSecrets } from "@matchbox/contracts/console"
import { describe, expect, it } from "vitest"
import { maxActiveSecrets } from "./client-secrets"

describe("client secrets page", () => {
  it("allows as many active secrets as the server does", () => {
    expect(maxActiveSecrets).toBe(maxActiveClientSecrets)
  })
})
