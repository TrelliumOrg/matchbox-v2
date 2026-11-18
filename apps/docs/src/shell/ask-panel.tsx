import {
  type DocsAskNote,
  docsAskLimits,
  docsAskPath,
  docsAskResponseSchema,
} from "@matchbox/docs/ask"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as Sheet from "@matchbox/ui/sheet"
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react"
import { DogDisc } from "./dog"

/**
 * "Ask about this page" (docs plan, Stuart): Stuart's reviewed notes, with
 * the notes written on this page first. It is a keyword search on Stuart's
 * public docs endpoint, so it never reads a wallet or prepares anything.
 * When Stuart cannot answer, the question goes to docs search instead.
 * Loaded on intent.
 */

const proUrl = "https://pro.matchbox.markets"
const timeoutMs = 8_000

type State =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "answered"; question: string; notes: readonly DocsAskNote[] }

async function askStuart(
  endpoint: string,
  question: string,
  page: string | null,
): Promise<readonly DocsAskNote[] | null> {
  try {
    const response = await fetch(`${endpoint}${docsAskPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, page }),
      credentials: "omit",
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    const parsed = docsAskResponseSchema.safeParse(await response.json())
    return parsed.success ? parsed.data.notes : null
  } catch {
    return null
  }
}

function Note({ note }: { note: DocsAskNote }): ReactNode {
  return (
    <li className="rounded-3xl bg-soft px-5 py-4">
      <p className="flex items-baseline gap-2.5">
        <span className="text-[17px] font-semibold text-ink">{note.title}</span>
        {note.onPage ? (
          <span className="text-[13px] font-semibold text-sec">This page</span>
        ) : null}
      </p>
      <p className="mt-1.5 text-[15.5px] leading-[1.55] text-ink2">
        {note.answer}
      </p>
      {note.detail.length === 0 ? null : (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[14.5px] text-sec">
          {note.detail.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {note.sources.map((source) => (
          <li key={source.url}>
            <a
              href={source.url}
              className="inline-flex min-h-6 items-center gap-1 text-[14px] font-semibold text-acc-ink underline-offset-[3px] outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
            >
              {source.label}
            </a>
          </li>
        ))}
      </ul>
    </li>
  )
}

export default function AskPanel({
  open,
  endpoint,
  page,
  onClose,
  onFallback,
}: {
  open: boolean
  endpoint: string
  page: string | null
  onClose: () => void
  onFallback: (question: string) => void
}): ReactNode {
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [question, setQuestion] = useState("")
  const [state, setState] = useState<State>({ kind: "idle" })

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const text = question.trim()
    if (text === "" || state.kind === "asking") return
    setState({ kind: "asking" })
    const notes = await askStuart(endpoint, text, page)
    if (notes === null) {
      setState({ kind: "idle" })
      onFallback(text)
      return
    }
    setState({ kind: "answered", question: text, notes })
  }

  return (
    <Sheet.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Sheet.Content
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          input.current?.focus()
        }}
      >
        <Sheet.Header accessory={<DogDisc size={30} className="order-first" />}>
          Ask about this page
        </Sheet.Header>
        <Sheet.Body>
          <form onSubmit={(event) => void onSubmit(event)}>
            <label
              htmlFor={inputId}
              className="text-[15px] font-semibold text-ink"
            >
              Your question
            </label>
            <div className="mt-2 flex gap-2">
              <input
                ref={input}
                id={inputId}
                type="text"
                value={question}
                maxLength={docsAskLimits.question}
                autoComplete="off"
                enterKeyHint="send"
                onChange={(event) => setQuestion(event.target.value)}
                className="h-12 min-w-0 flex-1 rounded-3xl bg-soft px-4 text-base text-ink outline-none placeholder:text-sec focus-visible:outline-2 focus-visible:outline-ink"
              />
              <button
                type="submit"
                aria-label="Ask"
                disabled={state.kind === "asking"}
                className="grid size-12 flex-none cursor-pointer place-items-center rounded-full bg-ink text-bg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-wait disabled:opacity-60"
              >
                <Glyph shape={shapes.arrowUp} size={20} strokeWidth={2} />
              </button>
            </div>
          </form>
          <div aria-live="polite" className="mt-6">
            {state.kind === "asking" ? (
              <p className="text-[15px] text-sec">Checking the notes</p>
            ) : null}
            {state.kind === "answered" && state.notes.length > 0 ? (
              <ul className="space-y-3">
                {state.notes.map((note) => (
                  <Note key={note.id} note={note} />
                ))}
              </ul>
            ) : null}
            {state.kind === "answered" && state.notes.length === 0 ? (
              <div className="rounded-3xl bg-soft px-5 py-4">
                <p className="text-[15.5px] text-ink2">
                  No reviewed note answers that.
                </p>
                <button
                  type="button"
                  onClick={() => onFallback(state.question)}
                  className="mt-2 cursor-pointer text-[15px] font-semibold text-acc-ink underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
                >
                  Search the docs instead
                </button>
              </div>
            ) : null}
          </div>
        </Sheet.Body>
        <Sheet.Footer className="items-start">
          <p className="text-[14.5px] text-sec">
            These are Stuart's reviewed notes. In Pro, Stuart can also read your
            locks and prepare votes for your wallet to sign.
          </p>
          <a
            href={proUrl}
            className="inline-flex h-11 items-center gap-1.5 rounded-3xl bg-soft px-4 text-[15px] font-semibold text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
          >
            Ask Stuart in Pro
            <Glyph shape={shapes.arrowUpRight} size={16} strokeWidth={2} />
          </a>
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet.Root>
  )
}
