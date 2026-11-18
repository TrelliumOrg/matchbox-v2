import {
  AvatarDecodeError,
  checkSize,
  type DecodeLimits,
  type PixelSample,
  SampleGrid,
} from "./sample"

// Lossless WebP (VP8L) to a sample grid. Lossless streams cannot be sampled
// without decoding every pixel (LZ77 copies reach back anywhere), so this is
// a complete, compact decoder: prefix codes, colour cache, meta codes and the
// four inverse transforms, after the WebP Lossless Bitstream Specification.

/** LSB-first bit reader; reads past the end return zeros. */
class BitReader {
  private readonly data: Uint8Array
  private position: number
  private bits = 0
  private count = 0

  constructor(data: Uint8Array, position: number) {
    this.data = data
    this.position = position
  }

  private fill(length: number): void {
    while (this.count < length) {
      this.bits |= (this.data[this.position] ?? 0) << this.count
      this.position += 1
      this.count += 8
    }
  }

  /** Up to 24 bits. */
  read(length: number): number {
    this.fill(length)
    const value = this.bits & ((1 << length) - 1)
    this.bits >>>= length
    this.count -= length
    return value
  }

  bit(): number {
    return this.read(1)
  }

  peek(length: number): number {
    this.fill(length)
    return this.bits & ((1 << length) - 1)
  }

  skip(length: number): void {
    this.bits >>>= length
    this.count -= length
  }

  get exhausted(): boolean {
    return this.position > this.data.length + 8
  }
}

const lookupBits = 8

/**
 * A canonical prefix code. Codes up to 8 bits resolve in one lookup of the
 * next 8 (bit-reversed) bits; longer ones walk the canonical ranges.
 */
type PrefixCode =
  | { kind: "single"; symbol: number }
  | {
      kind: "tree"
      /** Per bit pattern: symbol << 4 | length, or 0 for a longer code. */
      lookup: Uint32Array
      /** Per length: first code, count and offset into `symbols`. */
      firstCode: Int32Array
      counts: Int32Array
      offsets: Int32Array
      symbols: Uint16Array
      maxLength: number
    }

function reverseBits(code: number, length: number): number {
  let reversed = 0
  for (let i = 0; i < length; i += 1)
    reversed |= ((code >> i) & 1) << (length - 1 - i)
  return reversed
}

function buildCode(lengths: Uint8Array): PrefixCode {
  const nonZero: number[] = []
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    if ((lengths[symbol] ?? 0) > 0) nonZero.push(symbol)
  }
  if (nonZero.length === 0)
    throw new AvatarDecodeError("corrupt", "Empty VP8L code")
  if (nonZero.length === 1) return { kind: "single", symbol: nonZero[0] ?? 0 }
  const counts = new Int32Array(16)
  let maxLength = 0
  for (const symbol of nonZero) {
    const length = lengths[symbol] ?? 0
    counts[length] = (counts[length] ?? 0) + 1
    if (length > maxLength) maxLength = length
  }
  const firstCode = new Int32Array(16)
  const offsets = new Int32Array(16)
  let code = 0
  let offset = 0
  for (let length = 1; length < 16; length += 1) {
    code = (code + (counts[length - 1] ?? 0)) << 1
    firstCode[length] = code
    offsets[length] = offset
    offset += counts[length] ?? 0
  }
  const symbols = new Uint16Array(nonZero.length)
  const next = Int32Array.from(firstCode)
  const fill = Int32Array.from(offsets)
  const lookup = new Uint32Array(1 << lookupBits)
  for (const symbol of nonZero) {
    const length = lengths[symbol] ?? 0
    symbols[fill[length] ?? 0] = symbol
    fill[length] = (fill[length] ?? 0) + 1
    const assigned = next[length] ?? 0
    next[length] = assigned + 1
    if (length <= lookupBits) {
      const reversed = reverseBits(assigned, length)
      for (let high = 0; high < 1 << (lookupBits - length); high += 1) {
        lookup[reversed | (high << length)] = (symbol << 4) | length
      }
    }
  }
  return {
    kind: "tree",
    lookup,
    firstCode,
    counts,
    offsets,
    symbols,
    maxLength,
  }
}

