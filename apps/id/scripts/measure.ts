// Initial JS per Matchbox ID route in brotli, against a running preview on
// the memory store (`pnpm preview` with .dev.vars from the example). Fails
// over 120 kB, or when a first-paint chunk holds wallet code (by module,
// from the build's dist/chunk-modules.json): wagmi and WalletConnect must
// load only when a wallet is asked for. Signed-in pages are measured signed
// in, with a SIWE sign-in by Hardhat account #0 (the memory store's dev
// wallet, a well-known local key, never a real wallet).
// Usage: tsx scripts/measure.ts [baseUrl] [--json]
import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { measure } from "@matchbox/perf/measure"
import { privateKeyToAccount } from "viem/accounts"
import { signInMessage } from "../src/shared/siwe-message"

const budgetKb = 120
const base =
  process.argv.find((arg) => arg.startsWith("http")) ?? "http://localhost:5180"
const asJson = process.argv.includes("--json")
// Run from apps/id (pnpm measure).
const chunkModules: unknown = JSON.parse(
  readFileSync("dist/chunk-modules.json", "utf8"),
)
const wallet = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
)

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
}

const nonceResponse = await fetch(`${base}/api/siwe/nonce`, {
  method: "POST",
  headers: { origin: base },
})
const { nonce } = (await nonceResponse.json()) as { nonce: string }
const url = new URL(base)
const message = signInMessage({
  host: url.host,
  origin: url.origin,
  address: wallet.address,
  chainId: 31611,
  nonce,
  issuedAt: new Date(),
})
const verified = await fetch(`${base}/api/siwe/verify`, {
  method: "POST",
  headers: {
    origin: base,
    "content-type": "application/json",
    cookie: cookiesOf(nonceResponse),
  },
  body: JSON.stringify({
    message,
    signature: await wallet.signMessage({ message }),
  }),
})
if (!verified.ok) throw new Error(`SIWE sign-in answered ${verified.status}`)
const cookie = cookiesOf(verified)

// A pending authorization request for the seeded test client, to measure
// the consent page.
const verifier = randomBytes(32).toString("base64url")
const authorize = await fetch(
  `${base}/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: "mbx_test_ExampleTestClient0000001",
    redirect_uri: "http://localhost:5174/callback",
    scope: "openid wallet",
    state: "measure",
    nonce: "measure",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  })}`,
  { headers: { cookie }, redirect: "manual" },
)
const consent = new URL(authorize.headers.get("location") ?? "/", base)

const signedOut = ["/sign-in", "/error?code=invalid_request"]
const signedIn = ["/", "/?tab=sessions", `${consent.pathname}${consent.search}`]

const withCookie: typeof fetch = (input, init = {}) =>
  fetch(input, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), cookie },
  })

const results = [
  ...(await measure({ base, routes: signedOut, budgetKb, chunkModules })),
  ...(await measure({
    base,
    routes: signedIn,
    budgetKb,
    chunkModules,
    fetch: withCookie,
  })),
]

if (asJson) {
  console.log(JSON.stringify(results, null, 2))
} else {
  for (const result of results) {
    console.log(
      `${result.brotliKb.toFixed(2).padStart(7)} kB br  ${result.gzipKb.toFixed(2).padStart(7)} kB gz  ${result.status}  ${result.wallet ? "WALLET " : ""}${result.over ? "OVER " : ""}${result.route}`,
    )
  }
  console.log(`budget ${budgetKb} kB brotli per route, no wallet code`)
}
if (results.some((result) => result.over)) process.exitCode = 1
