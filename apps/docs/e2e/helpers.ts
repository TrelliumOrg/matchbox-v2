import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import type { Page } from "@playwright/test"

/** Shared by the smoke and layout suites. */

const require = createRequire(import.meta.url)
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8")

export type Watch = { errors: string[]; worker: string[] }

export function watch(page: Page): Watch {
  const seen: Watch = { errors: [], worker: [] }
  page.on("console", (message) => {
    if (message.type() === "error") seen.errors.push(message.text())
  })
  page.on("pageerror", (error) => seen.errors.push(error.message))
  page.on("response", (response) => {
    const worker = response.headers()["x-docs-worker"]
    if (worker !== undefined && response.status() !== 404) {
      seen.worker.push(`${response.url()} ${worker}`)
    }
  })
  return seen
}

export async function axe(page: Page): Promise<string[]> {
  // Served as a same-origin file: the page's CSP allows no injected inline script.
  await page.route("**/__axe.js", (route) =>
    route.fulfill({ body: axeSource, contentType: "text/javascript" }),
  )
  await page.addScriptTag({ url: "/__axe.js" })
  return page.evaluate(async () => {
    const result = await (
      window as unknown as {
        axe: {
          run: (
            context: Document,
            options: object,
          ) => Promise<{
            violations: { id: string; nodes: { target: string[] }[] }[]
          }>
        }
      }
    ).axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
      },
    })
    return result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes
          .slice(0, 3)
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    )
  })
}
