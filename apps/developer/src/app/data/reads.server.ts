import {
  type AdminReview,
  type AdminReviewContextResponse,
  type AdminReviewStatsResponse,
  type ApiKeyRecord,
  type App,
  adminAppListResponseSchema,
  adminReviewContextResponseSchema,
  adminReviewListResponseSchema,
  adminReviewLogoResponseSchema,
  adminReviewSchema,
  adminReviewStatsResponseSchema,
  apiKeyListResponseSchema,
  appListResponseSchema,
  appSchema,
  auditSearchResponseSchema,
  type ClientSecretRecord,
  clientSecretListResponseSchema,
  consoleSessionListResponseSchema,
  type DeveloperReview,
  type Environment,
  environmentReviewListResponseSchema,
  environmentSchema,
  type Invitation,
  invitationListResponseSchema,
  type Member,
  type MeResponse,
  memberListResponseSchema,
  meResponseSchema,
  type OAuthStatsResponse,
  type OrgReview,
  type OrgUsageResponse,
  oauthStatsResponseSchema,
  orgReviewListResponseSchema,
  orgUsageResponseSchema,
  quotaOverrideListResponseSchema,
  requestLogResponseSchema,
  type UsageResponse,
  usageResponseSchema,
} from "@matchbox/contracts/console"
import {
  type AuthorizationRequestDetail,
  authorizationRequestDetailSchema,
} from "@matchbox/contracts/identity"
import {
  type PlatformHealthResponse,
  platformHealthResponseSchema,
} from "@matchbox/contracts/platform-health"
import {
  type EnvironmentQuotaStatus,
  environmentQuotaListResponseSchema,
  environmentQuotaStatusSchema,
} from "@matchbox/contracts/rate-limits"
import { getRequest } from "@tanstack/react-start/server"
import type { z } from "zod"
import { ApiError, apiRequest, type FetchLike } from "../lib/api-client"
import { idSegment } from "./ids"
import { readInternal } from "./internal.server"

/**
 * Server-side reads of the console server's GET routes, through the same
 * typed client the browser uses, sent in-process (internal.server.ts). A
 * 401 means signed out; anything else unexpected throws.
 */

const transport: FetchLike = (input) => readInternal(input)

function read<Schema extends z.ZodType>(
  schema: Schema,
  path: string,
  query?: Record<string, string>,
): Promise<z.output<Schema>> {
  return apiRequest(schema, path, {
    transport,
    ...(query === undefined ? {} : { query }),
  })
}

const enc = idSegment

