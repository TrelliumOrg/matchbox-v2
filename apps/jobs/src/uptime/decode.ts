import { bytesToHex, sha256 } from "viem"

// Pure decoding for validator uptime: addresses (bech32 operator and
// consensus keys), CometBFT's proposer selection, and one commit into the
// compact row uptime_blocks stores. No I/O here.
//
// Verified on Mezo mainnet (12 Nov 2026, heights 13,171,500 to 13,171,579,
// recorded in test/fixtures/uptime): stepping the set's proposer priorities
// once per height reproduced every next height's priorities exactly (79 of
// 79), and the stepped set's pick was the header's proposer on every
// round-0 block (75 of 75) and, stepped once more, on every round-1 block
// (4 of 4).

const bech32Alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
/** Amino's prefix of an ed25519 public key in a bech32 consensus key. */
const aminoEd25519Prefix = "1624de6420"

/** The bytes a bech32 string carries (checksum not verified). */
export function bech32Bytes(text: string): Uint8Array {
  const lower = text.toLowerCase()
  const separator = lower.lastIndexOf("1")
  if (separator < 1 || lower.length - separator < 8) {
    throw new Error(`Not a bech32 string: ${text}`)
  }
  const words = [...lower.slice(separator + 1, -6)].map((char) => {
    const word = bech32Alphabet.indexOf(char)
    if (word < 0) throw new Error(`Not a bech32 string: ${text}`)
    return word
  })
  const bytes: number[] = []
  let accumulator = 0
  let bits = 0
  for (const word of words) {
    accumulator = ((accumulator << 5) | word) & 0xffff
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >> bits) & 0xff)
    }
  }
  return Uint8Array.from(bytes)
}

/** `mezovaloper1...` as the 0x operator address the EVM names as miner. */
export function operatorOf(bech32: string): string {
  const bytes = bech32Bytes(bech32)
  if (bytes.length !== 20) throw new Error(`Not an operator: ${bech32}`)
  return bytesToHex(bytes).toLowerCase()
}

/** A `mezovalconspub1...` key's raw ed25519 key, as base64. */
export function consensusKeyOf(bech32: string): string {
  const bytes = bech32Bytes(bech32)
  const prefix = bytesToHex(bytes.subarray(0, 5)).slice(2)
  if (bytes.length !== 37 || prefix !== aminoEd25519Prefix) {
    throw new Error(`Not an ed25519 consensus key: ${bech32}`)
  }
  return base64Of(bytes.subarray(5))
}

export function base64Of(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function bytesOfBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}

/**
 * The consensus address a commit signature names: the first 20 bytes of
 * the SHA-256 of the ed25519 key, upper-case hex as CometBFT prints it.
 */
export function consensusAddressOf(base64Key: string): string {
  return sha256(bytesOfBase64(base64Key)).slice(2, 42).toUpperCase()
}

// -- proposer selection -------------------------------------------------------

/** One set member for proposer selection. */
export type Weighted = { address: string; power: bigint; priority: bigint }

const int64Max = 2n ** 63n - 1n
const int64Min = -(2n ** 63n)

function clip(value: bigint): bigint {
  return value > int64Max ? int64Max : value < int64Min ? int64Min : value
}

/** Go's integer division (truncates toward zero), as BigInt's. */
function goDiv(a: bigint, b: bigint): bigint {
  return a / b
}

/** big.Int Div: Euclidean, so the average rounds down for a negative sum. */
function euclidDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b
  return a % b !== 0n && a < 0n ? quotient - 1n : quotient
}

function compareBigInt(a: bigint, b: bigint): number {
  return a === b ? 0 : a < b ? -1 : 1
}

function mostPriority(set: readonly Weighted[]): Weighted {
  let best = set[0]
  if (best === undefined) throw new Error("Empty validator set")
  for (const member of set.slice(1)) {
    if (
      member.priority > best.priority ||
      (member.priority === best.priority && member.address < best.address)
    ) {
      best = member
    }
  }
  return best
}

/**
 * CometBFT 0.38's ValidatorSet.IncrementProposerPriority(times) on a copy:
 * rescale to a window of twice the total power, centre on the average,
 * then `times` steps of "everyone gains their power, the most gets the
 * total taken off". Returns the new priorities and the member picked by
 * the last step (the proposer).
 */
export function incrementPriorities(
  set: readonly Weighted[],
  times: number,
): { set: Weighted[]; proposer: string } {
  const next = set.map((member) => ({ ...member }))
  const total = next.reduce((sum, member) => sum + member.power, 0n)
  const diffMax = 2n * total
  const sorted = next.map((member) => member.priority).sort(compareBigInt)
  const diff = (sorted.at(-1) ?? 0n) - (sorted[0] ?? 0n)
  if (diffMax > 0n && diff > diffMax) {
    const ratio = goDiv(diff + diffMax - 1n, diffMax)
    for (const member of next) member.priority = goDiv(member.priority, ratio)
  }
  const average = euclidDiv(
    next.reduce((sum, member) => sum + member.priority, 0n),
    BigInt(next.length),
  )
  for (const member of next) member.priority = clip(member.priority - average)
  let proposer = ""
  for (let step = 0; step < times; step += 1) {
    for (const member of next) {
      member.priority = clip(member.priority + member.power)
    }
    const most = mostPriority(next)
    most.priority = clip(most.priority - total)
    proposer = most.address
  }
  return { set: next, proposer }
}

