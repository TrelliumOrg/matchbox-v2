import { BORROW_CONTRACTS, MUSD_CONTRACTS } from "@matchbox/chain"
import type { ScanLockItem, ScanMorphoMarket } from "@matchbox/contracts/scan"
import { describe, expect, it } from "vitest"
import { enclaveEvents, morphoEvents, troveEvents } from "./fixtures/borrow"
import { findLock, wallet } from "./fixtures/world"
import {
  enclaveTxLoan,
  loanRefs,
  morphoTxLoan,
  othersText,
  troveTxLoan,
} from "./tx-loan"

const topic = (address: string) =>
  `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`
const word = (tail: string) => `0x${tail.padStart(64, "0")}`
const units = (whole: bigint) => (whole * 10n ** 18n).toString()

const troveUpdated =
  "0x85a52d2a9df6d50beea0d12f454309d08739d01fde1aa65491f68b92367297b4"
const positionOpened =
  "0x71b8cfcb91be8c2c8670be096e68d6366139b0e2d777e4f77ade632a4d721196"
const borrow =
  "0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43"

describe("the loan a transaction's logs name", () => {
  const market = word("6f88")
  it("reads a trove's borrower, an Enclave position and a Morpho account", () => {
    const refs = loanRefs([
      {
        address: MUSD_CONTRACTS.mainnet.borrowerOperations,
        topics: [troveUpdated, topic(wallet)],
      },
      // The same trove again in the TroveManager's log: named once.
      {
        address: MUSD_CONTRACTS.mainnet.troveManager,
        topics: [troveUpdated, topic(wallet)],
      },
      {
        address: BORROW_CONTRACTS.mainnet.enclaveDebtManager,
        topics: [positionOpened, word("e7c1")],
      },
      {
        address: BORROW_CONTRACTS.mainnet.morphoBlue,
        topics: [borrow, market, topic(wallet)],
      },
    ])
    expect(refs).toEqual([
      { kind: "trove", borrower: wallet },
      { kind: "enclave", position: word("e7c1") },
      { kind: "morpho", market, account: wallet },
    ])
  })

  it("takes only the position events, never another event at the address", () => {
    expect(
      loanRefs([
        {
          address: `0x${"12".repeat(20)}`,
          topics: [troveUpdated, topic(wallet)],
        },
        // A TroveManager event that is not TroveUpdated.
        {
          address: MUSD_CONTRACTS.mainnet.troveManager,
          topics: [word("1"), topic(wallet)],
        },
        // OriginatorFeeAccrued(originator indexed, ...): not a position.
        {
          address: BORROW_CONTRACTS.mainnet.enclaveDebtManager,
          topics: [word("0fee"), topic(wallet)],
        },
        // AccrueInterest(id, ...): no account topic.
        {
          address: BORROW_CONTRACTS.mainnet.morphoBlue,
          topics: [word("abcd"), market],
        },
      ]),
    ).toEqual([])
  })

  it("counts the other positions a redemption moved", () => {
    const refs = ["a1", "a2", "a3", "a4"].map((tail) => ({
      kind: "trove" as const,
      borrower: `0x${tail.padStart(40, "0")}`,
    }))
    expect(othersText(refs, "trove")).toBe("+3 more troves")
    expect(othersText(refs.slice(0, 2), "trove")).toBe("+1 more trove")
    expect(othersText(refs.slice(0, 1), "trove")).toBeNull()
  })
})

