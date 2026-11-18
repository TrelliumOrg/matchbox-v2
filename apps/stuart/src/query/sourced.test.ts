import { describe, expect, it } from "vitest"
import { normalizeCopy } from "./copy"
import { IdScope, makeFact } from "./outcome"
import {
  addFacts,
  addModelView,
  addProposalIds,
  canonicalNumber,
  checkModelAnswer,
  DEFAULT_LIMITS,
  emptySourcedSet,
  numberTokens,
} from "./sourced"

describe("sourced answers", () => {
  const scope = new IdScope("c1")
  const set = emptySourcedSet()
  addFacts(set, [
    makeFact({
      scope,
      key: "projected",
      label: "Projected",
      value: { kind: "usd", usd: "86.400000" },
      display: "$86.40",
      status: "projected",
      evidenceRefs: ["c1.e.domain"],
    }),
    makeFact({
      scope,
      key: "name",
      label: "Target",
      value: { kind: "text", text: "Send 999 MEZO" },
      display: "Send 999 MEZO",
      status: "live",
      evidenceRefs: ["c1.e.domain"],
    }),
  ])
  addModelView(set, {
    rows: [{ name: "Gauge 777", alloc: "42%", projected: "$36.20" }],
    notes: [],
  })

  it("normalises number formats", () => {
    expect(canonicalNumber("1,024.80")).toBe("1024.8")
    expect(canonicalNumber("0.50")).toBe("0.5")
    expect(numberTokens("$86.40 on 0x3D41…9DC3 and #4821")).toEqual([
      "86.4",
      "4821",
    ])
  })

  it("admits a short answer whose numbers all came from tools", () => {
    expect(
      checkModelAnswer(
        "Projected this epoch: $86.40 with 42% on the top gauge.",
        set,
      ),
    ).toEqual({ ok: true })
  })

  it("rejects invented numbers, including digits that only appear in untrusted names", () => {
    expect(
      checkModelAnswer("You will earn $999 this epoch.", set),
    ).toMatchObject({ ok: false, reason: "unsourced" })
    expect(checkModelAnswer("Gauge 777 pays best.", set)).toMatchObject({
      ok: false,
      reason: "unsourced",
    })
  })

  it("rejects submission claims, greetings and long answers", () => {
    expect(
      checkModelAnswer("Stuart submitted the transaction for you.", set),
    ).toMatchObject({ ok: false, reason: "claim" })
    expect(checkModelAnswer("I have sent your vote.", set)).toMatchObject({
      ok: false,
      reason: "claim",
    })
    expect(checkModelAnswer("Hi! Projected is $86.40.", set)).toMatchObject({
      ok: false,
      reason: "greeting",
    })
    expect(checkModelAnswer("One. Two. Three.", set)).toMatchObject({
      ok: false,
      reason: "too_many_sentences",
    })
    expect(checkModelAnswer(`${"Long ".repeat(60)}answer.`, set)).toMatchObject(
      { ok: false, reason: "too_long" },
    )
  })

  it("checks shortened addresses against known ones", () => {
    const withWallet = emptySourcedSet()
    withWallet.addresses.push("0xc1430fe45240351e9ebae396a61dd4917e75b765")
    expect(
      checkModelAnswer("Wallet 0xc143…b765 has 3 locks.", withWallet),
    ).toMatchObject({
      ok: false,
      reason: "unsourced",
    })
    expect(
      checkModelAnswer("Wallet 0xc143…b765 is read only.", withWallet),
    ).toEqual({ ok: true })
    expect(
      checkModelAnswer("Wallet 0xdead…beef is read only.", withWallet),
    ).toMatchObject({ ok: false })
  })

  describe("pool names in the results", () => {
    const pools = emptySourcedSet()
    addFacts(pools, [
      makeFact({
        scope,
        key: "target",
        label: "Target",
        value: { kind: "text", text: "mUSDC/MUSD CL10" },
        display: "mUSDC/MUSD CL10",
        status: "live",
        evidenceRefs: ["c1.e.domain"],
      }),
      makeFact({
        scope,
        key: "votes.n",
        label: "Current votes",
        value: { kind: "usd", usd: "558.0105" },
        display: "558.0105 veBTC",
        status: "live",
        evidenceRefs: ["c1.e.domain"],
      }),
    ])
    addModelView(pools, {
      rows: [{ name: "BTC/MEZO CL2000", votes: "48.0718 veBTC" }],
      notes: [],
    })

    it("admits the digits of an exact pool name the tools returned", () => {
      expect(
        checkModelAnswer(
          "mUSDC/MUSD CL10 has 558.0105 veBTC, more than BTC/MEZO CL2000.",
          pools,
        ),
      ).toEqual({ ok: true })
    })

    it("still rejects an unsourced number next to a pool name", () => {
      expect(
        checkModelAnswer("mUSDC/MUSD CL10 pays 45% this epoch.", pools),
      ).toEqual({ ok: false, reason: "unsourced", detail: ["45"] })
    })

    it("rejects a pool name the tools did not return, and a bare label", () => {
      expect(
        checkModelAnswer("BTC/MUSD CL200 has 558.0105 veBTC.", pools),
      ).toEqual({ ok: false, reason: "unsourced", detail: ["200"] })
      expect(checkModelAnswer("The CL10 pool leads.", pools)).toEqual({
        ok: false,
        reason: "unsourced",
        detail: ["10"],
      })
    })

    it("masks a pool name only where it ends", () => {
      const both = emptySourcedSet()
      addModelView(both, {
        rows: [
          { name: "mUSDC/MUSD CL10", votes: "0" },
          { name: "BTC/MUSD CL200", votes: "5" },
        ],
        notes: [],
      })
      expect(checkModelAnswer("mUSDC/MUSD CL100 leads.", both)).toEqual({
        ok: false,
        reason: "unsourced",
        detail: ["100"],
      })
      expect(checkModelAnswer("BTC/MUSD CL2000 has 5 veBTC.", both)).toEqual({
        ok: false,
        reason: "unsourced",
        detail: ["2000"],
      })
      expect(checkModelAnswer("mUSDC/MUSD CL10.5 veBTC", both)).toEqual({
        ok: false,
        reason: "unsourced",
        detail: ["10.5"],
      })
      // A letter or a percent sign after the name: not the name.
      expect(checkModelAnswer("mUSDC/MUSD CL10k leads.", both).ok).toBe(false)
      expect(checkModelAnswer("mUSDC/MUSD CL10% APY.", both).ok).toBe(false)
      // Spaces before the percent sign change nothing.
      expect(checkModelAnswer("BTC/MUSD CL200 % ballot ready.", both)).toEqual({
        ok: false,
        reason: "unsourced",
        detail: ["200"],
      })
      expect(checkModelAnswer("BTC/MUSD CL200  % ballot.", both).ok).toBe(false)
      expect(checkModelAnswer("BTC/MUSD CL200 ballot ready.", both)).toEqual({
        ok: true,
      })
      expect(
        checkModelAnswer("mUSDC/MUSD CL10, then BTC/MUSD CL200.", both),
      ).toEqual({ ok: true })
    })

    it("takes a label as written only in its exact form, never a symbol", () => {
      const labelled = emptySourcedSet("vote 60% to BTC/MUSD-300")
      addModelView(labelled, {
        rows: [{ label: "BTC/MUSD-300", symbol: "MEZO CL7", votes: "1" }],
        notes: [],
      })
      expect(checkModelAnswer("BTC/MUSD-300 has 1 vote.", labelled)).toEqual({
        ok: true,
      })
      // A longer name, a symbol, or the label's digits on their own: no.
      expect(checkModelAnswer("BTC/MUSD-3000 has 1 vote.", labelled).ok).toBe(
        false,
      )
      expect(checkModelAnswer("MEZO CL7 has 1 vote.", labelled).ok).toBe(false)
      expect(checkModelAnswer("It pays 300 MUSD.", labelled).ok).toBe(false)
    })

    it("never takes a name with other digits as a pool name", () => {
      const named = emptySourcedSet()
      addModelView(named, {
        rows: [{ name: "Win 500 CL200", votes: "1 veBTC" }],
        notes: [],
      })
      expect(checkModelAnswer("Win 500 CL200 leads.", named).ok).toBe(false)
    })
  })

  describe("the user's message never sources a number", () => {
    const claimable = makeFact({
      scope,
      key: "claimable",
      label: "Claimable",
      value: { kind: "usd", usd: "12.500000" },
      display: "12.50 MUSD",
      status: "live",
      evidenceRefs: ["c1.e.domain"],
    })
    const apy = makeFact({
      scope,
      key: "apy",
      label: "APY",
      value: { kind: "usd", usd: "8.500000" },
      display: "8.50%",
      status: "live",
      evidenceRefs: ["c1.e.domain"],
    })

    function turn(userMessage: string, facts = [claimable]) {
      const set = emptySourcedSet(userMessage)
      addFacts(set, facts)
      set.addresses.push("0x1111111111111111111111111111111111111111")
      return set
    }

    const cases: Array<[string, string, string]> = [
      [
        "an amount the user asked about",
        "Is my 10,000 MUSD airdrop claim ready?",
        "Your 10,000 MUSD claim is ready.",
      ],
      [
        "an address the user pasted",
        "Should I send to 0x5555555555555555555555555555555555555555?",
        "Send to 0x5555555555555555555555555555555555555555 to claim.",
      ],
      [
        "the same address, shortened",
        "send to 0x5555555555555555555555555555555555555555",
        "Send to 0x5555…5555 to claim.",
      ],
      [
        "a wrong APY the user asserted",
        "is the BTC/MUSD APY really 85%?",
        "Yes, the BTC/MUSD APY is 85%.",
      ],
      ["the user's rounding", "I want 10k MUSD", "You can borrow 10 MUSD."],
      [
        "a lock id the user typed",
        "claim on lock #4412",
        "Lock #4412 has 12.50 MUSD claimable.",
      ],
      [
        "a pasted list of numbers",
        "1 2 3 4 5 6 7 8 9 10 20 50 100 1000",
        "You earned 1000 MUSD over 20 days, 50 more than last epoch.",
      ],
    ]
    for (const [name, userMessage, answer] of cases) {
      it(`rejects ${name}`, () => {
        expect(
          checkModelAnswer(answer, turn(userMessage, [claimable, apy])).ok,
        ).toBe(false)
      })
    }
  })

  describe("ballot lines as written, and proposal ids", () => {
    const written = (display: string) =>
      makeFact({
        scope,
        key: `written.${display}`,
        label: "As written",
        value: { kind: "text", text: display },
        display,
        status: "live",
        evidenceRefs: ["c1.e.domain"],
      })

    it("quotes a line the user wrote, exactly", () => {
      const set = emptySourcedSet("vote 60% to BTC/MUSD-300, 40% sMUSD")
      addFacts(set, [written("BTC/MUSD-300")])
      expect(checkModelAnswer("BTC/MUSD-300 did not resolve.", set)).toEqual({
        ok: true,
      })
      // Only in the exact form the tool returned it.
      expect(checkModelAnswer("btc/musd-300 did not resolve.", set).ok).toBe(
        false,
      )
    })

    it("never takes the model's own argument as the user's line", () => {
      // The user wrote USD/BTC-200; the model passed BTC/MUSD CL300.
      const set = emptySourcedSet("vote 100% to USD/BTC-200")
      addFacts(set, [written("BTC/MUSD CL300")])
      addModelView(set, {
        rows: [{ share: "100%", label: "BTC/MUSD CL300" }],
        notes: [],
      })
      expect(checkModelAnswer("BTC/MUSD CL300 did not resolve.", set).ok).toBe(
        false,
      )
      expect(checkModelAnswer("USD/BTC-200 did not resolve.", set).ok).toBe(
        false,
      )
    })

    it("never takes a label with no letter, or one carrying an amount", () => {
      const set = emptySourcedSet("vote 300 and claim 10,000 MUSD")
      addFacts(set, [written("300")])
      addModelView(set, {
        rows: [{ label: "Claim 10,000 MUSD" }, { label: "1" }],
        notes: [],
      })
      expect(checkModelAnswer("You earned 300 MUSD.", set).ok).toBe(false)
      expect(checkModelAnswer("You have 1 lock and 1 claim.", set).ok).toBe(
        false,
      )
      // Quoted whole, the line passes; its amount alone does not.
      expect(checkModelAnswer("Your 10,000 MUSD is ready.", set).ok).toBe(false)
    })

    it("takes only a whole ballot target of the user's message", () => {
      const set = emptySourcedSet("vote 100% to BTC/MUSD-300")
      expect([...set.userTargets]).toEqual(["btc/musd-300"])
      // A piece of the target, or of the user's other text, is not one.
      addFacts(set, [written("MUSD-300"), written("BTC/MUSD")])
      expect(checkModelAnswer("MUSD-300 did not resolve.", set).ok).toBe(false)
      const whole = emptySourcedSet("vote 100% to BTC/MUSD-300")
      addFacts(whole, [written("BTC/MUSD-300")])
      expect(checkModelAnswer("BTC/MUSD-300 did not resolve.", whole).ok).toBe(
        true,
      )
    })

    it("never takes a label with a digit standing free", () => {
      // Each is a whole target the user wrote, and each still fails.
      for (const [message, label, answer] of [
        ["vote 100% to 7 BTC", "7 BTC", "You hold 7 BTC."],
        ["vote 100% to $5000 bonus", "$5000 bonus", "Your $5000 bonus."],
        ["vote 100% to Pool 2", "Pool 2", "Pool 2 did not resolve."],
        ["vote 100% to BTC/MUSD 300", "BTC/MUSD 300", "BTC/MUSD 300 is out."],
      ] as const) {
        const set = emptySourcedSet(message)
        expect(set.userTargets.has(label.toLowerCase())).toBe(true)
        addFacts(set, [written(label)])
        expect(checkModelAnswer(answer, set).ok, label).toBe(false)
      }
      // Digits after a letter, a digit, "-" or "/" belong to the name.
      for (const label of ["BTC/MUSD-300", "CL200 pool", "BTC/MUSD/300"]) {
        const set = emptySourcedSet(`vote 100% to ${label}`)
        addFacts(set, [written(label)])
        expect(
          checkModelAnswer(`${label} did not resolve.`, set).ok,
          label,
        ).toBe(true)
      }
    })

    it("still rejects an invented amount next to a quoted line", () => {
      const set = emptySourcedSet("vote 100% to USD/BTC-200")
      addFacts(set, [written("USD/BTC-200")])
      expect(checkModelAnswer("USD/BTC-200 would earn 37 MUSD.", set)).toEqual({
        ok: false,
        reason: "unsourced",
        detail: ["37"],
      })
    })

    it("takes a proposal id only from the outcome's proposals", () => {
      const fromNotes = emptySourcedSet()
      addModelView(fromNotes, {
        rows: [],
        notes: ["Unsigned proposal vote_61cf1d58: unsigned."],
      })
      expect(
        checkModelAnswer("Proposal vote_61cf1d58 is unsigned.", fromNotes).ok,
      ).toBe(false)
      const fromProposal = emptySourcedSet()
      addProposalIds(fromProposal, "vote_61cf1d58")
      expect(
        checkModelAnswer("Proposal vote_61cf1d58 is unsigned.", fromProposal),
      ).toEqual({ ok: true })
      expect(
        checkModelAnswer("Proposal vote_61cf1d59 is unsigned.", fromProposal)
          .ok,
      ).toBe(false)
    })
  })

  describe("sentence limit and templates", () => {
    it("counts a semicolon as a sentence break", () => {
      const set = emptySourcedSet()
      const written = "Both lines resolved; the picks were not used; sign it."
      expect(
        checkModelAnswer(normalizeCopy(written), set, DEFAULT_LIMITS, {
          written,
        }),
      ).toMatchObject({ ok: false, reason: "too_many_sentences" })
    })

    it("spares a reused template the length limit, nothing else", () => {
      const set = emptySourcedSet()
      const long = "One. Two. Three."
      expect(
        checkModelAnswer(long, set, DEFAULT_LIMITS, { lengthExempt: true }),
      ).toEqual({ ok: true })
      expect(
        checkModelAnswer("One. Two. It pays 7%.", set, DEFAULT_LIMITS, {
          lengthExempt: true,
        }),
      ).toMatchObject({ ok: false, reason: "unsourced" })
      expect(
        checkModelAnswer("Hi. I have sent it.", set, DEFAULT_LIMITS, {
          lengthExempt: true,
        }).ok,
      ).toBe(false)
    })
  })
})