function readSymbol(code: PrefixCode, reader: BitReader): number {
  if (code.kind === "single") return code.symbol
  const entry = code.lookup[reader.peek(lookupBits)] ?? 0
  if (entry !== 0) {
    reader.skip(entry & 15)
    return entry >> 4
  }
  let value = 0
  for (let length = 1; length <= code.maxLength; length += 1) {
    value = (value << 1) | reader.bit()
    const index = value - (code.firstCode[length] ?? 0)
    if (index >= 0 && index < (code.counts[length] ?? 0)) {
      return code.symbols[(code.offsets[length] ?? 0) + index] ?? 0
    }
  }
  throw new AvatarDecodeError("corrupt", "Bad VP8L prefix code")
}

const codeLengthOrder = [
  17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
]

function readCode(reader: BitReader, alphabetSize: number): PrefixCode {
  const lengths = new Uint8Array(alphabetSize)
  if (reader.bit() === 1) {
    const symbolCount = reader.bit() + 1
    const firstSymbol = reader.read(reader.bit() === 0 ? 1 : 8)
    lengths[firstSymbol] = 1
    if (symbolCount === 2) lengths[reader.read(8)] = 1
    return buildCode(lengths)
  }
  const lengthCodeLengths = new Uint8Array(19)
  const count = reader.read(4) + 4
  for (let i = 0; i < count; i += 1) {
    lengthCodeLengths[codeLengthOrder[i] ?? 0] = reader.read(3)
  }
  const lengthCode = buildCode(lengthCodeLengths)
  let maxSymbol = alphabetSize
  if (reader.bit() === 1) {
    const lengthBits = 2 + 2 * reader.read(3)
    maxSymbol = 2 + reader.read(lengthBits)
    if (maxSymbol > alphabetSize)
      throw new AvatarDecodeError("corrupt", "VP8L max symbol")
  }
  let previous = 8
  let symbol = 0
  while (symbol < alphabetSize) {
    if (maxSymbol === 0) break
    maxSymbol -= 1
    const length = readSymbol(lengthCode, reader)
    if (length < 16) {
      lengths[symbol] = length
      symbol += 1
      if (length !== 0) previous = length
      continue
    }
    const extraBits = length === 16 ? 2 : length === 17 ? 3 : 7
    const repeatOffset = length === 18 ? 11 : 3
    const repeat = reader.read(extraBits) + repeatOffset
    if (symbol + repeat > alphabetSize)
      throw new AvatarDecodeError("corrupt", "VP8L repeat")
    const value = length === 16 ? previous : 0
    lengths.fill(value, symbol, symbol + repeat)
    symbol += repeat
  }
  return buildCode(lengths)
}

type Group = [PrefixCode, PrefixCode, PrefixCode, PrefixCode, PrefixCode]

function readGroup(reader: BitReader, cacheSize: number): Group {
  return [
    readCode(reader, 256 + 24 + cacheSize),
    readCode(reader, 256),
    readCode(reader, 256),
    readCode(reader, 256),
    readCode(reader, 40),
  ]
}

function prefixValue(reader: BitReader, prefix: number): number {
  if (prefix < 4) return prefix + 1
  const extraBits = (prefix - 2) >> 1
  const offset = (2 + (prefix & 1)) << extraBits
  return offset + reader.read(extraBits) + 1
}

const codeToPlane = [
  0x18, 0x07, 0x17, 0x19, 0x28, 0x06, 0x27, 0x29, 0x16, 0x1a, 0x26, 0x2a, 0x38,
  0x05, 0x37, 0x39, 0x15, 0x1b, 0x36, 0x3a, 0x25, 0x2b, 0x48, 0x04, 0x47, 0x49,
  0x14, 0x1c, 0x35, 0x3b, 0x46, 0x4a, 0x24, 0x2c, 0x58, 0x45, 0x4b, 0x34, 0x3c,
  0x03, 0x57, 0x59, 0x13, 0x1d, 0x56, 0x5a, 0x23, 0x2d, 0x44, 0x4c, 0x55, 0x5b,
  0x33, 0x3d, 0x68, 0x02, 0x67, 0x69, 0x12, 0x1e, 0x66, 0x6a, 0x22, 0x2e, 0x54,
  0x5c, 0x43, 0x4d, 0x65, 0x6b, 0x32, 0x3e, 0x78, 0x01, 0x77, 0x79, 0x53, 0x5d,
  0x11, 0x1f, 0x64, 0x6c, 0x42, 0x4e, 0x76, 0x7a, 0x21, 0x2f, 0x75, 0x7b, 0x31,
  0x3f, 0x63, 0x6d, 0x52, 0x5e, 0x00, 0x74, 0x7c, 0x41, 0x4f, 0x10, 0x20, 0x62,
  0x6e, 0x30, 0x73, 0x7d, 0x51, 0x5f, 0x40, 0x72, 0x7e, 0x61, 0x6f, 0x50, 0x71,
  0x7f, 0x60, 0x70,
]

