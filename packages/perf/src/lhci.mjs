#!/usr/bin/env node
// `matchbox-lhci --config=<lighthouserc>`: Lighthouse CI as `lhci autorun`
// runs it (collect, assert, upload), with the LCP timestamp tie rule
// (lcp-tie.mjs) applied to the collected results before they are judged.
// Every run the rule covers is printed, with a count, so it is never
// silent. Assertions, budgets and median-run selection are lhci's own.

import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { applyTieRule, tieLine, tieSummary } from "./lcp-tie.mjs"

/** The app's own @lhci/cli, resolved from where the script runs. */
const lhciCli = createRequire(path.resolve("package.json")).resolve(
  "@lhci/cli/src/cli.js",
)

/** Runs `lhci <command> <args>` with Node, no shell. */
function lhci(/** @type {string} */ command, /** @type {string[]} */ args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [lhciCli, command, ...args], {
      stdio: "inherit",
    })
    child.on("exit", (code) => resolve(code ?? 1))
    child.on("error", () => resolve(1))
  })
}

const args = process.argv.slice(2)

const collected = await lhci("collect", args)
if (collected !== 0) process.exit(collected)

const result = await applyTieRule(path.resolve(".lighthouseci"))
for (const used of result.used) console.log(tieLine(used))
console.log(tieSummary(result))

const asserted = await lhci("assert", args)
// Like autorun: the reports are written whether or not the budget held.
const uploaded = await lhci("upload", args)
process.exit(asserted !== 0 ? asserted : uploaded)
