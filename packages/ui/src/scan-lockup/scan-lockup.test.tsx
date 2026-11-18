import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import * as Lockup from "../lockup"
import { Root } from "./scan-lockup"

/** The Scan-only lockup draws exactly what Lockup.Root draws for Scan. */
describe("ScanLockup", () => {
  for (const form of ["full", "short", "icon"] as const) {
    it(`matches Lockup.Root product="scan" form="${form}"`, () => {
      const shared = renderToStaticMarkup(
        <Lockup.Root product="scan" form={form} height={22} className="x" />,
      )
      const own = renderToStaticMarkup(
        <Root form={form} height={22} className="x" />,
      )
      expect(own).toBe(shared)
    })
  }
})