// -- one commit ---------------------------------------------------------------

/** A commit as read from `/commit?height=h`, already validated. */
export type Commit = {
  height: number
  /** Block time, unix seconds. */
  time: number
  round: number
  proposer: string
  validatorsHash: string
  /** In set order: 1 absent, 2 commit, 3 nil, with the signer's address. */
  signatures: { flag: number; address: string }[]
}

/** What uptime_blocks stores of one height. */
export type BlockRecord = {
  height: number
  time: number
  round: number
  setId: number
  /** Index of the header's proposer in the set; -1 when not a member. */
  proposer: number
  /**
   * Indexes of earlier rounds' proposers that did not propose this block;
   * empty for a round-0 block, null when they could not be worked out.
   */
  missed: number[] | null
  /** Bit i set when member i signed (a commit or a nil vote). */
  signed: bigint
  signers: number
  /** The set's priorities at this height, or null when not known. */
  priorities: bigint[] | null
}

export class SetMismatchError extends Error {}

export type DecodeResult = { record: BlockRecord } | { resync: true }

/**
 * Decodes one commit against the set in force at its height. `previous`
 * is the set's priorities at height - 1 (same members, same order), or
 * null; `current` is the set's priorities read at this very height, when
 * the caller re-read them (a new set, or a resync). With `previous`, the
 * round-0 proposer is the one stepping picks, checked against the header
 * on a round-0 block: a mismatch returns `resync` so the caller re-reads
 * the set at this height and decodes again with `current`.
 *
 * A nil vote counts as signed: the validator was online and voted, as
 * x/slashing counts liveness.
 */
export function decodeCommit(
  commit: Commit,
  set: { id: number; members: readonly Weighted[] },
  priorities:
    | { previous: readonly bigint[]; current: null }
    | { previous: null; current: readonly bigint[] }
    | { previous: null; current: null },
): DecodeResult {
  const members = set.members
  if (commit.signatures.length !== members.length) {
    throw new SetMismatchError(
      `Height ${commit.height}: ${commit.signatures.length} signatures for ${members.length} members`,
    )
  }
  let signed = 0n
  let signers = 0
  commit.signatures.forEach((signature, index) => {
    if (signature.flag !== 2 && signature.flag !== 3) return
    if (signature.address.toUpperCase() !== members[index]?.address) {
      throw new SetMismatchError(
        `Height ${commit.height}: signature ${index} is ${signature.address}, not ${members[index]?.address}`,
      )
    }
    signed |= 1n << BigInt(index)
    signers += 1
  })
  const indexOf = new Map(
    members.map((member, index) => [member.address, index]),
  )
  const proposer = indexOf.get(commit.proposer.toUpperCase()) ?? -1

  let atHeight: Weighted[] | null = null
  let roundZero: string | null = null
  if (priorities.previous !== null) {
    const stepped = incrementPriorities(
      members.map((member, index) => ({
        ...member,
        priority: priorities.previous[index] ?? 0n,
      })),
      1,
    )
    if (commit.round === 0 && stepped.proposer !== commit.proposer) {
      return { resync: true }
    }
    atHeight = stepped.set
    roundZero = stepped.proposer
  } else if (priorities.current !== null) {
    atHeight = members.map((member, index) => ({
      ...member,
      priority: priorities.current[index] ?? 0n,
    }))
    // Read at this height, the priorities no longer show who round 0
    // picked; a round-0 block names it in its header.
    roundZero = commit.round === 0 ? commit.proposer.toUpperCase() : null
  }

  let missed: number[] | null = commit.round === 0 ? [] : null
  if (commit.round > 0 && atHeight !== null && roundZero !== null) {
    // Each later round steps the round's set once more (enterNewRound).
    const pickers = [roundZero]
    let roundSet: Weighted[] = atHeight
    for (let round = 1; round <= commit.round; round += 1) {
      const stepped = incrementPriorities(roundSet, 1)
      roundSet = stepped.set
      pickers.push(stepped.proposer)
    }
    // The header names the round-r proposer, or an earlier proposer whose
    // block was re-proposed; anything else means the stepping is off.
    if (pickers.includes(commit.proposer.toUpperCase())) {
      missed = [
        ...new Set(
          pickers
            .slice(0, commit.round)
            .filter((address) => address !== commit.proposer.toUpperCase())
            .map((address) => indexOf.get(address) ?? -1)
            .filter((index) => index >= 0),
        ),
      ]
    }
  }
  return {
    record: {
      height: commit.height,
      time: commit.time,
      round: commit.round,
      setId: set.id,
      proposer,
      missed,
      signed,
      signers,
      priorities:
        atHeight === null ? null : atHeight.map((member) => member.priority),
    },
  }
}

/** Bit i of a stored bitmap. */
export function signedAt(bitmap: string, index: number): boolean {
  return (
    ((BigInt(`0x${bitmap === "" ? "0" : bitmap}`) >> BigInt(index)) & 1n) === 1n
  )
}
