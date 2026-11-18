import { MorphText, useReducedMotion } from "@matchbox/motion"
import { TokenIcon } from "@matchbox/token-icons"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as Lockup from "@matchbox/ui/lockup"
import * as PillButton from "@matchbox/ui/pill-button"
import * as ScanLockup from "@matchbox/ui/scan-lockup"
import { Dialog } from "radix-ui"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { classicUrl } from "../classic-note/note-store"
import { closeWelcome, welcomeParam } from "./welcome-store"

/**
 * The welcome dialog: three steps, text on the left and a picture of the
 * product on the right (Doop `mbpWkkU-8d`, `jBvVnutsJi`); on phones and
 * narrow windows the picture sits on top and the dialog fills the screen
 * (`51CXh8BRUY`). When it shows is in `welcome-store`.
 *
 * The pictures are drawings with sample figures, not live data, and are
 * hidden from assistive technology. This module loads only for a browser
 * that is shown the dialog.
 */

const exitMs = 220

type Point = { icon: GlyphShape; title: string; line: string }

const proPoints: Point[] = [
  {
    icon: shapes.vote,
    title: "Vote with every lock",
    line: "One ballot, one signature per lock",
  },
  {
    icon: shapes.gift,
    title: "Claim and relock",
    line: "Rewards go straight back into your lock",
  },
  {
    icon: shapes.dog,
    title: "Ask Stuart",
    line: "Gauges, wallets and transactions",
  },
]

const scanPoints: Point[] = [
  {
    icon: shapes.search,
    title: "Search Mezo",
    line: "Wallets, transactions, gauges and locks",
  },
  {
    icon: shapes.fileText,
    title: "Read any transaction",
    line: "Described in plain words",
  },
  {
    icon: shapes.wallet,
    title: "View wallet positions",
    line: "Locks, loans and rewards",
  },
]

const buildPoints: Point[] = [
  {
    icon: shapes.keyRound,
    title: "Sign in with your wallet",
    line: "One sign-in for every Matchbox product",
  },
  {
    icon: shapes.shieldCheck,
    title: "Manage app access",
    line: "See and revoke connected apps",
  },
  {
    icon: shapes.codeXml,
    title: "Build with Matchbox",
    line: "Use the API, SDK and MCP server",
  },
]

/** What the third step's headline integrates, in turn. */
export const integrations = [
  "gauge data",
  "vote history",
  "reward rates",
  "market data",
  "wallet sign-in",
] as const

const stepCount = 3
const phraseMs = 3000
const lockupMs = 5000

function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Counts 0, 1, … `count - 1` and round again, one step every `ms`. */
function useCycle(count: number, ms: number, running: boolean): number {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % count),
      ms,
    )
    return () => clearInterval(timer)
  }, [count, ms, running])
  return index
}

const headline =
  "text-[clamp(34px,3.6vw,43px)] leading-[1.08] font-[650] tracking-[-0.03em] max-[860px]:text-[36px]"

