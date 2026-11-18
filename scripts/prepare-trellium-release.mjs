#!/usr/bin/env node
// Builds a public release snapshot for TrelliumOrg from this repository:
//
//   pnpm release:trellium:prepare -- [--ref <ref> | --working-tree]
//     [--out <dir>] [--force] [--skip-verify] [--keep-going]
//     [--concurrency <n>] [--keep-verify-dir]
//
// 1. Exports the tracked files of <ref> (default HEAD), or of the working
//    tree, with no Git history.
// 2. Removes every .trelliumignore path (internal/, the private workflows).
// 3. Swaps .github/public-workflows in as .github/workflows.
// 4. Runs the boundary check strictly (deny list required, no baseline) and
//    the secrets check on the snapshot.
// 5. Unless --skip-verify, copies the snapshot to a temporary directory
//    outside this repository, with no production credentials in the
//    environment, and checks it stands alone: pnpm install
//    --frozen-lockfile, the checks above from inside it, lint, typecheck and
//    unit tests. The snapshot directory itself stays untouched.
//
// Nothing is pushed. Publishing is scripts/publish-trellium-release.mjs.
import { execFileSync, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  unlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { matchesAny, parsePatternFile } from "./lib/public-tree.mjs"

const repoRoot = process.cwd()
const managedRoot = path.join(repoRoot, ".trellium-release")
const usage =
  "Usage: pnpm release:trellium:prepare -- [--ref <ref> | --working-tree] [--out <dir>] [--force] [--skip-verify] [--keep-going] [--concurrency <n>] [--keep-verify-dir]"

let ref = null
let workingTree = false
let outDir = null
let force = false
let skipVerify = false
let keepGoing = false
let keepVerifyDir = false
let concurrency = "2"
const args = process.argv.slice(2).filter((arg) => arg !== "--")
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  const value = args[i + 1]
  if (arg === "--ref" || arg === "--out" || arg === "--concurrency") {
    if (!value) {
      console.error(`${arg} needs a value\n${usage}`)
      process.exit(1)
    }
    if (arg === "--ref") ref = value
    if (arg === "--out") outDir = value
    if (arg === "--concurrency") concurrency = value
    i += 1
    continue
  }
  if (arg === "--working-tree") workingTree = true
  else if (arg === "--force") force = true
  else if (arg === "--skip-verify") skipVerify = true
  else if (arg === "--keep-going") keepGoing = true
  else if (arg === "--keep-verify-dir") keepVerifyDir = true
  else {
    console.error(`Unknown argument: ${arg}\n${usage}`)
    process.exit(1)
  }
}
if (ref && workingTree) {
  console.error("Use either --ref or --working-tree, not both")
  process.exit(1)
}
if (!/^\d+$/.test(concurrency)) {
  console.error("--concurrency takes a whole number")
  process.exit(1)
}
ref ??= "HEAD"

function git(argv, env) {
  return execFileSync("git", argv, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 256 * 1024 * 1024,
  })
}

const label = workingTree ? "working-tree" : ref.replaceAll(/[^\w.-]+/g, "-")
const out = path.resolve(repoRoot, outDir ?? path.join(managedRoot, label))

if (existsSync(out)) {
  const managed = out.startsWith(`${managedRoot}${path.sep}`)
  if (!force) {
    console.error(
      `Output directory exists: ${out}\nPass --force to replace it.`,
    )
    process.exit(1)
  }
  if (!managed) {
    console.error(
      "For safety, --force only replaces directories inside .trellium-release/",
    )
    process.exit(1)
  }
  rmSync(out, { recursive: true, force: true })
}
mkdirSync(out, { recursive: true })

// 1. Export tracked files, never .git.
if (workingTree) {
  for (const file of git(["ls-files", "-z"]).split("\0").filter(Boolean)) {
    const source = path.join(repoRoot, file)
    if (!existsSync(source)) continue
    mkdirSync(path.dirname(path.join(out, file)), { recursive: true })
    cpSync(source, path.join(out, file))
  }
} else {
  // A throwaway index, so the repository's own index is never touched.
  const scratch = mkdtempSync(path.join(tmpdir(), "trellium-index-"))
  const env = { GIT_INDEX_FILE: path.join(scratch, "index") }
  try {
    const commit = git(["rev-parse", "--verify", `${ref}^{commit}`]).trim()
    git(["read-tree", commit], env)
    const prefix = `${out.replaceAll("\\", "/")}/`
    git(["checkout-index", "--all", "--force", `--prefix=${prefix}`], env)
    console.log(`Exported ${ref} (${commit.slice(0, 12)})`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// 2. Remove .trelliumignore paths.
const ignored = parsePatternFile(
  readFileSync(path.join(repoRoot, ".trelliumignore"), "utf8"),
)
let removed = 0
function prune(current) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name)
    if (entry.isDirectory()) {
      prune(absolute)
      if (readdirSync(absolute).length === 0) rmdirSync(absolute)
      continue
    }
    const relative = path.relative(out, absolute).replaceAll("\\", "/")
    if (matchesAny(relative, ignored)) {
      unlinkSync(absolute)
      removed += 1
    }
  }
}
prune(out)
console.log(`Removed ${removed} files under .trelliumignore paths`)

