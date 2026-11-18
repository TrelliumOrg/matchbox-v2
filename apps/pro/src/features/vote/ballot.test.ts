import { projectAllocation } from "@matchbox/domain"
import { describe, expect, it } from "vitest"
import { gaugesSample, voterSample } from "../samples"
import {
  allocated,
  ballotFromLock,
  ballotGauges,
  microToUsd,
  pick,
  project,
  replacesLine,
  setShare,
  signable,
  splitEvenly,
  standingVotes,
  unpick,
  usdToMicro,
  votesIn,
} from "./ballot"
import { optimize } from "./optimize"

const gauges = gaugesSample.gauges
const lock = voterSample.lock
function named(name: string): string {
  const gauge = gauges.find((entry) => entry.name === name)
  if (gauge === undefined) throw new Error(`no gauge ${name}`)
  return gauge.address
}
const gaugeRefs = {
  kiln: { address: named("Kiln Labs") },
  b604: { address: named("veBTC #604") },
  sats: { address: named("Sats Collective") },
  tinder: { address: named("Tinder Fund") },
  northgate: { address: named("Northgate Capital") },
}
const power = BigInt(lock?.votingPowerWei ?? "0")
const id = (address: string): string => address.toLowerCase()

describe("ballot editing", () => {
  it("starts from the lock's votes", () => {
    const ballot = ballotFromLock(lock, "vebtc")
    expect([...ballot.values()]).toEqual([7000, 3000])
    expect(allocated(ballot)).toBe(10_000)
  })

  it("gives each gauge type its own 100%: the voters do not share one", () => {
    // Zho's lock #224, 12 Nov 2026: 1,702,812 veMEZO on a veBTC gauge
    // (BoostVoter) and 1,451,855 on a MEZO gauge (ThirdPartyVoter). The
    // read model's shares are of both together, 53.98% and 46.02%.
    if (lock === null) throw new Error("no sample lock")
    const snf = "0x00000000000000000000000000000000000000a1"
    const aerodrome = "0x00000000000000000000000000000000000000a2"
    const curve = "0x00000000000000000000000000000000000000a3"
    const [template] = lock.votes
    if (template === undefined) throw new Error("no sample vote")
    const vote = (
      address: string,
      voter: "boost" | "third-party",
      weight: string,
      shareBps: number,
    ) => ({
      gauge: { ...template.gauge, address, voter },
      weight,
      shareBps,
    })
    const both = {
      ...lock,
      votes: [
        vote(snf, "boost", "1702812000000000000000000", 5398),
        vote(aerodrome, "third-party", "1088891000000000000000000", 3452),
        vote(curve, "third-party", "362964000000000000000000", 1150),
      ],
    }
    expect([...ballotFromLock(both, "vebtc")]).toEqual([[snf, 10_000]])
    const cross = ballotFromLock(both, "mezo")
    expect([...cross]).toEqual([
      [aerodrome, 7_500],
      [curve, 2_500],
    ])
    expect(allocated(cross)).toBe(10_000)
    expect(votesIn(both, "vebtc")).toBe(true)
    expect(votesIn(both, "mezo")).toBe(true)
    expect(votesIn({ ...both, votes: both.votes.slice(0, 1) }, "mezo")).toBe(
      false,
    )
    expect(ballotFromLock(both, "pool").size).toBe(0)
  })

  it("gives a new pick what is left, else splits evenly in 5% steps", () => {
    const freed = unpick(ballotFromLock(lock, "vebtc"), gaugeRefs.b604.address)
    expect(allocated(freed)).toBe(7000)
    const picked = pick(freed, gaugeRefs.sats.address)
    expect(picked.get(id(gaugeRefs.sats.address))).toBe(3000)
    const full = pick(picked, gaugeRefs.tinder.address)
    expect(allocated(full)).toBe(10_000)
    expect([...full.values()].every((share) => share % 500 === 0)).toBe(true)
  })

  it("lets a typed share go past 100% but not sign until it fits", () => {
    const ballot = setShare(
      ballotFromLock(lock, "vebtc"),
      gaugeRefs.kiln.address,
      9000,
    )
    expect(ballot.get(id(gaugeRefs.kiln.address))).toBe(9000)
    expect(allocated(ballot)).toBe(12_000)
    expect(signable(ballot)).toBe(false)
    expect(signable(setShare(ballot, gaugeRefs.kiln.address, 7000))).toBe(true)
    expect(allocated(splitEvenly(ballot))).toBe(10_000)
  })

  it("keeps each share between 0 and 100%, rounding typed tenths", () => {
    const ballot = ballotFromLock(lock, "vebtc")
    expect(
      setShare(ballot, gaugeRefs.kiln.address, 12_000).get(
        id(gaugeRefs.kiln.address),
      ),
    ).toBe(10_000)
    expect(
      setShare(ballot, gaugeRefs.kiln.address, -5).get(
        id(gaugeRefs.kiln.address),
      ),
    ).toBe(0)
    expect(
      setShare(ballot, gaugeRefs.kiln.address, 1250.4).get(
        id(gaugeRefs.kiln.address),
      ),
    ).toBe(1250)
    expect(signable(new Map())).toBe(false)
  })
})

