import { describe, expect, it } from "vitest"
import { SNF_RESOLVABLE_PICKED } from "../../bench/cases"
import { BENCH_NOW, BENCH_WALLET, benchProviders } from "../../bench/world"
import { IdScope } from "./outcome"
import { resolveEntityTool } from "./tools/entity"
import { prepareVoteScriptTool } from "./tools/voteScript"

// Template answers read as plain English: a count agrees with its noun, and
// a ballot's remaining lines are named as gauges.

function context(query: string) {
  return {
    providers: benchProviders(),
    wallet: {
      address: BENCH_WALLET,
      mode: "connected" as const,
      label: "Connected wallet",
    },
    query,
    choice: null,
    now: () => BENCH_NOW,
    secret: "test-secret-test-secret-test-secret-00",
    scope: new IdScope("c1"),
  }
}

describe("template copy", () => {
  it("says 1 match, not 1 matches", async () => {
    const one = await resolveEntityTool.execute(context("find sMUSD"), {
      text: "sMUSD",
      kinds: ["pool"],
    })
    if ("invalid" in one) throw new Error(one.invalid)
    expect(one.answer.text).toBe("1 match.")
    const many = await resolveEntityTool.execute(context("find BTC/MUSD"), {
      text: "BTC/MUSD",
      kinds: ["pool"],
    })
    if ("invalid" in many) throw new Error(many.invalid)
    expect(many.answer.text).toMatch(/^\d+ matches\.$/)
  })

  it("names the ballot lines past the first three as gauges", async () => {
    const outcome = await prepareVoteScriptTool.execute(
      context(SNF_RESOLVABLE_PICKED),
      { script: SNF_RESOLVABLE_PICKED },
    )
    if ("invalid" in outcome) throw new Error(outcome.invalid)
    expect(outcome.answer.text).toMatch(/ and 5 more gauges on veBTC #\d+\.$/)
  })
})
