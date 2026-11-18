import type { AuthorizationRequestSummary } from "@matchbox/contracts/identity"
import { whenIdle } from "@matchbox/motion"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { Glyph } from "../components/glyphs"
import { AppMark, WalletMark } from "../components/marks"
import { isApiError } from "../lib/api-error"
import { shortAddress } from "../lib/format"
import { chainName } from "../lib/network"
import type { MezoChainId } from "../lib/search"
import { isUserRejection } from "../lib/wallet-errors"
import type { SiwePreview } from "../wallet/siwe"
import {
  loadWallet,
  openWallet,
  rememberedWallet,
  setWallet,
  useWallet,
  walletIntent,
} from "../wallet/wallet-store"
import {
  BitcoinWalletNotice,
  bitcoinWalletNoticeEnabled,
} from "./bitcoin-wallet-notice"

const WalletHost = lazy(() => loadWallet())

type StepState = "done" | "active" | "pending"

function StepMark({
  state,
  number,
}: {
  state: StepState
  number: number
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={`grid size-10 flex-none place-items-center rounded-full text-[15px] font-semibold tabular-nums ${
        state === "done"
          ? "bg-pos-soft text-pos"
          : state === "active"
            ? "bg-ink text-bg"
            : "bg-soft text-mut"
      }`}
    >
      {state === "done" ? (
        <Icon name="check" size={17} strokeWidth={2.2} />
      ) : (
        number
      )}
    </span>
  )
}

function Step({
  number,
  title,
  detail,
  state,
  aside,
  last = false,
  children,
}: {
  number: number
  title: string
  detail: ReactNode
  state: StepState
  aside?: ReactNode
  last?: boolean
  children?: ReactNode
}): ReactNode {
  return (
    <li className="grid grid-cols-[40px_1fr] gap-x-4">
      <StepMark state={state} number={number} />
      <div className="flex min-h-10 items-start justify-between gap-4">
        <p>
          <span
            className={`block text-[16px] font-semibold ${state === "pending" ? "text-sec" : "text-ink"}`}
          >
            {title}
            {state === "done" ? <span className="sr-only"> (done)</span> : null}
          </span>
          <span className="block text-[15px] text-sec">{detail}</span>
        </p>
        {aside}
      </div>
      <span
        aria-hidden="true"
        className={`mx-auto w-px ${last || children === undefined ? "" : "bg-line"}`}
      />
      <div className={children === undefined ? "pb-6" : "pt-4 pb-7"}>
        {children}
      </div>
    </li>
  )
}

function signInErrorText(error: unknown): string {
  if (isUserRejection(error)) return "Signature rejected"
  if (isApiError(error, "rate_limited")) return "Too many attempts"
  if (error instanceof Error && error.message === "Unsupported network") {
    return "Unsupported network"
  }
  return "Sign-in failed"
}

export type SignInViewProps = {
  summary: AuthorizationRequestSummary | null
  /** The chain the message must name: Mezo, or the app's for `?chain=`. */
  targetChainId: MezoChainId
  /** True when an app asked for that network (the title says so). */
  named: boolean
  /** The current session's wallet when signing in again; else null. */
  sessionWallet: string | null
  onSignedIn: () => Promise<void>
}

