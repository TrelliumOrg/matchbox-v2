import {
  defaultErrorMessages,
  errorCodeSchema,
  errorStatusByCode,
  oauthErrorCodeSchema,
  oauthErrorStatusByCode,
} from "@matchbox/contracts/errors"
import {
  gaugeProfileListDefaultLimit,
  gaugeProfileListMaxLimit,
} from "@matchbox/contracts/gauge-profiles"
import {
  gaugeEpochsDefaultLimit,
  gaugeEpochsMaxLimit,
} from "@matchbox/contracts/market"
import {
  chainIdByNetwork,
  environmentKindSchema,
  networkByEnvironmentKind,
  networkNames,
} from "@matchbox/contracts/network"
import {
  matchboxIdIssuer,
  oidcEndpointPaths,
  oidcLifetimes,
} from "@matchbox/contracts/oidc"
import {
  endpointClassSchema,
  publishableIpRateLimitPolicy,
  rateLimitHeaderNames,
  rateLimitPolicies,
} from "@matchbox/contracts/rate-limits"
import {
  claimLabels,
  platformScopeSchema,
  scopeDefinitions,
} from "@matchbox/contracts/scopes"
import type { DocNode } from "../render-types"
import { readMcpTools, toolsIndexRows } from "./mcp-tools"

/**
 * Leaf directives that render tables from @matchbox/contracts, as Classic's
 * console guides did, so a changed limit, scope or error code changes the
 * page with no copy edit. `::errors-table` keeps an anchor per code: every
 * API error body's docsUrl points at one.
 */

const integer = new Intl.NumberFormat("en-US")

function code(text: string): DocNode {
  return { t: "code", c: [text] }
}

function table(
  head: readonly string[],
  rows: readonly (readonly DocNode[])[],
  options: {
    rowIds?: readonly string[]
    align?: readonly ("left" | "right")[]
  } = {},
): DocNode {
  const cell = (tag: "th" | "td", content: DocNode, index: number): DocNode => {
    const align = options.align?.[index]
    return align === "right"
      ? { t: tag, p: { align }, c: [content] }
      : { t: tag, c: [content] }
  }
  return {
    t: "table",
    c: [
      {
        t: "thead",
        c: [{ t: "tr", c: head.map((text, index) => cell("th", text, index)) }],
      },
      {
        t: "tbody",
        c: rows.map((row, rowIndex) => {
          const id = options.rowIds?.[rowIndex]
          const cells = row.map((content, index) => cell("td", content, index))
          return id === undefined
            ? { t: "tr", c: cells }
            : { t: "tr", p: { id }, c: cells }
        }),
      },
    ],
  }
}

function duration(seconds: number): string {
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400
    return `${days} ${days === 1 ? "day" : "days"}`
  }
  if (seconds % 60 === 0 && seconds >= 120) return `${seconds / 60} min`
  return `${seconds} s`
}

const lifetimeLabels: Record<keyof typeof oidcLifetimes, string> = {
  authorizationRequest: "Authorization request",
  authorizationCode: "Authorization code",
  accessToken: "Access token",
  idToken: "ID token",
  refreshToken: "Refresh token, rotates on use",
  siweNonce: "Sign-in message nonce",
  session: "Matchbox ID session",
}

