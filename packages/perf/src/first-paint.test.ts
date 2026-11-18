// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { build } from "vite"
import { afterAll, describe, expect, it } from "vitest"
import { firstPaintViolations } from "./first-paint.mjs"
import { chunkModules } from "./vite"

/**
 * Builds a tiny app with the real bundler and the chunkModules plugin. The
 * stand-in packages are minified-looking code with none of the strings the
 * old text markers searched for, so only a module check can catch them.
 */
const root = mkdtempSync(join(tmpdir(), "matchbox-first-paint-"))

afterAll(() => rmSync(root, { recursive: true, force: true }))

function write(path: string, content: string): void {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function fakePackage(name: string, body: string): void {
  write(
    `node_modules/${name}/package.json`,
    JSON.stringify({ name, type: "module", main: "index.js" }),
  )
  write(`node_modules/${name}/index.js`, body)
}

fakePackage("@wagmi/core", "export const c=(a)=>a+1")
fakePackage("viem", "export const v=(a)=>a*2")
write(
  "packages/wallet/src/wallet-runtime.js",
  "export function walletConfig(a){return a}",
)
write("src/lazy.js", 'import { v } from "viem"\nexport const lazy = v(2)')
write(
  "src/clean.js",
  'export const load = () => import("./lazy.js")\nconsole.log(load)',
)
write(
  "src/static.js",
  [
    'import { c } from "@wagmi/core"',
    'import { walletConfig } from "../packages/wallet/src/wallet-runtime.js"',
    "console.log(c(walletConfig(1)))",
  ].join("\n"),
)

async function buildEntry(entry: string): Promise<{
  modules: Record<string, string[]>
  entryFile: string
}> {
  const file = join(root, `dist-${entry}/chunk-modules.json`)
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [chunkModules({ file })],
    build: {
      outDir: join(root, `dist-${entry}/client`),
      emptyOutDir: true,
      minify: true,
      rolldownOptions: { input: join(root, `src/${entry}.js`) },
    },
  })
  const modules: Record<string, string[]> = JSON.parse(
    readFileSync(file, "utf8"),
  )
  const entryFile = Object.keys(modules).find((name) =>
    modules[name]?.some((id) => id.endsWith(`src/${entry}.js`)),
  )
  if (entryFile === undefined) throw new Error("No entry chunk")
  return { modules, entryFile }
}

describe("first-paint module gate", () => {
  it("fails a build whose entry statically imports the wallet runtime", async () => {
    const { modules, entryFile } = await buildEntry("static")
    const rules = firstPaintViolations(modules, [`/${entryFile}`]).map(
      (violation) => violation.rule,
    )
    expect(rules).toContain("wagmi")
    expect(rules).toContain("@matchbox/wallet runtime")
  }, 30_000)

  it("passes a build that only loads viem lazily", async () => {
    const { modules, entryFile } = await buildEntry("clean")
    expect(firstPaintViolations(modules, [`/${entryFile}`])).toEqual([])
    // The lazy chunk holds viem; it is not first paint.
    const lazy = Object.entries(modules).find(([, ids]) =>
      ids.some((id) => id.includes("/viem/")),
    )
    expect(lazy).toBeDefined()
    expect(lazy?.[0]).not.toBe(entryFile)
  }, 30_000)

  it("refuses a first-paint chunk the manifest does not know", () => {
    expect(firstPaintViolations({}, ["/assets/main.js"])).toEqual([
      { file: "assets/main.js", rule: "unknown chunk", module: null },
    ])
  })
})
