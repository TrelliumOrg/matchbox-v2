import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import type { Locator, Page } from "@playwright/test"

/** Shared by the smoke tests. */

const require = createRequire(import.meta.url)
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8")

/**
 * An element's text without its aria-hidden parts: a morphing figure holds
 * its text twice, once for screen readers and once letter by letter.
 */
export function spokenText(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const copy = element.cloneNode(true) as Element
    for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) {
      hidden.remove()
    }
    return (copy.textContent ?? "").trim()
  })
}

/** Console errors and page errors while a test runs. */
export function watch(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
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