export const contractTables: Readonly<Record<string, () => DocNode[]>> = {
  "errors-table": () => {
    const codes = errorCodeSchema.options
    return [
      table(
        ["Code", "Status", "Message"],
        codes.map((name) => [
          code(name),
          String(errorStatusByCode[name]),
          defaultErrorMessages[name],
        ]),
        { rowIds: codes, align: ["left", "right", "left"] },
      ),
    ]
  },
  "oauth-errors-table": () => {
    const codes = oauthErrorCodeSchema.options
    return [
      table(
        ["Code", "Status"],
        codes.map((name) => [code(name), String(oauthErrorStatusByCode[name])]),
        { align: ["left", "right"] },
      ),
    ]
  },
  "rate-limits-table": () => [
    table(
      [
        "Endpoint class",
        "Test per min",
        "Test per day",
        "Live per min",
        "Live per day",
      ],
      endpointClassSchema.options.map((name) => [
        code(name),
        integer.format(rateLimitPolicies.test[name].perMinute),
        integer.format(rateLimitPolicies.test[name].perDay),
        integer.format(rateLimitPolicies.live[name].perMinute),
        integer.format(rateLimitPolicies.live[name].perDay),
      ]),
      { align: ["left", "right", "right", "right", "right"] },
    ),
  ],
  "rate-limit-headers-table": () => [
    table(
      ["Header", "Meaning"],
      [
        [
          code(rateLimitHeaderNames.limit),
          "Requests allowed in the current window",
        ],
        [
          code(rateLimitHeaderNames.remaining),
          "Requests left in the current window",
        ],
        [code(rateLimitHeaderNames.reset), "Seconds until the window resets"],
        [code(rateLimitHeaderNames.retryAfter), "On a 429, seconds to wait"],
      ],
    ),
  ],
  "publishable-ip-limit": () => [
    {
      t: "p",
      c: [
        "Publishable keys also have a limit per key and client IP of ",
        `${integer.format(publishableIpRateLimitPolicy.perMinute)} a minute and ${integer.format(publishableIpRateLimitPolicy.perDay)} a day.`,
      ],
    },
  ],
  "environments-table": () => [
    table(
      ["Environment", "Network", "Slug", "Chain ID", "Redirect URIs"],
      environmentKindSchema.options.map((kind) => {
        const network = networkByEnvironmentKind[kind]
        return [
          code(kind),
          networkNames[network],
          code(network),
          String(chainIdByNetwork[network]),
          kind === "test" ? "https, http://localhost" : "https only",
        ]
      }),
      { align: ["left", "left", "left", "right", "left"] },
    ),
  ],
  "scopes-table": () => {
    const scopes = platformScopeSchema.options.filter(
      (scope) => scopeDefinitions[scope].kind === "oidc",
    )
    return [
      table(
        ["Scope", "Consent text", "Claims", "Review"],
        scopes.map((scope) => {
          const definition = scopeDefinitions[scope]
          const claims: DocNode[] = []
          definition.claims.forEach((claim, index) => {
            if (index > 0) claims.push(", ")
            claims.push(code(claim))
          })
          return [
            code(scope),
            definition.consentDescription,
            { t: "strong", c: claims },
            definition.requiresReview ? "Required" : "No",
          ]
        }),
      ),
    ]
  },
  "claims-table": () => [
    table(
      ["Claim", "Label"],
      Object.entries(claimLabels).map(([claim, labelText]) => [
        code(claim),
        labelText,
      ]),
    ),
  ],
  "oidc-lifetimes-table": () => [
    table(
      ["Token", "Lasts"],
      Object.entries(oidcLifetimes).map(([name, seconds]) => [
        lifetimeLabels[name as keyof typeof oidcLifetimes],
        duration(seconds),
      ]),
    ),
  ],
  "oidc-endpoints-table": () => [
    table(
      ["Endpoint", "URL"],
      [
        [
          "Discovery",
          code(`${matchboxIdIssuer}${oidcEndpointPaths.discovery}`),
        ],
        [
          "Authorize",
          code(`${matchboxIdIssuer}${oidcEndpointPaths.authorization}`),
        ],
        ["Token", code(`${matchboxIdIssuer}${oidcEndpointPaths.token}`)],
        ["User info", code(`${matchboxIdIssuer}${oidcEndpointPaths.userinfo}`)],
        [
          "Signing keys (JWKS)",
          code(`${matchboxIdIssuer}${oidcEndpointPaths.jwks}`),
        ],
        ["Revoke", code(`${matchboxIdIssuer}${oidcEndpointPaths.revocation}`)],
      ],
    ),
  ],
  "gauge-epochs-limit": () => [
    {
      t: "p",
      c: [
        "Gauge epoch history is newest first. ",
        code("limit"),
        ` is 1 to ${gaugeEpochsMaxLimit}, default ${gaugeEpochsDefaultLimit}.`,
      ],
    },
  ],
  "gauge-profiles-limit": () => [
    {
      t: "p",
      c: [
        "Cursors are opaque. ",
        code("limit"),
        ` is 1 to ${gaugeProfileListMaxLimit}, default ${gaugeProfileListDefaultLimit}.`,
      ],
    },
  ],
  "mcp-tools": () => toolsIndexRows(readMcpTools()),
}
