import { mezoPoolName } from "@matchbox/domain/activity"
import type { TxPage } from "../data/entities"
import { partsText, type SentencePart } from "../data/scan/activity-view"
import { formatTokenAmount, tokenLookup } from "../data/scan/tokens"
import type { AddressView, LogView } from "../data/views"

/**
 * The transaction page as Matchscan shows it, on the server: Mezo's DEX
 * pools named by pair and pool type ("BTC/MUSD Volatile", as the pool and
 * gauge pages name them) wherever the page names them, in its title, its
 * actions and its parties, rather than by the label read model's contract
 * name ("Pool Musd Btc"). A known token's own logs read their amounts
 * in the token ("5.04 MUSD"), the raw integer kept beside it.
 */

function isAddressView(value: object): value is AddressView {
  return "address" in value && "contract" in value && "name" in value
}

function isAddressPart(
  value: object,
): value is Extract<SentencePart, { kind: "address" }> {
  return "kind" in value && value.kind === "address" && "address" in value
}

function isSentence(
  value: object,
): value is { parts: SentencePart[]; text: string } {
  return (
    "parts" in value &&
    Array.isArray(value.parts) &&
    "text" in value &&
    typeof value.text === "string"
  )
}

function namePools(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(namePools)
  if (node === null || typeof node !== "object") return node
  const copy: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(node)) copy[key] = namePools(child)
  const pool =
    "address" in node && typeof node.address === "string"
      ? mezoPoolName(node.address)
      : null
  if (pool !== null && isAddressView(node)) {
    copy.label = { name: pool, kind: "pool", tags: [] }
  } else if (pool !== null && isAddressPart(node)) {
    copy.name = pool
  }
  if (isSentence(node)) copy.text = partsText(copy.parts as SentencePart[])
  return copy
}

/** The amount parameters of ERC-20 events (Transfer, Approval, Deposit). */
const amountParam = /^_?(value|amount|wad)$/i

const tokens = tokenLookup()

function logAmounts(log: LogView): LogView {
  const token = tokens(log.address.address)
  if (log.decoded === null || token === null) return log
  return {
    ...log,
    decoded: {
      ...log.decoded,
      params: log.decoded.params.map((param) => {
        if (
          !amountParam.test(param.name) ||
          !/^uint\d*$/.test(param.type) ||
          !/^\d+$/.test(param.value)
        ) {
          return param
        }
        const amount = formatTokenAmount(param.value, token)
        return amount === null
          ? param
          : { ...param, value: `${amount} (${param.value})` }
      }),
    },
  }
}

export function presentTx(page: TxPage): TxPage {
  const named = namePools(page) as TxPage
  return named.logs.status === "ok"
    ? {
        ...named,
        logs: { ...named.logs, data: named.logs.data.map(logAmounts) },
      }
    : named
}
