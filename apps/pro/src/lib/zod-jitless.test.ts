import { describe, expect, it, vi } from "vitest"
import { zodJitless } from "./zod-jitless"

describe("zodJitless", () => {
  it("turns off zod's eval probe through the setting zod reads", async () => {
    zodJitless()
    const { config } = await import("zod/v4/core")
    expect(config().jitless).toBe(true)
    const { z } = await import("zod")
    const evaluate = vi.spyOn(globalThis, "Function")
    expect(z.object({ a: z.number() }).parse({ a: 1 })).toEqual({ a: 1 })
    expect(evaluate).not.toHaveBeenCalled()
    evaluate.mockRestore()
  })
})
