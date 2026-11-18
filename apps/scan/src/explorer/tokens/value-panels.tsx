import { TokenIcon } from "@matchbox/token-icons"
import * as Inspect from "@matchbox/ui/inspect"
import type { ReactNode } from "react"
import type { TokensPage } from "../../data/token-pages"
import { Figure, Panel, PanelState } from "../voting/parts"
import { SeriesBody } from "../voting/series-panel"

/**
 * Tokens' two panels (`PnId7WLIDs`): value on Mezo now, split by token,
 * and the dollar tokens on Mezo over 90 days at today's prices.
 */

/** Five tones that stay apart in light and dark; the rest is "more". */
const tones = ["bg-acc", "bg-mezo", "bg-ink", "bg-pos", "bg-mut"]

function ValuePanel({ value }: { value: TokensPage["value"] }): ReactNode {
  Inspect.useInspect(value !== null)
  return (
    <Panel
      label="Value on Mezo"
      aside={<span className="text-[14px] font-semibold">Now</span>}
    >
      {value === null ? (
        <PanelState section={{ status: "unavailable" }} />
      ) : (
        <>
          <Figure value={value.figure} note="at the latest prices" />
          <p
            aria-hidden="true"
            className="mt-5 flex h-3 gap-0.5 overflow-hidden rounded-full"
            {...Inspect.root("items", "tip", false)}
          >
            {value.parts.map((part, index) =>
              part.bps <= 0 ? null : (
                <span
                  key={part.label}
                  className={tones[index % tones.length]}
                  style={{ flexGrow: part.bps, flexBasis: 0 }}
                  {...Inspect.point({
                    label: part.label,
                    value: `${part.value}, ${part.share}`,
                  })}
                />
              ),
            )}
          </p>
          <ul aria-label="Value by token" className="mt-4 flex flex-col">
            {value.parts.map((part, index) => (
              <li
                key={part.label}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 border-t border-line py-2.5 text-[15px] first:border-t-0"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`size-2.5 flex-none rounded-[2px] ${tones[index % tones.length]}`}
                  />
                  {part.ticker === null ? null : (
                    <TokenIcon ticker={part.ticker} size={20} />
                  )}
                  <span className="truncate font-semibold">{part.label}</span>
                  {part.amount === null ? null : (
                    <span className="truncate text-sec max-md:hidden">
                      {part.amount}
                    </span>
                  )}
                </span>
                <span className="font-semibold tabular-nums">{part.value}</span>
                <span className="w-14 text-right text-sec tabular-nums">
                  {part.share}
                </span>
              </li>
            ))}
          </ul>
          {value.uncounted.length === 0 ? null : (
            <p className="mt-2 text-[14px] text-sec">
              Not counted, no price: {value.uncounted.join(", ")}
            </p>
          )}
        </>
      )}
    </Panel>
  )
}

function StablecoinsPanel({
  stablecoins,
}: {
  stablecoins: TokensPage["stablecoins"]
}): ReactNode {
  return (
    <Panel
      label="Stablecoins on Mezo"
      aside={<span className="text-[14px] text-sec">At today's prices</span>}
    >
      {stablecoins === null ? (
        <PanelState section={{ status: "unavailable" }} />
      ) : stablecoins.data.status !== "ok" ? (
        <PanelState section={stablecoins.data} />
      ) : (
        <>
          <SeriesBody
            name="Stablecoins on Mezo"
            data={stablecoins.data.data}
            stats={stablecoins.stats}
            empty="No stablecoins yet"
          />
          {stablecoins.uncounted.length === 0 ? null : (
            <p className="mt-2 text-[14px] text-sec">
              Not counted, no price: {stablecoins.uncounted.join(", ")}
            </p>
          )}
        </>
      )}
    </Panel>
  )
}

export function ValuePanels({ page }: { page: TokensPage }): ReactNode {
  return (
    <div className="mt-6 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
      <ValuePanel value={page.value} />
      <StablecoinsPanel stablecoins={page.stablecoins} />
    </div>
  )
}
