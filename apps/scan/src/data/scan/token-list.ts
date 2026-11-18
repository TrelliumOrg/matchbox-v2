/**
 * The tokens Matchscan lists (`PnId7WLIDs`): the eight whose supply and
 * holder counts the jobs Worker keeps a day at a time (apps/jobs
 * `supplyTokens` and `counterTokens`). MUSD and MEZO have their own pages
 * (`iuXYHNtoLX`, `ZaITnY1T_X`); the rest open their address page. No
 * imports: the token route's param check runs in the browser too.
 */

export type TokenSlug = "musd" | "mezo"

export type ListedToken = {
  address: string
  symbol: string
  /** CoinGecko's name; null where we do not know it (shown by address). */
  name: string | null
  /** The bundled coin's ticker in @matchbox/token-icons, else the symbol. */
  ticker: string
  /** Its page under /tokens, or null for the address page. */
  slug: TokenSlug | null
  /** The daily price route that prices it (`/prices/{btc|mezo}`), if any. */
  price: "btc" | "mezo" | null
}

export const listedTokens: readonly ListedToken[] = [
  {
    address: "0x7b7c000000000000000000000000000000000000",
    symbol: "BTC",
    name: "Bitcoin",
    ticker: "BTC",
    slug: null,
    price: "btc",
  },
  {
    address: "0x7b7c000000000000000000000000000000000001",
    symbol: "MEZO",
    name: "Mezo",
    ticker: "MEZO",
    slug: "mezo",
    price: "mezo",
  },
  {
    address: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
    symbol: "MUSD",
    name: "Mezo USD",
    ticker: "MUSD",
    slug: "musd",
    price: null,
  },
  {
    address: "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
    symbol: "mUSDC",
    name: "USDC",
    ticker: "mUSDC",
    slug: null,
    price: null,
  },
  {
    address: "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e",
    symbol: "mUSDT",
    name: "USDT",
    ticker: "mUSDT",
    slug: null,
    price: null,
  },
  {
    address: "0xa10ad2570ea7b93d19fdae6bd7189ff4929bc747",
    symbol: "mSolvBTC",
    name: "Solv Protocol solvBTC",
    ticker: "SolvBTC",
    slug: null,
    price: null,
  },
  {
    address: "0x6a7cd8e1384d49f502b4a4ce9ac9eb320835c5d7",
    symbol: "mcbBTC",
    name: null,
    ticker: "mcbBTC",
    slug: null,
    price: null,
  },
  {
    address: "0xe2232789d4cf5bb1ffada1a105cc59b18d639318",
    symbol: "mbhBTC",
    name: null,
    ticker: "mbhBTC",
    slug: null,
    price: null,
  },
]

/** The token a page is about, by its slug. */
export function tokenBySlug(slug: TokenSlug): ListedToken {
  const found = listedTokens.find((token) => token.slug === slug)
  if (found === undefined) throw new Error(`No token page ${slug}`)
  return found
}

/**
 * A token page's slug from a URL segment: the slug itself, its symbol in
 * any case, or its address. `canonical` says the segment was already the
 * slug; anything else redirects to it. Null for no token page.
 */
export function tokenSlugOf(
  segment: string,
): { slug: TokenSlug; canonical: boolean } | null {
  const lower = segment.toLowerCase()
  const found = listedTokens.find(
    (token) =>
      token.slug !== null &&
      (token.slug === lower ||
        token.address === lower ||
        token.symbol.toLowerCase() === lower),
  )
  if (found === undefined || found.slug === null) return null
  return { slug: found.slug, canonical: segment === found.slug }
}

/** A token page's tabs, Overview first (`?tab=`; Overview has none). */
export type TokenTab = "overview" | "holders" | "transfers" | "contract"

export const tokenTabs: readonly TokenTab[] = [
  "overview",
  "holders",
  "transfers",
  "contract",
]

/** The tab a `?tab=` value names; null for anything else. */
export function tokenTabOf(value: unknown): TokenTab | null {
  return tokenTabs.find((tab) => tab === value) ?? null
}
