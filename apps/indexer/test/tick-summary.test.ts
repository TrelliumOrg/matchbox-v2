import { describe, expect, it } from "vitest"
import { builtDecoderVersion } from "../src/decode/projection"
import { initialSummary } from "../src/tick-summary"
import { migratedThrough } from "./fake-rpc"
import { pgClient } from "./row-seq/pglite"

// The jobs Worker treats a change in summary.projection.decoderVersion as a
// rebuilt warehouse and flags a re-fill (apps/jobs/src/scan/copy.ts), so
// the summary must carry the version the tables are built with, whether or
// not this tick's projection runs.

const usage = { bytes: 1n, capBytes: 10n, writable: true }

describe("the tick summary's decoder version", { timeout: 60_000 }, () => {
  it("is the built version, so a tick whose projection fails keeps it", async () => {
    const db = await migratedThrough(null)
    await db.query(
      `INSERT INTO matchbox.projection_state (network, decoder_version)
       VALUES ('mezo', 2)`,
    )
    const built = await builtDecoderVersion(pgClient(db), "mezo")
    // Only a successful projection overwrites it, with the same version.
    const summary = initialSummary(
      "mezo",
      "*/15 * * * *",
      new Date(),
      usage,
      built,
    )
    expect(summary.projection.decoderVersion).toBe(2)
  })

  it("is left out when no tables are built yet", async () => {
    const built = await builtDecoderVersion(
      pgClient(await migratedThrough(null)),
      "mezo",
    )
    expect(built).toBeNull()
    const summary = initialSummary(
      "mezo",
      "*/15 * * * *",
      new Date(),
      usage,
      built,
    )
    expect("decoderVersion" in summary.projection).toBe(false)
  })
})
