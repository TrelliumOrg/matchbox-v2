import { z } from "zod"

/**
 * Long-tail token icons from the Mezo explorer (Blockscout). Call this from a
 * scheduled job that snapshots icons into D1, never on a request path.
 */

export const mezoBlockscoutApi = "https://api.explorer.mezo.org/api/v2"

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

const tokenResponseSchema = z.object({
  icon_url: z.url().nullable().optional(),
  symbol: z.string().nullable().optional(),
})

export type BlockscoutFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

export type ResolvedTokenIcon = {
  src: string
  symbol: string | null
}

export type ResolveTokenIconOptions = {
  baseUrl?: string
  signal?: AbortSignal
}

/**
 * Looks up `GET /tokens/{address}` and returns its `icon_url`. Returns null
 * for an invalid address, a failed request, an unexpected body or a token
 * without an icon, so callers fall back to the first-letter coin.
 */
export async function resolveTokenIcon(
  address: string,
  fetchFn: BlockscoutFetch,
  options: ResolveTokenIconOptions = {},
): Promise<ResolvedTokenIcon | null> {
  const parsedAddress = addressSchema.safeParse(address)
  if (!parsedAddress.success) return null

  const baseUrl = options.baseUrl ?? mezoBlockscoutApi
  let response: Response
  try {
    response = await fetchFn(
      `${baseUrl}/tokens/${parsedAddress.data}`,
      options.signal === undefined
        ? { headers: { accept: "application/json" } }
        : { headers: { accept: "application/json" }, signal: options.signal },
    )
  } catch {
    return null
  }
  if (!response.ok) return null

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return null
  }

  const parsed = tokenResponseSchema.safeParse(body)
  if (!parsed.success) return null
  const src = parsed.data.icon_url ?? null
  if (src === null) return null
  return { src, symbol: parsed.data.symbol ?? null }
}
