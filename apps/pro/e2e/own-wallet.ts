import { type Page, test } from "@playwright/test"

/**
 * Makes `address` this browser's own wallet, as connecting it does: the
 * first-party cookie the server and the page read before the wallet
 * reconnects. Without it a wallet's page is someone else's, viewed, and
 * offers no account panel of its own, no claim, lock or vote.
 */
export async function rememberWallet(
  page: Page,
  address: string,
): Promise<void> {
  const baseURL = test.info().project.use.baseURL
  if (baseURL === undefined) throw new Error("no baseURL")
  await page
    .context()
    .addCookies([
      { name: "mbx-wallet", value: address.toLowerCase(), url: baseURL },
    ])
}