function Points({ points }: { points: readonly Point[] }): ReactNode {
  return (
    <ul className="mt-[22px] max-[860px]:mt-4">
      {points.map((point) => (
        <li
          key={point.title}
          className="flex items-center gap-3.5 py-[9px] max-[860px]:py-[7px]"
        >
          <span className="grid size-11 flex-none place-items-center rounded-full bg-soft text-ink max-[860px]:hidden">
            <Glyph shape={point.icon} size={20} strokeWidth={1.75} />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold">{point.title}</span>
            <span className="mt-0.5 block text-[14.5px] text-sec">
              {point.line}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** MATCHBOX ID and MATCHBOX DEVELOPER, one at a time, in the same place. */
function IdDeveloperLockup({ running }: { running: boolean }): ReactNode {
  const shown = useCycle(2, lockupMs, running)
  const products = ["id", "developer"] as const
  return (
    <span
      role="img"
      aria-label="Matchbox ID and Matchbox Developer"
      className="relative block h-[22px]"
      style={{ width: Lockup.lockupWidth("developer", "full", 22) }}
    >
      {products.map((product, index) => (
        <Lockup.Root
          key={product}
          product={product}
          height={22}
          aria-hidden="true"
          data-shown={index === shown}
          className="absolute top-0 left-0 opacity-0 transition-opacity duration-[380ms] ease-out data-[shown=true]:opacity-100 motion-reduce:transition-none"
        />
      ))}
    </span>
  )
}

const mockCard =
  "rounded-[20px] bg-sheet p-4 shadow-[0_10px_30px_rgb(0_0_0/0.07)]"
const mockLabel = "text-[13px] text-sec"

function MockLock({
  id,
  amount,
  meta,
  icon,
}: {
  id: string
  amount: string
  meta: string
  icon: GlyphShape
}): ReactNode {
  return (
    <div className="overflow-hidden rounded-2xl bg-sheet">
      <div className="flex h-[38px] items-center gap-2 bg-mezo px-2.5 text-[13.5px] font-[650] text-on-mezo">
        <TokenIcon
          ticker="MEZO"
          size={20}
          className="rounded-full ring-2 ring-coin-ring"
        />
        {id}
        <span className="ml-auto grid size-[18px] place-items-center rounded-[5px] bg-sheet text-mezo">
          <Glyph shape={shapes.check} size={12} strokeWidth={3} />
        </span>
      </div>
      <div className="px-3 pt-[11px] pb-3">
        <div className="text-[15px] font-[650] tabular-nums">{amount}</div>
        <div className="mt-1 flex items-center gap-[5px] text-[12.5px] text-sec">
          <Glyph shape={icon} size={13} strokeWidth={1.9} />
          {meta}
        </div>
      </div>
    </div>
  )
}

function MockGauge({
  picture,
  name,
  id,
  apy,
  share,
}: {
  picture: string
  name: string
  id: string
  apy: string
  share: string
}): ReactNode {
  return (
    <div className="flex items-center gap-2.5 py-2">
      <img
        src={picture}
        alt=""
        width={32}
        height={32}
        loading="lazy"
        decoding="async"
        className="size-8 flex-none rounded-[10px] object-cover"
      />
      <div className="min-w-0">
        <div className="truncate text-[14.5px] font-semibold">
          {name} <span className="font-medium text-mut">{id}</span>
        </div>
        <div className="text-[12.5px] text-sec">APY {apy}</div>
      </div>
      <span className="ml-auto text-[14.5px] font-[650] tabular-nums">
        {share}
      </span>
    </div>
  )
}

/** Step 1: two locks ticked, one ballot. */
function BallotPicture(): ReactNode {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <MockLock
          id="#2930"
          amount="1,840,200 veMEZO"
          meta="2 Mar 2028"
          icon={shapes.calendarDays}
        />
        <MockLock
          id="#3011"
          amount="418,000 veMEZO"
          meta="Auto max"
          icon={shapes.infinity}
        />
      </div>
      <div className="mt-3 overflow-hidden rounded-[20px] bg-sheet shadow-[0_10px_30px_rgb(0_0_0/0.07)]">
        <div className="flex h-11 items-center justify-between bg-mezo px-4 text-[13.5px] font-[650] text-on-mezo tabular-nums">
          <span>Epoch 47, 2 locks</span>
          <span>2,258,200 veMEZO</span>
        </div>
        <div className="p-4">
          <div className={mockLabel}>Projected this epoch</div>
          <div className="mt-px text-[28px] font-[650] tracking-[-0.02em] tabular-nums">
            $17.92
          </div>
          <div className="mt-3.5 mb-1.5 flex h-1.5 gap-[3px]">
            <span className="flex-[70] rounded-[3px] bg-ink" />
            <span className="flex-[30] rounded-[3px] bg-[#7A5A3A]" />
          </div>
          <MockGauge
            picture="/welcome/snf.webp"
            name="SNF"
            id="#6033"
            apy="10.29%"
            share="70%"
          />
          <MockGauge
            picture="/welcome/boar.webp"
            name="Boar Finance"
            id="#1226"
            apy="8.74%"
            share="30%"
          />
          <div className="mt-2.5 grid h-[42px] place-items-center rounded-[21px] bg-acc text-sm font-semibold text-on-acc">
            Review and sign, 2 signatures
          </div>
        </div>
      </div>
    </>
  )
}

function MockActivity({
  icon,
  title,
  when,
}: {
  icon: ReactNode
  title: string
  when: string
}): ReactNode {
  return (
    <div className="flex items-center gap-2.5 py-2">
      <span className="grid size-8 flex-none place-items-center rounded-full bg-soft">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{title}</div>
        <div className="text-[12.5px] text-sec">{when}</div>
      </div>
    </div>
  )
}

/** Step 2: a search and the wallet page it finds. */
function ScanPicture(): ReactNode {
  return (
    <>
      <div className="mb-3 flex h-12 items-center gap-2.5 rounded-3xl bg-sheet px-4 text-[15.5px] font-medium">
        <Glyph shape={shapes.search} size={18} />
        0x5959…0965
        <span className="-ml-2 h-5 w-0.5 bg-acc" />
      </div>
      <div className={mockCard}>
        <div className="flex items-center gap-3">
          <span className="grid size-10 flex-none place-items-center rounded-full bg-[#2E4A3E] text-[13px] font-bold text-[#DDEBE3]">
            59
          </span>
          <div>
            <div className="text-[15.5px] font-[650]">pyke.mezo</div>
            <div className="font-mono text-[12.5px] text-sec">0x5959…0965</div>
          </div>
        </div>
        <div className="mt-3.5 mb-2 grid grid-cols-3 gap-2">
          {[
            ["3", "Locks"],
            ["2.26M", "veMEZO"],
            ["$212.48", "Claimable"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-xl bg-soft px-2.5 py-[9px]">
              <div className="text-[15px] font-[650] tabular-nums">{value}</div>
              <div className="text-[12.5px] text-sec">{label}</div>
            </div>
          ))}
        </div>
        <MockActivity
          icon={<Glyph shape={shapes.vote} size={15} strokeWidth={1.9} />}
          title="Voted with #2930 and #3011"
          when="Epoch 47, Thu 5 Nov"
        />
        <MockActivity
          icon={<TokenIcon ticker="MUSD" size={32} />}
          title="Repaid 1,200 MUSD on loan #8214"
          when="Tue 3 Nov"
        />
        <MockActivity
          icon={<TokenIcon ticker="MEZO" size={32} />}
          title="Claimed $38.20 from SNF"
          when="Epoch 46, Fri 30 Oct"
        />
      </div>
    </>
  )
}

/** Step 3: a sign-in request, and the app's key and usage. */
function BuildPicture(): ReactNode {
  return (
    <>
      <div className={mockCard}>
        <div className={mockLabel}>Sign in with Matchbox</div>
        <div className="mt-2.5 flex items-center gap-3">
          <span className="grid size-10 flex-none place-items-center rounded-xl bg-[#1F3A2E] text-[13px] font-bold text-[#F3E9D2]">
            GS
          </span>
          <div>
            <div className="text-[15.5px] font-[650]">Gauge Scout</div>
            <div className={mockLabel}>pyke.mezo</div>
          </div>
        </div>
        <div className="mt-3">
          {["Wallet address", "Discord username"].map((scope) => (
            <div
              key={scope}
              className="flex items-center gap-2 py-[5px] text-sm"
            >
              <Glyph
                shape={shapes.check}
                size={15}
                strokeWidth={2.4}
                className="text-pos"
              />
              {scope}
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2 text-[14.5px] font-semibold">
          <span className="grid h-10 flex-1 place-items-center rounded-[20px] bg-acc text-on-acc">
            Allow
          </span>
          <span className="grid h-10 flex-1 place-items-center rounded-[20px] bg-soft">
            Deny
          </span>
        </div>
      </div>
      <div className={`${mockCard} mt-3`}>
        <div className="flex items-baseline justify-between">
          <span className="text-[15.5px] font-[650]">Gauge Scout</span>
          <span className={mockLabel}>Live</span>
        </div>
        <div className="mt-2.5 text-[15px] font-[650] tabular-nums">
          122,480{" "}
          <span className="font-normal text-sec">of 200,000 requests</span>
        </div>
        <div className="mt-2.5 mb-3 h-1.5 overflow-hidden rounded-[3px] bg-soft2">
          <span className="block h-full w-[61%] rounded-[3px] bg-acc" />
        </div>
        <div className="flex items-center justify-between rounded-xl bg-soft px-3 py-2.5">
          <span className={mockLabel}>Production server key</span>
          <span className="font-mono text-[12.5px] text-sec">
            mbx_live_…4f2a
          </span>
        </div>
      </div>
    </>
  )
}

export function WelcomeDialog(): ReactNode {
  const [open, setOpen] = useState(true)
  const [step, setStep] = useState(0)
  const reduced = useReducedMotion()
  const next = useRef<HTMLButtonElement>(null)
  const phrase = useCycle(integrations.length, phraseMs, step === 2 && !reduced)

  // `?welcome=show` has done its work: nothing shared or bookmarked keeps it.
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      if (!url.searchParams.has(welcomeParam)) return
      url.searchParams.delete(welcomeParam)
      window.history.replaceState(
        window.history.state,
        "",
        url.pathname + url.search + url.hash,
      )
    } catch {
      // An address that cannot be parsed keeps its query.
    }
  }, [])

  /** Remembered at once, so a reload during the exit does not show it again. */
  function close(): void {
    if (!open) return
    setOpen(false)
    setTimeout(() => closeWelcome(today()), reduced ? 0 : exitMs)
  }

  function advance(): void {
    if (step === stepCount - 1) {
      close()
      return
    }
    setStep(step + 1)
  }

  const titles = [
    "Meet the new Matchbox Pro",
    "Explore Mezo with Matchscan",
    `Integrate ${integrations.join(", ")} into your app`,
  ]

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) close()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          data-mbx-motion=""
          data-mbx-layer=""
          className="fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-[mbx-fade-out_220ms_ease-out_forwards] data-[state=open]:animate-[mbx-fade-in_240ms_ease-out]"
        />
        <Dialog.Content
          data-welcome=""
          data-mbx-motion=""
          data-mbx-layer=""
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // The primary button, not the close X the trap would pick.
            event.preventDefault()
            next.current?.focus()
          }}
          onPointerDown={(event) => {
            // The padding around the card is the scrim.
            if (event.target === event.currentTarget) close()
          }}
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-6 text-ink outline-none data-[state=closed]:animate-[mbx-fade-out_220ms_ease-out_forwards] data-[state=open]:animate-[mbx-pop-in_280ms_var(--ease-roll)] max-[860px]:block max-[860px]:p-0"
        >
          <div className="relative w-full max-w-[960px] rounded-[28px] bg-soft2 pb-12 max-[860px]:min-h-dvh max-[860px]:rounded-none max-[860px]:bg-sheet max-[860px]:pb-0">
            <div className="relative grid h-[590px] grid-cols-2 overflow-hidden rounded-[28px] bg-sheet shadow-[0_14px_40px_rgb(0_0_0/0.16)] max-[860px]:flex max-[860px]:h-auto max-[860px]:min-h-dvh max-[860px]:flex-col max-[860px]:rounded-none max-[860px]:shadow-none">
              <div className="flex flex-col px-11 pt-11 pb-10 max-[860px]:order-2 max-[860px]:flex-1 max-[860px]:px-6 max-[860px]:pt-7 max-[860px]:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                <div className="flex h-[22px] items-center gap-3 max-[860px]:hidden">
                  {step === 0 ? <Lockup.Pro height={22} /> : null}
                  {step === 1 ? (
                    <>
                      <ScanLockup.Root height={22} />
                      <span className="rounded-lg bg-acc-soft px-2 py-[3px] text-[12.5px] leading-[1.3] font-semibold text-acc-ink">
                        Preview
                      </span>
                    </>
                  ) : null}
                  {step === 2 ? <IdDeveloperLockup running={!reduced} /> : null}
                </div>
                <Dialog.Title
                  className={`${headline} mt-11 max-[860px]:mt-0`}
                  aria-label={titles[step]}
                >
                  {step === 0 ? (
                    <>
                      Meet the new
                      <span className="block text-acc">Matchbox Pro</span>
                    </>
                  ) : null}
                  {step === 1 ? (
                    <>
                      Explore Mezo with
                      <span className="block text-acc">
                        Matchscan
                        <span className="ml-3 hidden rounded-lg bg-acc-soft px-2 py-[3px] align-middle text-[12.5px] leading-[1.3] font-semibold tracking-normal text-acc-ink max-[860px]:inline-block">
                          Preview
                        </span>
                      </span>
                    </>
                  ) : null}
                  {step === 2 ? (
                    <span aria-hidden="true">
                      Integrate
                      <span className="block whitespace-nowrap text-acc">
                        <MorphText>{integrations[phrase] ?? ""}</MorphText>
                      </span>
                      into your app
                    </span>
                  ) : null}
                </Dialog.Title>
                <Points
                  points={
                    step === 0
                      ? proPoints
                      : step === 1
                        ? scanPoints
                        : buildPoints
                  }
                />
                <div className="mt-auto flex items-center justify-between pt-6">
                  <div className="flex gap-1">
                    {Array.from({ length: stepCount }, (_, index) => (
                      <button
                        // biome-ignore lint/suspicious/noArrayIndexKey: the steps are fixed and in order
                        key={index}
                        type="button"
                        aria-label={`Step ${index + 1} of ${stepCount}`}
                        aria-current={index === step ? "step" : undefined}
                        onClick={() => setStep(index)}
                        className="group grid size-6 cursor-pointer place-items-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-ink"
                      >
                        <span className="size-[9px] rounded-full bg-soft2 transition-colors group-aria-[current=step]:bg-acc" />
                      </button>
                    ))}
                  </div>
                  <PillButton.Root
                    ref={next}
                    onClick={advance}
                    className="h-12 rounded-3xl px-[26px] text-[16.5px]"
                  >
                    {step === stepCount - 1 ? "Get started" : "Next"}
                  </PillButton.Root>
                </div>
                <p className="mt-5 hidden text-center text-sm text-sec max-[860px]:block">
                  Looking for the old Matchbox?{" "}
                  <ClassicLink label="Go to Classic" />
                </p>
              </div>
              <div
                aria-hidden="true"
                className="relative flex items-center justify-center bg-soft max-[860px]:order-1 max-[860px]:h-[300px] max-[860px]:flex-none max-[860px]:items-start max-[860px]:overflow-hidden max-[860px]:pt-16"
              >
                <div className="w-[344px] max-w-[calc(100%-40px)]">
                  {step === 0 ? <BallotPicture /> : null}
                  {step === 1 ? <ScanPicture /> : null}
                  {step === 2 ? <BuildPicture /> : null}
                </div>
              </div>
              <Dialog.Close
                aria-label="Close"
                className="absolute top-5 right-5 z-10 grid size-9 cursor-pointer place-items-center rounded-full bg-sheet text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink max-[860px]:top-4 max-[860px]:right-4"
              >
                <Glyph shape={shapes.x} size={16} />
              </Dialog.Close>
            </div>
            <p className="absolute inset-x-0 bottom-3.5 text-center text-[14.5px] text-sec max-[860px]:hidden">
              Looking for the old Matchbox?{" "}
              <ClassicLink label="Go to Matchbox Classic" />
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Leaving for Classic counts as having seen the dialog. */
function ClassicLink({ label }: { label: string }): ReactNode {
  return (
    <a
      href={classicUrl}
      onClick={() => closeWelcome(today())}
      className="rounded-[6px] font-semibold text-ink2 underline decoration-1 underline-offset-[3px] outline-none hover:decoration-2 focus-visible:outline-2 focus-visible:outline-ink"
    >
      {label}
    </a>
  )
}
