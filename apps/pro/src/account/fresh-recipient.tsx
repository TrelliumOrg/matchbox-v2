import type { ReactNode } from "react"
import { type Address, getAddress } from "viem"
import { ReviewStop } from "../tx/tx-sheet"
import { freshMezoIdWallet, type IdentityLookup } from "./identity"
import { mezoIdNotFoundMessage, mezoIdUnavailableMessage } from "./recipient"

/**
 * What a transfer to a Mezo ID sends to (Send, and a lock's Transfer).
 * While typing, the sheets show the ID's wallet from caches built for
 * display. An ID can be pointed at another wallet, so at review the ID is
 * read again past every cache (the API's `?fresh=1`, no query or tab
 * cache), and funds go only to that answer:
 *
 * - the same wallet as shown: the review goes on;
 * - another wallet: the review stops, shows the new address in full, and
 *   the sheet shows it too, so the next review is a new confirmation;
 * - no longer found, or the read failed: the review stops, nothing can be
 *   signed, and Try again reads again.
 */

export type FreshCheck =
  | { kind: "same"; address: Address }
  | { kind: "moved"; address: Address }
  | { kind: "not-found" }
  | { kind: "unavailable" }

/** The fresh answer against the wallet the sheet showed. */
export function checkFresh(shown: string, fresh: IdentityLookup): FreshCheck {
  if (fresh.status !== "found") return { kind: fresh.status }
  const address = getAddress(fresh.identity.address)
  return address.toLowerCase() === shown.toLowerCase()
    ? { kind: "same", address }
    : { kind: "moved", address }
}

/**
 * The wallet to send to, read now. Throws a ReviewStop unless it is the
 * wallet shown; `onMoved` hands the sheet the new wallet to show.
 */
export async function freshRecipient(
  id: string,
  shown: string,
  onMoved: (address: Address) => void,
  read: (id: string) => Promise<IdentityLookup> = freshMezoIdWallet,
): Promise<Address> {
  const check = checkFresh(shown, await read(id))
  switch (check.kind) {
    case "same":
      return check.address
    case "moved":
      onMoved(check.address)
      throw new ReviewStop(
        `${id} now points to a different address. Check it before you send.`,
        "Review again",
        [
          { label: "Mezo ID", value: id },
          {
            label: "New address",
            value: <FullAddress address={check.address} />,
          },
        ],
      )
    case "not-found":
      throw new ReviewStop(mezoIdNotFoundMessage, "Try again")
    case "unavailable":
      throw new ReviewStop(mezoIdUnavailableMessage, "Try again")
  }
}

/** An address in full, checksummed, wrapping where it must. */
export function FullAddress({ address }: { address: string }): ReactNode {
  return (
    <span className="font-mono text-[14px] break-all">
      {getAddress(address)}
    </span>
  )
}
