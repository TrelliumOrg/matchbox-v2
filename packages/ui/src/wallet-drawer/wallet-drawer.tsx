import { useIsLeaving } from "@matchbox/motion"
import { Dialog } from "radix-ui"
import type { ComponentProps, ReactNode } from "react"
import { Glyph, shapes } from "../icons"
import { tv } from "../tv"

/**
 * The wallet drawer (skate9 pattern, Connect wallet `ue22xgsv9U`,
 * Connecting `6OKwJxV1vt`, phone `Qpx1lv1Ryc`): a floating drawer 440 wide,
 * 16px clear of the right, top and bottom edges, radius 24; a bottom sheet
 * on phones. Groups of wallet rows, then the connecting view with a ring
 * around the wallet's icon. Presentational: the app owns wagmi.
 */

const drawer = tv({
  slots: {
    overlay:
      "fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-[mbx-fade-out_240ms_ease-out] data-[state=open]:animate-[mbx-fade-in_240ms_ease-out]",
    content:
      "fixed top-4 right-4 bottom-4 z-50 flex w-[440px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[24px] bg-sheet text-ink shadow-sheet outline-none data-[state=closed]:animate-[mbx-sheet-out_280ms_var(--ease-roll)] data-[state=open]:animate-[mbx-sheet-in_340ms_var(--ease-roll)] max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[92dvh] max-sm:w-full max-sm:max-w-full max-sm:rounded-b-none max-sm:data-[state=closed]:animate-[mbx-sheet-down_280ms_var(--ease-roll)] max-sm:data-[state=open]:animate-[mbx-sheet-up_340ms_var(--ease-roll)]",
    grab: "mx-auto mt-2.5 hidden h-1 w-9 flex-none rounded-sm bg-ring max-sm:block",
    header:
      "flex h-11 flex-none items-center gap-3 px-7 pt-7 max-sm:px-6 max-sm:pt-4",
    title: "text-[22px] font-[650] tracking-[-0.02em]",
    round:
      "grid size-10 flex-none cursor-pointer place-items-center rounded-full bg-soft text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink dark:bg-soft2",
    body: "mt-6 min-h-0 flex-1 overflow-y-auto px-7 pb-4 max-sm:px-6",
    footer:
      "flex-none px-7 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-[13.5px] text-sec max-sm:px-6",
    group: "mt-6 first:mt-0",
    groupLabel: "mb-1.5 text-[15px] font-[550] text-sec",
    row: "group -mx-3 flex min-h-[72px] w-[calc(100%+24px)] cursor-pointer items-center gap-4 rounded-[18px] px-3 text-left outline-none hover:bg-soft focus-visible:bg-soft focus-visible:outline-2 focus-visible:outline-ink dark:hover:bg-soft2",
    icon: "grid size-12 flex-none place-items-center overflow-hidden rounded-full bg-soft2 text-[17px] font-[650] text-ink2",
    name: "block truncate text-base font-semibold",
    detail: "block text-[14.5px] text-sec",
    action:
      "ml-auto flex h-9 flex-none items-center gap-1.5 rounded-[18px] px-4 text-[15px] font-semibold",
  },
})

const actions = {
  primary: "bg-acc text-on-acc",
  secondary: "bg-acc-soft text-acc-ink",
  get: "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--line)]",
} as const

export type RootProps = ComponentProps<typeof Dialog.Root>

/**
 * Closes while its host keeps it mounted for the exit (`LeavingProvider`),
 * so the slide out mirrors the slide in.
 */
export function Root({ open, ...props }: RootProps): ReactNode {
  const leaving = useIsLeaving()
  const shown = leaving ? false : open
  return (
    <Dialog.Root {...props} {...(shown === undefined ? {} : { open: shown })} />
  )
}

Root.displayName = "WalletDrawer.Root"

export type ContentProps = ComponentProps<typeof Dialog.Content>

export function Content({
  className,
  children,
  ...props
}: ContentProps): ReactNode {
  const s = drawer()
  return (
    <Dialog.Portal>
      <Dialog.Overlay
        data-mbx-motion=""
        data-mbx-layer=""
        className={s.overlay()}
      />
      <Dialog.Content
        data-mbx-motion=""
        data-mbx-layer=""
        aria-describedby={undefined}
        className={s.content({ className })}
        {...props}
      >
        <span aria-hidden="true" className={s.grab()} />
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  )
}

Content.displayName = "WalletDrawer.Content"

export type HeaderProps = {
  children: ReactNode
  /** Shows the back arrow (connecting view). */
  onBack?: (() => void) | undefined
}

