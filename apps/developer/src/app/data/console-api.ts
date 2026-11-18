import type {
  AdminReview,
  AdminReviewContextResponse,
  AdminReviewStatsResponse,
  ApiKeyRecord,
  App,
  ClientSecretRecord,
  DeveloperReview,
  Environment,
  Invitation,
  Member,
  MeResponse,
  OAuthStatsResponse,
  OrgReview,
  OrgUsageResponse,
  UsageResponse,
} from "@matchbox/contracts/console"
import type { AuthorizationRequestDetail } from "@matchbox/contracts/identity"
import type { PlatformHealthResponse } from "@matchbox/contracts/platform-health"
import type { EnvironmentQuotaStatus } from "@matchbox/contracts/rate-limits"
import { createServerFn } from "@tanstack/react-start"
import type {
  AdminApp,
  AdminReviewState,
  AuditEvent,
  ConsoleSession,
  QuotaOverride,
  RequestLogEntry,
  ReviewLogo,
  UsageEnvironments,
  UsageRange,
} from "./reads.server"
import {
  readAdminApps,
  readAdminReview,
  readAdminReviewStats,
  readAdminReviews,
  readApiKeys,
  readApp,
  readAudit,
  readClientSecrets,
  readConsentPreview,
  readEnvironment,
  readEnvironmentQuota,
  readEnvironmentReviews,
  readEnvironmentUsage,
  readInvitations,
  readMe,
  readMembers,
  readMySessions,
  readOAuthStats,
  readOrgApps,
  readOrgAudit,
  readOrgQuotas,
  readOrgReviews,
  readOrgUsage,
  readPlatformHealth,
  readQuotaOverrides,
  readRequestLog,
} from "./reads.server"
import { inputs, serve } from "./serve.server"

/**
 * Server functions behind the route loaders: the console server's GET
 * routes read in-process, so pages render with their data and zod stays on
 * the server. Validators are type-only identities.
 */

type OrgInput = { orgId: string }
type AppInput = { appId: string }

function orgInput(input: OrgInput): OrgInput {
  return input
}

function appInput(input: AppInput): AppInput {
  return input
}

export const getMe = createServerFn({ method: "GET" }).handler(
  async function getMeHandler(): Promise<MeResponse | null> {
    return readMe()
  },
)

export const getOverview = createServerFn({ method: "GET" })
  .validator(orgInput)
  .handler(async function getOverviewHandler({ data }): Promise<{
    apps: App[]
    usage: OrgUsageResponse | null
    health: PlatformHealthResponse | null
    reviews: OrgReview[] | null
  }> {
    return serve(inputs.org, data, async (input) => {
      const [apps, usage, health, reviews] = await Promise.all([
        readOrgApps(input.orgId),
        readOrgUsage(input.orgId, new Date()),
        readPlatformHealth(),
        readOrgReviews(input.orgId),
      ])
      return { apps, usage, health, reviews }
    })
  })

export const getApps = createServerFn({ method: "GET" })
  .validator(orgInput)
  .handler(async function getAppsHandler({ data }): Promise<App[]> {
    return serve(inputs.org, data, async (input) => {
      return readOrgApps(input.orgId)
    })
  })

export type CredentialSet = {
  environmentId: string
  kind: "test" | "live"
  environment: Environment
  apiKeys: ApiKeyRecord[]
  clientSecrets: ClientSecretRecord[]
}

export const getAppDetail = createServerFn({ method: "GET" })
  .validator(appInput)
  .handler(async function getAppDetailHandler({ data }): Promise<{
    app: App
    credentials: CredentialSet[]
  }> {
    return serve(inputs.app, data, async (input) => {
      const app = await readApp(input.appId)
      const credentials = await Promise.all(
        app.environments.map(async (environment) => ({
          environmentId: environment.id,
          kind: environment.kind,
          environment: await readEnvironment(environment.id),
          apiKeys: await readApiKeys(environment.id),
          clientSecrets: await readClientSecrets(environment.id),
        })),
      )
      return { app, credentials }
    })
  })

