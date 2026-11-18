import { TokenIcon } from "@matchbox/token-icons"
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import * as CoinStack from "../coin-stack"
import { Tip } from "../floating/floating"
import { Glyph, type GlyphShape, shapes } from "../icons"
import * as PillButton from "../pill-button"
import * as Slot from "../slot"
import { tv } from "../tv"

/**
 * Lock cards (Doop `QwQxqCNbxn`, Overview refined in `sL4e8DNYO0`): soft
 * card, 54px coloured tab with the official coin and the lock's id, the
 * voting power headline in its unit, a meta row of properties as icons with
 * tooltips, icon rows under a hairline and one pill.
 * A click anywhere on the card flips it between its faces with a 360ms 3D
 * transform (Decided 9 Nov), except on its buttons, links and fields; Manage
 * or the tab's chevron flips it, and the back tab's return arrow (`llXWfukzLz`
 * A) flips it home. The back is recessed and hatched, its tab dimmed, so a
 * flipped card reads as flipped. Under reduced motion the faces swap without
 * animation. Both faces share one grid cell, so nothing shifts.
 */

export type LockKind = "vebtc" | "vemezo" | "expired"

type LockCardContextValue = {
  kind: LockKind
  token: "BTC" | "MEZO"
  flipped: boolean
  setFlipped: (flipped: boolean) => void
  manageRef: RefObject<HTMLButtonElement | null>
  backRef: RefObject<HTMLDivElement | null>
}

const LockCardContext = createContext<LockCardContextValue | null>(null)

/** Which face a part sits on: the back tab dims and gets the return arrow. */
const FaceContext = createContext<"front" | "back">("front")

function useLockCard(): LockCardContextValue {
  const context = useContext(LockCardContext)
  if (context === null) {
    throw new Error("LockCard parts must be inside <LockCard.Root>")
  }
  return context
}

const styles = tv({
  slots: {
    scene: "group/lock relative cursor-pointer [perspective:1400px]",
    flipper:
      "grid h-full transition-transform duration-[360ms] ease-roll [transform-style:preserve-3d] group-data-[flipped=true]/lock:[transform:rotateY(180deg)] motion-reduce:transition-none motion-reduce:group-data-[flipped=true]/lock:[transform:none]",
    face: "flex min-h-[292px] flex-col overflow-hidden rounded-[24px] bg-soft text-ink shadow-[inset_0_0_0_1px_var(--edge)] [grid-area:1/1] [backface-visibility:hidden]",
    front: "motion-reduce:group-data-[flipped=true]/lock:opacity-0",
    back: "bg-[color:color-mix(in_srgb,var(--soft)_55%,var(--bg))] bg-[image:repeating-linear-gradient(135deg,color-mix(in_srgb,var(--ink)_6%,transparent)_0_1px,transparent_1px_8px)] shadow-[inset_0_0_0_1px_var(--line)] [transform:rotateY(180deg)] motion-reduce:[transform:none] motion-reduce:opacity-0 motion-reduce:group-data-[flipped=true]/lock:opacity-100",
    tab: "flex h-[54px] flex-none items-center justify-between gap-3 pr-3.5 pl-5 text-[15.5px] font-[650]",
    label: "flex min-w-0 items-center gap-2",
    mark: "block size-6 flex-none overflow-hidden rounded-full shadow-[0_0_0_2px_var(--coinRing)]",
    flip: "grid size-8 flex-none cursor-pointer place-items-center rounded-full outline-none hover:bg-[color-mix(in_srgb,currentColor_14%,transparent)] focus-visible:outline-2 focus-visible:outline-current",
    chip: "rounded-[7px] bg-soft2 px-2 py-[3px] text-[12.5px] font-[650] text-ink2",
    headline: "text-[24px] font-[650] tracking-[-0.015em] tabular-nums",
    unit: "ml-[5px] text-[15px] font-semibold tracking-normal text-sec",
    meta: "mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[14px] text-sec tabular-nums",
    prop: "inline-flex items-center gap-1.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
    lines:
      "mt-4 flex flex-col gap-2.5 border-t border-line pt-3.5 text-[14.5px] text-ink2 tabular-nums",
    line: "flex min-h-6 items-center gap-2.5",
    lineValue:
      "ml-auto flex min-w-0 items-center gap-2 text-right font-semibold",
    body: "flex flex-1 flex-col px-5 pt-5 pb-[18px]",
    amount: "text-[23px] font-[650] tracking-[-0.015em] tabular-nums",
    usd: "mt-0.5 text-[15px] text-sec tabular-nums",
    rows: "mt-4 flex flex-col gap-[9px] text-[15px] text-ink2 tabular-nums",
    row: "flex items-center justify-between gap-3",
    menu: "flex flex-1 flex-col px-2.5 pt-2 pb-3",
    item: "flex h-11 w-full cursor-pointer items-center gap-3 rounded-[14px] px-2.5 text-left text-[15.5px] font-[550] text-ink outline-none hover:bg-raised focus-visible:bg-raised focus-visible:outline-2 focus-visible:outline-ink aria-disabled:cursor-default aria-disabled:text-sec aria-disabled:hover:bg-transparent",
    itemIcon:
      "grid size-[30px] flex-none place-items-center rounded-full bg-raised group-hover/item:bg-soft group-focus-visible/item:bg-soft",
  },
  variants: {
    kind: {
      vebtc: { tab: "bg-acc text-on-acc" },
      vemezo: { tab: "bg-mezo text-on-mezo" },
      expired: { tab: "bg-tab-off text-on-tab-off" },
    },
    face: {
      front: {},
      // An inset shadow darkens the tab's colour under its coin and text.
      back: { tab: "shadow-[inset_0_0_0_999px_rgb(0_0_0/0.24)]" },
    },
  },
})

