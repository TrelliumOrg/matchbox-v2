import { liveSnapshot } from "./borrow"
import { type FixtureRoute, fixtureNow, ok } from "./shared"

/**
 * `/status`: how complete and current Scan's data is. The `delayed`
 * scenario has the copy step halt two tables and the live Borrow snapshot
 * fall behind, as the shell's two "delayed" notes show.
 */

export const statusFixtures: FixtureRoute[] = [
  {
    pattern: /^status$/,
    answer: (_match, _query, scenario) => {
      const halted = scenario === "delayed"
      return ok({
        data: {
          source: "status",
          asOf: fixtureNow - 300,
          lastRunStatus: halted ? "failed" : "ok",
          lastRunAt: fixtureNow - 60,
          consecutiveFailures: halted ? 3 : 0,
          copiedThrough: fixtureNow - 300,
          dirtyEpochs: 0,
          dirtyDays: 0,
          aggregatesComplete: true,
          historyFilled: true,
          refillRequired: false,
          quarantinedRows: 0,
          halted,
          haltedTables: halted ? ["lock_votes", "activity"] : [],
          stale: halted,
          liveSnapshot: liveSnapshot(scenario),
        },
      })
    },
  },
]
