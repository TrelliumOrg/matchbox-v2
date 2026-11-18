import {
  BORROW_TOKEN_DECIMALS,
  type BorrowContractKind,
  ENCLAVE_DEBT_MANAGER_EVENTS_ABI,
  ENCLAVE_EVENTS_ABI,
  ENCLAVE_ROLE,
  MORPHO_BLUE_EVENTS_ABI,
  PROXY_UPGRADED_EVENTS_ABI,
} from "@matchbox/chain"
import { createLogger } from "@matchbox/logger"
import { type Address, decodeEventLog, type Hex, toEventSelector } from "viem"
import { eventTopics, lower } from "../decode/helpers"
import type { Network } from "../ingest/networks"
import type { RawLog, RawTx } from "../ingest/rpc"
import type {
  BorrowContract,
  EnclaveAction,
  EnclaveEventRow,
  EnclavePosition,
  MorphoAction,
  MorphoEventRow,
  MorphoMarketRow,
} from "./rows"

// Decodes borrow logs into rows, in (block, log index) order, carrying the
// state the events alone do not: Morpho market totals (for morpho_markets)
// and each Enclave position's enclave, borrower, principal and pledged veBTC
// (debt events name only the position id).
//
// Morpho totals follow Morpho.sol exactly: Supply and Withdraw move supply
// assets and shares, Borrow and Repay borrow assets and shares (Repay floors
// borrow assets at zero), AccrueInterest adds the interest to both sides and
// the fee shares to supply shares, Liquidate removes repaid and bad debt.
// Collateral is not a Morpho total; it is summed from the collateral events.

// Bump on any change to what the borrow tables hold; they must then be
// rebuilt (scripts/backfill-borrow.ts --replay).
export const BORROW_DECODER_VERSION = 1

const logger = createLogger({ fields: { service: "matchbox-indexer-borrow" } })

const DEBT_MANAGER_DECODE_ABI = [
  ...ENCLAVE_DEBT_MANAGER_EVENTS_ABI,
  ...PROXY_UPGRADED_EVENTS_ABI,
] as const
const ENCLAVE_DECODE_ABI = [
  ...ENCLAVE_EVENTS_ABI,
  ...PROXY_UPGRADED_EVENTS_ABI,
] as const

const ROLE_GRANTED = toEventSelector("RoleGranted(bytes32,address,address)")

export class UnknownBorrowStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnknownBorrowStateError"
  }
}

function decimalsOf(token: Address): number | null {
  return BORROW_TOKEN_DECIMALS[lower(token)] ?? null
}

function zeroFloorSub(left: bigint, right: bigint): bigint {
  return left > right ? left - right : 0n
}

function minToken(tokens: readonly bigint[]): bigint | undefined {
  let lowest: bigint | undefined
  for (const token of tokens) {
    if (lowest === undefined || token < lowest) lowest = token
  }
  return lowest
}

function sortedTokens(tokens: readonly bigint[]): bigint[] {
  return [...tokens].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
}

/** A new Enclave, from RoleGranted(ENCLAVE_ROLE) on the EnclaveDebtManager. */
export function discoverEnclave(
  log: RawLog,
  kind: BorrowContractKind | undefined,
): BorrowContract | null {
  if (kind !== "enclaveDebtManager" || log.topics[0] !== ROLE_GRANTED) {
    return null
  }
  const decoded = decodeEventLog({
    abi: ENCLAVE_DEBT_MANAGER_EVENTS_ABI,
    data: log.data,
    topics: eventTopics(log),
    strict: true,
  })
  if (decoded.eventName !== "RoleGranted") return null
  if (lower(decoded.args.role) !== lower(ENCLAVE_ROLE)) return null
  return {
    network: log.network,
    address: lower(decoded.args.account),
    kind: "enclave",
    template: "Enclave",
    createdBlock: log.blockNumber,
    createdTx: log.txHash,
  }
}

export type BorrowState = {
  markets: Map<Hex, MorphoMarketRow>
  positions: Map<Hex, EnclavePosition>
}

export type DecodedBorrowRows = {
  morphoEvents: MorphoEventRow[]
  enclaveEvents: EnclaveEventRow[]
  // Markets whose totals changed, in their state after the batch.
  markets: MorphoMarketRow[]
}