export const getOrganization = createServerFn({ method: "GET" })
  .validator(orgInput)
  .handler(async function getOrganizationHandler({ data }): Promise<{
    members: Member[]
    invitations: Invitation[] | null
    activity: AuditEvent[] | null
  }> {
    return serve(inputs.org, data, async (input) => {
      const [members, invitations, activity] = await Promise.all([
        readMembers(input.orgId),
        readInvitations(input.orgId),
        readOrgAudit(input.orgId),
      ])
      return { members, invitations, activity }
    })
  })

export const getMySessions = createServerFn({ method: "GET" }).handler(
  async function getMySessionsHandler(): Promise<ConsoleSession[]> {
    return readMySessions()
  },
)

type UsageInput = { orgId: string; range: UsageRange }

function usageInput(input: UsageInput): UsageInput {
  return input
}

export const getUsage = createServerFn({ method: "GET" })
  .validator(usageInput)
  .handler(async function getUsageHandler({
    data,
  }): Promise<OrgUsageResponse | null> {
    return serve(inputs.usage, data, async (input) => {
      const range =
        input.range === "24h" || input.range === "30d" ? input.range : "7d"
      return readOrgUsage(input.orgId, new Date(), range)
    })
  })

type UsagePageInput = {
  orgId: string
  range: UsageRange
  environmentKind: UsageEnvironments
}

function usagePageInput(input: UsagePageInput): UsagePageInput {
  return input
}

export type UsagePage = {
  usage: OrgUsageResponse | null
  quotas: EnvironmentQuotaStatus[] | null
}

/** Usage (`Kz0wFg3gQf`): the org's usage and today's quota per environment. */
export const getUsagePage = createServerFn({ method: "GET" })
  .validator(usagePageInput)
  .handler(async function getUsagePageHandler({ data }): Promise<UsagePage> {
    return serve(inputs.usagePage, data, async (input) => {
      const range =
        input.range === "24h" || input.range === "30d" ? input.range : "7d"
      const kind =
        input.environmentKind === "test" || input.environmentKind === "live"
          ? input.environmentKind
          : "both"
      const [usage, quotas] = await Promise.all([
        readOrgUsage(input.orgId, new Date(), range, kind),
        readOrgQuotas(input.orgId, kind),
      ])
      return { usage, quotas }
    })
  })

type ReviewInput = { reviewId: string }

function reviewInput(input: ReviewInput): ReviewInput {
  return input
}

type AdminReviewsInput = { state: AdminReviewState }

function adminReviewsInput(input: AdminReviewsInput): AdminReviewsInput {
  return input
}

const reviewStates: AdminReviewState[] = [
  "open",
  "approved",
  "changes-requested",
  "rejected",
  "withdrawn",
]

/** Admin reviews (`YY4uOHeVTm`): one state's reviews and the stats. */
export const getAdminReviews = createServerFn({ method: "GET" })
  .validator(adminReviewsInput)
  .handler(async function getAdminReviewsHandler({ data }): Promise<{
    reviews: AdminReview[]
    stats: AdminReviewStatsResponse
  }> {
    return serve(inputs.adminReviews, data, async (input) => {
      const state = reviewStates.includes(input.state) ? input.state : "open"
      const [reviews, stats] = await Promise.all([
        readAdminReviews(state),
        readAdminReviewStats(),
      ])
      return { reviews, stats }
    })
  })

export const getAdminReview = createServerFn({ method: "GET" })
  .validator(reviewInput)
  .handler(async function getAdminReviewHandler({ data }): Promise<{
    review: AdminReview
    logo: ReviewLogo
    context: AdminReviewContextResponse | null
  }> {
    return serve(inputs.review, data, async (input) => {
      return readAdminReview(input.reviewId)
    })
  })

type EnvironmentsInput = { orgId: string; environmentIds: string[] }

function environmentsInput(input: EnvironmentsInput): EnvironmentsInput {
  return input
}

export type EnvironmentsExtras = {
  /** Reviews per environment id, newest first. */
  reviews: Record<string, DeveloperReview[]>
  /** Requests over seven days per environment id; null without analytics. */
  requests: Record<string, number> | null
}

