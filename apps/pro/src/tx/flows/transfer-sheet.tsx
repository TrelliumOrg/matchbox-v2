import { TokenIcon } from "@matchbox/token-icons"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { type ReactNode, useId, useState } from "react"
import type { Address } from "viem"
import { FullAddress, freshRecipient } from "../../account/fresh-recipient"
import { lookupIdentity } from "../../account/identity"
import {
  formatDate,
  formatToken,
  formatUsd,
  shortAddress,
} from "../../lib/format"
import {
  lookedUpRecipient,
  parseRecipient,
  type Recipient,
  resolvedRecipient,
} from "../../locks/recipient"
import { transferPlan } from "../plans"
import { lockState, lockToken } from "../reads"
import {
  type PrepareContext,
  type Review,
  ReviewStop,
  TxSheet,
} from "../tx-sheet"
import {
  BlockBanner,
  checkLock,
  claimFirst,
  escrowLabel,
  Notice,
  type Props,
  powerLabel,
  refreshLocks,
  useLockBlock,
  wei,
} from "./lock-sheets"
import { LockPreview, useChainRead } from "./parts"

/**
 * Transfer (Decided 9 Nov): a lock to an address or a Mezo ID (looked up
 * with the header's identity lookup) with the owner's own
 * `safeTransferFrom`, never an approval. The escrow moves a lock with its
 * votes (no reset), and what it has not claimed goes to the new owner, so
 * the form offers "Claim first". Vesting, managed and expired locks cannot
 * move. A Mezo ID is read again past every cache at review
 * (fresh-recipient), and the lock goes only to that answer.
 */
