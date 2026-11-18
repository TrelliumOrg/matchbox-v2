import {
  AvatarDecodeError,
  type DecodeLimits,
  type PixelSample,
} from "./sample"
import decodeVp8 from "./vp8"
import decodeVp8l from "./vp8l"

// The WebP container: a simple file is one VP8 (lossy) or VP8L (lossless)
// chunk; an extended file (VP8X) wraps one with metadata. Animated files
// are refused. A lossy image's ALPH chunk is ignored, so its transparent
// areas read as whatever colour they hide (usually black or white, which
// the picker skips anyway).

function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  )
}

export function isWebp(bytes: Uint8Array): boolean {
  return fourCc(bytes, 0) === "RIFF" && fourCc(bytes, 8) === "WEBP"
}

export default function decodeWebp(
  bytes: Uint8Array,
  limits: DecodeLimits,
): PixelSample {
  if (!isWebp(bytes)) throw new AvatarDecodeError("corrupt", "Not a WebP")
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = fourCc(bytes, offset)
    const size =
      ((bytes[offset + 4] ?? 0) |
        ((bytes[offset + 5] ?? 0) << 8) |
        ((bytes[offset + 6] ?? 0) << 16) |
        ((bytes[offset + 7] ?? 0) << 24)) >>>
      0
    const body = bytes.subarray(offset + 8, offset + 8 + size)
    if (id === "VP8 ") return decodeVp8(body, limits)
    if (id === "VP8L") return decodeVp8l(body, limits)
    if (id === "ANIM" || id === "ANMF") {
      throw new AvatarDecodeError("unsupported", "Animated WebP")
    }
    offset += 8 + size + (size & 1)
  }
  throw new AvatarDecodeError("corrupt", "WebP without image data")
}