/** Clicks that land on a control inside the card do not flip it. */
function fromInteractive(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target
  return (
    target instanceof Element &&
    target.closest(
      "a, button, input, select, textarea, label, [tabindex], [data-lock-card-ignore]",
    ) !== null
  )
}

export type RootProps = Omit<ComponentProps<"article">, "children"> & {
  kind: LockKind
  /** Which coin marks the tab. Defaults from the kind (expired: MEZO). */
  token?: "BTC" | "MEZO"
  flipped?: boolean
  defaultFlipped?: boolean
  onFlippedChange?: (flipped: boolean) => void
  children: ReactNode
}

export function Root({
  kind,
  token,
  flipped: flippedProp,
  defaultFlipped = false,
  onFlippedChange,
  className,
  children,
  onClick,
  ...props
}: RootProps): ReactNode {
  const [inner, setInner] = useState(defaultFlipped)
  const flipped = flippedProp ?? inner
  const manageRef = useRef<HTMLButtonElement | null>(null)
  const backRef = useRef<HTMLDivElement | null>(null)
  const s = styles({ kind })

  const value = useMemo<LockCardContextValue>(
    () => ({
      kind,
      token: token ?? (kind === "vebtc" ? "BTC" : "MEZO"),
      flipped,
      setFlipped: (next) => {
        setInner(next)
        onFlippedChange?.(next)
      },
      manageRef,
      backRef,
    }),
    [kind, token, flipped, onFlippedChange],
  )

  return (
    <LockCardContext.Provider value={value}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Manage and Done are the keyboard controls */}
      <article
        data-flipped={flipped}
        className={s.scene({ className })}
        onClick={(event) => {
          onClick?.(event)
          if (event.defaultPrevented || fromInteractive(event)) return
          if (window.getSelection()?.type === "Range") return
          value.setFlipped(!flipped)
        }}
        {...props}
      >
        <div data-mbx-motion="" className={s.flipper()}>
          {children}
        </div>
      </article>
    </LockCardContext.Provider>
  )
}

Root.displayName = "LockCard"

export function Front({ children }: { children: ReactNode }): ReactNode {
  const { flipped } = useLockCard()
  const s = styles()
  return (
    <div inert={flipped} className={s.face({ className: s.front() })}>
      {children}
    </div>
  )
}

Front.displayName = "LockCard.Front"