/** Environments tab (`45HRaWcjCi`): review history and 7-day requests. */
export const getEnvironmentsExtras = createServerFn({ method: "GET" })
  .validator(environmentsInput)
  .handler(async function getEnvironmentsExtrasHandler({
    data,
  }): Promise<EnvironmentsExtras> {
    return serve(inputs.environments, data, async (input) => {
      const ids = input.environmentIds.slice(0, 2)
      const [usage, ...reviews] = await Promise.all([
        readOrgUsage(input.orgId, new Date(), "7d"),
        ...ids.map((id) => readEnvironmentReviews(id)),
      ])
      const requests =
        usage === null
          ? null
          : Object.fromEntries(
              usage.byEnvironment.map((entry) => [
                entry.environmentId,
                entry.summary.requests,
              ]),
            )
      return {
        reviews: Object.fromEntries(
          ids.map((id, index) => [id, reviews[index] ?? []]),
        ),
        requests,
      }
    })
  })

export type UsageTab = {
  usage: UsageResponse | null
  quota: EnvironmentQuotaStatus | null
  log: { from: string; to: string; data: RequestLogEntry[] } | null
}

/** An app's Usage tab (`6KF4QVLIpP`): usage, quota today and the log. */
export const getUsageTab = createServerFn({ method: "GET" })
  .validator(environmentInput)
  .handler(async function getUsageTabHandler({ data }): Promise<UsageTab> {
    return serve(inputs.environment, data, async (input) => {
      const now = new Date()
      const [usage, quota, log] = await Promise.all([
        readEnvironmentUsage(input.environmentId, now, "7d"),
        readEnvironmentQuota(input.environmentId),
        readRequestLog(input.environmentId, now, "7d"),
      ])
      return { usage, quota, log }
    })
  })

export type OAuthExtras = {
  preview: AuthorizationRequestDetail | null
  stats: OAuthStatsResponse | null
}

/** OAuth tab (`ue1xxOLm6q`): the consent preview and 30-day grant stats. */
export const getOAuthExtras = createServerFn({ method: "GET" })
  .validator(environmentInput)
  .handler(async function getOAuthExtrasHandler({
    data,
  }): Promise<OAuthExtras> {
    return serve(inputs.environment, data, async (input) => {
      const [preview, stats] = await Promise.all([
        readConsentPreview(input.environmentId),
        readOAuthStats(input.environmentId, new Date()),
      ])
      return { preview, stats }
    })
  })

type TextInput = { query: string }

function textInput(input: TextInput): TextInput {
  return input
}

export const getAdminApps = createServerFn({ method: "GET" })
  .validator(textInput)
  .handler(async function getAdminAppsHandler({ data }): Promise<AdminApp[]> {
    return serve(inputs.text, data, async (input) => {
      return readAdminApps(typeof input?.query === "string" ? input.query : "")
    })
  })

type EnvironmentInput = { environmentId: string }

function environmentInput(input: EnvironmentInput): EnvironmentInput {
  return input
}

export const getQuotaOverrides = createServerFn({ method: "GET" })
  .validator(environmentInput)
  .handler(async function getQuotaOverridesHandler({
    data,
  }): Promise<QuotaOverride[]> {
    return serve(inputs.environment, data, async (input) => {
      return readQuotaOverrides(input.environmentId)
    })
  })

type AuditInput = { organizationId?: string; appId?: string }

function auditInput(input: AuditInput): AuditInput {
  return input
}

export const getAudit = createServerFn({ method: "GET" })
  .validator(auditInput)
  .handler(async function getAuditHandler({ data }): Promise<AuditEvent[]> {
    return serve(inputs.audit, data, async (input) => {
      return readAudit({
        ...(typeof input?.organizationId === "string" &&
        input.organizationId !== ""
          ? { organizationId: input.organizationId }
          : {}),
        ...(typeof input?.appId === "string" && input.appId !== ""
          ? { appId: input.appId }
          : {}),
      })
    })
  })
