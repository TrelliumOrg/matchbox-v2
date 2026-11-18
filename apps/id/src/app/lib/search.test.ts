import { describe, expect, it } from "vitest"
import {
  validateAccountSearch,
  validateErrorSearch,
  validateSignInSearch,
} from "./search"

describe("sign-in search", () => {
  it("accepts a Mezo target chain and drops anything else", () => {
    expect(validateSignInSearch({ chain: 31611, force: true })).toEqual({
      chain: 31611,
      force: true,
    })
    expect(validateSignInSearch({ chain: 1 }).chain).toBeUndefined()
    expect(validateSignInSearch({ chain: "31612" }).chain).toBeUndefined()
  })

  it("keeps a return path no longer than 2048 characters", () => {
    expect(validateSignInSearch({ return: "/authorize?request=x" })).toEqual({
      return: "/authorize?request=x",
    })
    expect(validateSignInSearch({ return: "/".repeat(2049) })).toEqual({})
    expect(validateSignInSearch({ force: "true" })).toEqual({})
  })
})

describe("account and error search", () => {
  it("opens known tabs only", () => {
    expect(validateAccountSearch({ tab: "sessions" })).toEqual({
      tab: "sessions",
    })
    expect(validateAccountSearch({ tab: "admin" })).toEqual({})
  })

  it("accepts snake case error codes only", () => {
    expect(validateErrorSearch({ code: "request_expired" })).toEqual({
      code: "request_expired",
    })
    expect(validateErrorSearch({ code: "<script>" })).toEqual({})
  })
})
