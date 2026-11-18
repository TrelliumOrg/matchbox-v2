import type { BlockRecord } from "./decode"

// Blocks into per-validator counts per UTC hour (uptime_hourly) or day
// (the backfill's uptime_daily), and the compact row uptime_blocks keeps.

/** A set member as uptime_sets stores it. */
export type StoredMember = {
  /** Consensus address, upper-case hex. */
  c: string
  /** Operator address (lower case), or null when the PoA module did not name it. */
  o: string | null
  /** Moniker, or null. */
  n: string | null
}

/** The key a member's counts are kept under. */
export function validatorKey(member: StoredMember): string {
  return member.o ?? `cons:${member.c.toLowerCase()}`
}

/** The chain's own row: blocks and signatures summed over the set. */
export const chainKey = ""

export type Counts = {
  blocks: number
  signed: number
  missed: number
  proposed: number
  proposals_missed: number
  expected_micro: number
  unattributed: number
  first_height: number | null
  last_height: number | null
}

export function emptyCounts(): Counts {
  return {
    blocks: 0,
    signed: 0,
    missed: 0,
    proposed: 0,
    proposals_missed: 0,
    expected_micro: 0,
    unattributed: 0,
    first_height: null,
    last_height: null,
  }
}

function addHeight(counts: Counts, height: number): void {
  counts.first_height =
    counts.first_height === null
      ? height
      : Math.min(counts.first_height, height)
  counts.last_height =
    counts.last_height === null ? height : Math.max(counts.last_height, height)
}

/** Adds one block to `buckets` (validator key, then bucket key). */
export function addBlock(
  buckets: Map<string, Map<string, Counts>>,
  bucket: string,
  record: BlockRecord,
  members: readonly StoredMember[],
): void {
  const counts = (key: string): Counts => {
    let byBucket = buckets.get(key)
    if (byBucket === undefined) {
      byBucket = new Map()
      buckets.set(key, byBucket)
    }
    let value = byBucket.get(bucket)
    if (value === undefined) {
      value = emptyCounts()
      byBucket.set(bucket, value)
    }
    return value
  }
  const expected = Math.round(1_000_000 / members.length)
  const missedBy = new Set(record.missed ?? [])
  members.forEach((member, index) => {
    const row = counts(validatorKey(member))
    const signed = ((record.signed >> BigInt(index)) & 1n) === 1n
    row.blocks += 1
    if (signed) row.signed += 1
    else row.missed += 1
    if (record.proposer === index) row.proposed += 1
    if (missedBy.has(index)) row.proposals_missed += 1
    row.expected_micro += expected
    addHeight(row, record.height)
  })
  const chain = counts(chainKey)
  chain.blocks += 1
  chain.signed += record.signers
  chain.missed += members.length - record.signers
  chain.proposed += 1
  if (record.round > 0) {
    if (record.missed === null) chain.unattributed += 1
    else if (record.missed.length > 0) chain.proposals_missed += 1
  }
  addHeight(chain, record.height)
}

/** The UTC hour a block time falls in, as unix seconds. */
export function hourOf(time: number): number {
  return time - (time % 3_600)
}

/** The UTC day a block time falls in. */
export function dayOfTime(time: number): string {
  return new Date(time * 1000).toISOString().slice(0, 10)
}

/** A block as uptime_blocks stores it. */
export type BlockRow = {
  height: number
  time: number
  round: number
  set_id: number
  proposer: number
  missed: string | null
  signed: string
  signers: number
}

export function blockRow(record: BlockRecord): BlockRow {
  return {
    height: record.height,
    time: record.time,
    round: record.round,
    set_id: record.setId,
    proposer: record.proposer,
    missed: record.missed === null ? null : record.missed.join(","),
    signed: record.signed.toString(16),
    signers: record.signers,
  }
}

/** One validator's counts in one bucket. */
export type CountRow = { validator: string; bucket: string; counts: Counts }

/** Every validator's counts in every bucket, in key order. */
export function countRows(
  buckets: Map<string, Map<string, Counts>>,
): CountRow[] {
  return [...buckets.entries()]
    .flatMap(([validator, byBucket]) =>
      [...byBucket.entries()].map(([bucket, counts]) => ({
        validator,
        bucket,
        counts,
      })),
    )
    .sort((a, b) =>
      a.validator === b.validator
        ? a.bucket.localeCompare(b.bucket)
        : a.validator.localeCompare(b.validator),
    )
}
