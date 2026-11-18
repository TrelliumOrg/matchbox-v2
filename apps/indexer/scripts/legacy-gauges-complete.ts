import type { Address } from "viem"

// Whether the GaugeCreated logs recorded by record-legacy-gauges.ts are all
// of them, judged independently of eth_getLogs: each voter pushes one entry
// per createGauge (the call that emits GaugeCreated) and length() counts
// them, so at the last block read it must equal the logs found for that
// voter, and the voter must have no code before the first block read.
// Returns what does not add up; empty when complete.
export function enumerationProblems(input: {
  voters: Record<string, Address>
  deployBlocks: Record<string, bigint>
  lengths: Record<string, bigint>
  fromBlock: bigint
  toBlock: bigint
  logs: ReadonlyArray<{ address: string }>
}): string[] {
  const problems: string[] = []
  for (const [name, address] of Object.entries(input.voters)) {
    const deployBlock = input.deployBlocks[name]
    if (deployBlock === undefined || deployBlock < input.fromBlock) {
      problems.push(
        `${name} has code from block ${deployBlock ?? "unknown"}, before the first block read (${input.fromBlock})`,
      )
    }
    const length = input.lengths[name]
    const recorded = input.logs.filter(
      (log) => log.address.toLowerCase() === address.toLowerCase(),
    ).length
    if (length === undefined) {
      problems.push(`${name}.length() was not read`)
    } else if (length !== BigInt(recorded)) {
      problems.push(
        `${name}.length() is ${length} at block ${input.toBlock}, but ${recorded} GaugeCreated logs were recorded`,
      )
    }
  }
  return problems
}