export function Back({ children }: { children: ReactNode }): ReactNode {
  const { flipped, backRef, manageRef } = useLockCard()
  const s = styles()
  const wasFlipped = useRef(flipped)

  useEffect(() => {
    if (flipped && !wasFlipped.current) {
      // The first action, not the tab's return arrow ahead of it.
      const back = backRef.current
      const first =
        back?.querySelector<HTMLElement>("[data-lock-item]") ??
        back?.querySelector<HTMLElement>("button, a")
      first?.focus()
    } else if (!flipped && wasFlipped.current) {
      manageRef.current?.focus()
    }
    wasFlipped.current = flipped
  }, [flipped, backRef, manageRef])

  return (
    <div
      ref={backRef}
      inert={!flipped}
      className={s.face({ className: s.back() })}
    >
      <FaceContext.Provider value="back">{children}</FaceContext.Provider>
    </div>
  )
}

Back.displayName = "LockCard.Back"

export type TabProps = {
  children: ReactNode
  /** Link to the lock's page; shows the chevron. */
  href?: string
  /** Right of the label: a state chip, the flip control. */
  aside?: ReactNode
  className?: string
}

/**
 * The coloured tab: the official coin, the lock's id, then `aside`. On the
 * back it dims and ends in the return arrow, where the front's chevron sits.
 */
export function Tab({ children, href, aside, className }: TabProps): ReactNode {
  const { kind, token } = useLockCard()
  const face = useContext(FaceContext)
  const s = styles({ kind, face })
  const mark = (
    <span aria-hidden="true" className={s.mark()}>
      <TokenIcon
        ticker={token}
        size={24}
        style={
          kind === "expired" ? { filter: "grayscale(1)", opacity: 0.6 } : {}
        }
      />
    </span>
  )
  return (
    <div className={s.tab({ className })}>
      {href === undefined ? (
        <span className={s.label()}>
          {mark}
          {children}
        </span>
      ) : (
        <a
          href={href}
          className={`${s.label()} rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current`}
        >
          {mark}
          {children}
          <Glyph shape={shapes.chevronRight} size={16} strokeWidth={2.2} />
        </a>
      )}
      {aside === undefined && face === "front" ? null : (
        <span className="flex flex-none items-center gap-1.5">
          {aside}
          {face === "back" ? <Unflip /> : null}
        </span>
      )}
    </div>
  )
}

Tab.displayName = "LockCard.Tab"

/** The back tab's return arrow: flips the card home. */
function Unflip(): ReactNode {
  const { setFlipped } = useLockCard()
  return (
    <button
      type="button"
      aria-label="Back"
      data-tap=""
      className={styles().flip({
        className:
          "bg-[color-mix(in_srgb,currentColor_16%,transparent)] hover:bg-[color-mix(in_srgb,currentColor_24%,transparent)]",
      })}
      onClick={() => setFlipped(false)}
    >
      <Glyph shape={shapes.undo2} size={17} strokeWidth={2.2} />
    </button>
  )
}

export function Body({
  className,
  ...props
}: ComponentProps<"div">): ReactNode {
  return <div className={styles().body({ className })} {...props} />
}

Body.displayName = "LockCard.Body"

export function Amount({
  className,
  ...props
}: ComponentProps<"p">): ReactNode {
  return <p className={styles().amount({ className })} {...props} />
}

Amount.displayName = "LockCard.Amount"

export function Usd({ className, ...props }: ComponentProps<"p">): ReactNode {
  return <p className={styles().usd({ className })} {...props} />
}

Usd.displayName = "LockCard.Usd"

export function Rows({ className, ...props }: ComponentProps<"dl">): ReactNode {
  return <dl className={styles().rows({ className })} {...props} />
}

Rows.displayName = "LockCard.Rows"

export type RowProps = {
  label: ReactNode
  children: ReactNode
  /** "attention" for state that needs action ("Not voted"). */
  tone?: "default" | "attention"
}

export function Row({
  label,
  children,
  tone = "default",
}: RowProps): ReactNode {
  return (
    <div className={styles().row()}>
      <dt className="text-sec">{label}</dt>
      <dd className={tone === "attention" ? "font-semibold text-acc-ink" : ""}>
        {children}
      </dd>
    </div>
  )
}

Row.displayName = "LockCard.Row"

export type ActionProps = Omit<PillButton.RootProps, "size" | "intent"> & {
  /** Primary (orange) for Claim, Vote and Withdraw; neutral otherwise. */
  intent?: "primary" | "neutral"
}