export function Header({ children, onBack }: HeaderProps): ReactNode {
  const s = drawer()
  return (
    <header className={s.header()}>
      {onBack === undefined ? null : (
        <button
          type="button"
          aria-label="Back to wallets"
          onClick={onBack}
          className={s.round({ className: "-ml-1" })}
        >
          <Glyph shape={shapes.arrowLeft} size={20} strokeWidth={1.8} />
        </button>
      )}
      <Dialog.Title className={s.title()}>{children}</Dialog.Title>
      <Dialog.Close
        aria-label="Close"
        className={s.round({ className: "ml-auto" })}
      >
        <Glyph shape={shapes.x} size={20} strokeWidth={1.8} />
      </Dialog.Close>
    </header>
  )
}

Header.displayName = "WalletDrawer.Header"

export function Body({
  className,
  ...props
}: ComponentProps<"div">): ReactNode {
  return <div className={drawer().body({ className })} {...props} />
}

Body.displayName = "WalletDrawer.Body"

export function Footer({
  className,
  ...props
}: ComponentProps<"footer">): ReactNode {
  return <footer className={drawer().footer({ className })} {...props} />
}

Footer.displayName = "WalletDrawer.Footer"

export function Group({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): ReactNode {
  const s = drawer()
  return (
    <section className={s.group()} aria-label={label}>
      <h3 className={s.groupLabel()}>{label}</h3>
      <ul>{children}</ul>
    </section>
  )
}

Group.displayName = "WalletDrawer.Group"

export function WalletIcon({
  name,
  src,
  size = 48,
}: {
  name: string
  src: string | null
  size?: number
}): ReactNode {
  const s = drawer()
  return (
    <span
      aria-hidden="true"
      className={s.icon()}
      style={{ width: size, height: size }}
    >
      {src === null ? (
        name.slice(0, 1)
      ) : (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          draggable={false}
          decoding="async"
          className="size-full object-cover"
        />
      )}
    </span>
  )
}

WalletIcon.displayName = "WalletDrawer.WalletIcon"

export type RowProps = {
  name: string
  icon: string | null
  detail: string
  /** "Installed" reads green. */
  tone?: "default" | "positive"
  /** primary: detected; secondary: connectable; get: a download link. */
  action: keyof typeof actions
  onSelect: () => void
}

export function Row({
  name,
  icon,
  detail,
  tone = "default",
  action,
  onSelect,
}: RowProps): ReactNode {
  const s = drawer()
  return (
    <li>
      <button type="button" onClick={onSelect} className={s.row()}>
        <WalletIcon name={name} src={icon} />
        <span className="min-w-0 flex-1">
          <span className={s.name()}>{name}</span>
          <span
            className={s.detail({
              className: tone === "positive" ? "text-pos" : "",
            })}
          >
            {detail}
          </span>
        </span>
        <span className={s.action({ className: actions[action] })}>
          {action === "get" ? (
            <>
              Get
              <Glyph shape={shapes.arrowUpRight} size={14} strokeWidth={2.2} />
              <span className="sr-only">, opens in a new tab</span>
            </>
          ) : (
            "Connect"
          )}
        </span>
      </button>
    </li>
  )
}

Row.displayName = "WalletDrawer.Row"

export type ConnectingProps = {
  name: string
  icon: string | null
  /** null while waiting on the wallet. */
  error: string | null
  onCancel: () => void
  onRetry: () => void
}

/** The ring view: a spinning orange arc while the wallet asks, red on error. */
export function Connecting({
  name,
  icon,
  error,
  onCancel,
  onRetry,
}: ConnectingProps): ReactNode {
  const failed = error !== null
  return (
    <div className="flex flex-col items-center pt-8 text-center">
      <div className="relative size-[152px]">
        <svg
          viewBox="0 0 152 152"
          aria-hidden="true"
          className="absolute inset-0"
        >
          <circle
            cx="76"
            cy="76"
            r="72"
            fill="none"
            strokeWidth="5"
            className={failed ? "stroke-neg" : "stroke-soft2"}
          />
          {failed ? null : (
            <circle
              cx="76"
              cy="76"
              r="72"
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray="120 333"
              data-mbx-motion=""
              className="origin-center animate-[mbx-spin_1.1s_linear_infinite] stroke-acc"
            />
          )}
        </svg>
        <span className="absolute inset-[20px]">
          <WalletIcon name={name} src={icon} size={112} />
        </span>
      </div>
      <h3
        aria-live="polite"
        className={`mt-7 text-[24px] font-[650] tracking-[-0.02em] ${failed ? "text-neg" : ""}`}
      >
        {failed ? error : `Confirm in ${name}`}
      </h3>
      <div className="mt-6 flex gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 cursor-pointer rounded-[22px] bg-acc-soft px-6 text-base font-semibold text-acc-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {failed ? "Back" : "Cancel"}
        </button>
        {failed ? (
          <button
            type="button"
            onClick={onRetry}
            className="h-11 cursor-pointer rounded-[22px] bg-acc px-6 text-base font-semibold text-on-acc outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  )
}

Connecting.displayName = "WalletDrawer.Connecting"