/** The signed-in developer, or null. */
export async function readMe(): Promise<MeResponse | null> {
  // Touch the request so a read outside a page fails loudly.
  getRequest()
  try {
    return await read(meResponseSchema, "/api/me")
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export function readOrgApps(orgId: string): Promise<App[]> {
  return read(appListResponseSchema, `/api/orgs/${enc(orgId)}/apps`).then(
    (list) => list.data,
  )
}

export function readApp(appId: string): Promise<App> {
  return read(appSchema, `/api/apps/${enc(appId)}`)
}

/** Seven days of requests, all apps, by day. */
export type UsageRange = "24h" | "7d" | "30d"

const rangeDays: Record<UsageRange, number> = { "24h": 1, "7d": 7, "30d": 30 }

export type UsageEnvironments = "both" | "test" | "live"

export async function readOrgUsage(
  orgId: string,
  now: Date,
  range: UsageRange = "7d",
  environmentKind: UsageEnvironments = "both",
): Promise<OrgUsageResponse | null> {
  const to = new Date(now)
  to.setUTCMinutes(0, 0, 0)
  to.setUTCHours(to.getUTCHours() + 1)
  const from = new Date(to.getTime() - rangeDays[range] * 24 * 60 * 60_000)
  try {
    return await read(orgUsageResponseSchema, `/api/orgs/${enc(orgId)}/usage`, {
      from: from.toISOString(),
      to: to.toISOString(),
      bucket: range === "24h" ? "hour" : "day",
      environmentKind,
    })
  } catch (error) {
    // Usage needs Analytics Engine; the page still renders without it.
    if (error instanceof ApiError && error.status === 503) return null
    throw error
  }
}

/** API, ID and chain-sync health; null when the probes cannot be read. */
export async function readPlatformHealth(): Promise<PlatformHealthResponse | null> {
  try {
    return await read(platformHealthResponseSchema, "/api/platform/health")
  } catch (error) {
    if (error instanceof ApiError && error.status >= 500) return null
    throw error
  }
}

/** The organization's latest reviews; null when the role may not see them. */
export async function readOrgReviews(
  orgId: string,
): Promise<OrgReview[] | null> {
  try {
    const list = await read(
      orgReviewListResponseSchema,
      `/api/orgs/${enc(orgId)}/reviews`,
      { limit: "6" },
    )
    return list.data
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return null
    throw error
  }
}

/** One environment's usage over a range; null without analytics. */
export async function readEnvironmentUsage(
  environmentId: string,
  now: Date,
  range: UsageRange,
): Promise<UsageResponse | null> {
  const to = new Date(now)
  to.setUTCMinutes(0, 0, 0)
  to.setUTCHours(to.getUTCHours() + 1)
  const from = new Date(to.getTime() - rangeDays[range] * 24 * 60 * 60_000)
  try {
    return await read(
      usageResponseSchema,
      `/api/environments/${enc(environmentId)}/usage`,
      {
        from: from.toISOString(),
        to: to.toISOString(),
        bucket: range === "24h" ? "hour" : "day",
      },
    )
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) return null
    throw error
  }
}

/** One environment's quota today; null when the counters are unavailable. */
export async function readEnvironmentQuota(
  environmentId: string,
): Promise<EnvironmentQuotaStatus | null> {
  try {
    return await read(
      environmentQuotaStatusSchema,
      `/api/environments/${enc(environmentId)}/quota`,
    )
  } catch (error) {
    if (error instanceof ApiError && error.status >= 500) return null
    throw error
  }
}

/** Today's quota per environment; null when the counters are unavailable. */
export async function readOrgQuotas(
  orgId: string,
  environmentKind: UsageEnvironments,
): Promise<EnvironmentQuotaStatus[] | null> {
  try {
    const list = await read(
      environmentQuotaListResponseSchema,
      `/api/orgs/${enc(orgId)}/quotas`,
      { environmentKind },
    )
    return list.data
  } catch (error) {
    if (error instanceof ApiError && error.status >= 500) return null
    throw error
  }
}

export function readApiKeys(environmentId: string): Promise<ApiKeyRecord[]> {
  return read(
    apiKeyListResponseSchema,
    `/api/environments/${enc(environmentId)}/api-keys`,
  ).then((list) => list.data)
}

export function readClientSecrets(
  environmentId: string,
): Promise<ClientSecretRecord[]> {
  return read(
    clientSecretListResponseSchema,
    `/api/environments/${enc(environmentId)}/client-secrets`,
  ).then((list) => list.data)
}

/** What people see on the consent screen; null when it cannot be shown. */
export async function readConsentPreview(
  environmentId: string,
): Promise<AuthorizationRequestDetail | null> {
  try {
    return await read(
      authorizationRequestDetailSchema,
      `/api/environments/${enc(environmentId)}/consent-preview`,
    )
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return null
    throw error
  }
}

/** Grants over the last 30 days; null without the data. */
export async function readOAuthStats(
  environmentId: string,
  now: Date,
): Promise<OAuthStatsResponse | null> {
  const to = new Date(now)
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60_000)
  try {
    return await read(
      oauthStatsResponseSchema,
      `/api/environments/${enc(environmentId)}/oauth`,
      { from: from.toISOString(), to: to.toISOString() },
    )
  } catch (error) {
    if (error instanceof ApiError && error.status >= 500) return null
    throw error
  }
}

/** Every review of an environment, newest first. */
export function readEnvironmentReviews(
  environmentId: string,
): Promise<DeveloperReview[]> {
  return read(
    environmentReviewListResponseSchema,
    `/api/environments/${enc(environmentId)}/reviews`,
  ).then((list) => list.data)
}

export function readEnvironment(environmentId: string): Promise<Environment> {
  return read(environmentSchema, `/api/environments/${enc(environmentId)}`)
}

export function readMembers(orgId: string): Promise<Member[]> {
  return read(memberListResponseSchema, `/api/orgs/${enc(orgId)}/members`).then(
    (list) => list.data,
  )
}

/** Null when the viewer may not see invitations (403 for developers). */
export async function readInvitations(
  orgId: string,
): Promise<Invitation[] | null> {
  try {
    const list = await read(
      invitationListResponseSchema,
      `/api/orgs/${enc(orgId)}/invitations`,
    )
    return list.data
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return null
    throw error
  }
}

export type ConsoleSession = z.output<
  typeof consoleSessionListResponseSchema
>["data"][number]

export function readMySessions(): Promise<ConsoleSession[]> {
  return read(consoleSessionListResponseSchema, "/api/me/sessions").then(
    (list) => list.data,
  )
}

export type ReviewLogo = z.output<typeof adminReviewLogoResponseSchema>

