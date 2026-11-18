import { type ReactNode, useId, useState } from "react"
import { CopyStatus, useCopy } from "../copy"
import { Glyph, shapes } from "../icons"
import * as SegmentedControl from "../segmented-control"
import * as UntrustedText from "../untrusted-text"

/**
 * Raw data viewer for a transaction's input and its logs: "Decoded" shows
 * the call or event with each parameter's name, type and value, "Raw" the
 * hex as the chain has it (a log's topics, then its data), with a copy
 * button. Without a decoding, Raw is the only view and no toggle shows.
 *
 * Inputs can be megabytes: each value shows its first 8 KB with "Show all",
 * and Copy always takes the whole value. Decoded names, types and values
 * come from the chain, so they render as untrusted text (bidi isolated,
 * hidden characters escaped).
 */

/** Characters of one value shown before "Show all". */
export const previewChars = 8192

export type DecodedParam = { name: string; type: string; value: string }

export type Decoded = {
  /** "repay(uint256 amount)" for input, "Transfer" for a log. */
  name: string
  params: readonly DecodedParam[]
}

export type RawData =
  | { kind: "input"; data: string }
  | { kind: "log"; topics: readonly string[]; data: string }

export type View = "decoded" | "raw"

export type RootProps = {
  /** "Input", "Log 3". */
  title: string
  decoded: Decoded | null
  raw: RawData
  defaultView?: View
  /** Extra header content, for a log the emitting contract's chip. */
  accessory?: ReactNode
  className?: string
}

function rawText(raw: RawData): string {
  if (raw.kind === "input") return raw.data
  return [...raw.topics, raw.data].join("\n")
}

const copyLabel = { idle: "Copy", copied: "Copied", failed: "Copy failed" }

function CopyRaw({ value }: { value: string }): ReactNode {
  const { state, copy } = useCopy(value)
  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-2xl px-3 text-[14px] font-semibold text-ink2 outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
      >
        <Glyph
          shape={
            state === "copied"
              ? shapes.check
              : state === "failed"
                ? shapes.x
                : shapes.copy
          }
          size={14}
          strokeWidth={2}
          className={
            state === "copied"
              ? "text-pos"
              : state === "failed"
                ? "text-neg"
                : undefined
          }
        />
        {copyLabel[state]}
      </button>
      <CopyStatus state={state} />
    </>
  )
}

/** A value that may be huge: its start, and the rest on request. */
function LongValue({
  text,
  untrusted,
}: {
  text: string
  untrusted: boolean
}): ReactNode {
  const [all, setAll] = useState(false)
  const long = text.length > previewChars
  const limit = all || !long ? text.length : previewChars
  return (
    <>
      {untrusted ? (
        <UntrustedText.Root value={text} limit={limit} />
      ) : (
        <>
          {text.slice(0, limit)}
          {limit < text.length ? "…" : null}
        </>
      )}
      {long ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((current) => !current)}
          className="ml-2 cursor-pointer rounded-md font-sans text-[14px] font-semibold text-ink underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          {all
            ? "Show less"
            : `Show all ${Math.ceil(text.length / 1024).toLocaleString("en-US")} KB`}
        </button>
      ) : null}
    </>
  )
}

function DecodedView({ decoded }: { decoded: Decoded }): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[14.5px] [overflow-wrap:anywhere] text-ink">
        <LongValue text={decoded.name} untrusted />
      </p>
      {decoded.params.length === 0 ? null : (
        <table className="w-full border-collapse text-left text-[14.5px]">
          <thead className="sr-only">
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {decoded.params.map((param, index) => (
              <tr
                // Parameters can repeat a name; their order is their identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: order is the key
                key={index}
                className="border-t border-line align-top max-md:flex max-md:flex-col max-md:gap-0.5 max-md:py-2.5"
              >
                <th
                  scope="row"
                  className="w-40 py-2.5 pr-4 font-medium text-ink max-md:w-auto max-md:py-0"
                >
                  <UntrustedText.Root value={param.name} />
                </th>
                <td className="w-28 py-2.5 pr-4 font-mono text-sec max-md:w-auto max-md:py-0">
                  <UntrustedText.Root value={param.type} />
                </td>
                <td className="py-2.5 font-mono break-all text-ink max-md:py-0">
                  <LongValue text={param.value} untrusted />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function RawView({ raw }: { raw: RawData }): ReactNode {
  if (raw.kind === "input") {
    return (
      <pre className="font-mono text-[14px] leading-6 break-all whitespace-pre-wrap text-ink2">
        <LongValue text={raw.data} untrusted={false} />
      </pre>
    )
  }
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[14px]">
      {raw.topics.map((topic, index) => (
        <div key={topic + String(index)} className="contents">
          <dt className="text-sec">Topic {index}</dt>
          <dd className="font-mono break-all text-ink2">
            <LongValue text={topic} untrusted={false} />
          </dd>
        </div>
      ))}
      <dt className="text-sec">Data</dt>
      <dd className="font-mono break-all text-ink2">
        <LongValue text={raw.data} untrusted={false} />
      </dd>
    </dl>
  )
}

export function Root({
  title,
  decoded,
  raw,
  defaultView = "decoded",
  accessory,
  className,
}: RootProps): ReactNode {
  const [chosen, setChosen] = useState<View>(defaultView)
  const view: View = decoded === null ? "raw" : chosen
  const headingId = useId()
  const panelId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-[24px] bg-soft p-6 max-md:p-5 ${className ?? ""}`}
    >
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h3 id={headingId} className="text-[16px] font-semibold">
          {title}
        </h3>
        {accessory}
        <span className="flex-1" />
        {decoded === null ? null : (
          <SegmentedControl.Root
            size="sm"
            surface="card"
            aria-label={`${title} view`}
            aria-controls={panelId}
            value={view}
            onValueChange={(next) =>
              setChosen(next === "raw" ? "raw" : "decoded")
            }
            className="h-10 rounded-[20px]"
          >
            <SegmentedControl.Item value="decoded">
              Decoded
            </SegmentedControl.Item>
            <SegmentedControl.Item value="raw">Raw</SegmentedControl.Item>
          </SegmentedControl.Root>
        )}
        {view === "raw" ? <CopyRaw value={rawText(raw)} /> : null}
      </header>
      <div id={panelId}>
        {view === "decoded" && decoded !== null ? (
          <DecodedView decoded={decoded} />
        ) : (
          <RawView raw={raw} />
        )}
      </div>
    </section>
  )
}

Root.displayName = "RawViewer.Root"
