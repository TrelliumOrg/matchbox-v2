import {
  AvatarDecodeError,
  checkSize,
  type DecodeLimits,
  type PixelSample,
  SampleGrid,
} from "./sample"

// GIF to a sample grid from the first frame only. Interlaced frames are
// sampled in stored row order: the picker counts area, so row order does
// not matter.

export function isGif(bytes: Uint8Array): boolean {
  return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

/** Skips data sub-blocks from `offset`; returns the offset after them. */
function skipBlocks(bytes: Uint8Array, offset: number): number {
  let position = offset
  while (position < bytes.length) {
    const size = bytes[position] ?? 0
    position += 1
    if (size === 0) return position
    position += size
  }
  return position
}

/** LZW-decodes up to `count` colour indices from sub-blocks at `offset`. */
function decodeIndices(
  bytes: Uint8Array,
  offset: number,
  minCodeSize: number,
  count: number,
): Uint8Array {
  if (minCodeSize < 2 || minCodeSize > 8) {
    throw new AvatarDecodeError("corrupt", `GIF code size ${minCodeSize}`)
  }
  const output = new Uint8Array(count)
  const clear = 1 << minCodeSize
  const end = clear + 1
  const prefix = new Uint16Array(4096)
  const suffix = new Uint8Array(4096)
  const stack = new Uint8Array(4097)
  for (let code = 0; code < clear; code += 1) suffix[code] = code
  let codeSize = minCodeSize + 1
  let next = clear + 2
  let previous = -1
  let first = 0
  let written = 0
  let bits = 0
  let bitCount = 0
  let position = offset
  let blockLeft = 0
  while (written < count) {
    while (bitCount < codeSize) {
      if (blockLeft === 0) {
        blockLeft = bytes[position] ?? 0
        position += 1
        if (blockLeft === 0) return output
      }
      bits |= (bytes[position] ?? 0) << bitCount
      position += 1
      blockLeft -= 1
      bitCount += 8
    }
    let code = bits & ((1 << codeSize) - 1)
    bits >>>= codeSize
    bitCount -= codeSize
    if (code === clear) {
      codeSize = minCodeSize + 1
      next = clear + 2
      previous = -1
      continue
    }
    if (code === end) break
    if (previous === -1) {
      if (code >= clear) throw new AvatarDecodeError("corrupt", "GIF LZW code")
      output[written] = code
      written += 1
      previous = code
      first = code
      continue
    }
    const incoming = code
    let top = 0
    if (code >= next) {
      stack[top] = first
      top += 1
      code = previous
    }
    while (code >= clear) {
      if (top >= 4096) throw new AvatarDecodeError("corrupt", "GIF LZW chain")
      stack[top] = suffix[code] ?? 0
      top += 1
      code = prefix[code] ?? 0
    }
    first = suffix[code] ?? 0
    stack[top] = first
    top += 1
    if (next < 4096) {
      prefix[next] = previous
      suffix[next] = first
      next += 1
      if (next === 1 << codeSize && codeSize < 12) codeSize += 1
    }
    previous = incoming
    while (top > 0 && written < count) {
      top -= 1
      output[written] = stack[top] ?? 0
      written += 1
    }
  }
  return output
}

export default function decodeGif(
  bytes: Uint8Array,
  limits: DecodeLimits,
): PixelSample {
  if (!isGif(bytes) || bytes.length < 13) {
    throw new AvatarDecodeError("corrupt", "Not a GIF")
  }
  const screenWidth = u16le(bytes, 6)
  const screenHeight = u16le(bytes, 8)
  checkSize(screenWidth, screenHeight, limits)
  const flags = bytes[10] ?? 0
  let position = 13
  let globalTable: Uint8Array | null = null
  if (flags & 0x80) {
    const size = 3 * (1 << ((flags & 7) + 1))
    globalTable = bytes.subarray(position, position + size)
    position += size
  }
  let transparent = -1
  while (position < bytes.length) {
    const introducer = bytes[position]
    if (introducer === 0x3b) break
    if (introducer === 0x21) {
      const label = bytes[position + 1]
      if (label === 0xf9 && bytes[position + 2] === 4) {
        const packed = bytes[position + 3] ?? 0
        transparent = packed & 1 ? (bytes[position + 6] ?? -1) : -1
      }
      position = skipBlocks(bytes, position + 2)
      continue
    }
    if (introducer !== 0x2c) {
      throw new AvatarDecodeError("corrupt", "GIF block")
    }
    const width = u16le(bytes, position + 5)
    const height = u16le(bytes, position + 7)
    checkSize(width, height, limits)
    const imageFlags = bytes[position + 9] ?? 0
    position += 10
    let table = globalTable
    if (imageFlags & 0x80) {
      const size = 3 * (1 << ((imageFlags & 7) + 1))
      table = bytes.subarray(position, position + size)
      position += size
    }
    if (table === null) {
      throw new AvatarDecodeError("corrupt", "GIF without a colour table")
    }
    const indices = decodeIndices(
      bytes,
      position + 1,
      bytes[position] ?? 0,
      width * height,
    )
    const grid = new SampleGrid(width, height)
    for (let y = 0; y < height; y += grid.stepY) {
      for (let x = 0; x < width; x += grid.stepX) {
        const index = indices[y * width + x] ?? 0
        grid.set(
          x,
          y,
          table[index * 3] ?? 0,
          table[index * 3 + 1] ?? 0,
          table[index * 3 + 2] ?? 0,
          index === transparent ? 0 : 255,
        )
      }
    }
    return grid.sample(screenWidth, screenHeight)
  }
  throw new AvatarDecodeError("corrupt", "GIF without a frame")
}