// 3. The public workflows replace the private ones.
const publicWorkflows = path.join(out, ".github", "public-workflows")
const workflows = path.join(out, ".github", "workflows")
if (!existsSync(publicWorkflows)) {
  console.error(
    "No .github/public-workflows in the export: refusing to ship without public CI",
  )
  process.exit(1)
}
rmSync(workflows, { recursive: true, force: true })
cpSync(publicWorkflows, workflows, { recursive: true })
rmSync(publicWorkflows, { recursive: true, force: true })
console.log("Swapped .github/public-workflows in as .github/workflows")

if (readdirSync(out).length === 0) {
  console.error("The snapshot is empty")
  process.exit(1)
}

const failures = []
function step(name, command, cwd, env) {
  console.log(`\n== ${name}`)
  const result = spawnSync(command, {
    cwd,
    env,
    shell: true,
    stdio: "inherit",
  })
  if (result.status === 0) return
  failures.push(name)
  if (!keepGoing) {
    console.error(`\nFailed: ${name}. Snapshot left at ${out}`)
    process.exit(1)
  }
}

// 4. Strict checks with the private deny list.
const node = JSON.stringify(process.execPath)
step(
  "Trellium boundary (strict, private deny list)",
  `${node} scripts/check-trellium-boundary.mjs --dir ${JSON.stringify(out)} --require-deny-list`,
  repoRoot,
  process.env,
)
step(
  "Secrets",
  `${node} scripts/check-secrets.mjs --dir ${JSON.stringify(out)}`,
  repoRoot,
  process.env,
)

// 5. The snapshot stands alone, without production access.
if (!skipVerify) {
  const verify = mkdtempSync(path.join(tmpdir(), "trellium-verify-"))
  cpSync(out, verify, { recursive: true })
  const credential =
    /DATABASE|SUPABASE|CLOUDFLARE|NEON|WRANGLER|TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE|_KEY$|^GH_|^GITHUB_/i
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !credential.test(key)),
  )
  env.CI = "1"
  env.TURBO_TELEMETRY_DISABLED = "1"
  console.log(`\nVerifying a copy at ${verify}`)
  // A repository of its own, as the public one will be (Biome reads the
  // VCS ignore file, check-secrets reads the index).
  step("git init", "git init -q && git add -A", verify, env)
  step("Install", "pnpm install --frozen-lockfile", verify, env)
  step("Secrets (inside)", "node scripts/check-secrets.mjs", verify, env)
  step(
    "Boundary tests and check (inside, public mode)",
    'node --test "scripts/lib/*.test.mjs" && node scripts/check-trellium-boundary.mjs',
    verify,
    env,
  )
  step("Lint", "pnpm lint", verify, env)
  step(
    "Typecheck",
    `pnpm turbo run typecheck --concurrency=${concurrency}`,
    verify,
    env,
  )
  step(
    "Unit tests",
    `pnpm turbo run test --concurrency=${concurrency} -- --testTimeout=30000 --hookTimeout=60000`,
    verify,
    env,
  )
  if (keepVerifyDir) console.log(`\nVerification copy kept at ${verify}`)
  else rmSync(verify, { recursive: true, force: true })
}

console.log("")
if (failures.length > 0) {
  console.error(`Snapshot at ${out} FAILED: ${failures.join(", ")}`)
  process.exit(1)
}
console.log(`Prepared Trellium release snapshot at ${out}`)
if (skipVerify)
  console.log("Standalone verification was skipped (--skip-verify).")
console.log(
  `Inspect it, then: pnpm release:trellium:publish -- --dir ${out} --repo TrelliumOrg/<name> --author "<name> <email>" --message "Release vX.Y.Z" --confirm`,
)
