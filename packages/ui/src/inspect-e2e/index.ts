import { armedAttribute } from "../inspect/armed"

/**
 * For end-to-end tests: waits until the page's charts listen. They arm
 * once the page has hydrated, a few hundred milliseconds after the load
 * event with every test's browser at once; a hover or a key before then
 * lands on the server HTML and nothing hears it. Takes a Playwright
 * `Page` (typed by the one method it calls, so this package needs no
 * Playwright).
 */
export async function inspectable(page: {
  waitForSelector(
    selector: string,
    options: { state: "attached" },
  ): Promise<unknown>
}): Promise<void> {
  await page.waitForSelector(`html[${armedAttribute}]`, { state: "attached" })
}
