import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  assertLocalArgs,
  assertLocalEnvironment,
  assertNoArguments,
  childEnvironment,
  credentialVariables,
  LocalSeedRefusal,
  localStateDir,
  migrateArgs,
} from "./guard"

const apiDir = path.resolve("/work/matchbox/apps/api")
const persistTo = localStateDir(apiDir)

describe("local seed guard", () => {
  it("builds local migrate commands into the API's state", () => {
    expect(migrateArgs({ binding: "READ_DB", apiDir, persistTo })).toEqual([
      "d1",
      "migrations",
      "apply",
      "READ_DB",
      "--local",
      "--persist-to",
      persistTo,
    ])
    expect(
      migrateArgs({
        binding: "READ_DB",
        environment: "v2preview",
        apiDir,
        persistTo,
      }),
    ).toContain("v2preview")
  })

  it("refuses production or unknown environments", () => {
    for (const environment of ["production", "prod", "staging", ""]) {
      expect(() =>
        migrateArgs({ binding: "READ_DB", environment, apiDir, persistTo }),
      ).toThrow(LocalSeedRefusal)
    }
  })

  it("refuses unknown bindings and state outside the API's directory", () => {
    expect(() =>
      migrateArgs({ binding: "matchbox-read-models", apiDir, persistTo }),
    ).toThrow(LocalSeedRefusal)
    expect(() =>
      migrateArgs({
        binding: "READ_DB",
        apiDir,
        persistTo: path.resolve("/work/matchbox/apps/jobs/.wrangler/state"),
      }),
    ).toThrow(LocalSeedRefusal)
  })

  it("refuses a command that is not local", () => {
    expect(() =>
      assertLocalArgs(["d1", "migrations", "apply", "READ_DB"]),
    ).toThrow(LocalSeedRefusal)
    for (const flag of ["--remote", "--remote=true", "--experimental-remote"]) {
      expect(() =>
        assertLocalArgs([
          "d1",
          "migrations",
          "apply",
          "READ_DB",
          "--local",
          flag,
        ]),
      ).toThrow(LocalSeedRefusal)
    }
    expect(() =>
      assertLocalArgs(["d1", "--local", "--persist-to", "/remote-work/state"]),
    ).not.toThrow()
  })

  it("refuses arguments", () => {
    expect(() => assertNoArguments([])).not.toThrow()
    expect(() => assertNoArguments(["--remote"])).toThrow(LocalSeedRefusal)
  })

  it("refuses an environment that selects or names production", () => {
    expect(() => assertLocalEnvironment({})).not.toThrow()
    expect(() =>
      assertLocalEnvironment({
        ENVIRONMENT: "development",
        CLOUDFLARE_ENV: "",
      }),
    ).not.toThrow()
    for (const env of [
      { CLOUDFLARE_ENV: "v2preview" },
      { ENVIRONMENT: "production" },
      { NODE_ENV: "production" },
    ]) {
      expect(() => assertLocalEnvironment(env)).toThrow(LocalSeedRefusal)
    }
  })

  it("passes wrangler no Cloudflare credentials", () => {
    const parent = Object.fromEntries(
      credentialVariables.map((name) => [name, "value"]),
    )
    const child = childEnvironment({ ...parent, PATH: "/usr/bin" })
    for (const name of credentialVariables)
      expect(child).not.toHaveProperty(name)
    expect(child.PATH).toBe("/usr/bin")
    expect(child.CI).toBe("true")
  })
})
