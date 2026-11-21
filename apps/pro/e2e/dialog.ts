import { expect, type Page } from "@playwright/test"

/**
 * Clicks until the dialog opens: a click before hydration does nothing,
 * and a test that clicks once right after load then waits on "a dialog
 * that never opened". Without a name, any dialog.
 */
export default async function openDialog(
  page: Page,
  click: () => Promise<void>,
  name?: string | RegExp,
): Promise<void> {
  const dialog =
    name === undefined
      ? page.getByRole("dialog")
      : page.getByRole("dialog", { name })
  await expect(async () => {
    await click()
    await expect(dialog).toBeVisible({ timeout: 2_000 })
  }).toPass()
}
