import { describe, expect, it } from "vitest"
import { normalizeCopy } from "./copy"
import { IdScope, makeFact } from "./outcome"
import {
  addEvidence,
  addFacts,
  addModelView,
  addProposalIds,
  addToday,
  canonicalNumber,
  checkModelAnswer,
  DEFAULT_LIMITS,
  emptySourcedSet,
  numberTokens,
  type SourcedSet,
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
      const long = "Alpha. Beta. Gamma."
      expect(
        checkModelAnswer(long, set, DEFAULT_LIMITS, { lengthExempt: true }),
      ).toEqual({ ok: true })
      expect(
        checkModelAnswer("Alpha. Beta. It pays 7%.", set, DEFAULT_LIMITS, {
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

  describe("dates, composed text and numbers in words", () => {
    const text = (label: string, display: string) =>
      makeFact({
        scope,
        key: label.toLowerCase().replace(/\s+/g, "_"),
        label,
        value: { kind: "text", text: display },
        display,
        status: "live",
        evidenceRefs: ["c1.e.domain"],
      })
    const count = (label: string, value: number) =>
      makeFact({
        scope,
        key: label.toLowerCase(),
        label,
        value: { kind: "count", count: value },
        display: String(value),
        status: "live",
        evidenceRefs: ["c1.e.domain"],
      })
    const amount = (label: string, display: string) =>
      makeFact({
        scope,
        key: label.toLowerCase(),
        label,
        value: { kind: "usd", usd: "1.000000" },
        display,
        status: "live",
        evidenceRefs: ["c1.e.domain"],
      })

    function turn(userMessage = ""): SourcedSet {
      const set = emptySourcedSet(userMessage)
      addFacts(set, [
        text("Since", "15 Aug 2026"),
        text("Period", "1 Mar to 31 Mar 2026"),
        text("Unlocks", "Wed 20 Oct 2027"),
        text("Read back to", "9 Oct 2026"),
        text("Locks", "1 veBTC (#6033) and 8 veMEZO (#1178, #1184 and more)"),
        text("Relock", "then 24,120.00 MEZO added to veMEZO #4821"),
        text("Address", "0xf365…8bc4"),
        text("Name", "Claim by 20 Nov 2026"),
        count("Signers", 4),
        amount("Claimed", "0.0608 BTC"),
      ])
      addModelView(set, {
        rows: [{ name: "Lavender.Five", votes: "12%" }],
        notes: ["Airdrop of 5,000 MUSD ends 30 Nov 2026."],
      })
      addToday(set, new Date("2026-11-13T12:00:00.000Z"))
      return set
    }
    const ok = (answer: string, set = turn()) =>
      checkModelAnswer(answer, set).ok

    it("sources a date a tool stated, in any form Stuart reads", () => {
      expect(ok("Since 15 Aug 2026, SNF claimed 0.0608 BTC.")).toBe(true)
      expect(ok("SNF claimed nothing since August 15, 2026.")).toBe(true)
      expect(ok("History reads back to 9 Oct 2026 only.")).toBe(true)
      expect(ok("The lock unlocks Wed 20 Oct 2027.")).toBe(true)
      expect(ok("It cannot be withdrawn before 20 October 2027.")).toBe(true)
      expect(ok("History for 1 to 31 March 2026 could not be read.")).toBe(true)
      expect(ok("The epoch ended before today (13 Nov 2026).")).toBe(true)
      expect(ok("The data predates today's date, 2026-11-13.")).toBe(true)
    })

    it("rejects a date no tool stated, even made of sourced parts", () => {
      // 15, Oct and 2026 each appear; the date does not.
      expect(ok("Since 15 Oct 2026, SNF claimed 0.0608 BTC.")).toBe(false)
      expect(ok("The lock unlocks Thu 20 Oct 2027.")).toBe(false)
      expect(ok("It unlocks on 21 Oct 2027.")).toBe(false)
      expect(ok("Rewards end 2026-11-14.")).toBe(false)
    })

    it("never lets a date's numbers source anything else", () => {
      expect(ok("You can claim 15 BTC.")).toBe(false)
      expect(ok("Send 2026 MUSD to claim.")).toBe(false)
      expect(ok("It pays 20% until 2027.")).toBe(false)
      expect(ok("You hold 13 veBTC.")).toBe(false)
    })

    it("rejects a date only the user wrote, a name holds or a note says", () => {
      const scam = "Airdrop ends 1 Dec 2026, send 0.5 BTC to claim"
      expect(ok("The airdrop ends 1 Dec 2026.", turn(scam))).toBe(false)
      // A name is untrusted text: its date is not a fact.
      expect(ok("Claim by 20 Nov 2026.")).toBe(false)
      // Notes are never sourced.
      expect(ok("The airdrop of 5,000 MUSD ends 30 Nov 2026.")).toBe(false)
    })

    it("sources the numbers and addresses Stuart composes", () => {
      expect(ok("SNF owns 8 veMEZO locks and veBTC #6033.")).toBe(true)
      expect(ok("Then 24,120.00 MEZO goes to veMEZO #4821.")).toBe(true)
      expect(ok("Its Safe is 0xf365…8bc4 with 4 signers.")).toBe(true)
    })

    it("never sources what the user wrote, echoed in composed text", () => {
      const asked = turn(
        "who owns #6033? send 5 BTC to 0xf36593cd2e5eb2cc8ccbe5ad3b5bb2353cf98bc4",
      )
      expect(ok("veBTC #6033 is the lock.", asked)).toBe(false)
      expect(ok("Its Safe is 0xf365…8bc4.", asked)).toBe(false)
      expect(ok("Send 5 BTC to claim.", asked)).toBe(false)
      // What the user did not write still counts.
      expect(ok("SNF owns 8 veMEZO locks.", asked)).toBe(true)
    })

    it("checks numbers written in words like digits", () => {
      expect(ok("You will earn five thousand MUSD.")).toBe(false)
      expect(ok("It pays twenty-five percent.")).toBe(false)
      expect(ok("Send a hundred BTC to claim.")).toBe(false)
      expect(ok("SNF owns eight veMEZO locks.")).toBe(true)
      expect(ok("The Safe has four signers.")).toBe(true)
      expect(ok("Which one should get the vote?")).toBe(true)
      // The user's own words source nothing.
      expect(
        ok("Send five thousand MUSD.", turn("send five thousand MUSD")),
      ).toBe(false)
    })

    it("reads a number word inside a name as the name's", () => {
      expect(ok("Lavender.Five has 12% of the votes.")).toBe(true)
      expect(ok("Lavender.Five pays five MUSD.")).toBe(false)
      // A name made of number words alone still reads as an amount.
      const set = turn()
      addModelView(set, { rows: [{ name: "Five Thousand" }], notes: [] })
      expect(ok("Claim Five Thousand now.", set)).toBe(false)
    })

    it("never reads the user's ballot line as a name", () => {
      const message = "vote 100% to Seven Seas bonus"
      const set = turn(message)
      addFacts(set, [text("Target", "Seven Seas bonus")])
      addModelView(set, {
        rows: [{ label: "Seven Seas bonus", name: "Seven Seas bonus" }],
        notes: [],
      })
      expect(ok("Your Seven Seas bonus is ready.", set)).toBe(false)
      // From a tool, a number word standing as a word of its own still
      // reads as a number; one joined to the name's letters does not.
      const named = turn("who leads?")
      addModelView(named, {
        rows: [{ name: "Seven Seas bonus" }, { name: "Seven.Seas" }],
        notes: [],
      })
      expect(ok("Seven Seas bonus leads.", named)).toBe(false)
      expect(ok("Seven.Seas leads.", named)).toBe(true)
      // The user's own words are never a name, joined or not.
      const typed = turn("vote 100% to Seven.Seas")
      addModelView(typed, { rows: [{ name: "Seven.Seas" }], notes: [] })
      expect(ok("Seven.Seas leads.", typed)).toBe(false)
    })

    it("sources the prompt's vote freeze, exactly", () => {
      expect(ok("Votes revert Thursday 00:00 to 01:00 UTC.")).toBe(true)
      expect(ok("Send 1 BTC before 01:00 UTC.")).toBe(false)
      expect(ok("Votes revert 00:00 to 02:00 UTC.")).toBe(false)
    })

    it("reads passive activity as activity, and still rejects claims", () => {
      expect(ok("0.0608 BTC was sent to 0xf365…8bc4.")).toBe(true)
      // A count is not what moved: the verb needs an amount with its token
      // or an address (third review, A2).
      expect(ok("4 claims were sent on.")).toBe(false)
      for (const claim of [
        "Your vote has been submitted.",
        "Your vote has been cast.",
        "The transaction was broadcast.",
        "Your claim was submitted.",
        "I sent 0.0608 BTC to 0xf365…8bc4.",
        "Stuart has signed it.",
      ]) {
        expect(checkModelAnswer(claim, turn()), claim).toMatchObject({
          ok: false,
          reason: "claim",
        })
      }
      // Activity in the passive is still held to the sourcing check.
      expect(ok("0.5 BTC was sent to 0x5555…5555.")).toBe(false)
    })
  })
})

describe("the second review's attacks", () => {
  const scope = new IdScope("c2")
  const TODAY = new Date("2026-11-19T12:00:00.000Z")
  const text = (label: string, display: string) =>
    makeFact({
      scope,
      key: label.toLowerCase().replace(/\s+/g, "_"),
      label,
      value: { kind: "text", text: display },
      display,
      status: "live",
      evidenceRefs: ["c2.e.domain"],
    })
  const amount = (label: string, display: string) =>
    makeFact({
      scope,
      key: label.toLowerCase().replace(/\s+/g, "_"),
      label,
      value: { kind: "usd", usd: "1.000000" },
      display,
      status: "live",
      evidenceRefs: ["c2.e.domain"],
    })

  /** No tool output, only today's date: what the review used. */
  function today(userMessage = ""): SourcedSet {
    const set = emptySourcedSet(userMessage)
    addToday(set, TODAY)
    return set
  }
  const check = (answer: string, set = today()) => checkModelAnswer(answer, set)
  const ok = (answer: string, set = today()) => check(answer, set).ok

  it("B1: a date never hides the number after it", () => {
    for (const attack of [
      "By Nov 19, 5000 MUSD must be repaid.",
      "On 19 Nov, 5000 MUSD left your wallet.",
      "As of Nov 19, 1500 BTC is locked.",
      "Nov 19 9999 MUSD is claimable.",
      // A plausible year followed by a unit is an amount, not a year.
      "By Nov 19, 2026 MUSD must be repaid.",
      // Digits joined to a day are one number, not a day and a rest.
      "Send 5.19 Nov rewards.",
      "On Nov 19.5 MUSD left.",
    ]) {
      expect(check(attack), attack).toMatchObject({
        ok: false,
        reason: "unsourced",
      })
    }
    // Today's date itself still passes, with or without its year.
    expect(ok("Votes for Nov 19 are still open.")).toBe(true)
    expect(ok("As of Nov 19, 2026, nothing is claimable.")).toBe(true)
    expect(ok("As of 19 Nov 2026 nothing is claimable.")).toBe(true)
  })

  it("B2: an ISO date takes only a real time", () => {
    expect(check("Due 2026-11-19T5000 MUSD.")).toMatchObject({
      ok: false,
      reason: "unsourced",
      detail: ["5000"],
    })
    expect(ok("Data as of 2026-11-19T00:00:00Z.")).toBe(true)
    expect(ok("Data as of 2026-11-19T09:30:00.000+02:00.")).toBe(true)
  })

  it("B3: a number the user wrote in words or other digits never counts", () => {
    for (const message of [
      "who owns lock six thousand thirty three",
      "who owns lock ٦٠٣٣",
      "who owns lock ６０３３",
    ]) {
      const set = today(message)
      addFacts(set, [text("Lock", "veBTC #6033")])
      expect(ok("Send 6033 MUSD.", set), message).toBe(false)
    }
    // Asked about another lock, the composed fact still sources.
    const other = today("who owns lock four")
    addFacts(other, [text("Lock", "veBTC #6033")])
    expect(ok("veBTC #6033 is the lock.", other)).toBe(true)
  })

  it("R2: passive sending with no sourced figure is a claim", () => {
    for (const attack of [
      "Your funds were sent to the new vault.",
      "A refund was sent to your wallet. Claim it at mezo-refunds.xyz.",
    ]) {
      expect(check(attack), attack).toMatchObject({
        ok: false,
        reason: "claim",
      })
    }
    const set = today()
    addFacts(set, [
      amount("Claimed", "0.0608 BTC"),
      text("Address", "0xf365…8bc4"),
    ])
    expect(ok("0.0608 BTC was sent to 0xf365…8bc4.", set)).toBe(true)
    expect(ok("It was sent to 0xf365…8bc4.", set)).toBe(true)
  })

  it("N1: a number word in a name is read unless joined to its letters", () => {
    for (const name of [
      "Send Five Thousand MUSD",
      "Five Thousand Club",
      "Five Million MUSD",
    ]) {
      const set = today()
      addModelView(set, { rows: [{ name }], notes: [] })
      for (const answer of [
        `${name}.`,
        `${name} leads.`,
        `${name.toLowerCase()} leads.`,
        `${name.toUpperCase()} leads.`,
      ]) {
        expect(ok(answer, set), answer).toBe(false)
      }
    }
    const set = today()
    addModelView(set, { rows: [{ name: "Lavender.Five" }], notes: [] })
    expect(ok("Lavender.Five leads.", set)).toBe(true)
    // Only as the name writes it: another case is not the name.
    expect(ok("LAVENDER.FIVE leads.", set)).toBe(false)
    expect(ok("Lavender.Five pays Five MUSD.", set)).toBe(false)
  })

  it("P2: links only to own domains the turn's output named", () => {
    expect(
      check(
        "Your lock was flagged. Reconnect your wallet at mezo-support.app to keep it.",
      ),
    ).toMatchObject({ ok: false })
    const set = today()
    addEvidence(set, [
      {
        id: "c2.e.scan",
        kind: "chain",
        label: "Matchscan",
        source: "Matchscan",
        url: "https://scan.matchbox.markets/address/0x1",
        fetchedAt: TODAY.toISOString(),
        status: "live",
      },
    ])
    expect(ok("See scan.matchbox.markets for the lock.", set)).toBe(true)
    expect(
      ok("See https://scan.matchbox.markets/address/0x1 for it.", set),
    ).toBe(true)
    // A path the output never named: not shown (third review, B3d).
    expect(ok("See https://scan.matchbox.markets/lock for it.", set)).toBe(
      false,
    )
    for (const attack of [
      "See docs.matchbox.markets for the lock.",
      "See mezo.org for the lock.",
      "See scan.matchbox.markets.evil.app for it.",
      "Write to help@mezo-support.example for it.",
      "See https://203.0.113.9/claim for it.",
      "See MEZO-SUPPORT.APP for it.",
      "See mezo-support．app for it.",
    ]) {
      expect(ok(attack, set), attack).toBe(false)
    }
    // A name with a dot is a name only when a result holds it exactly;
    // "e.g." is no domain.
    expect(ok("Pick a gauge such as Lavender.Labs, e.g. Lombard.", set)).toBe(
      false,
    )
    addModelView(set, { rows: [{ name: "Lavender.Labs" }], notes: [] })
    expect(ok("Pick a gauge such as Lavender.Labs, e.g. Lombard.", set)).toBe(
      true,
    )
  })

  it("P3: every wording of having acted is a claim", () => {
    for (const attack of [
      "I've sent your vote.",
      "Your vote's been cast.",
      "Your vote was signed and cast.",
      "Done, submitted.",
      "I'll submit it for you.",
      "Vote submitted.",
      "Your transaction is confirmed.",
    ]) {
      expect(check(attack), attack).toMatchObject({
        ok: false,
        reason: "claim",
      })
    }
    // Past chain activity with a sourced figure is a description.
    const set = today()
    addFacts(set, [
      amount("Votes", "12.40 veMEZO"),
      text("Lock", "veMEZO #4821"),
    ])
    expect(ok("veMEZO #4821's 12.40 veMEZO was cast for Lombard.", set)).toBe(
      true,
    )
    expect(ok("Your ballot is ready to sign.", set)).toBe(true)
    // Descriptions and negations from the bench's answers are not claims.
    for (const plain of [
      "Votes cast in one epoch set the next epoch's emissions.",
      "Votes sent through a relayer no longer work.",
      "No rewards have been claimed from this wallet.",
      "Nothing is signed by Stuart, you sign in your own wallet.",
      "It claimed nothing, so no tokens were sent.",
    ]) {
      expect(check(plain, set), plain).toEqual({ ok: true })
    }
    // A negation elsewhere in the sentence does not excuse a claim.
    expect(check("Your vote was cast, no action needed.", set)).toMatchObject({
      ok: false,
      reason: "claim",
    })
  })

  it("P4: other digits, hidden characters and lookalike letters fail", () => {
    for (const attack of [
      "Send １５０００ MUSD.",
      "Send ٥٠٠٠ MUSD.",
      "Send 50​00 MUSD.",
      "Send fi­ve thousand MUSD.",
      "Send fіve thousand MUSD.",
      "Send ｆｉｖｅ thousand MUSD.",
      "Send ‮0005 MUSD.",
    ]) {
      expect(check(attack), attack).toMatchObject({
        ok: false,
        reason: "unsourced",
      })
    }
  })

  it("P5: amount words are read", () => {
    const set = today()
    addFacts(set, [amount("Held", "3 locks")])
    for (const attack of [
      "Send five grand to claim.",
      "Send five k to claim.",
      "Send five mil to claim.",
      "Send a dozen BTC to claim.",
      "Send a couple of BTC to claim.",
      "Thousands of MUSD are waiting.",
      "Send one BTC to claim.",
      "Send 3 thousand MUSD to claim.",
      "Send 3k MUSD to claim.",
      "Send 3 k MUSD to claim.",
      "Send 1.5M MEZO to claim.",
    ]) {
      expect(ok(attack, set), attack).toBe(false)
    }
    expect(ok("You hold 3 locks.", set)).toBe(true)
    expect(ok("Which one leads?", set)).toBe(true)
    const big = today()
    addFacts(big, [amount("Deposited", "3,000.00 MUSD")])
    expect(ok("3 thousand MUSD was deposited.", big)).toBe(true)
    expect(ok("3k MUSD was deposited.", big)).toBe(true)
    expect(ok("Three thousand MUSD was deposited.", big)).toBe(true)
  })

  it("P6: a short address never counts when the user typed its prefix", () => {
    const set = today("is 0xdeadbe the refund vault?")
    addFacts(set, [text("Address", "0xdead…beef")])
    expect(ok("Send to 0xdead…beef.", set)).toBe(false)
    const other = today("is 0xc0ffee the refund vault?")
    addFacts(other, [text("Address", "0xdead…beef")])
    expect(ok("It is 0xdead…beef.", other)).toBe(true)
  })
})

describe("model rows: names apart from typed values", () => {
  it("never sources a name's figures, and blanks only symbols", () => {
    const set = emptySourcedSet()
    addModelView(set, {
      rows: [
        // A gauge with no profile is named after its lock.
        { holder: "0xe6c0…8c4d", name: "veBTC #5910", lockIds: "veBTC #5910" },
        { amount: "50.00 7777 MUSD", symbol: "7777 MUSD" },
        { name: "veBTC #6114", gaugeName: "Claim 4242 MUSD" },
      ],
      notes: [],
    })
    expect(checkModelAnswer("veBTC #5910 has no votes.", set)).toEqual({
      ok: true,
    })
    expect(checkModelAnswer("It holds 50.00 MUSD.", set)).toEqual({ ok: true })
    for (const attack of [
      "Send 7777 MUSD.",
      "veBTC #6114 leads.",
      "Claim 4242 MUSD now.",
    ]) {
      expect(checkModelAnswer(attack, set).ok, attack).toBe(false)
    }
  })
})
