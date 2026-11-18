import {
  describeFeedbackBrowser,
  feedbackSurfaceNames,
} from "@matchbox/contracts/feedback"
import { z } from "zod"
import type { StoredReport } from "./store"

/**
 * The report as the team receives it in Discord (Doop frame XFJNepq-CT):
 * one message from the Matchbox bot in one channel, an embed with the
 * type and product, the message, the context fields the user saw and the
 * screenshot, and "Report FB-…" in the footer. Mentions are never parsed,
 * so text a user typed cannot ping anyone.
 */

const discordApi = "https://discord.com/api/v10"

/** Bitcoin orange, the accent bar in the frame. */
const embedColor = 0xf7931a

const kindLabels = { bug: "Bug", idea: "Idea", other: "Other" } as const

export type DiscordScreenshot = {
  bytes: Uint8Array
  type: string
  fileName: string
}

type EmbedField = { name: string; value: string; inline: boolean }

export type DiscordMessage = {
  content: string
  allowed_mentions: { parse: [] }
  embeds: Array<{
    color: number
    author: { name: string }
    title: string
    description: string
    fields: EmbedField[]
    image?: { url: string }
    footer: { text: string }
    timestamp: string
  }>
  /**
   * Buttons under the report. Empty in v1. The seam for a later "Create
   * GitHub issue" action: return a button row here (custom_id
   * `issue:github:<report id>`) and add the interactions endpoint that
   * answers it; nothing else in the post changes.
   */
  components: unknown[]
}

/** Discord markdown characters a user typed are shown, not applied. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>[\]()#])/g, "\\$1")
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/** The first line of the message, as the embed's title. */
export function reportTitle(message: string): string {
  const firstLine = message.split(/\r?\n/).find((line) => line.trim() !== "")
  return truncate((firstLine ?? message).trim(), 80)
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/**
 * Buttons for a report. None in v1 (no issue tracker yet); see
 * `DiscordMessage.components`.
 */
export function reportActions(_report: StoredReport): unknown[] {
  return []
}

export function buildDiscordMessage(
  report: StoredReport,
  screenshot: { fileName: string } | null,
): DiscordMessage {
  const product = feedbackSurfaceNames[report.surface]
  const host = new URL(report.origin).host
  const fields: EmbedField[] = []
  if (report.route !== null) {
    fields.push({
      name: "Page",
      value: `[${escapeMarkdown(`${host}${report.route}`)}](${report.origin}${report.route})`,
      inline: true,
    })
  }
  fields.push(
    {
      name: "App",
      value:
        report.build === null
          ? product
          : `${product}, build ${escapeMarkdown(report.build)}`,
      inline: true,
    },
    {
      name: "Browser",
      value: escapeMarkdown(
        describeFeedbackBrowser(report.user_agent, report.wallet_browser),
      ),
      inline: true,
    },
    {
      name: "Screen",
      value: `${report.viewport_width} x ${report.viewport_height}, ${report.theme_mode}`,
      inline: true,
    },
  )
  if (report.wallet !== null) {
    fields.push({
      name: "Wallet",
      value: `[${shortAddress(report.wallet)}](https://scan.matchbox.markets/address/${report.wallet})`,
      inline: true,
    })
  }
  if (report.chain_id !== null) {
    fields.push({
      name: "Chain",
      value: String(report.chain_id),
      inline: true,
    })
  }
  if (report.contact !== null) {
    fields.push({
      name: "Contact",
      value: escapeMarkdown(truncate(report.contact, 200)),
      inline: true,
    })
  }
  return {
    content: "",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        color: embedColor,
        author: { name: `${kindLabels[report.kind]}, ${product}` },
        title: escapeMarkdown(reportTitle(report.message)),
        description: escapeMarkdown(report.message),
        fields,
        ...(screenshot === null
          ? {}
          : { image: { url: `attachment://${screenshot.fileName}` } }),
        footer: { text: `Report ${report.reference}` },
        timestamp: report.created_at,
      },
    ],
    components: reportActions(report),
  }
}

const createdMessageSchema = z.object({ id: z.string() })

export type DiscordPostOutcome =
  | { status: "posted"; messageId: string }
  | { status: "failed"; httpStatus: number | null }

/**
 * Posts the report to the channel as the bot. With a screenshot the
 * message is multipart: the JSON payload and the image as files[0].
 */
export async function postToDiscord(input: {
  report: StoredReport
  screenshot: DiscordScreenshot | null
  botToken: string
  channelId: string
  fetch: typeof globalThis.fetch
}): Promise<DiscordPostOutcome> {
  const message = buildDiscordMessage(input.report, input.screenshot)
  const url = `${discordApi}/channels/${input.channelId}/messages`
  const headers = {
    authorization: `Bot ${input.botToken}`,
    "user-agent": "DiscordBot (https://matchbox.markets, 1)",
  }
  let body: BodyInit
  let contentType: Record<string, string> = {}
  if (input.screenshot === null) {
    body = JSON.stringify(message)
    contentType = { "content-type": "application/json" }
  } else {
    const form = new FormData()
    form.append(
      "payload_json",
      JSON.stringify({
        ...message,
        attachments: [{ id: 0, filename: input.screenshot.fileName }],
      }),
    )
    form.append(
      "files[0]",
      new Blob([input.screenshot.bytes], { type: input.screenshot.type }),
      input.screenshot.fileName,
    )
    body = form
  }
  let response: Response
  try {
    response = await input.fetch(url, {
      method: "POST",
      headers: { ...headers, ...contentType },
      body,
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return { status: "failed", httpStatus: null }
  }
  if (!response.ok) return { status: "failed", httpStatus: response.status }
  const created = createdMessageSchema.safeParse(
    await response.json().catch(() => null),
  )
  return created.success
    ? { status: "posted", messageId: created.data.id }
    : { status: "failed", httpStatus: response.status }
}
