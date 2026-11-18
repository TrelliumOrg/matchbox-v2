import type { FeedbackScreenshotType } from "@matchbox/contracts/feedback"
import { randomBytes, randomToken } from "@matchbox/server"

/** Crockford base32: no I, L, O or U, so a reference reads aloud cleanly. */
const referenceAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** 32 lower-case hex characters of CSPRNG output. */
export function newReportId(): string {
  let hex = ""
  for (const byte of randomBytes(16)) hex += byte.toString(16).padStart(2, "0")
  return hex
}

/** FB- and six characters: about a billion, retried on a collision. */
export function newReference(): string {
  let code = ""
  for (const byte of randomBytes(6)) {
    code += referenceAlphabet[byte % referenceAlphabet.length]
  }
  return `FB-${code}`
}

/** The one-time token that lets the reporter upload one screenshot. */
export function newUploadToken(): string {
  return randomToken(32)
}

const extensions: Record<FeedbackScreenshotType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
}

/**
 * Where a screenshot is stored: 256 random bits, nothing from the report,
 * under the prefix the 90-day lifecycle rule covers.
 */
export function newScreenshotKey(type: FeedbackScreenshotType): string {
  return `screenshots/${randomToken(32)}.${extensions[type]}`
}