export class BorrowDecoder {
  private morphoEvents: MorphoEventRow[] = []
  private enclaveEvents: EnclaveEventRow[] = []
  private readonly changedMarkets = new Set<Hex>()

  constructor(
    private readonly network: Network,
    private readonly state: BorrowState,
  ) {}

  /** Decodes one log of a known borrow contract. */
  apply(log: RawLog, tx: RawTx, kind: BorrowContractKind): void {
    if (log.blockTimestamp <= 0n) {
      throw new Error(`Block ${log.blockNumber} has no timestamp`)
    }
    if (kind === "morphoBlue") this.applyMorpho(log, tx)
    else if (kind === "enclaveDebtManager") this.applyDebtManager(log, tx)
    else this.applyEnclave(log, tx)
  }

  /** Rows decoded since the last drain, and the markets they changed. */
  drain(): DecodedBorrowRows {
    const rows: DecodedBorrowRows = {
      morphoEvents: this.morphoEvents,
      enclaveEvents: this.enclaveEvents,
      markets: [...this.changedMarkets].flatMap((id) => {
        const market = this.state.markets.get(id)
        return market ? [{ ...market }] : []
      }),
    }
    this.morphoEvents = []
    this.enclaveEvents = []
    this.changedMarkets.clear()
    return rows
  }

  private key(log: RawLog, tx: RawTx) {
    return {
      network: this.network,
      txHash: log.txHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      timestamp: log.blockTimestamp,
      txFrom: tx.from,
    }
  }

  private market(id: Hex, log: RawLog): MorphoMarketRow {
    const market = this.state.markets.get(id)
    if (!market) {
      throw new UnknownBorrowStateError(
        `Morpho market ${id} has no CreateMarket before log ${log.txHash}-${log.logIndex}`,
      )
    }
    this.changedMarkets.add(id)
    market.updatedBlock = log.blockNumber
    return market
  }

  private morphoRow(
    log: RawLog,
    tx: RawTx,
    marketId: Hex,
    action: MorphoAction,
    fields: Partial<
      Pick<
        MorphoEventRow,
        | "caller"
        | "onBehalf"
        | "receiver"
        | "assets"
        | "shares"
        | "seizedAssets"
        | "badDebtAssets"
        | "badDebtShares"
        | "prevBorrowRate"
        | "feeShares"
        | "fee"
      >
    >,
  ): void {
    this.morphoEvents.push({
      ...this.key(log, tx),
      marketId,
      action,
      caller: fields.caller ? lower(fields.caller) : null,
      onBehalf: fields.onBehalf ? lower(fields.onBehalf) : null,
      receiver: fields.receiver ? lower(fields.receiver) : null,
      assets: fields.assets ?? null,
      shares: fields.shares ?? null,
      seizedAssets: fields.seizedAssets ?? null,
      badDebtAssets: fields.badDebtAssets ?? null,
      badDebtShares: fields.badDebtShares ?? null,
      prevBorrowRate: fields.prevBorrowRate ?? null,
      feeShares: fields.feeShares ?? null,
      fee: fields.fee ?? null,
    })
  }