function planeDistance(width: number, code: number): number {
  if (code > 120) return code - 120
  const value = codeToPlane[code - 1] ?? 0
  const distance = (value >> 4) * width + (8 - (value & 15))
  return Math.max(1, distance)
}

function subSampleSize(size: number, bits: number): number {
  return (size + (1 << bits) - 1) >> bits
}

/** Decodes one entropy-coded image of `width × height` ARGB pixels. */
function decodeImage(
  reader: BitReader,
  width: number,
  height: number,
  isLevel0: boolean,
): Uint32Array {
  let cacheBits = 0
  if (reader.bit() === 1) {
    cacheBits = reader.read(4)
    if (cacheBits < 1 || cacheBits > 11)
      throw new AvatarDecodeError("corrupt", "VP8L cache")
  }
  let metaBits = 0
  let metaImage: Uint32Array | null = null
  let groupCount = 1
  if (isLevel0 && reader.bit() === 1) {
    metaBits = reader.read(3) + 2
    const metaWidth = subSampleSize(width, metaBits)
    metaImage = decodeImage(
      reader,
      metaWidth,
      subSampleSize(height, metaBits),
      false,
    )
    for (let i = 0; i < metaImage.length; i += 1) {
      const group = ((metaImage[i] ?? 0) >> 8) & 0xffff
      metaImage[i] = group
      if (group + 1 > groupCount) groupCount = group + 1
    }
  }
  const cacheSize = cacheBits > 0 ? 1 << cacheBits : 0
  const groups: Group[] = []
  for (let i = 0; i < groupCount; i += 1)
    groups.push(readGroup(reader, cacheSize))
  const cache = cacheSize > 0 ? new Uint32Array(cacheSize) : null
  const cacheShift = 32 - cacheBits
  const pixels = new Uint32Array(width * height)
  const metaWidth = metaImage === null ? 0 : subSampleSize(width, metaBits)
  const groupAt = (position: number): Group => {
    if (metaImage === null) return groups[0] as Group
    const x = position % width
    const y = Math.floor(position / width)
    const index = metaImage[(y >> metaBits) * metaWidth + (x >> metaBits)] ?? 0
    return groups[index] ?? (groups[0] as Group)
  }
  let lastCached = 0
  const total = width * height
  let position = 0
  while (position < total) {
    if (reader.exhausted)
      throw new AvatarDecodeError("corrupt", "VP8L truncated")
    const group = groupAt(position)
    const code = readSymbol(group[0], reader)
    if (code < 256) {
      const red = readSymbol(group[1], reader)
      const blue = readSymbol(group[2], reader)
      const alpha = readSymbol(group[3], reader)
      pixels[position] =
        ((alpha << 24) | (red << 16) | (code << 8) | blue) >>> 0
      position += 1
    } else if (code < 280) {
      const length = prefixValue(reader, code - 256)
      const distanceCode = prefixValue(reader, readSymbol(group[4], reader))
      const distance = planeDistance(width, distanceCode)
      if (distance > position || position + length > total) {
        throw new AvatarDecodeError("corrupt", "VP8L copy out of range")
      }
      for (let i = 0; i < length; i += 1) {
        pixels[position + i] = pixels[position + i - distance] ?? 0
      }
      position += length
    } else {
      if (cache === null)
        throw new AvatarDecodeError("corrupt", "VP8L cache code")
      while (lastCached < position) {
        const argb = pixels[lastCached] ?? 0
        cache[Math.imul(argb, 0x1e35a7bd) >>> cacheShift] = argb
        lastCached += 1
      }
      pixels[position] = cache[code - 280] ?? 0
      position += 1
    }
    if (cache !== null) {
      while (lastCached < position) {
        const argb = pixels[lastCached] ?? 0
        cache[Math.imul(argb, 0x1e35a7bd) >>> cacheShift] = argb
        lastCached += 1
      }
    }
  }
  return pixels
}

type Transform =
  | { kind: "predictor"; bits: number; width: number; data: Uint32Array }
  | { kind: "color"; bits: number; width: number; data: Uint32Array }
  | { kind: "subtract-green" }
  | {
      kind: "color-indexing"
      bits: number
      width: number
      palette: Uint32Array
    }

