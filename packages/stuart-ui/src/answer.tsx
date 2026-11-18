import { MorphText } from "@matchbox/motion"
import * as PillButton from "@matchbox/ui/pill-button"
import { type ReactNode, useId, useState } from "react"
import { Block } from "./blocks"
import type {
  ActivityTraceBlock,
  AllocationDiffBlock,
  BusyReason,
  Evidence,
  Fact,
  StuartResponse,
} from "./contract"
import { formatBlock } from "./format"
import { EntityLink, isAppPath, useHost } from "./host"
import { Glyph } from "./icons"
import { usePresence } from "./presence"
import { ProposalCard } from "./proposal-card"
import type { Turn } from "./thread"

/**
 * One question and its answer. The sentence is plain text: the facts it
 * cites are bolded by exact substring, never by markup from the server.
 */

type Segment = { text: string; strong: boolean; key: string }

export function segmentAnswer(text: string, facts: readonly Fact[]): Segment[] {
  const needles = [...new Set(facts.map((fact) => fact.display))]
    .filter((needle) => needle.length > 0)
    .sort((a, b) => b.length - a.length)
  const segments: Segment[] = []
  let rest = text
  let offset = 0
  while (rest.length > 0) {
    let at = -1
    let found = ""
    for (const needle of needles) {
      const index = rest.indexOf(needle)
      if (index !== -1 && (at === -1 || index < at)) {
        at = index
        found = needle
      }
    }
    if (at === -1) {
      segments.push({ text: rest, strong: false, key: `t${offset}` })
      break
    }
    if (at > 0) {
      segments.push({
        text: rest.slice(0, at),
        strong: false,
        key: `t${offset}`,
      })
    }
    segments.push({ text: found, strong: true, key: `f${offset + at}` })
    offset += at + found.length
    rest = rest.slice(at + found.length)
  }
  return segments
}

function citedFacts(response: StuartResponse): Fact[] {
  return response.facts.filter((fact) =>
    response.answer.factRefs.includes(fact.id),
  )
}

/**
 * Each source once (frame 41yLhKsfh5): evidence deduplicated by its label,
 * then the snapshot block when no source already names it.
 */
export function uniqueSources(
  evidence: readonly Evidence[],
  block: string | null,
): { key: string; text: string; url: string | null }[] {
  const seen = new Set<string>()
  const sources: { key: string; text: string; url: string | null }[] = []
  for (const item of evidence) {
    const text = item.label.trim()
    const key = text.toLowerCase()
    if (text === "" || seen.has(key)) continue
    seen.add(key)
    sources.push({ key, text, url: item.url ?? null })
  }
  if (block !== null) {
    const text = `block ${formatBlock(block)}`
    if (!seen.has(text.toLowerCase())) {
      sources.push({ key: "block", text, url: null })
    }
  }
  return sources
}

/** "Checked 1 lock and prices, block 13,103,045", or a count of the steps. */
export function summaryText(
  trace: ActivityTraceBlock | null,
  block: string | null,
): string {
  if (trace?.summary !== undefined && trace.summary.trim() !== "") {
    return trace.summary
  }
  const count = trace?.items.length ?? 0
  const steps =
    count === 0
      ? "Checked sources"
      : `Checked ${count} ${count === 1 ? "step" : "steps"}`
  return block === null ? steps : `${steps}, block ${formatBlock(block)}`
}

/**
 * One collapsed row once the answer is in: what was checked, at which
 * block. It opens to the steps in plain words and the sources, each once.
 */
