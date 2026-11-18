import { describe, expect, it } from "vitest"
import {
  canSend,
  type FeedbackEvent,
  type FeedbackState,
  feedbackReducer,
  initialState,
  messageCounter,
  messageLabel,
  minutesLeft,
  type ReadyShot,
  sendLabel,
} from "./machine"

const now = 1_794_470_000_000

function run(...events: FeedbackEvent[]): FeedbackState {
  return events.reduce(feedbackReducer, initialState)
}

const typed: FeedbackEvent = {
  type: "set-message",
  message: "Claim all fails in OKX Wallet",
}

const shot: ReadyShot = {
  status: "ready",
  blob: new Blob(["png"], { type: "image/png" }),
  preview: "data:image/png;base64,AA==",
  masked: 1,
}

describe("the panel's state machine", () => {
  it("opens on Bug with nothing typed, and Send waits for 3 characters", () => {
    const opened = run({ type: "open", kind: null })
    expect(opened.draft.kind).toBe("bug")
    expect(canSend(opened, now)).toBe(false)
    const short = run({ type: "set-message", message: " ab " })
    expect(canSend(short, now)).toBe(false)
    expect(canSend(run(typed), now)).toBe(true)
  })

  it("keeps the type the user picked, unless Report a problem opens it", () => {
    const idea = run({ type: "set-kind", kind: "idea" })
    expect(feedbackReducer(idea, { type: "open", kind: null }).draft.kind).toBe(
      "idea",
    )
    expect(
      feedbackReducer(idea, { type: "open", kind: "bug" }).draft.kind,
    ).toBe("bug")
    expect(messageLabel("idea")).toBe("What would help?")
  })

  it("stops the message at 2,000 characters and counts from 1,500", () => {
    const long = run({ type: "set-message", message: "a".repeat(2_400) })
    expect(long.draft.message).toHaveLength(2_000)
    expect(messageCounter("a".repeat(1_499))).toBeNull()
    expect(messageCounter("a".repeat(1_503))).toBe("1,503 of 2,000")
  })

  it("locks the fields while sending and ignores edits", () => {
    const sending = run(typed, { type: "send", now })
    expect(sending.phase.name).toBe("sending")
    expect(sendLabel(sending, now)).toBe("Sending")
    const edited = feedbackReducer(sending, {
      type: "set-message",
      message: "changed",
    })
    expect(edited).toBe(sending)
    expect(feedbackReducer(sending, { type: "send", now })).toBe(sending)
  })

  it("does not send while a screenshot is being taken", () => {
    const capturing = run(typed, { type: "capture-started" })
    expect(canSend(capturing, now)).toBe(false)
    expect(feedbackReducer(capturing, { type: "send", now })).toBe(capturing)
  })

  it("shows the reference once sent, then starts over", () => {
    const sent = run(
      typed,
      { type: "send", now },
      {
        type: "send-finished",
        outcome: { result: "sent", reference: "FB-7K3Q2M" },
        now,
      },
    )
    expect(sent.phase).toEqual({ name: "sent", reference: "FB-7K3Q2M" })
    expect(sent.draft.message).toBe("")
    const reopened = feedbackReducer(sent, { type: "open", kind: null })
    expect(reopened).toEqual(initialState)
  })

  it("keeps the report, screenshot included, when sending fails", () => {
    const failed = run(
      typed,
      { type: "capture-started" },
      { type: "capture-finished", shot },
      { type: "send", now },
      { type: "send-finished", outcome: { result: "failed" }, now },
    )
    expect(failed.phase).toEqual({
      name: "editing",
      notice: { kind: "failed" },
    })
    expect(failed.draft.message).toBe("Claim all fails in OKX Wallet")
    expect(failed.draft.shot).toBe(shot)
    expect(sendLabel(failed, now)).toBe("Try again")
    expect(canSend(failed, now)).toBe(true)
  })

  it("waits out a rate limit, counting down in minutes", () => {
    const limited = run(
      typed,
      { type: "send", now },
      {
        type: "send-finished",
        outcome: { result: "rate-limited", retryAfterSeconds: 14 * 60 - 5 },
        now,
      },
    )
    expect(canSend(limited, now)).toBe(false)
    expect(sendLabel(limited, now)).toBe("Send report in 14 min")
    expect(sendLabel(limited, now + 10 * 60_000)).toBe("Send report in 4 min")
    const later = now + 14 * 60_000
    expect(canSend(limited, later)).toBe(true)
    expect(sendLabel(limited, later)).toBe("Send report")
    expect(feedbackReducer(limited, { type: "send", now }).phase.name).toBe(
      "editing",
    )
    expect(
      feedbackReducer(limited, { type: "send", now: later }).phase.name,
    ).toBe("sending")
    expect(minutesLeft(now + 61_000, now)).toBe(2)
  })

  it("asks for the check again when Turnstile fails", () => {
    const refused = run(
      typed,
      { type: "send", now },
      {
        type: "send-finished",
        outcome: { result: "check-failed" },
        now,
      },
    )
    expect(refused.phase).toEqual({
      name: "editing",
      notice: { kind: "check-failed" },
    })
    expect(canSend(refused, now)).toBe(true)
  })

  it("drops a capture that finishes after the user removed it", () => {
    const removed = run({ type: "capture-started" }, { type: "remove-shot" })
    expect(
      feedbackReducer(removed, { type: "capture-finished", shot }).draft.shot,
    ).toEqual({ status: "none" })
    expect(
      feedbackReducer(removed, { type: "capture-failed" }).draft.shot,
    ).toEqual({ status: "none" })
  })

  it("takes an attached image at any time", () => {
    const attached: ReadyShot = { ...shot, masked: null }
    const state = run(
      { type: "capture-started" },
      {
        type: "capture-finished",
        shot: attached,
      },
    )
    expect(state.draft.shot).toBe(attached)
  })

  it("only includes the wallet and page as the user chooses", () => {
    expect(initialState.draft.includeWallet).toBe(false)
    expect(initialState.draft.includePage).toBe(true)
    const state = run(
      { type: "set-include-wallet", value: true },
      { type: "remove-page" },
    )
    expect(state.draft.includeWallet).toBe(true)
    expect(state.draft.includePage).toBe(false)
  })
})
