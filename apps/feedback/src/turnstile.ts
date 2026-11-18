import { z } from "zod"

/**
 * Server-side Turnstile check (Siteverify). The widget's action is
 * "feedback"; a token minted for another action or another site key does
 * not pass. The client IP is not sent: Cloudflare sees it already, and the
 * report never keeps it.
 */

export const turnstileAction = "feedback"

const siteverifyUrl =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify"

const siteverifySchema = z.object({
  success: z.boolean(),
  action: z.string().optional(),
  "error-codes": z.array(z.string()).optional(),
})

export type TurnstileOutcome =
  | { result: "passed" }
  | { result: "failed"; codes: string[] }
  | { result: "unavailable" }

export async function verifyTurnstile(input: {
  token: string
  secretKey: string
  fetch: typeof globalThis.fetch
  idempotencyKey: string
}): Promise<TurnstileOutcome> {
  let response: Response
  try {
    response = await input.fetch(siteverifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: input.secretKey,
        response: input.token,
        idempotency_key: input.idempotencyKey,
      }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    return { result: "unavailable" }
  }
  if (!response.ok) return { result: "unavailable" }
  const parsed = siteverifySchema.safeParse(
    await response.json().catch(() => null),
  )
  if (!parsed.success) return { result: "unavailable" }
  const codes = parsed.data["error-codes"] ?? []
  if (!parsed.data.success) return { result: "failed", codes }
  // The test secret keys answer without an action; real widgets send ours.
  if (
    parsed.data.action !== undefined &&
    parsed.data.action !== "" &&
    parsed.data.action !== turnstileAction
  ) {
    return { result: "failed", codes: ["action-mismatch"] }
  }
  return { result: "passed" }
}