/** The one small action at the bottom of the front face. */
export function Action({
  className,
  intent = "neutral",
  ...props
}: ActionProps): ReactNode {
  return (
    <PillButton.Root
      intent={intent}
      size="sm"
      className={`mt-auto self-start ${className ?? ""}`}
      {...props}
    />
  )
}

Action.displayName = "LockCard.Action"

/** Flips the card to its action face. */
export function Manage({
  children = "Manage",
}: {
  children?: string
}): ReactNode {
  const { setFlipped, manageRef } = useLockCard()
  return (
    <PillButton.Root
      ref={manageRef}
      intent="neutral"
      size="sm"
      className="mt-auto self-start"
      onClick={() => setFlipped(true)}
    >
      {children}
    </PillButton.Root>
  )
}

Manage.displayName = "LockCard.Manage"

/**
 * The tab's flip control (a chevron), for cards whose pill does something
 * else; it is the keyboard way to the actions and takes focus back on Done.
 */
export function Flip({ label = "Manage" }: { label?: string }): ReactNode {
  const { setFlipped, manageRef } = useLockCard()
  return (
    <button
      ref={manageRef}
      type="button"
      aria-label={label}
      className={styles().flip()}
      onClick={() => setFlipped(true)}
    >
      <Glyph shape={shapes.chevronRight} size={17} strokeWidth={2.2} />
    </button>
  )
}

Flip.displayName = "LockCard.Flip"

/** A state chip in the tab ("Expired"). Real state only. */
export function Chip({ children }: { children: ReactNode }): ReactNode {
  return <span className={styles().chip()}>{children}</span>
}

Chip.displayName = "LockCard.Chip"

export type HeadlineProps = {
  /** The figure ("500,000"). */
  children: ReactNode
  /** Its unit, smaller and secondary ("veMEZO"); omit when the figure carries it. */
  unit?: string
  /** Muted, for an expired lock's zero. */
  muted?: boolean
}

/** Voting power, the card's one headline figure, in its unit. */
export function Headline({
  children,
  unit,
  muted = false,
}: HeadlineProps): ReactNode {
  const s = styles()
  return (
    <p className={s.headline({ className: muted ? "text-sec" : "" })}>
      {children}
      {unit === undefined ? null : <span className={s.unit()}>{unit}</span>}
    </p>
  )
}

Headline.displayName = "LockCard.Headline"

/** The meta row under the headline: properties as icons and figures. */
export function Meta({
  className,
  ...props
}: ComponentProps<"div">): ReactNode {
  return <div className={styles().meta({ className })} {...props} />
}

Meta.displayName = "LockCard.Meta"

export type PropProps = {
  /** Tooltip and accessible name ("Locked", "Auto max", "Unlocks"). */
  label: string
  children?: ReactNode
} & (
  | { icon: GlyphShape }
  /** Any 16px mark instead, such as the token coin. */
  | { mark: ReactNode }
)

/** One property in the meta row: an icon with a tooltip, then its value. */
export function Prop(props: PropProps): ReactNode {
  const { label, children } = props
  const s = styles()
  const mark =
    "icon" in props ? (
      <Glyph shape={props.icon} size={15} strokeWidth={1.9} />
    ) : (
      props.mark
    )
  return (
    <Tip
      content={label}
      trigger={(tip) => (
        <span
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need the tooltip
          tabIndex={0}
          className={s.prop()}
          {...tip}
        >
          <span role="img" aria-label={label} className="inline-grid">
            {mark}
          </span>
          {children === undefined ? null : (
            <span className="font-semibold text-ink2">{children}</span>
          )}
        </span>
      )}
    />
  )
}

Prop.displayName = "LockCard.Prop"

/** Icon rows under a hairline. */
export function Lines({
  className,
  ...props
}: ComponentProps<"dl">): ReactNode {
  return <dl className={styles().lines({ className })} {...props} />
}

Lines.displayName = "LockCard.Lines"

export type LineProps = {
  icon: GlyphShape
  label: ReactNode
  children: ReactNode
  /** positive: money to claim; attention: amber, needs action; muted. */
  tone?: "default" | "positive" | "attention" | "muted"
}

