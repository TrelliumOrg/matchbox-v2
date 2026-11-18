import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { anvilUrl, client, mezoRpc, rpc, seedFork, testWallet } from "./chain"
import { startMockApi } from "./mock-api"

/**
 * Starts the fork test stack: Anvil forking Mezo mainnet, the mock read
 * model API on :8799, and Pro built for the `fork` env (data from that API,
 * wallet reads from Anvil) served on :4180. Returns the teardown.
 */

const app = join(import.meta.dirname, "..")
export const proUrl = "http://localhost:4180"
const apiPort = 8799

function stop(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    })
  } else {
    child.kill("SIGTERM")
  }
}

async function until(
  check: () => Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${label} did not start`)
}

/** Public Mezo mainnet RPCs, tried in order; MEZO_FORK_URL goes first. */
const forkSources = [
  process.env.MEZO_FORK_URL,
  mezoRpc,
  "https://rpc-http.mezo.boar.network",
  "https://mezo.drpc.org",
].filter((url): url is string => url !== undefined && url !== "")

async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [],
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const body: unknown = await response.json()
    return (
      typeof body === "object" &&
      body !== null &&
      typeof Reflect.get(body, "result") === "string"
    )
  } catch {
    return false
  }
}

/**
 * Anvil forking the first RPC that answers. Its output is kept, so a fork
 * that cannot start (an RPC refusing CI's address, a bad flag) says why
 * instead of timing out silently; the next RPC is tried after a failure.
 */
async function startAnvil(): Promise<ChildProcess> {
  const failures: string[] = []
  for (const source of forkSources) {
    if (!(await answers(source))) {
      failures.push(`${source}: no answer`)
      continue
    }
    const output: string[] = []
    const anvil = spawn(
      "anvil",
      [
        "--fork-url",
        source,
        "--chain-id",
        "31612",
        "--port",
        "8545",
        // The escrows use Cancun opcodes; Mezo charges about 0.0015 gwei.
        "--hardfork",
        "cancun",
        "--base-fee",
        "1500000",
        "--block-time",
        "2",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    )
    const keep = (chunk: Buffer): void => {
      output.push(chunk.toString())
      if (output.length > 40) output.shift()
    }
    anvil.stdout?.on("data", keep)
    anvil.stderr?.on("data", keep)
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && anvil.exitCode === null) {
      const ready = await client
        .getBlockNumber()
        .then((block) => block > 0n)
        .catch(() => false)
      if (ready) {
        anvil.stdout?.off("data", keep)
        anvil.stderr?.off("data", keep)
        anvil.stdout?.resume()
        anvil.stderr?.resume()
        return anvil
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    stop(anvil)
    const why = anvil.exitCode === null ? "timed out" : `exit ${anvil.exitCode}`
    failures.push(`${source} (${why}):\n${output.join("").slice(-2000)}`)
  }
  throw new Error(`Anvil at ${anvilUrl} did not start\n${failures.join("\n")}`)
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const vite = join(app, "node_modules", "vite", "bin", "vite.js")
  const anvil = await startAnvil()
  await rpc("anvil_impersonateAccount", [testWallet])
  await seedFork()

  const api = await startMockApi(apiPort)

  // The `fork` env in wrangler.jsonc points data at the mock API and the
  // wallet at Anvil; wrangler prefers `.dev.vars.fork` over `.dev.vars`.
  writeFileSync(
    join(app, ".dev.vars.fork"),
    `PRO_DATA=api
API_ORIGIN=http://127.0.0.1:${apiPort}
MEZO_RPC_URL=${anvilUrl}
`,
  )
  const env = { ...process.env, CLOUDFLARE_ENV: "fork" }
  // The Cloudflare plugin points `vite preview` at the last build through
  // this file; put it back afterwards so the normal preview keeps working.
  const redirect = join(app, ".wrangler", "deploy", "config.json")
  const savedRedirect = existsSync(redirect)
    ? readFileSync(redirect, "utf8")
    : null
  const build = spawnSync(
    process.execPath,
    [vite, "build", "--outDir", ".fork-dist"],
    { cwd: app, env, stdio: "ignore" },
  )
  if (build.status !== 0) throw new Error("Pro fork build failed")
  const pro = spawn(
    process.execPath,
    [
      vite,
      "preview",
      "--port",
      "4180",
      "--strictPort",
      "--outDir",
      ".fork-dist",
    ],
    { cwd: app, env, stdio: "ignore" },
  )
  await until(
    async () => (await fetch(`${proUrl}/protocol`)).ok,
    `Pro at ${proUrl}`,
  )

  return async () => {
    stop(pro)
    await new Promise<void>((resolve) => api.close(() => resolve()))
    stop(anvil)
    rmSync(join(app, ".fork-dist"), { recursive: true, force: true })
    if (savedRedirect === null) rmSync(redirect, { force: true })
    else writeFileSync(redirect, savedRedirect)
  }
}
