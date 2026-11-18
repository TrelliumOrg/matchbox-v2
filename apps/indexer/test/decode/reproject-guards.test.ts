import { describe, expect, it } from "vitest"
import { parsePositiveInteger } from "../../scripts/cli-args"
import {
  checkExpectedHost,
  resolveDirectDatabase,
} from "../../scripts/database-target"

// The reproject:legacy-rewards script's guards: which database it would
// write to and where that came from, the --expect-host it needs to write,
// and --concurrency.

const PROD = "postgres://owner@ep-prod-123.eu-central-1.aws.neon.tech/db"
const DEV = "postgres://owner@ep-dev-456.eu-central-1.aws.neon.tech/db"

describe("resolveDirectDatabase", () => {
  it("names the variable and the local file that won, not only the host", () => {
    // The runbook exports DATABASE_URL_UNPOOLED, but .dev.vars sets the
    // MATCHBOX_ one, which is tried first.
    const target = resolveDirectDatabase(
      { DATABASE_URL_UNPOOLED: PROD, MATCHBOX_DATABASE_URL_UNPOOLED: DEV },
      new Map([["MATCHBOX_DATABASE_URL_UNPOOLED", "apps/indexer/.dev.vars"]]),
    )
    expect(target).toMatchObject({
      host: "ep-dev-456.eu-central-1.aws.neon.tech",
      variable: "MATCHBOX_DATABASE_URL_UNPOOLED",
      origin: "apps/indexer/.dev.vars",
    })
  })

  it("says the shell when no file set it", () => {
    expect(
      resolveDirectDatabase({ DATABASE_URL_UNPOOLED: PROD }, new Map()),
    ).toMatchObject({
      host: "ep-prod-123.eu-central-1.aws.neon.tech",
      variable: "DATABASE_URL_UNPOOLED",
      origin: "the shell",
    })
  })

  it("keeps refusing pooled endpoints and tightening sslmode", () => {
    expect(() =>
      resolveDirectDatabase(
        {
          DATABASE_URL:
            "postgres://u@ep-x-pooler.eu-central-1.aws.neon.tech/db",
        },
        new Map(),
      ),
    ).toThrow(/direct Neon URL/)
    expect(
      resolveDirectDatabase(
        { DATABASE_URL: `${PROD}?sslmode=require` },
        new Map(),
      ).url,
    ).toContain("sslmode=verify-full")
  })
})

describe("checkExpectedHost", () => {
  const target = {
    host: "ep-dev-456.eu-central-1.aws.neon.tech",
    variable: "MATCHBOX_DATABASE_URL_UNPOOLED" as const,
    origin: "apps/indexer/.dev.vars",
  }

  it("lets a dry run through without one", () => {
    expect(() => checkExpectedHost(target, undefined, false)).not.toThrow()
  })

  it("refuses --apply without --expect-host, naming the host and its source", () => {
    expect(() => checkExpectedHost(target, undefined, true)).toThrow(
      /--apply needs --expect-host.*ep-dev-456.*MATCHBOX_DATABASE_URL_UNPOOLED, from apps\/indexer\/\.dev\.vars/,
    )
  })

  it("refuses a host that does not match, on a dry run too", () => {
    for (const apply of [true, false]) {
      expect(() =>
        checkExpectedHost(
          target,
          "ep-prod-123.eu-central-1.aws.neon.tech",
          apply,
        ),
      ).toThrow(/--expect-host is ep-prod-123.*but the database is ep-dev-456/)
    }
  })

  it("accepts the matching host", () => {
    expect(() =>
      checkExpectedHost(target, "EP-DEV-456.eu-central-1.aws.neon.tech", true),
    ).not.toThrow()
  })
})

describe("parsePositiveInteger", () => {
  it("accepts whole numbers of at least 1", () => {
    expect(parsePositiveInteger("--concurrency", "4")).toBe(4)
    expect(parsePositiveInteger("--concurrency", " 12 ")).toBe(12)
  })

  it("refuses what parseInt would turn into NaN, 0 or a truncation", () => {
    for (const value of ["x", "0", "-1", "1.5", "2x", "", "1e3"]) {
      expect(() => parsePositiveInteger("--concurrency", value)).toThrow(
        /--concurrency must be a whole number of at least 1/,
      )
    }
  })
})
