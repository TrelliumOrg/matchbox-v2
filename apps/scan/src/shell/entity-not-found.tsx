import { canonicalBtcAddress } from "@matchbox/domain/btc-address"
import { shortAddress, shortHash } from "@matchbox/domain/format"
import { shapes } from "@matchbox/ui/icons"
import { getRouteApi } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { canonicalAddress, canonicalHash } from "../data/canonical"
import { EntityPage } from "./entity"

/**
 * Not found (`vF29nhdD8n`) for a transaction or an address. Loaded only
 * when shown (`lazyRouteComponent`), so these pages do not preload it.
 */

/** Not found (`vF29nhdD8n`): a valid hash Blockscout has not indexed. */
export function TransactionNotFound(): ReactNode {
  const { hash } = getRouteApi("/tx/$hash").useParams()
  const valid = canonicalHash(hash)
  const checks = [
    {
      label: "Format",
      value:
        valid === null ? "Not a transaction hash" : "Valid transaction hash",
      detail: "0x + 64 hex",
      passed: valid !== null,
    },
    {
      label: "Explorer",
      value: "Not found",
      detail: "Blockscout",
      passed: false,
    },
  ]
  if (valid === null) {
    return (
      <EntityPage
        icon={shapes.arrowRight}
        title="Transaction"
        kind="Transaction hash"
        crumbs={[{ label: "Transactions", to: "/network/transactions" }]}
        current={hash.slice(0, 20)}
        checks={checks}
      />
    )
  }
  return (
    <EntityPage
      icon={shapes.arrowRight}
      title="Transaction"
      kind="Transaction hash"
      crumbs={[{ label: "Transactions", to: "/network/transactions" }]}
      current={shortHash(valid)}
      value={{ text: valid, kind: "hash" }}
      checks={checks}
    />
  )
}

/**
 * Not found: an address Blockscout has never seen, or a Bitcoin address
 * with no EVM address to go to. The loader says why (`data`): `none` is no
 * Mezo account for it; anything else is Mezo's API out.
 */
export function AddressNotFound({ data }: { data?: unknown }): ReactNode {
  const { address } = getRouteApi("/address/$address").useParams()
  const btc = canonicalBtcAddress(address)
  if (btc !== null) {
    const none = data === "none"
    return (
      <EntityPage
        icon={shapes.wallet}
        title="Address"
        kind="Bitcoin address"
        heading={none ? "No Mezo account" : "Mezo unavailable"}
        crumbs={[{ label: "Transactions", to: "/network/transactions" }]}
        current={`${btc.slice(0, 8)}…${btc.slice(-6)}`}
        value={{ text: btc, kind: "address" }}
        checks={[
          {
            label: "Format",
            value: "Bitcoin address",
            detail: "Mainnet",
            passed: true,
          },
          {
            label: "Mezo account",
            value: none ? "None" : "Unavailable",
            detail: "Mezo",
            passed: false,
          },
        ]}
      />
    )
  }
  const valid = canonicalAddress(address)
  return (
    <EntityPage
      icon={shapes.wallet}
      title="Address"
      kind="Address"
      crumbs={[{ label: "Transactions", to: "/network/transactions" }]}
      current={valid === null ? address.slice(0, 20) : shortAddress(valid)}
      checks={[
        {
          label: "Format",
          value: valid === null ? "Not an address" : "Valid address",
          detail: "0x + 40 hex",
          passed: valid !== null,
        },
        {
          label: "Explorer",
          value: "Not found",
          detail: "Blockscout",
          passed: false,
        },
      ]}
    />
  )
}
