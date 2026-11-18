import { ERC20_ABI } from "@matchbox/chain"
import { TokenIcon } from "@matchbox/token-icons"
import * as Field from "@matchbox/ui/field"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import { type Config, getBalance, readContract } from "@wagmi/core"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { type Address, getAddress } from "viem"
import { formatToken, formatUsd, shortAddress } from "../lib/format"
import { useLive } from "../live/live-context"
import { amountLabel, parseAmount, toDecimal, usdValue } from "../tx/amounts"
import { inputPlaces, truncate } from "../tx/flows/parts"
import { type SendToken, sendPlan } from "../tx/plans"
import { type PrepareContext, type Review, TxSheet } from "../tx/tx-sheet"
import { mezoChainId, requireConfig } from "../wallet/wallet-runtime"
import { getWallet, subscribeWallet, useWallet } from "../wallet/wallet-store"
import { type WalletTokenSymbol, walletTokens } from "./balances"
import { FullAddress, freshRecipient } from "./fresh-recipient"
import { lookupIdentity } from "./identity"
import { TextBox, textActionClass, useLoad } from "./panel-parts"
import {
  mezoIdNotFoundMessage,
  mezoIdUnavailableMessage,
  parseRecipient,
} from "./recipient"
import { maxSendable, sendBlocked } from "./send-rules"

/**
 * Send (frame `nfGe_W-agZ`): BTC (Mezo's native token) or an ERC-20, an
 * amount with Max, and a recipient address or Mezo ID; then the shared
 * review, simulation and signing of TxSheet on `sendPlan`. Mounted by the
 * Account panel, not through the transaction store. A Mezo ID is read
 * again past every cache at review (fresh-recipient), and the funds go
 * only to that answer.
 */

type Resolved =
  | { kind: "none" }
  | { kind: "resolving" }
  | { kind: "ok"; address: Address; mezoId: string | null }
  | { kind: "error"; message: string }
  /** The lookup failed (not "no such ID"): the field offers Try again. */
  | { kind: "unavailable" }

function sendToken(symbol: WalletTokenSymbol): SendToken {
  const token = walletTokens.find((entry) => entry.symbol === symbol)
  if (symbol === "BTC" || token === undefined || token.address === null)
    return "BTC"
  return { address: token.address, symbol, decimals: token.decimals }
}

async function balanceOf(
  config: Config,
  token: SendToken,
  owner: Address,
): Promise<bigint> {
  if (token === "BTC") {
    const balance = await getBalance(config, {
      address: owner,
      chainId: mezoChainId,
    })
    return balance.value
  }
  return readContract(config, {
    address: token.address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
    chainId: mezoChainId,
  })
}

/**
 * The recipient, resolving a Mezo ID (or naming an address's) as typed,
 * for display. `attempt` asks again after an unavailable lookup.
 */
