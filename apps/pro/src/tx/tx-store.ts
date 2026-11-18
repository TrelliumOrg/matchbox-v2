import type {
  GaugeKind,
  GaugeSummary,
  Lock,
  LockKind,
  TokenAmount,
  VoterKind,
} from "../data/view-models"

/**
 * What a transaction sheet is asked to do. The open request lives in the
 * wallet store (one small store in the first paint); the sheets, viem and
 * the runner load with `./tx-host` when a button is hovered or pressed.
 */

/** A ballot pick: gauge address (lower case) to share in basis points. */
export type BallotPick = { gauge: GaugeSummary; bps: number }

/** A lock's claimable rewards, by gauge (from the rewards read model). */
export type ClaimSource = {
  lock: { kind: LockKind; tokenId: string }
  usd: string
  gauges: { address: string; voter: VoterKind; name: string }[]
}

export type { VoterKind }

export type TxRequest =
  | {
      flow: "vote"
      /**
       * The gauge type voted: one voter contract, with its own 100%. The
       * lock's votes on its other type are not touched.
       */
      kind: GaugeKind
      /** The lock's other gauge type, when it holds votes there that stay. */
      keeps: GaugeKind | null
      /** Every lock votes the same split, one signature per lock and voter. */
      locks: Lock[]
      /**
       * Picked locks that voted this epoch: the chain refuses a second vote
       * until the next one, so their split is saved here, never signed.
       */
      saveLocks: Lock[]
      /** Whose locks: saved splits are kept per wallet and lock. */
      wallet: string
      /** This epoch's end, for "Votes can change from Thu 12 Nov 01:00 UTC". */
      epochEndsAt: number
      picks: BallotPick[]
      /** Over every picked lock (the ones signing and the ones saving). */
      projectedMicro: bigint
      perGaugeMicro: ReadonlyMap<string, bigint>
      epoch: number
    }
  | {
      flow: "claim"
      sources: ClaimSource[]
      /** The claim is worth this much (read model), for the headline. */
      usd: string
      /** The read model's per-token ledger, to price what the chain reports. */
      tokens: TokenAmount[]
      /** Offer to relock claimed MEZO into this veMEZO lock. */
      relockInto: { tokenId: string } | null
      relock: boolean
    }
  | { flow: "new-lock"; kind: LockKind }
  | { flow: "add"; lock: Lock }
  | { flow: "extend"; lock: Lock }
  | { flow: "merge"; lock: Lock; locks: Lock[] }
  | { flow: "withdraw"; lock: Lock }
  | { flow: "transfer"; lock: Lock }
  | { flow: "incentives"; gauge: GaugeSummary }

export {
  closeTx,
  loadTx,
  openTx,
  txIntent,
  useTx,
} from "../wallet/wallet-store"