const lineTone = {
  default: { row: "", value: "text-ink" },
  positive: { row: "", value: "text-pos" },
  attention: { row: "text-acc-ink", value: "text-acc-ink" },
  muted: { row: "", value: "font-medium text-sec" },
} as const

export function Line({
  icon,
  label,
  children,
  tone = "default",
}: LineProps): ReactNode {
  const s = styles()
  return (
    <div className={s.line({ className: lineTone[tone].row })}>
      <dt className="flex flex-none items-center gap-2.5 whitespace-nowrap">
        <Glyph
          shape={icon}
          size={16}
          strokeWidth={1.8}
          className={tone === "attention" ? "flex-none" : "flex-none text-sec"}
        />
        {label}
      </dt>
      <dd className={s.lineValue({ className: lineTone[tone].value })}>
        {children}
      </dd>
    </div>
  )
}

Line.displayName = "LockCard.Line"

export function Menu({
  className,
  ...props
}: ComponentProps<"div">): ReactNode {
  return <div className={styles().menu({ className })} {...props} />
}

Menu.displayName = "LockCard.Menu"

export type MenuItemProps = Omit<
  ComponentProps<"button">,
  "children" | "disabled"
> & {
  icon: ReactNode
  children: ReactNode
  /** Trailing value ("$8.70", "3y 2mo"), or why the item is off. */
  value?: ReactNode
  /** Dimmed and inert but still focusable, so its reason is read out. */
  disabled?: boolean
  asChild?: boolean
}

export function MenuItem({
  icon,
  children,
  value,
  disabled = false,
  asChild = false,
  className,
  type,
  onClick,
  ...props
}: MenuItemProps): ReactNode {
  const s = styles()
  const content = (
    <>
      <span className={s.itemIcon()}>{icon}</span>
      {children}
      {value === undefined ? null : (
        <span className="ml-auto text-sm font-medium text-sec tabular-nums">
          {value}
        </span>
      )}
    </>
  )
  if (asChild) {
    return (
      <Slot.Root
        data-lock-item=""
        aria-disabled={disabled ? true : undefined}
        className={s.item({ className: `group/item ${className ?? ""}` })}
        onClick={disabled ? undefined : onClick}
        {...props}
      >
        {content}
      </Slot.Root>
    )
  }
  return (
    <button
      type={type ?? "button"}
      data-lock-item=""
      aria-disabled={disabled ? true : undefined}
      className={s.item({ className: `group/item ${className ?? ""}` })}
      onClick={disabled ? undefined : onClick}
      {...props}
    >
      {content}
    </button>
  )
}

MenuItem.displayName = "LockCard.MenuItem"

/** Closes the action face. The back tab's return arrow does this too. */
export function Done({ children = "Done" }: { children?: string }): ReactNode {
  const { setFlipped } = useLockCard()
  return (
    <PillButton.Root
      intent="neutral"
      size="sm"
      className="mt-auto ml-2.5 self-start"
      onClick={() => setFlipped(false)}
    >
      {children}
    </PillButton.Root>
  )
}

Done.displayName = "LockCard.Done"

export type NewTileProps = ComponentProps<"button"> & {
  label?: string
  asChild?: boolean
}

/** "+" button, "New lock", then BTC and MEZO coins. No sentence. */
export function NewTile({
  label = "New lock",
  asChild = false,
  className,
  type,
  ...props
}: NewTileProps): ReactNode {
  const classes = `group flex min-h-[292px] w-full cursor-pointer flex-col items-center justify-center gap-3.5 rounded-[24px] border-[1.5px] border-dashed border-dash bg-bg text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${className ?? ""}`
  const content = (
    <>
      <span className="grid size-[52px] place-items-center rounded-full bg-acc text-on-acc">
        <Glyph shape={shapes.plus} size={22} strokeWidth={2.4} />
      </span>
      <span className="text-[17px] font-[650]">{label}</span>
      <CoinStack.Root
        coins={[{ ticker: "BTC" }, { ticker: "MEZO" }]}
        size={28}
        surface="var(--bg)"
        decorative
      />
    </>
  )
  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {content}
      </Slot.Root>
    )
  }
  return (
    <button type={type ?? "button"} className={classes} {...props}>
      {content}
    </button>
  )
}

NewTile.displayName = "LockCard.NewTile"