describe("projection", () => {
  it("matches the frames: $5.80 on Kiln, $2.95 on #604, $8.75 in all", () => {
    const projection = project(
      ballotGauges(gauges, lock),
      power,
      ballotFromLock(lock, "vebtc"),
    )
    expect(microToUsd(projection.total)).toBe("8.75")
    expect(
      microToUsd(projection.perGauge.get(id(gaugeRefs.kiln.address)) ?? 0n),
    ).toBe("5.80")
    expect(
      microToUsd(projection.perGauge.get(id(gaugeRefs.b604.address)) ?? 0n),
    ).toBe("2.95")
  })

  it("agrees with @matchbox/domain to the micro-dollar", () => {
    const targets = ballotGauges(gauges, lock)
    const ballot = splitEvenly(
      pick(
        pick(ballotFromLock(lock, "vebtc"), gaugeRefs.sats.address),
        gaugeRefs.northgate.address,
      ),
    )
    const ours = project(targets, power, ballot)
    const theirs = projectAllocation({
      gauges: targets.map((target) => ({
        id: target.id,
        existingWeight: target.competing,
        incentiveValueMicroUsd: target.incentivesMicro,
      })),
      votingPowers: [power],
      bps: new Map([...ballot].map(([key, share]) => [key, BigInt(share)])),
    })
    expect(ours.total).toBe(theirs.total)
  })

  it("Optimize never projects less than the current ballot", () => {
    const targets = ballotGauges(gauges, lock)
    const best = optimize(targets, power)
    expect(best).not.toBeNull()
    if (best === null) return
    expect(allocated(best)).toBe(10_000)
    expect(project(targets, power, best).total).toBeGreaterThanOrEqual(
      project(targets, power, ballotFromLock(lock, "vebtc")).total,
    )
  })

  it("converts dollars exactly", () => {
    expect(usdToMicro("1180.00")).toBe(1_180_000_000n)
    expect(usdToMicro("0.0000019")).toBe(1n)
    expect(microToUsd(8_745_000n)).toBe("8.75")
  })
})

describe("what a new vote replaces", () => {
  const vote = (name: string, voter: string, weight: bigint) => ({
    gauge: { address: `0x${name}`, voter, name },
    weight: `${weight}`,
    shareBps: 0,
  })
  const lock = (...votes: ReturnType<typeof vote>[]) =>
    ({ votes }) as unknown as Parameters<typeof standingVotes>[0]

  it("lists the type's gauges the locks vote on, largest first", () => {
    const locks = [
      lock(vote("Kiln", "boost", 30n), vote("Lido", "third-party", 99n)),
      lock(vote("Sats", "boost", 50n), vote("Kiln", "boost", 30n)),
    ] as unknown as Parameters<typeof standingVotes>[0]
    expect(standingVotes(locks, "vebtc")).toEqual(["Kiln", "Sats"])
    // The other type's voter is its own vote: not replaced by this one.
    expect(standingVotes(locks, "mezo")).toEqual(["Lido"])
    expect(standingVotes(locks, "pool")).toEqual([])
  })

  it("leaves out a vote of no weight", () => {
    expect(standingVotes(lock(vote("Kiln", "boost", 0n)), "vebtc")).toEqual([])
  })

  it("names one or two gauges and counts the rest", () => {
    expect(replacesLine([])).toBeNull()
    expect(replacesLine(["Kiln Labs"])).toBe("Kiln Labs")
    expect(replacesLine(["Kiln Labs", "veBTC #604"])).toBe(
      "Kiln Labs, veBTC #604",
    )
    expect(replacesLine(["Kiln Labs", "veBTC #604", "Sats"])).toBe(
      "Kiln Labs and 2 more",
    )
  })
})
