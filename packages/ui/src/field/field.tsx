import { TokenIcon } from "@matchbox/token-icons"
import {
  type ChangeEvent,
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useId,
} from "react"
import { Icon } from "../icons"
import { tv } from "../tv"

/**
 * Amount field (Components frame): white box, radius 20, label inside, a
 * 34px figure and the currency pill (which is also the selector). Balance
 * and Max sit on the line below. Values stay strings end to end: no floats.
 */

const field = tv({
  slots: {
    root: "flex flex-col",
    box: "flex items-center gap-3 rounded-[20px] border-[1.5px] border-soft2 bg-bg py-4 pr-4 pl-5 focus-within:border-ink",
    label: "block text-sm text-sec",
    input:
      "mt-0.5 w-full min-w-0 bg-transparent text-[34px] font-[650] tracking-[-0.02em] text-ink tabular-nums outline-none placeholder:text-mut",
    currency:
      "ml-auto flex h-[46px] flex-none cursor-pointer items-center gap-[9px] rounded-[23px] bg-soft pr-4 pl-[7px] text-base font-[650] text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink",
    balance:
      "mt-2.5 flex items-center justify-between px-1 text-[14.5px] text-sec tabular-nums",
    max: "cursor-pointer font-[650] text-ink underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
    error: "mt-2 px-1 text-[14.5px] font-semibold text-neg",
  },
  variants: {
    invalid: {
      true: { box: "border-neg focus-within:border-neg" },
    },
  },
})

type FieldContextValue = {
  inputId: string
  errorId: string
  invalid: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

function useField(): FieldContextValue {
  const context = useContext(FieldContext)
  if (context === null)
    throw new Error("Field parts must be inside <Field.Root>")
  return context
}

export type RootProps = ComponentProps<"div"> & {
  invalid?: boolean
}

export function Root({
  invalid = false,
  className,
  ...props
}: RootProps): ReactNode {
  const id = useId()
  return (
    <FieldContext.Provider
      value={{ inputId: `${id}-input`, errorId: `${id}-error`, invalid }}
    >
      <div className={field().root({ className })} {...props} />
    </FieldContext.Provider>
  )
}

Root.displayName = "Field"

export function Box({ className, ...props }: ComponentProps<"div">): ReactNode {
  const { invalid } = useField()
  return <div className={field({ invalid }).box({ className })} {...props} />
}

Box.displayName = "Field.Box"

export function Label({
  className,
  ...props
}: ComponentProps<"label">): ReactNode {
  const { inputId } = useField()
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor comes from Field.Root's context
    <label
      htmlFor={inputId}
      className={field().label({ className })}
      {...props}
    />
  )
}

Label.displayName = "Field.Label"

/** Keeps digits and one decimal point, capped at `decimals` places. */
export function sanitizeAmount(raw: string, decimals: number): string {
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.]/g, "")
  const [whole = "", ...rest] = cleaned.split(".")
  if (rest.length === 0) return whole
  return `${whole}.${rest.join("").slice(0, decimals)}`
}

export type InputProps = Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "type"
> & {
  value: string
  onValueChange: (value: string) => void
  /** Decimal places allowed: BTC up to 8, MEZO 2. */
  decimals?: number
}

export function Input({
  value,
  onValueChange,
  decimals = 18,
  className,
  placeholder = "0.00",
  ...props
}: InputProps): ReactNode {
  const { inputId, errorId, invalid } = useField()
  return (
    <input
      id={inputId}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={value}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? errorId : undefined}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        onValueChange(sanitizeAmount(event.target.value, decimals))
      }
      className={field().input({ className })}
      {...props}
    />
  )
}

Input.displayName = "Field.Input"

export type CurrencyProps = Omit<ComponentProps<"button">, "children"> & {
  ticker: string
  src?: string | null
}

/** The currency pill, also the selector. */
export function Currency({
  ticker,
  src,
  className,
  type,
  ...props
}: CurrencyProps): ReactNode {
  return (
    <button
      type={type ?? "button"}
      aria-label={`Currency ${ticker}`}
      className={field().currency({ className })}
      {...props}
    >
      <TokenIcon ticker={ticker} src={src ?? null} size={32} />
      {ticker}
      <Icon
        name="chevron-down"
        size={16}
        strokeWidth={2.2}
        className="text-sec"
      />
    </button>
  )
}

Currency.displayName = "Field.Currency"

export function Balance({
  className,
  ...props
}: ComponentProps<"p">): ReactNode {
  return <p className={field().balance({ className })} {...props} />
}

Balance.displayName = "Field.Balance"

export function Max({
  className,
  type,
  children = "Max",
  ...props
}: ComponentProps<"button">): ReactNode {
  return (
    <button
      type={type ?? "button"}
      className={field().max({ className })}
      {...props}
    >
      {children}
    </button>
  )
}

Max.displayName = "Field.Max"

/** What happened, said once. Linked to the input when invalid. */
export function ErrorMessage({
  className,
  ...props
}: ComponentProps<"p">): ReactNode {
  const { errorId, invalid } = useField()
  if (!invalid) return null
  return (
    <p
      id={errorId}
      aria-live="polite"
      className={field().error({ className })}
      {...props}
    />
  )
}

ErrorMessage.displayName = "Field.Error"
