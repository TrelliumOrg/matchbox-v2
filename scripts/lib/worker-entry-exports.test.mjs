// node --test "scripts/lib/*.test.mjs"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import {
  checkRepository,
  configMains,
  entryProblems,
  isFunctionInitializer,
  isPackageSpecifier,
  readModule,
  workspacePackages,
} from "./worker-entry-exports.mjs"

const repoRoot = path.resolve(import.meta.dirname, "../..")

function kinds(source) {
  return Object.fromEntries(
    [...readModule(source).exports].map(([name, entry]) => [
      name,
      entry.kind ?? "re-export",
    ]),
  )
}

describe("export statements", () => {
  it("reads declarations", () => {
    assert.deepEqual(
      kinds(
        [
          'export const liveCron = "*/5 * * * *"',
          "export const table = {",
          "  a: 1,",
          "}",
          "export async function run(): Promise<void> {}",
          "export class Hub extends DurableObject {}",
          "export abstract class Base {}",
          "export const handler = async (event: Event) => {",
          "  return event",
          "}",
          "export const short = (a: number): number => a",
          "export const single = x => x",
          "export const grouped = (1 + 2)",
          "export enum Mode { A }",
          "export type Shape = { a: string }",
          "export interface Old {}",
          "export default {}",
        ].join("\n"),
      ),
      {
        liveCron: "value",
        table: "value",
        run: "function",
        Hub: "class",
        Base: "class",
        handler: "function",
        short: "function",
        single: "function",
        grouped: "value",
        Mode: "value",
        default: "handler",
      },
    )
  })

  it("reads export lists and re-exports", () => {
    const module = readModule(
      [
        'import { Thing as Local } from "./thing"',
        'import Fallback from "./fallback"',
        'export { RateLimiter } from "@matchbox/server/rate-limiter"',
        "export {",
        "  Local,",
        "  Fallback as Other,",
        "  type Hidden,",
        '} from "./local"',
        "export { mine }",
        'export * from "./all"',
        'export * as tools from "./tools"',
      ].join("\n"),
    )
    assert.deepEqual(module.exports.get("RateLimiter"), {
      from: "@matchbox/server/rate-limiter",
      name: "RateLimiter",
    })
    assert.deepEqual(module.exports.get("Other"), {
      from: "./local",
      name: "Fallback",
    })
    assert.equal(module.exports.has("Hidden"), false)
    assert.deepEqual(module.exports.get("mine"), { local: "mine" })
    assert.equal(module.exports.get("tools")?.kind, "value")
    assert.deepEqual(module.stars, ["./all"])
    assert.deepEqual(module.imports.get("Local"), {
      from: "./thing",
      name: "Thing",
    })
    assert.deepEqual(module.imports.get("Fallback"), {
      from: "./fallback",
      name: "default",
    })
  })

  it("skips commented-out exports", () => {
    assert.deepEqual(
      kinds(
        ["/*", 'export const gone = "x"', "*/", "export class Kept {}"].join(
          "\n",
        ),
      ),
      { Kept: "class" },
    )
  })

  it("tells arrow functions from parenthesised values", () => {
    assert.ok(isFunctionInitializer(" async () => 1"))
    assert.ok(isFunctionInitializer("<T>(value: T): T => value"))
    assert.ok(isFunctionInitializer("function named() {}"))
    assert.ok(!isFunctionInitializer(' "* * * * *"'))
    assert.ok(!isFunctionInitializer("(a + b) * 2"))
    assert.ok(!isFunctionInitializer("createApp()"))
  })
})

describe("wrangler configs", () => {
  it("lists every main, per environment too", () => {
    assert.deepEqual(
      configMains(`{
        // the entry
        "main": "src/index.ts",
        "env": { "preview": { "main": "src/preview.ts", }, "staging": {} },
      }`),
      [
        { where: "default", main: "src/index.ts" },
        { where: "env.preview", main: "src/preview.ts" },
      ],
    )
  })

  it("tells package entries from files", () => {
    assert.ok(isPackageSpecifier("@tanstack/react-start/server-entry"))
    assert.ok(!isPackageSpecifier("src/index.ts"))
    assert.ok(!isPackageSpecifier("./src/server.ts"))
  })
})

describe("entry modules", () => {
  const root = mkdtempSync(path.join(tmpdir(), "worker-entry-"))
  after(() => rmSync(root, { recursive: true, force: true }))

  function write(relative, text) {
    const file = path.join(root, relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
    return file
  }

  write(
    "packages/server/package.json",
    JSON.stringify({
      name: "@fixture/server",
      exports: {
        "./limiter": { types: "./src/limiter.ts", default: "./src/limiter.ts" },
      },
    }),
  )
  write("packages/server/src/limiter.ts", "export class Limiter {}\n")
  write("apps/worker/package.json", JSON.stringify({ name: "@fixture/worker" }))
  write(
    "apps/worker/src/hub.ts",
    'export class Hub {}\nexport const hubName = "hub"\n',
  )
  write("apps/worker/src/crons.ts", 'export const liveCron = "*/5 * * * *"\n')

  it("passes a handler, classes and re-exported classes", () => {
    const file = write(
      "apps/worker/src/clean.ts",
      [
        'import { liveCron } from "./crons"',
        'export { Limiter } from "@fixture/server/limiter"',
        'export { Hub } from "./hub"',
        "export class Api {}",
        "export default { scheduled() { return liveCron } }",
      ].join("\n"),
    )
    assert.deepEqual(entryProblems(file, workspacePackages(root)), [])
  })

  it("fails a string constant, directly or re-exported", () => {
    const file = write(
      "apps/worker/src/dirty.ts",
      [
        'export const healthProbeCron = "* * * * *"',
        'export { hubName } from "./hub"',
        'export * from "./crons"',
        'export { Gone } from "./hub"',
        'export { Remote } from "some-package"',
        "export default {}",
      ].join("\n"),
    )
    const problems = entryProblems(file, workspacePackages(root))
    assert.deepEqual(problems.map((problem) => problem.name).sort(), [
      "Gone",
      "Remote",
      "healthProbeCron",
      "hubName",
      "liveCron",
    ])
  })

  it("reports a main that does not exist", () => {
    write("apps/worker/wrangler.jsonc", '{ "main": "src/missing.ts" }')
    const { lines } = checkRepository(root)
    assert.equal(lines.length, 1)
    assert.match(lines[0], /main "src\/missing\.ts" not found/)
  })
})

describe("this repository", () => {
  it("has no Worker entry module the runtime would refuse", () => {
    const { lines, checked } = checkRepository(repoRoot)
    assert.deepEqual(lines, [])
    assert.ok(
      checked.some((file) =>
        file.endsWith(path.join("api", "src", "index.ts")),
      ),
    )
    assert.ok(
      checked.some((file) =>
        file.endsWith(path.join("jobs", "src", "index.ts")),
      ),
    )
  })
})
