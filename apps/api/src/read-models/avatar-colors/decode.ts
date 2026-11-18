import decodeGif, { isGif } from "./gif"
import decodeJpeg, { isJpeg } from "./jpeg"
import decodePng, { isPng } from "./png"
import {
  AvatarDecodeError,
  type DecodeLimits,
  type PixelSample,
} from "./sample"
import decodeWebp, { isWebp } from "./webp"

/** Decodes a PNG, JPEG, GIF or WebP avatar by its magic bytes. */
export default async function decodeAvatar(
  bytes: Uint8Array,
  limits: DecodeLimits,
): Promise<PixelSample> {
  if (isPng(bytes)) return decodePng(bytes, limits)
  if (isJpeg(bytes)) return decodeJpeg(bytes, limits)
  if (isWebp(bytes)) return decodeWebp(bytes, limits)
  if (isGif(bytes)) return decodeGif(bytes, limits)
  throw new AvatarDecodeError("unsupported", "Unknown image format")
}