describe("a trove transaction", () => {
  const [borrowed] = troveEvents
  if (borrowed === undefined) throw new Error("fixture")
  const own = troveEvents.filter((event) => event.borrower === wallet)

  it("says what it did and what changed, before and after", () => {
    const view = troveTxLoan(borrowed.tx_hash, own, null, false)
    expect(view?.title).toBe("Borrowed 4,000.00 MUSD")
    // 6,000 principal, 8.10 stored interest and 4.40 accrued since.
    expect(view?.changes).toEqual([
      { label: "Debt", value: "10,012.50 MUSD", note: "From 6,012.50 MUSD" },
      { label: "Collateral", value: "0.2710 BTC", note: "From 0.2710 BTC" },
      { label: "Rate", value: "1.00% APR", note: null },
    ])
    expect(view?.notYet).toEqual([])
    expect(view?.position.link).toEqual({ kind: "trove", owner: wallet })
    expect(view?.position.status).toBe("Not available yet")
    expect(view?.position.history[0]).toMatchObject({ current: true })
  })

  it("adds up: from plus what moved is after", () => {
    // A repayment with interest accrued since the last event.
    const repaid = {
      ...borrowed,
      tx_hash: word("feed"),
      action: "LOAN_REPAID",
      principal: units(7_000n),
      interest: "0",
      prev_principal: units(10_000n),
      prev_interest: units(12n),
      accrued_interest: units(3n),
      debt_change: `-${units(3_015n)}`,
    }
    const view = troveTxLoan(repaid.tx_hash, [repaid, ...own], null, false)
    expect(view?.title).toBe("Repaid 3,015.00 MUSD")
    expect(view?.changes[0]).toEqual({
      label: "Debt",
      value: "7,000.00 MUSD",
      note: "From 10,015.00 MUSD",
    })
    // Without the change, the stored before with its accrued interest.
    const unknown = { ...repaid, debt_change: null }
    expect(
      troveTxLoan(unknown.tx_hash, [unknown, ...own], null, false)?.changes[0]
        ?.note,
    ).toBe("From 10,015.00 MUSD")
  })

  it("calls an opening a new loan", () => {
    const opened = own.find((event) => event.action === "LOAN_OPENED")
    if (opened === undefined) throw new Error("fixture")
    const view = troveTxLoan(opened.tx_hash, own, null, false)
    expect(view?.title).toBe("Opened 6,000.00 MUSD")
    expect(view?.changes[0]?.note).toBe("New loan")
  })

  it("is nothing when none of the events is this transaction's", () => {
    expect(troveTxLoan(word("dead"), own, null, false)).toBeNull()
  })
})

