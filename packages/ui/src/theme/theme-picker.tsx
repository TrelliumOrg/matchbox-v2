import { useHapticsSetting } from "@matchbox/motion"
import {
  type ColorScheme,
  type DarkPreset,
  darkPresets,
  isColorScheme,
  isDarkPreset,
  isLightPreset,
  type LightPreset,
  lightPresets,
  presets,
} from "@matchbox/tokens"
import { RadioGroup } from "radix-ui"
import { type CSSProperties, type ReactNode, useId } from "react"
import { Icon, type IconName } from "../icons"
import * as SegmentedControl from "../segmented-control"
import * as Switch from "../switch"
import * as Tooltip from "../tooltip"
import { type SyncState, useTheme } from "./theme-provider"

/**
 * The appearance picker from Doop "Theme picker" (`litxCRq5Vd`): mode, preset
 * swatches, then the Haptics switch. Applies on tap, no save button.
 */

const schemes: { value: ColorScheme; label: string; icon: IconName }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
]

export type RootProps = {
  children?: ReactNode
  className?: string
}

/** Mode, the presets the mode lists, and Haptics. Pass children to compose. */
export function Root({ children, className }: RootProps): ReactNode {
  const { appearance } = useTheme()
  return (
    <div className={className}>
      {children ?? (
        <>
          <Mode />
          {appearance.mode !== "dark" ? <Presets mode="light" /> : null}
          {appearance.mode !== "light" ? <Presets mode="dark" /> : null}
          <Haptics />
        </>
      )}
    </div>
  )
}

Root.displayName = "ThemePicker"

function Label({
  id,
  children,
  detail,
}: {
  id: string
  children: ReactNode
  detail?: string
}): ReactNode {
  return (
    <p
      id={id}
      className="mb-3 flex items-baseline justify-between text-base font-semibold text-ink"
    >
      {children}
      {detail === undefined ? null : (
        <span className="text-[14.5px] font-normal text-sec">{detail}</span>
      )}
    </p>
  )
}

export function Mode({ className }: { className?: string }): ReactNode {
  const { appearance, setScheme } = useTheme()
  const id = useId()
  return (
    <section className={className}>
      <Label id={id}>Mode</Label>
      <SegmentedControl.Root
        size="md"
        surface="sheet"
        aria-labelledby={id}
        value={appearance.mode}
        onValueChange={(value) => {
          if (isColorScheme(value)) setScheme(value)
        }}
      >
        {schemes.map((scheme) => (
          <SegmentedControl.Item key={scheme.value} value={scheme.value}>
            <Icon name={scheme.icon} size={18} strokeWidth={1.8} />
            {scheme.label}
          </SegmentedControl.Item>
        ))}
      </SegmentedControl.Root>
    </section>
  )
}

Mode.displayName = "ThemePicker.Mode"

export type PresetsProps = {
  mode: "light" | "dark"
  className?: string
}

export function Presets({ mode, className }: PresetsProps): ReactNode {
  const { appearance, setPreset } = useTheme()
  const id = useId()
  const list: readonly (LightPreset | DarkPreset)[] =
    mode === "light" ? lightPresets : darkPresets
  const selected = mode === "light" ? appearance.light : appearance.dark
  return (
    <section className={`mt-7 ${className ?? ""}`}>
      <Label id={id} detail={presets[selected].name}>
        {mode === "light" ? "Light" : "Dark"}
      </Label>
      <RadioGroup.Root
        aria-labelledby={id}
        value={selected}
        onValueChange={(value) => {
          if (mode === "light" && isLightPreset(value)) setPreset(value)
          if (mode === "dark" && isDarkPreset(value)) setPreset(value)
        }}
        loop
        className="grid grid-cols-2 gap-x-4 gap-y-5"
      >
        {list.map((preset) => (
          <Swatch key={preset} preset={preset} />
        ))}
      </RadioGroup.Root>
    </section>
  )
}

Presets.displayName = "ThemePicker.Presets"

type Shape = {
  left: string
  top: string
  width: string
  height: string
  radius: string
  className: string
}

// A shape-only Overview, drawn with the preset's own tokens.
const shapes: Shape[] = [
  {
    left: "6%",
    top: "12%",
    width: "17%",
    height: "8%",
    radius: "99px",
    className: "bg-soft",
  },
  {
    left: "9%",
    top: "28%",
    width: "11%",
    height: "3.5%",
    radius: "2px",
    className: "bg-mut",
  },
  {
    left: "9%",
    top: "37%",
    width: "11%",
    height: "3.5%",
    radius: "2px",
    className: "bg-mut",
  },
  {
    left: "9%",
    top: "46%",
    width: "11%",
    height: "3.5%",
    radius: "2px",
    className: "bg-mut",
  },
  {
    left: "30%",
    top: "12%",
    width: "9%",
    height: "3.5%",
    radius: "2px",
    className: "bg-sec",
  },
  {
    left: "30%",
    top: "20%",
    width: "24%",
    height: "9%",
    radius: "2px",
    className: "bg-ink",
  },
  {
    left: "30%",
    top: "35%",
    width: "12%",
    height: "8%",
    radius: "99px",
    className: "bg-acc",
  },
  {
    left: "44%",
    top: "35%",
    width: "15%",
    height: "8%",
    radius: "99px",
    className: "bg-acc-soft",
  },
  {
    left: "30%",
    top: "53%",
    width: "30%",
    height: "38%",
    radius: "8px",
    className: "bg-soft shadow-[inset_0_0_0_1px_var(--edge)]",
  },
  {
    left: "63%",
    top: "53%",
    width: "30%",
    height: "38%",
    radius: "8px",
    className: "bg-soft shadow-[inset_0_0_0_1px_var(--edge)]",
  },
  {
    left: "30%",
    top: "53%",
    width: "30%",
    height: "11%",
    radius: "8px 8px 0 0",
    className: "bg-acc",
  },
  {
    left: "63%",
    top: "53%",
    width: "30%",
    height: "11%",
    radius: "8px 8px 0 0",
    className: "bg-mezo",
  },
]

