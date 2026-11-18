import type { LatestBlock } from "./figures"

/**
 * Validator names for the latest blocks' proposers. Blockscout names no
 * proposer (`miner.name` is null on Mezo), so the edge reads the names
 * Matchscan shows from `GET /internal/scan/validators` and keeps them in
 * its snapshot (`figures.server.ts`). The map never goes to the browser:
 * blocks are named at the edge.
 */

/** Proposer address (lower case) to the name Matchscan shows for it. */
export type ValidatorNames = Readonly<Record<string, string>>

/** The edge's names and when they were last read; never read: `at` null. */
export type KnownNames = { byAddress: ValidatorNames; at: number | null }

export const noNames: KnownNames = { byAddress: {}, at: null }

/** A name longer than this is cut: the row shows a few dozen at most. */
const longestName = 80

/** What the names read needs of the `/validators` answer. */
type ValidatorsAnswer = {
  data: {
    validators: readonly {
      address: string
      name: string | null
      label: string | null
    }[]
  }
}

/**
 * The name Matchscan shows for each validator: Pro's directory name
 * (profile, else ValidatorPool moniker), else Scan's label (`rowName` in
 * `apps/scan/src/data/validators.server.ts`). A validator with neither has
 * no entry, and its blocks show its short address.
 */
export function validatorNames(answer: ValidatorsAnswer): ValidatorNames {
  const names: Record<string, string> = {}
  for (const row of answer.data.validators) {
    const name = (row.name ?? row.label ?? "").trim()
    if (name === "") continue
    names[row.address.toLowerCase()] = [...name].slice(0, longestName).join("")
  }
  return names
}

/** "0x6E35…23b5", as Blockscout writes an address, shortened. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/**
 * Each block's proposer by its validator's name where one is known; a
 * block whose proposer has none keeps what it showed (Blockscout's name,
 * else the short address), never a blank.
 */
export function nameBlocks(
  blocks: LatestBlock[] | null,
  names: ValidatorNames,
): LatestBlock[] | null {
  if (blocks === null) return null
  return blocks.map((block) => {
    const name = names[block.address.toLowerCase()]
    return name === undefined || name === block.proposer
      ? block
      : { ...block, proposer: name }
  })
}

/** Whether any of the blocks has a proposer with no known name. */
export function anyUnnamed(
  blocks: readonly LatestBlock[] | null,
  names: ValidatorNames,
): boolean {
  return (blocks ?? []).some(
    (block) => names[block.address.toLowerCase()] === undefined,
  )
}