/** Two steps: connect a wallet on the right network, then sign the message. */
export function SignInView({
  summary,
  targetChainId,
  named,
  sessionWallet,
  onSignedIn,
}: SignInViewProps): ReactNode {
  const wallet = useWallet()
  const account = wallet.account
  const title = named ? `Sign in on ${chainName(targetChainId)}` : "Sign in"
  const supported = account !== null && account.chainId === targetChainId
  const [preview, setPreview] = useState<SiwePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const switchedFor = useRef<string | null>(null)

  useEffect(() => {
    setWallet({ targetChainId })
  }, [targetChainId])

  // A wallet this browser connected before reconnects once the page is idle.
  useEffect(
    () =>
      whenIdle(() => {
        if (rememberedWallet()) void loadWallet()
      }),
    [],
  )

  // Move the wallet to the sign-in chain as soon as it connects; the button
  // under the wallet step is for a declined or failed switch.
  const wrongChain =
    account !== null && !supported
      ? `${account.address}:${account.chainId}`
      : null
  useEffect(() => {
    if (wrongChain === null || switchedFor.current === wrongChain) return
    switchedFor.current = wrongChain
    void loadWallet().then(async (host) =>
      host
        .switchTo(await host.walletConfig(), targetChainId)
        .catch(() => undefined),
    )
  }, [wrongChain, targetChainId])

  const address = supported ? account.address : null
  const prepare = useCallback(async (): Promise<SiwePreview | null> => {
    if (address === null) return null
    try {
      const host = await loadWallet()
      const next = await host.prepareSignIn(address, targetChainId)
      setPreview(next)
      setPreviewError(null)
      return next
    } catch (caught) {
      setPreview(null)
      setPreviewError(
        isApiError(caught, "rate_limited")
          ? "Too many attempts"
          : "Message unavailable",
      )
      return null
    }
  }, [address, targetChainId])

  // The message is ready before the click, and re-issued before it expires.
  useEffect(() => {
    setPreview(null)
    if (address === null) return
    void prepare()
    const timer = window.setInterval(() => void prepare(), 4 * 60_000)
    return () => window.clearInterval(timer)
  }, [address, prepare])

  async function sign(): Promise<void> {
    if (address === null) return
    setSigning(true)
    setError(null)
    try {
      const host = await loadWallet()
      let current = preview
      if (
        current === null ||
        !host.isFresh(current) ||
        current.address !== address
      ) {
        current = await prepare()
      }
      if (current === null) throw new Error("Sign-in failed")
      await host.signIn(await host.walletConfig(), current)
      await onSignedIn()
    } catch (caught) {
      setError(signInErrorText(caught))
      // A verify attempt spends the nonce: show a fresh message next time.
      void prepare()
    } finally {
      setSigning(false)
    }
  }

  const host = typeof window === "undefined" ? "" : window.location.host

  return (
    <section
      aria-labelledby="sign-in-title"
      className="mx-auto flex w-full max-w-[480px] flex-col pt-[92px] max-md:pt-6"
    >
      {summary === null ? null : (
        <p className="mb-6 flex items-center gap-3">
          <AppMark
            name={summary.app.name}
            logoUrl={summary.app.logoUrl}
            size={40}
          />
          <span className="text-[15.5px] text-sec">
            Continue to{" "}
            <span className="font-semibold text-ink">{summary.app.name}</span>
          </span>
        </p>
      )}
      <h1
        id="sign-in-title"
        className="text-[32px] font-[650] leading-[1.15] tracking-[-0.02em] text-ink"
      >
        {title}
      </h1>
      {bitcoinWalletNoticeEnabled() ? <BitcoinWalletNotice /> : null}
      <ol className="mt-10">
        <Step
          number={1}
          title="Wallet"
          state={supported ? "done" : "active"}
          detail={
            account === null
              ? "Not connected"
              : (account.walletName ?? "Connected")
          }
          aside={
            account === null ? undefined : (
              <span className="flex flex-col items-end gap-1">
                <span className="flex items-center gap-2">
                  <WalletMark address={account.address} size={24} />
                  <span
                    title={account.address}
                    className="font-mono text-[15.5px] font-medium text-ink"
                  >
                    {shortAddress(account.address)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={openWallet}
                  className="cursor-pointer text-[15px] font-semibold text-ink underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
                >
                  Change
                </button>
              </span>
            )
          }
        >
          {account === null ? (
            <PillButton.Root
              size="lg"
              {...walletIntent}
              pending={wallet.phase === "loading" && wallet.drawerOpen}
              onClick={openWallet}
            >
              Connect wallet
            </PillButton.Root>
          ) : supported ? undefined : (
            <p className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[15px] font-semibold text-neg">
                Wrong network
              </span>
              <PillButton.Root
                intent="secondary"
                size="sm"
                onClick={() =>
                  void loadWallet().then(async (loaded) =>
                    loaded
                      .switchTo(await loaded.walletConfig(), targetChainId)
                      .catch(() => undefined),
                  )
                }
              >
                Switch to {chainName(targetChainId)}
              </PillButton.Root>
            </p>
          )}
        </Step>
        <Step
          number={2}
          title="Sign message"
          detail="No fee, no transaction"
          state={supported ? "active" : "pending"}
          last
        >
          {supported ? (
            <div className="flex flex-col gap-4">
              {sessionWallet === null ? null : (
                <p className="text-[14.5px] text-sec">
                  Signed in{" "}
                  <span className="font-mono text-ink2">
                    {shortAddress(sessionWallet)}
                  </span>
                </p>
              )}
              <div className="rounded-[24px] bg-soft p-5">
                <p className="text-[14px] text-sec">In your wallet</p>
                <p className="mt-2.5 text-[15.5px] font-semibold text-ink">
                  {host} wants you to sign in
                </p>
                <p className="text-[15px] text-ink2">Sign in to Matchbox ID.</p>
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
                  <dt className="text-sec">Network</dt>
                  <dd className="text-right font-medium text-ink">
                    {chainName(targetChainId)} (chain {targetChainId})
                  </dd>
                  <dt className="text-sec">Expires</dt>
                  <dd className="text-right font-medium text-ink">
                    In 5 minutes
                  </dd>
                </dl>
              </div>
              <PillButton.Root
                size="lg"
                intent={signing ? "neutral" : "primary"}
                pending={signing}
                disabled={previewError !== null && preview === null}
                onClick={() => void sign()}
              >
                {signing ? (
                  "Waiting for wallet"
                ) : (
                  <>
                    <Glyph name="pen-line" size={18} />
                    Sign message
                  </>
                )}
              </PillButton.Root>
              {previewError === null ? null : (
                <p role="alert" className="text-[15px] font-medium text-neg">
                  {previewError}
                </p>
              )}
              {error === null ? null : (
                <p role="alert" className="text-[15px] font-medium text-neg">
                  {error}
                </p>
              )}
            </div>
          ) : undefined}
        </Step>
      </ol>
      {wallet.phase === "idle" ? null : (
        <Suspense fallback={null}>
          <WalletHost />
        </Suspense>
      )}
    </section>
  )
}