/** Open reviews for staff (the server answers 403 to everyone else). */
export type AdminReviewState =
  | "open"
  | "approved"
  | "changes-requested"
  | "rejected"
  | "withdrawn"

export function readAdminReviews(
  state: AdminReviewState = "open",
): Promise<AdminReview[]> {
  return read(adminReviewListResponseSchema, "/api/admin/reviews", {
    state,
    limit: "50",
  }).then((list) => list.data)
}

/** Open count, oldest, decisions over seven days and the median wait. */
export function readAdminReviewStats(): Promise<AdminReviewStatsResponse> {
  return read(adminReviewStatsResponseSchema, "/api/admin/reviews/stats")
}

/** A review and the logo pinned when it was submitted. */
export async function readAdminReview(reviewId: string): Promise<{
  review: AdminReview
  logo: ReviewLogo
  context: AdminReviewContextResponse | null
}> {
  const id = enc(reviewId)
  const [review, logo, context] = await Promise.all([
    read(adminReviewSchema, `/api/admin/reviews/${id}`),
    read(adminReviewLogoResponseSchema, `/api/admin/reviews/${id}/logo`),
    // Classic's context panel; the decision never depends on it.
    read(
      adminReviewContextResponseSchema,
      `/api/admin/reviews/${id}/context`,
    ).catch(() => null),
  ])
  return { review, logo, context }
}

export type RequestLogEntry = z.output<
  typeof requestLogResponseSchema
>["data"][number]

/** The environment's latest requests over a range; null without analytics. */
export async function readRequestLog(
  environmentId: string,
  now: Date,
  range: UsageRange,
): Promise<{ from: string; to: string; data: RequestLogEntry[] } | null> {
  const to = new Date(now)
  to.setUTCMinutes(0, 0, 0)
  to.setUTCHours(to.getUTCHours() + 1)
  const from = new Date(to.getTime() - rangeDays[range] * 24 * 60 * 60_000)
  try {
    const log = await read(
      requestLogResponseSchema,
      `/api/environments/${enc(environmentId)}/requests`,
      { from: from.toISOString(), to: to.toISOString(), limit: "100" },
    )
    return { from: from.toISOString(), to: to.toISOString(), data: log.data }
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) return null
    throw error
  }
}

export type AdminApp = z.output<
  typeof adminAppListResponseSchema
>["data"][number]
type AuditRow = z.output<typeof auditSearchResponseSchema>["data"][number]

/** An audit event with its metadata flattened to text, for the page. */
export type AuditEvent = Omit<AuditRow, "metadata"> & {
  metadata: Record<string, string>
}

function auditView(row: AuditRow): AuditEvent {
  const metadata: Record<string, string> = {}
  for (const [key, value] of Object.entries(row.metadata ?? {})) {
    metadata[key] = typeof value === "string" ? value : JSON.stringify(value)
  }
  return { ...row, metadata }
}
export type QuotaOverride = z.output<
  typeof quotaOverrideListResponseSchema
>["data"][number]

/** Staff: apps by name or slug (the server answers 403 to everyone else). */
export function readAdminApps(query: string): Promise<AdminApp[]> {
  return read(adminAppListResponseSchema, "/api/admin/apps", {
    ...(query.trim() === "" ? {} : { query: query.trim().slice(0, 120) }),
    limit: "50",
  }).then((list) => list.data)
}

/** Staff: an environment's quota overrides. */
export function readQuotaOverrides(
  environmentId: string,
): Promise<QuotaOverride[]> {
  return read(
    quotaOverrideListResponseSchema,
    `/api/admin/environments/${enc(environmentId)}/quota-overrides`,
  ).then((list) => list.data)
}

/** Staff: the platform audit log, optionally for one organization or app. */
export function readAudit(filters: {
  organizationId?: string
  appId?: string
}): Promise<AuditEvent[]> {
  const query: Record<string, string> = { limit: "100" }
  if (filters.organizationId !== undefined) {
    query.organizationId = enc(filters.organizationId)
  }
  if (filters.appId !== undefined) query.appId = enc(filters.appId)
  return read(auditSearchResponseSchema, "/api/admin/audit", query).then(
    (list) => list.data.map(auditView),
  )
}

/** An organization's own recent activity (owners and admins). */
export async function readOrgAudit(
  orgId: string,
): Promise<AuditEvent[] | null> {
  try {
    const list = await read(
      auditSearchResponseSchema,
      `/api/orgs/${enc(orgId)}/audit`,
      { limit: "8" },
    )
    return list.data.map(auditView)
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return null
    throw error
  }
}
