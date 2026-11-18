import { createLogger } from "@matchbox/logger"
import { z } from "zod"

/**
 * Where browsers post Content Security Policy violations while the policy
 * is report-only (`PRO_CSP=report-only`): each one becomes a log line, so a
 * rollback also says which source a real wallet needed. The policy names
 * this path as report-uri, so the body is `{"csp-report": {...}}`.
 * Enforced, nothing is reported here and the route only answers 204.
 */

export const cspReportPath = "/csp-report"

const log = createLogger({
  fields: { service: "matchbox-pro", area: "csp" },
})

/** Reports are small; anything bigger is not one. */
const maxBytes = 16_384

/** Longest value kept from a report field, so a page cannot flood the log. */
const maxField = 300

const field = z
  .string()
  .optional()
  .transform((value) => value?.slice(0, maxField))

const legacyReport = z.object({
  "csp-report": z.object({
    "document-uri": field,
    "effective-directive": field,
    "violated-directive": field,
    "blocked-uri": field,
    "source-file": field,
    disposition: field,
  }),
})

export type CspViolation = {
  directive: string
  blocked: string
  page: string
  source: string
  disposition: string
}

/** The page without its query or hash: where, not who or what was typed. */
function pageOf(url: string | undefined): string {
  if (url === undefined) return ""
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return ""
  }
}

/** The violations a report body holds; none when it is not a report. */
export function parseCspReport(body: unknown): CspViolation[] {
  const legacy = legacyReport.safeParse(body)
  if (!legacy.success) return []
  const report = legacy.data["csp-report"]
  return [
    {
      directive:
        report["effective-directive"] ?? report["violated-directive"] ?? "",
      blocked: report["blocked-uri"] ?? "",
      page: pageOf(report["document-uri"]),
      source: report["source-file"] ?? "",
      disposition: report.disposition ?? "",
    },
  ]
}

export async function cspReport(
  request: Request,
  reporting: boolean,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } })
  }
  if (!reporting) return new Response(null, { status: 204 })
  // Refused before reading when the size is declared; checked again after.
  const declared = Number(request.headers.get("content-length") ?? "0")
  if (declared > maxBytes) return new Response(null, { status: 413 })
  const text = await request.text()
  if (text.length > maxBytes) return new Response(null, { status: 413 })
  let body: unknown
  try {
    body = z.json().parse(JSON.parse(text))
  } catch {
    return new Response(null, { status: 400 })
  }
  for (const violation of parseCspReport(body)) {
    log.warn({ message: "CSP violation", ...violation })
  }
  return new Response(null, { status: 204 })
}