export function TransferSheet({
  request,
  config,
  account,
}: Props<"transfer">): ReactNode {
  const { lock } = request
  const token = lockToken[lock.kind]
  const inputId = useId()
  const [input, setInput] = useState("")
  const block = useLockBlock({ config, account }, lock, "transfer")
  const parsed = parseRecipient(input, account)
  const name = parsed.kind === "name" ? parsed.name : null
  const [attempt, setAttempt] = useState(0)
  // For display while typing; what the lock goes to is read again, past
  // every cache, at review.
  const lookup = useChainRead(`recipient-${name ?? ""}-${attempt}`, async () =>
    name === null ? null : await lookupIdentity(name),
  )
  // The wallet a review found the typed ID now points to, shown from then
  // on (the next review confirms it).
  const [moved, setMoved] = useState<{ id: string; address: Address } | null>(
    null,
  )
  const recipient: Recipient =
    parsed.kind !== "name"
      ? parsed
      : moved?.id === parsed.name
        ? resolvedRecipient(moved.address, account)
        : lookedUpRecipient(
            lookup.failed ? { status: "unavailable" } : lookup.data,
            account,
          )
  const title = `${escrowLabel[lock.kind]} #${lock.tokenId}`
  const amount = `${formatToken(lock.amount, token.symbol)} ${token.symbol}`
  const power = powerLabel(lock.kind, BigInt(lock.votingPowerWei))
  const error =
    recipient.kind === "invalid" || recipient.kind === "unavailable"
      ? recipient.message
      : null

  async function prepare(context: PrepareContext): Promise<Review> {
    if (recipient.kind !== "address") throw new Error("No recipient")
    const id = name
    let to = recipient.address
    if (id !== null) {
      // An ID is sent to what Mezo answers now, never a cached answer,
      // and still never to this wallet.
      const fresh = await freshRecipient(id, to, (address) =>
        setMoved({ id, address }),
      )
      const checked = resolvedRecipient(fresh, account)
      if (checked.kind !== "address") {
        throw new ReviewStop(
          checked.kind === "invalid" ? checked.message : "Not an address",
        )
      }
      to = checked.address
    }
    const chain = await lockState(
      context.config,
      lock.kind,
      BigInt(lock.tokenId),
    )
    const check = checkLock(chain, lock, "transfer", context.account)
    const rows =
      id === null
        ? [
            {
              label: "To",
              value: (
                <span className="font-mono text-[14px]">
                  {shortAddress(to)}
                </span>
              ),
            },
            { label: "Voting power", value: power },
          ]
        : [
            { label: "To", value: id },
            { label: "Address", value: <FullAddress address={to} /> },
            { label: "Voting power", value: power },
          ]
    return {
      headline: {
        label: `Transfer ${title}`,
        figure: (
          <>
            <TokenIcon ticker={token.symbol} size={36} />
            {amount}
          </>
        ),
        sub: `To ${id ?? shortAddress(to)}`,
      },
      rows,
      signRows: id === null ? 1 : 2,
      steps: transferPlan({
        kind: lock.kind,
        tokenId: BigInt(lock.tokenId),
        from: context.account,
        to,
      }),
      blocked: check.blocked,
      done: { sub: `${title} to ${id ?? shortAddress(to)}`, rows },
    }
  }

  return (
    <TxSheet
      config={config}
      account={account}
      titles={{
        form: "Transfer",
        review: "Review",
        sign: "Sign",
        done: "Lock transferred",
      }}
      form={{
        cta: "Review",
        ready: recipient.kind === "address" && block === null,
        content: (
          <ol className="flex flex-col gap-5">
            <BlockBanner block={block} />
            {block === null && wei(lock.claimableUsd) > 0n ? (
              <Notice
                label={`${formatUsd(lock.claimableUsd, "cents")} unclaimed moves with it`}
                action={claimFirst(account, lock)}
              />
            ) : null}
            <li>
              <LockPreview
                kind={lock.expired ? "expired" : lock.kind}
                title={title}
                amount={amount}
                aside={
                  lock.unlocksAt === null
                    ? "Auto max"
                    : `Unlocks ${formatDate(lock.unlocksAt)}`
                }
                rows={[
                  { label: "Voting power", value: power },
                  {
                    label: "To claim",
                    value: formatUsd(lock.claimableUsd, "cents"),
                  },
                ]}
              />
            </li>
            <li>
              <div
                className={`rounded-[20px] border-[1.5px] bg-bg px-5 py-4 ${
                  error === null
                    ? "border-soft2 focus-within:border-ink"
                    : "border-neg"
                }`}
              >
                <label htmlFor={inputId} className="block text-sm text-sec">
                  To
                </label>
                <input
                  id={inputId}
                  value={input}
                  onChange={(event) => setInput(event.currentTarget.value)}
                  placeholder="0x address or Mezo ID"
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  aria-invalid={error !== null}
                  aria-describedby={
                    error === null ? undefined : `${inputId}-error`
                  }
                  className="mt-1 w-full bg-transparent font-mono text-[16px] text-ink outline-none placeholder:text-mut"
                />
              </div>
              {error === null ? null : (
                <p
                  id={`${inputId}-error`}
                  className="mt-2 px-1 text-[14.5px] font-semibold text-neg"
                >
                  {error}
                </p>
              )}
              {recipient.kind === "unavailable" ? (
                <button
                  type="button"
                  className="mt-2 px-1 text-[14.5px] font-semibold underline underline-offset-4"
                  onClick={() => setAttempt((count) => count + 1)}
                >
                  Try again
                </button>
              ) : null}
              {name !== null && recipient.kind === "address" ? (
                <p
                  aria-live="polite"
                  className="mt-2 px-1 font-mono text-[14px] text-sec"
                >
                  {shortAddress(recipient.address)}
                </p>
              ) : null}
            </li>
            <li className="flex items-center gap-4">
              <span className="grid size-12 flex-none place-items-center rounded-full bg-acc-soft text-acc-ink">
                <Glyph shape={shapes.circleAlert} size={20} strokeWidth={1.9} />
              </span>
              <p className="text-base font-semibold">
                {lock.votes.length > 0
                  ? `#${lock.tokenId} leaves this wallet with its votes`
                  : `#${lock.tokenId} leaves this wallet`}
              </p>
            </li>
          </ol>
        ),
      }}
      prepare={prepare}
      reviewCta="Sign"
      success={{ toast: "Lock transferred", refresh: [...refreshLocks] }}
    />
  )
}