  private applyMorpho(log: RawLog, tx: RawTx): void {
    const event = decodeEventLog({
      abi: MORPHO_BLUE_EVENTS_ABI,
      data: log.data,
      topics: eventTopics(log),
      strict: true,
    })
    switch (event.eventName) {
      case "CreateMarket": {
        const id = lower(event.args.id)
        const params = event.args.marketParams
        this.state.markets.set(id, {
          network: this.network,
          marketId: id,
          loanToken: lower(params.loanToken),
          collateralToken: lower(params.collateralToken),
          oracle: lower(params.oracle),
          irm: lower(params.irm),
          lltv: params.lltv,
          loanDecimals: decimalsOf(params.loanToken),
          collateralDecimals: decimalsOf(params.collateralToken),
          fee: 0n,
          totalSupplyAssets: 0n,
          totalSupplyShares: 0n,
          totalBorrowAssets: 0n,
          totalBorrowShares: 0n,
          totalCollateral: 0n,
          lastUpdate: log.blockTimestamp,
          createdBlock: log.blockNumber,
          createdTx: log.txHash,
          createdTimestamp: log.blockTimestamp,
          updatedBlock: log.blockNumber,
        })
        this.changedMarkets.add(id)
        this.morphoRow(log, tx, id, "MARKET_CREATED", {})
        return
      }
      case "Supply": {
        const id = lower(event.args.id)
        const market = this.market(id, log)
        market.totalSupplyAssets += event.args.assets
        market.totalSupplyShares += event.args.shares
        this.morphoRow(log, tx, id, "SUPPLIED", event.args)
        return
      }
      case "Withdraw": {
        const id = lower(event.args.id)
        const market = this.market(id, log)
        market.totalSupplyAssets -= event.args.assets
        market.totalSupplyShares -= event.args.shares
        this.morphoRow(log, tx, id, "WITHDRAWN", event.args)
        return
      }
      case "Borrow": {
        const id = lower(event.args.id)
        const market = this.market(id, log)
        market.totalBorrowAssets += event.args.assets
        market.totalBorrowShares += event.args.shares
        this.morphoRow(log, tx, id, "BORROWED", event.args)
        return
      }
      case "Repay": {
        const id = lower(event.args.id)
        const market = this.market(id, log)
        market.totalBorrowShares -= event.args.shares
        market.totalBorrowAssets = zeroFloorSub(
          market.totalBorrowAssets,
          event.args.assets,
        )
        this.morphoRow(log, tx, id, "REPAID", event.args)
        return
      }
      case "SupplyCollateral": {
        const id = lower(event.args.id)
        this.market(id, log).totalCollateral += event.args.assets
        this.morphoRow(log, tx, id, "COLLATERAL_SUPPLIED", event.args)
        return
      }
      case "WithdrawCollateral": {
        const id = lower(event.args.id)
        this.market(id, log).totalCollateral -= event.args.assets
        this.morphoRow(log, tx, id, "COLLATERAL_WITHDRAWN", event.args)
        return
      }
      case "Liquidate": {
        const id = lower(event.args.id)
        const market = this.market(id, log)
        const args = event.args
        market.totalBorrowShares -= args.repaidShares
        market.totalBorrowAssets = zeroFloorSub(
          market.totalBorrowAssets,
          args.repaidAssets,
        )
        market.totalCollateral -= args.seizedAssets
        market.totalBorrowAssets -= args.badDebtAssets
        market.totalSupplyAssets -= args.badDebtAssets
        market.totalBorrowShares -= args.badDebtShares
        this.morphoRow(log, tx, id, "LIQUIDATED", {
          caller: args.caller,
          onBehalf: args.borrower,
          assets: args.repaidAssets,
          shares: args.repaidShares,
          seizedAssets: args.seizedAssets,
          badDebtAssets: args.badDebtAssets,
          badDebtShares: args.badDebtShares,
        })
        return
      }
      case "AccrueInterest": {
        const id = lower(event.args.id)
        const market = this.market(id, log)
        market.totalBorrowAssets += event.args.interest
        market.totalSupplyAssets += event.args.interest
        market.totalSupplyShares += event.args.feeShares
        market.lastUpdate = log.blockTimestamp
        this.morphoRow(log, tx, id, "INTEREST_ACCRUED", {
          assets: event.args.interest,
          prevBorrowRate: event.args.prevBorrowRate,
          feeShares: event.args.feeShares,
        })
        return
      }
      case "SetFee": {
        const id = lower(event.args.id)
        this.market(id, log).fee = event.args.newFee
        this.morphoRow(log, tx, id, "FEE_SET", { fee: event.args.newFee })
        return
      }
      default:
        // Ingest fetches only the topics above (BORROW_INDEXED_EVENTS).
        throw new Error(
          `Morpho ${event.eventName} is not a borrow stream event (${log.txHash}-${log.logIndex})`,
        )
    }
  }

  private position(positionId: Hex, log: RawLog): EnclavePosition {
    const position = this.state.positions.get(positionId)
    if (!position) {
      throw new UnknownBorrowStateError(
        `Enclave position ${positionId} was never opened before log ${log.txHash}-${log.logIndex}`,
      )
    }
    return position
  }