function average2(a: number, b: number): number {
  return (((((a ^ b) & 0xfefefefe) >>> 1) + (a & b)) >>> 0) >>> 0
}

function clip255(value: number): number {
  return Math.min(255, Math.max(0, value))
}

function channel(value: number, shift: number): number {
  return (value >>> shift) & 0xff
}

function select(top: number, left: number, topLeft: number): number {
  let difference = 0
  for (const shift of [24, 16, 8, 0]) {
    const a = channel(top, shift)
    const b = channel(left, shift)
    const c = channel(topLeft, shift)
    difference += Math.abs(b - c) - Math.abs(a - c)
  }
  return difference <= 0 ? top : left
}

function clampAddSubtractFull(a: number, b: number, c: number): number {
  let result = 0
  for (const shift of [24, 16, 8, 0]) {
    result |=
      clip255(channel(a, shift) + channel(b, shift) - channel(c, shift)) <<
      shift
  }
  return result >>> 0
}

function clampAddSubtractHalf(a: number, b: number): number {
  let result = 0
  for (const shift of [24, 16, 8, 0]) {
    const x = channel(a, shift)
    const y = channel(b, shift)
    result |= clip255(x + Math.trunc((x - y) / 2)) << shift
  }
  return result >>> 0
}

function addPixels(a: number, b: number): number {
  const alphaGreen = ((a & 0xff00ff00) >>> 0) + ((b & 0xff00ff00) >>> 0)
  const redBlue = (a & 0x00ff00ff) + (b & 0x00ff00ff)
  return (((alphaGreen & 0xff00ff00) >>> 0) | (redBlue & 0x00ff00ff)) >>> 0
}

function predict(
  mode: number,
  left: number,
  top: number,
  topLeft: number,
  topRight: number,
): number {
  switch (mode) {
    case 0:
      return 0xff000000
    case 1:
      return left
    case 2:
      return top
    case 3:
      return topRight
    case 4:
      return topLeft
    case 5:
      return average2(average2(left, topRight), top)
    case 6:
      return average2(left, topLeft)
    case 7:
      return average2(left, top)
    case 8:
      return average2(topLeft, top)
    case 9:
      return average2(top, topRight)
    case 10:
      return average2(average2(left, topLeft), average2(top, topRight))
    case 11:
      return select(top, left, topLeft)
    case 12:
      return clampAddSubtractFull(left, top, topLeft)
    case 13:
      return clampAddSubtractHalf(average2(left, top), topLeft)
    default:
      return 0xff000000
  }
}

function inversePredictor(
  pixels: Uint32Array,
  width: number,
  height: number,
  bits: number,
  data: Uint32Array,
) {
  const tiles = subSampleSize(width, bits)
  pixels[0] = addPixels(pixels[0] ?? 0, 0xff000000)
  for (let x = 1; x < width; x += 1) {
    pixels[x] = addPixels(pixels[x] ?? 0, pixels[x - 1] ?? 0)
  }
  for (let y = 1; y < height; y += 1) {
    const row = y * width
    pixels[row] = addPixels(pixels[row] ?? 0, pixels[row - width] ?? 0)
    const modes = (y >> bits) * tiles
    for (let x = 1; x < width; x += 1) {
      const i = row + x
      const mode = ((data[modes + (x >> bits)] ?? 0) >> 8) & 15
      const prediction = predict(
        mode,
        pixels[i - 1] ?? 0,
        pixels[i - width] ?? 0,
        pixels[i - width - 1] ?? 0,
        pixels[i - width + 1] ?? 0,
      )
      pixels[i] = addPixels(pixels[i] ?? 0, prediction)
    }
  }
}

function colorDelta(transform: number, value: number): number {
  return (((transform << 24) >> 24) * ((value << 24) >> 24)) >> 5
}

function inverseColor(
  pixels: Uint32Array,
  width: number,
  height: number,
  bits: number,
  data: Uint32Array,
) {
  const tiles = subSampleSize(width, bits)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const element = data[(y >> bits) * tiles + (x >> bits)] ?? 0
      const greenToRed = element & 0xff
      const greenToBlue = (element >> 8) & 0xff
      const redToBlue = (element >> 16) & 0xff
      const i = y * width + x
      const argb = pixels[i] ?? 0
      const green = (argb >> 8) & 0xff
      const red = (((argb >> 16) & 0xff) + colorDelta(greenToRed, green)) & 0xff
      const blue =
        ((argb & 0xff) +
          colorDelta(greenToBlue, green) +
          colorDelta(redToBlue, red)) &
        0xff
      pixels[i] = (((argb & 0xff00ff00) >>> 0) | (red << 16) | blue) >>> 0
    }
  }
}