export function TraceSummary({
  response,
}: {
  response: StuartResponse
}): ReactNode {
  const [open, setOpen] = useState(false)
  const body = usePresence(open, 160)
  const id = useId()
  const trace =
    response.uiBlocks.find(
      (block): block is ActivityTraceBlock => block.type === "activity_trace",
    ) ?? null
  const block = response.snapshot.blockNumber
  const sources = uniqueSources(response.evidence, block)
  const steps = trace?.items ?? []
  if (steps.length === 0 && response.evidence.length === 0) return null
  return (
    <div className="stuart-summary">
      <button
        type="button"
        className="stuart-summary-row"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <Glyph name="check" size={15} />
        <span>{summaryText(trace, block)}</span>
        <Glyph name={open ? "chevron-up" : "chevron-down"} size={16} />
      </button>
      {body.mounted ? (
        <div
          id={id}
          className="stuart-summary-body"
          data-state={body.state}
          data-mbx-motion=""
          inert={!open}
        >
          {steps.length === 0 ? null : (
            <ul className="stuart-summary-steps">
              {steps.map((step) => (
                <li key={step.id}>
                  <Glyph
                    name={step.status === "error" ? "alert" : "check"}
                    size={15}
                    className={
                      step.status === "error" ? "stuart-neg" : "stuart-pos"
                    }
                  />
                  <span>
                    <b>{step.label}</b>
                    {step.detail === null ? null : <span>{step.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {sources.length === 0 ? null : (
            <ul className="stuart-summary-sources" aria-label="Sources">
              {sources.map((source) => (
                <li key={source.key}>
                  {source.url === null ? (
                    source.text
                  ) : (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {source.text}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** The allocation_diff that belongs to a proposal is drawn inside its card. */
function diffFor(
  response: StuartResponse,
  proposalId: string,
): AllocationDiffBlock | null {
  for (const block of response.uiBlocks) {
    if (block.type === "allocation_diff" && block.proposalId === proposalId) {
      return block
    }
  }
  return null
}

const busyText: Record<BusyReason, string> = {
  spend_cap: "Busy, try again",
  model_busy: "Busy, try again",
  rate_limited: "Too many questions, try again",
}

const errorText: Record<string, string> = {
  rate_limited: "Too many questions, try again",
  busy: "Busy, try again",
  invalid_request: "Question not accepted",
  payload_too_large: "Question too long",
  forbidden_origin: "Not available here",
  network: "Offline",
}

export function failureText(code: string): string {
  return errorText[code] ?? "Request failed"
}

function Answer({ response }: { response: StuartResponse }): ReactNode {
  const host = useHost()
  const facts = citedFacts(response)
  const consumed = new Set(
    response.proposedActions.map((proposal) => proposal.proposalId),
  )
  const missingFacts = facts.filter(
    (fact) => !response.answer.text.includes(fact.display),
  )
  return (
    <>
      <p className="stuart-answer">
        {segmentAnswer(response.answer.text, facts).map((segment) =>
          segment.strong ? (
            <b key={segment.key}>{segment.text}</b>
          ) : (
            <span key={segment.key}>{segment.text}</span>
          ),
        )}
      </p>
      {missingFacts.length > 0 ? (
        <dl className="stuart-kv">
          {missingFacts.map((fact) => (
            <div key={fact.id}>
              <dt>{fact.label}</dt>
              <dd>{fact.display}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {response.why === null || response.why.items.length === 0 ? null : (
        <details className="stuart-why">
          <summary>Why</summary>
          <ul>
            {response.why.items.map((item) => (
              <li key={item.text}>{item.text}</li>
            ))}
          </ul>
        </details>
      )}
      {response.uiBlocks.map((block) =>
        block.type === "allocation_diff" &&
        consumed.has(block.proposalId) ? null : (
          <Block key={block.id} block={block} evidence={response.evidence} />
        ),
      )}
      {response.proposedActions.map((proposal) => (
        <ProposalCard
          key={proposal.proposalId}
          proposal={proposal}
          diff={diffFor(response, proposal.proposalId)}
        />
      ))}
      {response.service.notice === null ? null : (
        <p className="stuart-notice">{response.service.notice}</p>
      )}
      {response.followups.length === 0 ? null : (
        <ul className="stuart-rows" aria-label="Follow-up questions">
          {response.followups.map((followup) => {
            const action = followup.action
            if (action.kind === "navigate") {
              if (!isAppPath(action.to)) return null
              return (
                <li key={followup.id}>
                  <EntityLink to={action.to} className="stuart-row">
                    <span className="stuart-row-text">{followup.label}</span>
                    <Glyph name="arrow-right" size={16} />
                  </EntityLink>
                </li>
              )
            }
            return (
              <li key={followup.id}>
                <button
                  type="button"
                  className="stuart-row"
                  disabled={host.busy}
                  onClick={() =>
                    action.kind === "query"
                      ? host.ask(action.query)
                      : host.ask(followup.label, {
                          clarification: {
                            cardId: action.cardId,
                            optionId: action.optionId,
                          },
                        })
                  }
                >
                  <span className="stuart-row-text">{followup.label}</span>
                  <Glyph name="arrow-right" size={16} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export function TurnView({
  turn,
  onRetry,
}: {
  turn: Turn
  onRetry: (turnId: string) => void
}): ReactNode {
  const outcome = turn.outcome
  const lastStatus = turn.status.at(-1) ?? null
  return (
    <li className="stuart-turn">
      <p className="stuart-question">
        {turn.entity === null ? null : (
          <span className="stuart-sr">About {turn.entity.label}: </span>
        )}
        {turn.question}
      </p>
      {outcome.kind === "streaming" ? (
        <p className="stuart-status-line" aria-busy="true">
          <span className="stuart-spin" data-mbx-motion="" />
          <MorphText as="span">
            {lastStatus ?? "Reading the question"}
          </MorphText>
        </p>
      ) : null}
      {outcome.kind === "answered" ? (
        <>
          <TraceSummary response={outcome.response} />
          <Answer response={outcome.response} />
        </>
      ) : null}
      {outcome.kind === "busy" || outcome.kind === "failed" ? (
        <div className="stuart-failure">
          <p className="stuart-status-line">
            <Glyph name="alert" size={15} className="stuart-neg" />
            {outcome.kind === "busy"
              ? busyText[outcome.reason]
              : failureText(outcome.code)}
          </p>
          <PillButton.Root
            intent="secondary"
            size="sm"
            onClick={() => onRetry(turn.id)}
          >
            Try again
          </PillButton.Root>
        </div>
      ) : null}
      {outcome.kind === "stopped" ? (
        <p className="stuart-status-line">
          Stopped
          <button
            type="button"
            className="stuart-link"
            onClick={() => onRetry(turn.id)}
          >
            Ask again
          </button>
        </p>
      ) : null}
    </li>
  )
}

TurnView.displayName = "Stuart.Turn"