  private enclaveRow(
    log: RawLog,
    tx: RawTx,
    action: EnclaveAction,
    veBtcTokenId: bigint,
    enclave: Address,
    position: EnclavePosition | null,
    fields: Partial<
      Pick<
        EnclaveEventRow,
        | "amount"
        | "interestRate"
        | "originatorFeeRate"
        | "warningCr"
        | "minimumCr"
        | "lockDuration"
        | "otherVeBtcTokenId"
      >
    >,
  ): void {
    this.enclaveEvents.push({
      ...this.key(log, tx),
      veBtcTokenId,
      contractAddress: log.address,
      enclave,
      positionId: position?.positionId ?? null,
      borrower: position?.borrower ?? null,
      action,
      amount: fields.amount ?? null,
      principal: position?.principal ?? null,
      interestRate: fields.interestRate ?? null,
      originatorFeeRate: fields.originatorFeeRate ?? null,
      warningCr: fields.warningCr ?? null,
      minimumCr: fields.minimumCr ?? null,
      lockDuration: fields.lockDuration ?? null,
      otherVeBtcTokenId: fields.otherVeBtcTokenId ?? null,
      pledgedVeBtc: position?.open ? sortedTokens(position.pledged) : [],
    })
  }

  // A debt row names the position's lowest pledged veBTC.
  private debtRow(
    log: RawLog,
    tx: RawTx,
    action: EnclaveAction,
    position: EnclavePosition,
    fields: Parameters<BorrowDecoder["enclaveRow"]>[6],
  ): void {
    const token = minToken(position.pledged)
    if (token === undefined) {
      throw new UnknownBorrowStateError(
        `Enclave position ${position.positionId} has no pledged veBTC at ${log.txHash}-${log.logIndex}`,
      )
    }
    this.enclaveRow(log, tx, action, token, position.enclave, position, fields)
  }

  // One row per veBTC that moved; the amount, if any, on the lowest only.
  private collateralRows(
    log: RawLog,
    tx: RawTx,
    action: EnclaveAction,
    tokens: readonly bigint[],
    position: EnclavePosition,
    fields: Parameters<BorrowDecoder["enclaveRow"]>[6],
  ): void {
    sortedTokens([...new Set(tokens)]).forEach((token, index) => {
      this.enclaveRow(
        log,
        tx,
        action,
        token,
        position.enclave,
        position,
        index === 0 ? fields : { ...fields, amount: null },
      )
    })
  }

  private applyDebtManager(log: RawLog, tx: RawTx): void {
    const event = decodeEventLog({
      abi: DEBT_MANAGER_DECODE_ABI,
      data: log.data,
      topics: eventTopics(log),
      strict: true,
    })
    switch (event.eventName) {
      case "PositionOpened": {
        const args = event.args
        const positionId = lower(args.positionId)
        const position: EnclavePosition = {
          positionId,
          enclave: lower(args.enclave),
          borrower: lower(args.borrower),
          principal: args.debtAmount,
          pledged: [...args.pledgedVeBtc],
          open: true,
        }
        this.state.positions.set(positionId, position)
        this.collateralRows(
          log,
          tx,
          "POSITION_OPENED",
          args.pledgedVeBtc,
          position,
          {
            amount: args.debtAmount,
            interestRate: args.interestRate,
            originatorFeeRate: args.originatorFeeRate,
            warningCr: args.warningCR,
            minimumCr: args.minimumCR,
          },
        )
        return
      }
      case "DebtIncreased": {
        const position = this.position(lower(event.args.positionId), log)
        position.principal = event.args.newPrincipal
        this.debtRow(log, tx, "DEBT_INCREASED", position, {
          amount: event.args.additionalDebt,
        })
        return
      }
      case "DebtRepaid": {
        const position = this.position(lower(event.args.positionId), log)
        position.principal = event.args.remainingPrincipal
        this.debtRow(log, tx, "DEBT_REPAID", position, {
          amount: event.args.amount,
        })
        return
      }
      case "PositionClosed": {
        const position = this.position(lower(event.args.positionId), log)
        const released = position.pledged
        position.pledged = []
        position.open = false
        this.collateralRows(log, tx, "POSITION_CLOSED", released, position, {})
        return
      }
      case "PledgedVeBtcAdded": {
        const position = this.position(lower(event.args.positionId), log)
        position.pledged = [...event.args.pledgedTokenIds]
        this.collateralRows(
          log,
          tx,
          "COLLATERAL_PLEDGED",
          event.args.tokenIdsAdded,
          position,
          {},
        )
        return
      }
      case "PledgedVeBtcRemoved": {
        const position = this.position(lower(event.args.positionId), log)
        position.pledged = [...event.args.pledgedTokenIds]
        this.collateralRows(
          log,
          tx,
          "COLLATERAL_RELEASED",
          event.args.tokenIdsRemoved,
          position,
          {},
        )
        return
      }
      case "PositionCRThresholdsSet": {
        const position = this.position(lower(event.args.positionId), log)
        this.debtRow(log, tx, "CR_THRESHOLDS_SET", position, {
          warningCr: event.args.warningCR,
          minimumCr: event.args.minimumCR,
        })
        return
      }
      case "PositionInterestRateSet": {
        const position = this.position(lower(event.args.positionId), log)
        this.debtRow(log, tx, "INTEREST_RATE_SET", position, {
          interestRate: event.args.newRate,
        })
        return
      }
      case "PositionOriginatorFeeRateSet": {
        const position = this.position(lower(event.args.positionId), log)
        this.debtRow(log, tx, "ORIGINATOR_FEE_RATE_SET", position, {
          originatorFeeRate: event.args.newRate,
        })
        return
      }
      case "RoleGranted":
        // Discovery reads it (discoverEnclave); it has no row.
        return
      case "Upgraded":
        this.upgraded(log, event.args.implementation)
        return
      default:
        throw new Error(
          `EnclaveDebtManager ${event.eventName} is not a borrow stream event (${log.txHash}-${log.logIndex})`,
        )
    }
  }