function Swatch({ preset }: { preset: LightPreset | DarkPreset }): ReactNode {
  const info = presets[preset]
  return (
    <RadioGroup.Item
      value={preset}
      className="group cursor-pointer text-left outline-none"
    >
      <span className="relative block rounded-[14px] group-hover:shadow-[0_0_0_2px_var(--sheet),0_0_0_4px_var(--ring)] group-focus-visible:outline-2 group-focus-visible:outline-offset-[6px] group-focus-visible:outline-ink group-data-[state=checked]:shadow-[0_0_0_2px_var(--sheet),0_0_0_4px_var(--acc)]">
        <span
          data-theme={preset}
          aria-hidden="true"
          className="relative block aspect-[200/124] overflow-hidden rounded-[14px] bg-bg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ink)_10%,transparent)]"
        >
          {shapes.map((shape) => (
            <i
              key={`${shape.left}${shape.top}${shape.className}`}
              className={`absolute block ${shape.className}`}
              style={
                {
                  left: shape.left,
                  top: shape.top,
                  width: shape.width,
                  height: shape.height,
                  borderRadius: shape.radius,
                } satisfies CSSProperties
              }
            />
          ))}
        </span>
        <RadioGroup.Indicator className="absolute top-2 right-2 grid size-[22px] place-items-center rounded-full bg-acc text-on-acc">
          <Icon name="check" size={14} strokeWidth={2.6} />
        </RadioGroup.Indicator>
      </span>
      <span className="mt-2.5 flex items-baseline justify-between text-[15px] font-semibold text-ink">
        {info.name}
        {info.note === null ? null : (
          <span className="text-[13.5px] font-normal text-sec">
            {info.note}
          </span>
        )}
      </span>
    </RadioGroup.Item>
  )
}

export function Haptics({ className }: { className?: string }): ReactNode {
  const [enabled, setEnabled] = useHapticsSetting()
  const id = useId()
  return (
    <div
      className={`mt-7 flex h-11 items-center justify-between text-base font-semibold text-ink ${className ?? ""}`}
    >
      <label htmlFor={id}>Haptics</label>
      <Switch.Root id={id} checked={enabled} onCheckedChange={setEnabled} />
    </div>
  )
}

Haptics.displayName = "ThemePicker.Haptics"

const syncCopy: Record<SyncState, { label: string; icon: IconName }> = {
  synced: { label: "Synced with Matchbox ID", icon: "cloud-check" },
  saving: { label: "Saving", icon: "cloud-download" },
  device: { label: "Saved on this device", icon: "smartphone" },
}

/** Icon only, beside the sheet title. Words live in the tooltip. */
export function SyncIcon(): ReactNode {
  const { sync } = useTheme()
  const copy = syncCopy[sync]
  return (
    <Tooltip.Simple label={copy.label} side="bottom">
      <button
        type="button"
        aria-label={copy.label}
        className="grid size-8 flex-none place-items-center rounded-full text-sec outline-none hover:bg-soft focus-visible:bg-soft focus-visible:outline-2 focus-visible:outline-ink"
      >
        <Icon name={copy.icon} size={20} strokeWidth={1.8} />
      </button>
    </Tooltip.Simple>
  )
}

SyncIcon.displayName = "ThemePicker.SyncIcon"

/** Icon-only Light, Dark, System switch for every account menu. */
export function QuickSwitch({ className }: { className?: string }): ReactNode {
  const { appearance, setScheme } = useTheme()
  return (
    <RadioGroup.Root
      aria-label="Theme"
      orientation="horizontal"
      loop
      value={appearance.mode}
      onValueChange={(value) => {
        if (isColorScheme(value)) setScheme(value)
      }}
      className={`flex gap-0.5 rounded-[18px] bg-soft p-[3px] ${className ?? ""}`}
    >
      {schemes.map((scheme) => (
        <Tooltip.Simple key={scheme.value} label={scheme.label} side="top">
          <RadioGroup.Item
            value={scheme.value}
            aria-label={scheme.label}
            className="grid h-[30px] w-9 place-items-center rounded-[15px] text-ink2 outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink data-[state=checked]:bg-raised data-[state=checked]:text-ink data-[state=checked]:shadow-lift"
          >
            <Icon name={scheme.icon} size={17} strokeWidth={1.8} />
          </RadioGroup.Item>
        </Tooltip.Simple>
      ))}
    </RadioGroup.Root>
  )
}

QuickSwitch.displayName = "ThemePicker.QuickSwitch"
