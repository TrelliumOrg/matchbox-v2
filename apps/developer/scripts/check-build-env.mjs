// The Cloudflare Vite plugin fixes the Worker environment when it builds:
// dist/server/wrangler.json carries the vars of CLOUDFLARE_ENV at build time,
// and `wrangler deploy` ships those, whatever --env says later. This check
// runs after `vite build` and fails when the built Worker's name or origin
// vars are not the ones wrangler.jsonc gives the requested environment.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const checked = (process.argv[2] ?? "").split(",").filter(Boolean)

/** wrangler.jsonc without comments or trailing commas. */
export function parseJsonc(text) {
  let out = ""
  let inString = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      out += char
      if (char === "\\") {
        out += text[i + 1] ?? ""
        i += 1
      } else if (char === '"') {
        inString = false
      }
    } else if (char === '"') {
      inString = true
      out += char
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1
      out += "\n"
    } else if (char === "/" && text[i + 1] === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/"))
        i += 1
      i += 1
    } else {
      out += char
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"))
}

/** What the built config must say for an environment ("" = top level). */
export function expected(config, environment, names) {
  const scope = environment === "" ? config : config.env?.[environment]
  if (scope === undefined) {
    throw new Error(`wrangler.jsonc has no environment "${environment}"`)
  }
  const name =
    environment === ""
      ? config.name
      : (scope.name ?? `${config.name}-${environment}`)
  return {
    name,
    vars: Object.fromEntries(names.map((key) => [key, scope.vars?.[key]])),
  }
}

/** The mismatches between the built config and the expected one. */
export function mismatches(built, want) {
  const found = []
  if (built.name !== want.name) {
    found.push(`name is ${built.name}, expected ${want.name}`)
  }
  for (const [key, value] of Object.entries(want.vars)) {
    if (built.vars?.[key] !== value) {
      found.push(`${key} is ${built.vars?.[key]}, expected ${value}`)
    }
  }
  return found
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const environment = process.env.CLOUDFLARE_ENV ?? ""
  const config = parseJsonc(readFileSync("wrangler.jsonc", "utf8"))
  const built = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"))
  const problems = mismatches(built, expected(config, environment, checked))
  const label = environment === "" ? "production" : environment
  if (problems.length > 0) {
    console.error(`The build is not the ${label} Worker:`)
    for (const problem of problems) console.error(`  ${problem}`)
    console.error(
      "Build each environment on its own: CLOUDFLARE_ENV=staging pnpm build.",
    )
    process.exit(1)
  }
  console.log(`Built for ${label}: ${built.name}, ${checked.join(", ")} match.`)
}