function useRecipient(input: string, attempt: number): Resolved {
  const [resolved, setResolved] = useState<Resolved>({ kind: "none" })
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt asks again after a failed lookup
  useEffect(() => {
    const parsed = parseRecipient(input)
    if (parsed.kind === "empty") {
      setResolved({ kind: "none" })
      return
    }
    if (parsed.kind === "invalid") {
      setResolved({ kind: "error", message: parsed.reason })
      return
    }
    let live = true
    if (parsed.kind === "address") {
      setResolved({ kind: "ok", address: parsed.address, mezoId: null })
      void lookupIdentity(parsed.address).then((lookup) => {
        const mezoId = lookup.status === "found" ? lookup.identity.mezoId : null
        if (live && mezoId !== null) {
          setResolved({ kind: "ok", address: parsed.address, mezoId })
        }
      })
      return () => {
        live = false
      }
    }
    setResolved({ kind: "resolving" })
    const timer = setTimeout(() => {
      void lookupIdentity(parsed.name).then((lookup) => {
        if (!live) return
        setResolved(
          lookup.status === "unavailable"
            ? { kind: "unavailable" }
            : lookup.status === "not-found"
              ? { kind: "error", message: mezoIdNotFoundMessage }
              : {
                  kind: "ok",
                  address: getAddress(lookup.identity.address),
                  mezoId: lookup.identity.mezoId ?? parsed.name,
                },
        )
      })
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [input, attempt])
  return resolved
}

/**
 * TxSheet closes through the transaction store's `closeTx`. Until it takes
 * an `onClose`, a `closeTx` while no store sheet is open (a store update
 * that changes nothing) is this sheet closing. A wallet change closes it too.
 */
function useCloseSignal(onClose: () => void): void {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    let before = getWallet()
    return subscribeWallet(() => {
      const after = getWallet()
      const unchanged =
        before.tx === null &&
        after.tx === null &&
        before.phase === after.phase &&
        before.drawerOpen === after.drawerOpen &&
        before.account?.address === after.account?.address
      const switched = before.account?.address !== after.account?.address
      before = after
      if (unchanged || switched) close.current()
    })
  }, [])
}

export default function SendSheet({
  onClose,
}: {
  onClose: () => void
}): ReactNode {
  const wallet = useWallet()
  useCloseSignal(onClose)
  if (wallet.phase !== "ready" || wallet.account === null) return null
  return (
    <SendForm
      config={requireConfig()}
      account={getAddress(wallet.account.address)}
    />
  )
}

function SendForm({ config, account }: PrepareContext): ReactNode {
  const { market } = useLive()
  const [symbol, setSymbol] = useState<WalletTokenSymbol>("MUSD")
  const [input, setInput] = useState("")
  const [to, setTo] = useState("")
  const token = sendToken(symbol)
  const decimals = token === "BTC" ? 18 : token.decimals
  const balance = useLoad(`${symbol}-${account}`, () =>
    balanceOf(config, token, account),
  )
  const [attempt, setAttempt] = useState(0)
  const recipient = useRecipient(to, attempt)
  const parsed = parseRecipient(to)
  const typedId = parsed.kind === "mezo-id" ? parsed.name : null
  // The wallet a review found the typed ID now points to, shown from then
  // on (the next review confirms it).
  const [moved, setMoved] = useState<{ id: string; address: Address } | null>(
    null,
  )
  const amount = parseAmount(input, decimals)
  const price =
    symbol === "MUSD"
      ? "1"
      : symbol === "BTC"
        ? (market.prices.btc?.usd ?? null)
        : (market.prices.mezo?.usd ?? null)
  const usd = amount === null ? null : usdValue(amount, decimals, price)
  const label = amount === null ? "0" : amountLabel(amount, decimals, symbol)
  const max = balance.data === null ? null : maxSendable(symbol, balance.data)
  const amountError = sendBlocked({
    amount,
    balance: balance.data,
    symbol,
    to: null,
    from: account,
  })
  const toAddress =
    recipient.kind !== "ok"
      ? null
      : typedId !== null && moved?.id === typedId
        ? moved.address
        : recipient.address
  const toError =
    recipient.kind === "error"
      ? recipient.message
      : recipient.kind === "unavailable"
        ? mezoIdUnavailableMessage
        : toAddress !== null && toAddress === account
          ? "Same as this wallet"
          : null
  const name =
    toAddress === null
      ? ""
      : (typedId ??
        (recipient.kind === "ok" ? recipient.mezoId : null) ??
        shortAddress(toAddress))

  async function prepare(context: PrepareContext): Promise<Review> {
    if (amount === null || toAddress === null) throw new Error("Incomplete")
    // An ID is sent to what Mezo answers now, never a cached answer.
    const id = typedId
    const to =
      id === null
        ? toAddress
        : await freshRecipient(id, toAddress, (address) =>
            setMoved({ id, address }),
          )
    const current = await balanceOf(context.config, token, context.account)
    const rows =
      id === null
        ? [
            { label: "To", value: name },
            ...(recipient.kind === "ok" && recipient.mezoId !== null
              ? [{ label: "Address", value: shortAddress(to) }]
              : []),
            { label: "Network", value: "Mezo" },
          ]
        : [
            { label: "To", value: id },
            { label: "Address", value: <FullAddress address={to} /> },
            { label: "Network", value: "Mezo" },
          ]
    return {
      headline: {
        label: "You send",
        figure: `${label} ${symbol}`,
        sub: usd === null ? undefined : formatUsd(usd, "cents"),
      },
      rows,
      signRows: id === null ? 1 : 2,
      steps: sendPlan({ token, to, amount }),
      blocked: sendBlocked({
        amount,
        balance: current,
        symbol,
        to,
        from: context.account,
      }),
      done: { sub: `${label} ${symbol} to ${name}`, rows: [] },
    }
  }

  return (
    <TxSheet
      config={config}
      account={account}
      titles={{ form: "Send", review: "Review", sign: "Sign", done: "Sent" }}
      form={{
        cta: "Review",
        ready:
          amount !== null &&
          amountError === null &&
          toAddress !== null &&
          toError === null,
        content: (
          <fieldset>
            <legend className="sr-only">Send</legend>
            <ol className="flex flex-col gap-4">
              <li>
                <SegmentedControl.Root
                  surface="sheet"
                  size="sm"
                  value={symbol}
                  aria-label="Token"
                  onValueChange={(value) => {
                    const next = walletTokens.find(
                      (entry) => entry.symbol === value,
                    )
                    if (next === undefined) return
                    setSymbol(next.symbol)
                    setInput("")
                  }}
                >
                  {walletTokens.map((entry) => (
                    <SegmentedControl.Item
                      key={entry.symbol}
                      value={entry.symbol}
                    >
                      {entry.symbol}
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl.Root>
              </li>
              <li>
                <Field.Root invalid={amountError !== null}>
                  <Field.Box>
                    <div className="min-w-0 flex-1">
                      <Field.Label>You send</Field.Label>
                      <Field.Input
                        value={input}
                        onValueChange={setInput}
                        decimals={inputPlaces(symbol)}
                      />
                      {usd === null ? null : (
                        <p className="text-[14px] text-sec tabular-nums">
                          {formatUsd(usd, "cents")}
                        </p>
                      )}
                    </div>
                    <span className="ml-auto flex h-[46px] flex-none items-center gap-[9px] rounded-[23px] bg-soft pr-4 pl-[7px] text-base font-[650]">
                      <TokenIcon ticker={symbol} size={32} />
                      {symbol}
                    </span>
                  </Field.Box>
                  <Field.Balance>
                    <span>
                      Balance{" "}
                      {balance.data === null
                        ? balance.failed
                          ? "unavailable"
                          : "…"
                        : `${formatToken(toDecimal(balance.data, decimals), symbol)} ${symbol}`}
                    </span>
                    {max === null || max === 0n ? null : (
                      <Field.Max
                        onClick={() =>
                          setInput(
                            truncate(
                              toDecimal(max, decimals),
                              inputPlaces(symbol),
                            ),
                          )
                        }
                      />
                    )}
                  </Field.Balance>
                  <Field.Error>{amountError}</Field.Error>
                </Field.Root>
              </li>
              <li>
                <TextBox
                  id="send-to"
                  label="To"
                  value={to}
                  onValueChange={setTo}
                  placeholder="Address or Mezo ID"
                  action={
                    recipient.kind === "unavailable" ? (
                      <button
                        type="button"
                        className={textActionClass}
                        onClick={() => setAttempt((count) => count + 1)}
                      >
                        Try again
                      </button>
                    ) : typeof navigator !== "undefined" &&
                      navigator.clipboard?.readText !== undefined ? (
                      <button
                        type="button"
                        className={textActionClass}
                        onClick={() =>
                          void navigator.clipboard
                            .readText()
                            .then((text) => setTo(text.trim()))
                            .catch(() => undefined)
                        }
                      >
                        Paste
                      </button>
                    ) : null
                  }
                  status={
                    toError !== null
                      ? { tone: "negative", text: toError }
                      : recipient.kind === "resolving"
                        ? { tone: "muted", text: "Looking up" }
                        : recipient.kind === "ok" && toAddress !== null
                          ? {
                              tone: "positive",
                              text:
                                typedId !== null
                                  ? shortAddress(toAddress)
                                  : (recipient.mezoId ??
                                    shortAddress(toAddress)),
                            }
                          : null
                  }
                />
              </li>
            </ol>
          </fieldset>
        ),
      }}
      prepare={prepare}
      reviewCta="Send"
      success={{ toast: "Sent", refresh: ["overview", "activity", "home"] }}
    />
  )
}