describe("an Enclave transaction", () => {
  const [opened] = enclaveEvents
  if (opened === undefined || opened.position_id === null) {
    throw new Error("fixture")
  }
  const position = opened.position_id
  const events = enclaveEvents.filter((each) => each.position_id === position)
  const lock = findLock("vebtc", "604") as ScanLockItem

  it("says the principal opened, the veBTC pledged and its terms", () => {
    const view = enclaveTxLoan(opened.tx_hash, position, events, [lock], false)
    expect(view?.title).toBe("Opened 25,000.00 MUSD")
    expect(view?.against).toBe("veBTC #604")
    expect(view?.changes).toEqual([
      {
        label: "Principal",
        value: "25,000.00 MUSD",
        note: "New position at 1.00% APR",
      },
      { label: "Pledged", value: "veBTC #604", note: null },
      { label: "Minimum ratio", value: "110%", note: "Warning at 150%" },
    ])
    // Today's amount locked is the card's, said to be now.
    expect(view?.position.rows).toContainEqual({
      label: "Collateral now",
      value: "1.2400 BTC",
    })
  })

  it("says the live figures are not available yet, never estimates them", () => {
    const view = enclaveTxLoan(opened.tx_hash, position, events, [], false)
    expect(view?.notYet).toEqual(["Collateral ratio", "Price at the minimum"])
    expect(view?.position.rows).toContainEqual({
      label: "Collateral ratio",
      value: "Not available yet",
    })
    expect(view?.position.rows).toContainEqual({
      label: "Collateral now",
      value: "Not available yet",
    })
  })

  it("reads a veBTC lock's own event in BTC", () => {
    const locked = {
      ...opened,
      tx_hash: word("10c4"),
      action: "VEBTC_INCREASED",
      amount: (5n * 10n ** 17n).toString(),
      principal: null,
    }
    const view = enclaveTxLoan(
      locked.tx_hash,
      position,
      [locked, ...events],
      [lock],
      false,
    )
    expect(view?.title).toBe("Added 0.5000 BTC to veBTC")
  })

  it("names the locks only when the transaction pledged some", () => {
    const borrowed = {
      ...opened,
      tx_hash: word("b0b0"),
      action: "DEBT_INCREASED",
      amount: units(1_000n),
      principal: units(26_000n),
    }
    const more = enclaveTxLoan(
      borrowed.tx_hash,
      position,
      [borrowed, ...events],
      [lock],
      false,
    )
    expect(more?.changes.map((change) => change.label)).toEqual([
      "Principal",
      "Minimum ratio",
    ])
    // Still borrowed against the position's locks.
    expect(more?.against).toBe("veBTC #604")
    // A pledge names the lock it added, not the ones already pledged.
    const pledged = {
      ...opened,
      tx_hash: word("ad0d"),
      action: "COLLATERAL_PLEDGED",
      ve_btc_token_id: "607",
      amount: null,
      pledged_ve_btc: ["604", "607"],
    }
    const view = enclaveTxLoan(
      pledged.tx_hash,
      position,
      [pledged, ...events],
      [lock],
      false,
    )
    expect(view?.changes).toContainEqual({
      label: "Pledged",
      value: "veBTC #607",
      note: null,
    })
    // Today's amount for the card needs every current lock: #607 unread.
    expect(view?.position.rows).toContainEqual({
      label: "Collateral now",
      value: "Not available yet",
    })
  })

  it("keeps the amount an event carries on one lock's row only", () => {
    const second = { ...opened, ve_btc_token_id: "605", amount: null }
    const view = enclaveTxLoan(
      opened.tx_hash,
      position,
      [second, opened, ...events.slice(1)],
      [lock],
      false,
    )
    expect(view?.title).toBe("Opened 25,000.00 MUSD")
  })
})

describe("a Morpho transaction", () => {
  const [supplied] = morphoEvents
  if (supplied === undefined || supplied.on_behalf === null) {
    throw new Error("fixture")
  }
  const ref = { market: supplied.market_id, account: supplied.on_behalf }

  it("says what moved and links the position", () => {
    const view = morphoTxLoan(
      supplied.tx_hash,
      ref,
      morphoEvents,
      { status: "ok", position: null },
      null,
      false,
    )
    expect(view?.title).toBe("Added 0.2416 BTC collateral")
    expect(view?.position.link).toEqual({ kind: "morpho", ...ref })
    expect(view?.position.status).toBe("Closed")
  })

  it("says not available when the position read failed", () => {
    const view = morphoTxLoan(
      supplied.tx_hash,
      ref,
      morphoEvents,
      { status: "failed" },
      null,
      false,
    )
    expect(view?.position.status).toBe("Not available yet")
  })

  it("uses the fetched market's decimals, and shows what a liquidation seized", () => {
    // A market the registry does not know, its collateral with 8 decimals.
    const market = {
      market_id: word("abc"),
      loan_token: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
      collateral_token: "0x7b7c000000000000000000000000000000000000",
      loan_decimals: 18,
      collateral_decimals: 8,
    } as unknown as ScanMorphoMarket
    const liquidated = {
      ...supplied,
      tx_hash: word("1100"),
      market_id: market.market_id,
      action: "LIQUIDATED",
      assets: units(500n),
      seized_assets: "25000000",
    }
    const view = morphoTxLoan(
      liquidated.tx_hash,
      { market: market.market_id, account: ref.account },
      [liquidated],
      { status: "ok", position: null },
      market,
      false,
    )
    expect(view?.changes).toEqual([
      { label: "Collateral seized", value: "0.2500 BTC", note: null },
      { label: "Debt repaid", value: "500.00 MUSD", note: null },
    ])
  })
})