  // The open position of `enclave` that holds `token`, if any.
  private positionHolding(
    enclave: Address,
    token: bigint,
  ): EnclavePosition | null {
    for (const position of this.state.positions.values()) {
      if (
        position.open &&
        position.enclave === enclave &&
        position.pledged.includes(token)
      ) {
        return position
      }
    }
    return null
  }

  private applyEnclave(log: RawLog, tx: RawTx): void {
    const event = decodeEventLog({
      abi: ENCLAVE_DECODE_ABI,
      data: log.data,
      topics: eventTopics(log),
      strict: true,
    })
    const enclave = log.address
    switch (event.eventName) {
      case "VeBTCLocked": {
        const token = event.args.tokenId
        this.enclaveRow(
          log,
          tx,
          "VEBTC_LOCKED",
          token,
          enclave,
          this.positionHolding(enclave, token),
          { amount: event.args.amount, lockDuration: event.args.lockDuration },
        )
        return
      }
      case "VeBTCIncreased": {
        const token = event.args.tokenId
        this.enclaveRow(
          log,
          tx,
          "VEBTC_INCREASED",
          token,
          enclave,
          this.positionHolding(enclave, token),
          { amount: event.args.amount },
        )
        return
      }
      case "VeBTCMerged": {
        const { fromTokenId, toTokenId } = event.args
        this.enclaveRow(
          log,
          tx,
          "VEBTC_MERGED",
          toTokenId,
          enclave,
          this.positionHolding(enclave, toTokenId) ??
            this.positionHolding(enclave, fromTokenId),
          { otherVeBtcTokenId: fromTokenId },
        )
        return
      }
      case "VeBTCWithdrawn": {
        const token = event.args.tokenId
        this.enclaveRow(
          log,
          tx,
          "VEBTC_WITHDRAWN",
          token,
          enclave,
          this.positionHolding(enclave, token),
          {},
        )
        return
      }
      case "Upgraded":
        this.upgraded(log, event.args.implementation)
        return
      default:
        throw new Error(
          `Enclave ${event.eventName} is not a borrow stream event (${log.txHash}-${log.logIndex})`,
        )
    }
  }

  // A new implementation can change events. The decoder keeps going (an
  // unknown topic would fail the window loudly), but someone should check
  // the new ABI against BORROW_INDEXED_EVENTS.
  private upgraded(log: RawLog, implementation: Address): void {
    logger.warn({
      message: "BORROW CONTRACT UPGRADED: check its events",
      network: this.network,
      contract: log.address,
      implementation: lower(implementation),
      block: log.blockNumber.toString(),
    })
  }
}
