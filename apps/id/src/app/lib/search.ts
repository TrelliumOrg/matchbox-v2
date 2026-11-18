/**
 * Search params. These validators sit in the route tree, which ships on
 * every page, so they are plain checks rather than zod. Bad values are
 * dropped, never thrown, so a mangled link still opens the page; the server
 * re-validates everything it is sent.
 */

export type MezoChainId = 31612 | 31611

function isMezoChainId(value: unknown): value is MezoChainId {
  return value === 31612 || value === 31611
}

/** `/sign-in?return=/authorize?request=…&force=true&chain=31612` */
export type SignInSearch = {
  return?: string
  /** Re-sign even with a session (`prompt=login`, switching wallets). */
  force?: boolean
  /**
   * Chain the SIWE message must name: a contract-account session verified
   * on another network has to sign in again on the client's network.
   */
  chain?: MezoChainId
}

export function validateSignInSearch(
  input: Record<string, unknown>,
): SignInSearch {
  const search: SignInSearch = {}
  if (typeof input.return === "string" && input.return.length <= 2048) {
    search.return = input.return
  }
  if (input.force === true) search.force = true
  if (isMezoChainId(input.chain)) search.chain = input.chain
  return search
}

/** `/authorize?request=<uuid>` */
export function validateAuthorizeSearch(input: Record<string, unknown>): {
  request: string
} {
  return {
    request:
      typeof input.request === "string" && input.request.length <= 64
        ? input.request
        : "",
  }
}

/** `/?tab=sessions`, `/?tab=appearance`; connected apps otherwise. */
export function validateAccountSearch(input: Record<string, unknown>): {
  tab?: "sessions" | "appearance"
} {
  return input.tab === "sessions" || input.tab === "appearance"
    ? { tab: input.tab }
    : {}
}

/** `/error?code=` */
export function validateErrorSearch(input: Record<string, unknown>): {
  code?: string
} {
  return typeof input.code === "string" && /^[a-z_]{1,64}$/.test(input.code)
    ? { code: input.code }
    : {}
}
