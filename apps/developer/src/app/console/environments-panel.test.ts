import {
  awaitingVerification as contractRule,
  type Environment,
} from "@matchbox/contracts/console"
import {
  platformScopeSchema,
  scopeDefinitions,
  scopeMayBeOptional,
} from "@matchbox/contracts/scopes"
import { describe, expect, it } from "vitest"
import { awaitingVerification } from "./environments-panel"
import { scopeRows } from "./scope-rows"

const environment = {
  kind: "live",
  verifiedAt: null,
  requestedScopes: [],
} as unknown as Environment

describe("review panel", () => {
  it("decides verification resubmission exactly like the contract", () => {
    for (const kind of ["test", "live"] as const) {
      for (const verifiedAt of [null, "2026-01-01T00:00:00.000Z"]) {
        for (const scope of platformScopeSchema.options) {
          const input = {
            ...environment,
            kind,
            verifiedAt,
            requestedScopes: [scope],
          }
          expect({
            kind,
            verifiedAt,
            scope,
            due: awaitingVerification(input),
          }).toEqual({ kind, verifiedAt, scope, due: contractRule(input) })
        }
      }
    }
  })

  it("lists every scope with the contract's claims and optional rule", () => {
    expect(scopeRows.map((row) => row.scope).sort()).toEqual(
      [...platformScopeSchema.options].sort(),
    )
    for (const row of scopeRows) {
      expect({
        scope: row.scope,
        label: row.label,
        consent: row.consent,
        claims: [...row.claims],
        optional: row.optionalAllowed,
      }).toEqual({
        scope: row.scope,
        label: scopeDefinitions[row.scope].label,
        consent: scopeDefinitions[row.scope].consentDescription,
        claims: [...scopeDefinitions[row.scope].claims],
        optional: scopeMayBeOptional(row.scope),
      })
    }
  })
})
