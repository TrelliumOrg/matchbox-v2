import { PlatformError } from "@matchbox/server"
import { z } from "zod"

// Opaque keyset cursors for /internal/scan lists: base64url of a JSON array
// whose first element names the list. A cursor from one list is rejected by
// another, and every value is checked against the list's key shape, so a
// cursor is always complete and well formed or the request is a 400.

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(text: string): string | null {
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/")
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      bytes,
    )
  } catch {
    return null
  }
}

const jsonArraySchema = z.array(z.union([z.string(), z.number()]))

/** One list's cursor: its name and the shape of its key. */
export class CursorCodec<Key extends readonly unknown[]> {
  constructor(
    readonly list: string,
    private readonly key: z.ZodType<Key>,
  ) {}

  encode(key: Readonly<Key>): string {
    return toBase64Url(JSON.stringify([this.list, ...key]))
  }

  /** `value` as this list's key, or null when it is not one. */
  keyOf(value: unknown): Key | null {
    const key = this.key.safeParse(value)
    return key.success ? key.data : null
  }

  /** The key, or null for the first page; a bad cursor is a 400. */
  decode(cursor: string | undefined): Key | null {
    if (cursor === undefined) return null
    const text = /^[A-Za-z0-9_-]{4,512}$/.test(cursor)
      ? fromBase64Url(cursor)
      : null
    if (text === null) throw new PlatformError("invalid_request")
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new PlatformError("invalid_request")
    }
    const array = jsonArraySchema.safeParse(raw)
    if (!array.success || array.data[0] !== this.list) {
      throw new PlatformError("invalid_request")
    }
    const key = this.key.safeParse(array.data.slice(1))
    if (!key.success) throw new PlatformError("invalid_request")
    return key.data
  }
}

/** Key parts. */
export const keyPart = {
  block: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  logIndex: z.number().int().nonnegative().max(1_000_000),
  rowid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  seconds: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sortKey: z.string().regex(/^[0-9]{40}$/),
  tokenId: z.string().regex(/^(0|[1-9][0-9]{0,77})$/),
  address: z.string().regex(/^0x[0-9a-f]{40}$/),
  hex32: z.string().regex(/^0x[0-9a-f]{64}$/),
  rank: z.number().int().positive().max(100_000),
  text: z.string().min(1).max(200),
} as const
