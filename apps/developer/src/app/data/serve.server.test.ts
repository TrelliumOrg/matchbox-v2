import { isNotFound } from "@tanstack/react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../lib/api-client"
import { InvalidIdError } from "./ids"

const status = vi.hoisted(() => ({ value: 200 }))
vi.mock("@tanstack/react-start/server", () => ({
  setResponseStatus: (code: number) => {
    status.value = code
  },
}))

const { BadInputError, inputs, serve } = await import("./serve.server")

function apiError(code: number): ApiError {
  return new ApiError({
    status: code,
    code:
      code === 403
        ? "forbidden"
        : code === 404
          ? "not_found"
          : "internal_error",
    message: "x",
    requestId: null,
  })
}

describe("server functions", () => {
  beforeEach(() => {
    status.value = 200
  })

  it("answer a generic 400 for a missing or wrong-shaped payload", async () => {
    for (const data of [
      undefined,
      null,
      "x",
      {},
      { appId: 1 },
      { orgId: "a", range: "1y" },
    ]) {
      status.value = 200
      const run = vi.fn(async () => "ran")
      await expect(serve(inputs.usage, data, run)).rejects.toBeInstanceOf(
        BadInputError,
      )
      expect(run).not.toHaveBeenCalled()
      expect(status.value).toBe(400)
    }
  })

  it("show Not found for a forbidden, missing or malformed id", async () => {
    for (const failure of [
      apiError(403),
      apiError(404),
      new InvalidIdError(),
    ]) {
      const result = await serve(inputs.app, { appId: "a" }, async () => {
        throw failure
      }).catch((error: unknown) => error)
      expect(isNotFound(result)).toBe(true)
    }
  })

  it("rethrow everything else unchanged", async () => {
    const failure = apiError(500)
    await expect(
      serve(inputs.app, { appId: "a" }, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
  })

  it("run the reads with the parsed payload", async () => {
    await expect(
      serve(inputs.app, { appId: "a" }, async (input) => input.appId),
    ).resolves.toBe("a")
  })
})