function inverseSubtractGreen(pixels: Uint32Array): void {
  for (let i = 0; i < pixels.length; i += 1) {
    const argb = pixels[i] ?? 0
    const green = (argb >> 8) & 0xff
    const redBlue = ((argb & 0x00ff00ff) + ((green << 16) | green)) & 0x00ff00ff
    pixels[i] = (((argb & 0xff00ff00) >>> 0) | redBlue) >>> 0
  }
}

function inverseColorIndexing(
  packed: Uint32Array,
  width: number,
  height: number,
  bits: number,
  palette: Uint32Array,
): Uint32Array {
  const out = new Uint32Array(width * height)
  const packedWidth = subSampleSize(width, bits)
  const bitsPerPixel = 8 >> bits
  const mask = (1 << bitsPerPixel) - 1
  const perByte = 1 << bits
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = ((packed[y * packedWidth + (x >> bits)] ?? 0) >> 8) & 0xff
      const index = (value >> ((x & (perByte - 1)) * bitsPerPixel)) & mask
      out[y * width + x] = palette[index] ?? 0
    }
  }
  return out
}

export default function decodeVp8l(
  data: Uint8Array,
  limits: DecodeLimits,
): PixelSample {
  if (data[0] !== 0x2f) throw new AvatarDecodeError("corrupt", "VP8L signature")
  const reader = new BitReader(data, 1)
  const width = reader.read(14) + 1
  const height = reader.read(14) + 1
  reader.read(1) // alpha hint
  if (reader.read(3) !== 0)
    throw new AvatarDecodeError("unsupported", "VP8L version")
  checkSize(width, height, limits)
  const transforms: Transform[] = []
  let codedWidth = width
  const seen = new Set<number>()
  while (reader.bit() === 1) {
    const type = reader.read(2)
    if (seen.has(type))
      throw new AvatarDecodeError("corrupt", "VP8L repeated transform")
    seen.add(type)
    if (type === 0 || type === 1) {
      const bits = reader.read(3) + 2
      const transformData = decodeImage(
        reader,
        subSampleSize(codedWidth, bits),
        subSampleSize(height, bits),
        false,
      )
      transforms.push(
        type === 0
          ? { kind: "predictor", bits, width: codedWidth, data: transformData }
          : { kind: "color", bits, width: codedWidth, data: transformData },
      )
    } else if (type === 2) {
      transforms.push({ kind: "subtract-green" })
    } else {
      const colors = reader.read(8) + 1
      const bits = colors > 16 ? 0 : colors > 4 ? 1 : colors > 2 ? 2 : 3
      const deltas = decodeImage(reader, colors, 1, false)
      const palette = new Uint32Array(256)
      let previous = 0
      for (let i = 0; i < colors; i += 1) {
        previous = addPixels(previous, deltas[i] ?? 0)
        palette[i] = previous
      }
      transforms.push({
        kind: "color-indexing",
        bits,
        width: codedWidth,
        palette,
      })
      codedWidth = subSampleSize(codedWidth, bits)
    }
  }
  let pixels = decodeImage(reader, codedWidth, height, true)
  for (let i = transforms.length - 1; i >= 0; i -= 1) {
    const transform = transforms[i]
    if (transform === undefined) continue
    if (transform.kind === "predictor") {
      inversePredictor(
        pixels,
        transform.width,
        height,
        transform.bits,
        transform.data,
      )
    } else if (transform.kind === "color") {
      inverseColor(
        pixels,
        transform.width,
        height,
        transform.bits,
        transform.data,
      )
    } else if (transform.kind === "subtract-green") {
      inverseSubtractGreen(pixels)
    } else {
      pixels = inverseColorIndexing(
        pixels,
        transform.width,
        height,
        transform.bits,
        transform.palette,
      )
    }
  }
  const grid = new SampleGrid(width, height)
  for (let y = 0; y < height; y += grid.stepY) {
    for (let x = 0; x < width; x += grid.stepX) {
      const argb = pixels[y * width + x] ?? 0
      grid.set(
        x,
        y,
        (argb >>> 16) & 0xff,
        (argb >>> 8) & 0xff,
        argb & 0xff,
        argb >>> 24,
      )
    }
  }
  return grid.sample(width, height)
}
