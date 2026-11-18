import { beforeEach, describe, expect, it, vi } from "vitest"

const status = vi.hoisted(() => ({ value: 200 }))
vi.mock("@tanstack/react-start/server", () => ({
  setResponseStatus: (code: number) => {
    status.value = code
  },
}))

const { BadInputError, requestInput } = await import("./input.server")

describe("server function payload", () => {
  beforeEach(() => {
    status.value = 200
  })

  it("reads the request id", () => {
    expect(requestInput({ request: "abc" })).toBe("abc")
    expect(status.value).toBe(200)
  })

  it("answers a generic 400 for any other shape", () => {
    for (const input of [
      undefined,
      null,
      {},
      { request: 1 },
      { request: "" },
      { request: "a".repeat(201) },
      { request: "abc", extra: true },
      "abc",
      ["abc"],
    ]) {
      status.value = 200
      expect(() => requestInput(input)).toThrow(BadInputError)
      expect(status.value).toBe(400)
    }
  })
})
