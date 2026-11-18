import {
  AvatarDecodeError,
  checkSize,
  clampByte,
  type DecodeLimits,
  type PixelSample,
  SampleGrid,
} from "./sample"
import {
  acQuant,
  coefficientProbabilities,
  coefficientUpdateProbabilities,
  dcQuant,
  subblockModeProbabilities,
} from "./vp8-tables"

// Lossy WebP (a VP8 key frame, RFC 6386) to a sample grid. A full decode
// after libwebp (prediction, inverse transforms) without the loop filter,
// which only softens block edges; intra prediction reads unfiltered pixels,
// so skipping it changes nothing else. Pixels are reconstructed one
// macroblock at a time in a small work buffer; only the grid is kept.

/** RFC 6386 boolean entropy decoder. */
class BoolDecoder {
  private readonly data: Uint8Array
  private position: number
  private readonly end: number
  private value: number
  private range = 255
  private bitCount = 0

  constructor(data: Uint8Array, start: number, end: number) {
    this.data = data
    this.end = Math.min(end, data.length)
    this.value = ((this.byteAt(start) << 8) | this.byteAt(start + 1)) >>> 0
    this.position = start + 2
  }

  private byteAt(index: number): number {
    return index < this.end ? (this.data[index] ?? 0) : 0
  }

  bit(probability: number): number {
    const split = 1 + (((this.range - 1) * probability) >> 8)
    const bigSplit = split << 8
    let result: number
    if (this.value >= bigSplit) {
      result = 1
      this.range -= split
      this.value -= bigSplit
    } else {
      result = 0
      this.range = split
    }
    while (this.range < 128) {
      this.value <<= 1
      this.range <<= 1
      this.bitCount += 1
      if (this.bitCount === 8) {
        this.bitCount = 0
        this.value |= this.byteAt(this.position)
        this.position += 1
      }
    }
    return result
  }

  literal(bits: number): number {
    let value = 0
    for (let i = bits - 1; i >= 0; i -= 1) value |= this.bit(128) << i
    return value
  }

  signedLiteral(bits: number): number {
    const value = this.literal(bits)
    return this.bit(128) === 1 ? -value : value
  }

  flag(): boolean {
    return this.bit(128) === 1
  }
}

const zigzag = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15]
const bands = [0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7, 0]
const cat3456 = [
  [173, 148, 140],
  [176, 155, 140, 135],
  [180, 157, 141, 134, 130],
  [254, 254, 243, 230, 196, 177, 153, 140, 133, 130, 129],
]

// Prediction modes; the 16 × 16 and chroma modes reuse the first four.
const modeDc = 0
const modeTm = 1
const modeVe = 2
const modeHe = 3
const modeRd = 4
const modeVr = 5
const modeLd = 6
const modeVl = 7
const modeHd = 8

type Quant = {
  y1: [number, number]
  y2: [number, number]
  uv: [number, number]
}

function clampIndex(value: number, max: number): number {
  return Math.min(max, Math.max(0, value))
}

function quantFor(
  q: number,
  deltas: {
    y1Dc: number
    y2Dc: number
    y2Ac: number
    uvDc: number
    uvAc: number
  },
): Quant {
  const y2Ac = Math.floor(
    ((acQuant[clampIndex(q + deltas.y2Ac, 127)] ?? 4) * 155) / 100,
  )
  return {
    y1: [
      dcQuant[clampIndex(q + deltas.y1Dc, 127)] ?? 4,
      acQuant[clampIndex(q, 127)] ?? 4,
    ],
    y2: [
      (dcQuant[clampIndex(q + deltas.y2Dc, 127)] ?? 4) * 2,
      Math.max(8, y2Ac),
    ],
    uv: [
      dcQuant[clampIndex(q + deltas.uvDc, 117)] ?? 4,
      acQuant[clampIndex(q + deltas.uvAc, 127)] ?? 4,
    ],
  }
}

function probabilityBase(type: number, band: number, context: number): number {
  return ((type * 8 + band) * 3 + context) * 11
}

function largeValue(br: BoolDecoder, probs: Uint8Array, p: number): number {
  if (!br.bit(probs[p + 3] ?? 0)) {
    if (!br.bit(probs[p + 4] ?? 0)) return 2
    return 3 + br.bit(probs[p + 5] ?? 0)
  }
  if (!br.bit(probs[p + 6] ?? 0)) {
    if (!br.bit(probs[p + 7] ?? 0)) return 5 + br.bit(159)
    return 7 + 2 * br.bit(165) + br.bit(145)
  }
  const bit1 = br.bit(probs[p + 8] ?? 0)
  const bit0 = br.bit(probs[p + 9 + bit1] ?? 0)
  const category = 2 * bit1 + bit0
  let value = 0
  for (const probability of cat3456[category] ?? []) {
    value = 2 * value + br.bit(probability)
  }
  return value + 3 + (8 << category)
}

/**
 * One block's tokens into `out` (dequantised, natural order). Returns the
 * index after the last non-zero coefficient, as libwebp's GetCoeffs does.
 */
function readCoefficients(
  br: BoolDecoder,
  probs: Uint8Array,
  type: number,
  context: number,
  dc: number,
  ac: number,
  first: number,
  out: Int32Array,
  offset: number,
): number {
  let p = probabilityBase(type, bands[first] ?? 0, context)
  for (let n = first; n < 16; n += 1) {
    if (!br.bit(probs[p] ?? 0)) return n
    while (!br.bit(probs[p + 1] ?? 0)) {
      n += 1
      if (n === 16) return 16
      p = probabilityBase(type, bands[n] ?? 0, 0)
    }
    let value: number
    const nextBand = bands[n + 1] ?? 0
    if (!br.bit(probs[p + 2] ?? 0)) {
      value = 1
      p = probabilityBase(type, nextBand, 1)
    } else {
      value = largeValue(br, probs, p)
      p = probabilityBase(type, nextBand, 2)
    }
    const signed = br.bit(128) === 1 ? -value : value
    out[offset + (zigzag[n] ?? 0)] = signed * (n > 0 ? ac : dc)
  }
  return 16
}

/** Each luma block's DC from the Y2 block (inverse WHT), 16 apart. */
function inverseWht(input: Int32Array, out: Int32Array): void {
  const tmp = new Int32Array(16)
  for (let i = 0; i < 4; i += 1) {
    const a0 = (input[i] ?? 0) + (input[12 + i] ?? 0)
    const a1 = (input[4 + i] ?? 0) + (input[8 + i] ?? 0)
    const a2 = (input[4 + i] ?? 0) - (input[8 + i] ?? 0)
    const a3 = (input[i] ?? 0) - (input[12 + i] ?? 0)
    tmp[i] = a0 + a1
    tmp[8 + i] = a0 - a1
    tmp[4 + i] = a3 + a2
    tmp[12 + i] = a3 - a2
  }
  for (let i = 0; i < 4; i += 1) {
    const dc = (tmp[i * 4] ?? 0) + 3
    const a0 = dc + (tmp[3 + i * 4] ?? 0)
    const a1 = (tmp[1 + i * 4] ?? 0) + (tmp[2 + i * 4] ?? 0)
    const a2 = (tmp[1 + i * 4] ?? 0) - (tmp[2 + i * 4] ?? 0)
    const a3 = dc - (tmp[3 + i * 4] ?? 0)
    out[i * 64] = (a0 + a1) >> 3
    out[i * 64 + 16] = (a3 + a2) >> 3
    out[i * 64 + 32] = (a0 - a1) >> 3
    out[i * 64 + 48] = (a3 - a2) >> 3
  }
}

// libwebp's work buffer: 32-byte rows; Y at row 1, column 8 (left samples
// in column 7, top samples in row 0, top-right samples in columns 24 to 27),
// U and V side by side below it.
const bps = 32
const yOffset = bps + 8
const uOffset = yOffset + bps * 16 + bps
const vOffset = uOffset + 16
const workSize = bps * 17 + bps * 9

/** Offset of each luma 4 × 4 block inside the macroblock. */
const blockOffsets = Array.from(
  { length: 16 },
  (_, n) => (n & 3) * 4 + (n >> 2) * 4 * bps,
)

function clip8(value: number): number {
  return Math.min(255, Math.max(0, value))
}

function avg3(a: number, b: number, c: number): number {
  return (a + 2 * b + c + 2) >> 2
}

function avg2(a: number, b: number): number {
  return (a + b + 1) >> 1
}

function at(buffer: Uint8Array, index: number): number {
  return buffer[index] ?? 0
}

function fill(buffer: Uint8Array, dst: number, size: number, value: number) {
  for (let y = 0; y < size; y += 1) {
    buffer.fill(value, dst + y * bps, dst + y * bps + size)
  }
}

function trueMotion(buffer: Uint8Array, dst: number, size: number): void {
  const topLeft = at(buffer, dst - bps - 1)
  for (let y = 0; y < size; y += 1) {
    const left = at(buffer, dst + y * bps - 1)
    for (let x = 0; x < size; x += 1) {
      buffer[dst + y * bps + x] = clip8(
        at(buffer, dst - bps + x) + left - topLeft,
      )
    }
  }
}

/** 16 × 16 luma or 8 × 8 chroma prediction (DC, TM, V, H). */
function predictBlock(
  buffer: Uint8Array,
  dst: number,
  size: number,
  mode: number,
  hasTop: boolean,
  hasLeft: boolean,
): void {
  if (mode === modeTm) {
    trueMotion(buffer, dst, size)
    return
  }
  if (mode === modeVe) {
    for (let y = 0; y < size; y += 1) {
      buffer.copyWithin(dst + y * bps, dst - bps, dst - bps + size)
    }
    return
  }
  if (mode === modeHe) {
    for (let y = 0; y < size; y += 1) {
      const row = dst + y * bps
      buffer.fill(at(buffer, row - 1), row, row + size)
    }
    return
  }
  const shift = size === 16 ? 4 : 3
  let sum = 0
  if (hasTop) {
    for (let i = 0; i < size; i += 1) sum += at(buffer, dst - bps + i)
  }
  if (hasLeft) {
    for (let j = 0; j < size; j += 1) sum += at(buffer, dst + j * bps - 1)
  }
  if (hasTop && hasLeft) fill(buffer, dst, size, (sum + size) >> (shift + 1))
  else if (hasTop || hasLeft) {
    fill(buffer, dst, size, (sum + (size >> 1)) >> shift)
  } else fill(buffer, dst, size, 0x80)
}

/** Pixel positions (x, y) inside a 4 × 4 block. */
type Cells = readonly (readonly [number, number])[]

/** One 4 × 4 luma block's prediction (the ten key-frame modes). */
function predictSubblock(buffer: Uint8Array, dst: number, mode: number): void {
  const top = dst - bps
  const A = at(buffer, top)
  const B = at(buffer, top + 1)
  const C = at(buffer, top + 2)
  const D = at(buffer, top + 3)
  const E = at(buffer, top + 4)
  const F = at(buffer, top + 5)
  const G = at(buffer, top + 6)
  const H = at(buffer, top + 7)
  const X = at(buffer, top - 1)
  const I = at(buffer, dst - 1)
  const J = at(buffer, dst + bps - 1)
  const K = at(buffer, dst + 2 * bps - 1)
  const L = at(buffer, dst + 3 * bps - 1)
  const put = (cells: Cells, value: number) => {
    for (const [x, y] of cells) buffer[dst + x + y * bps] = value
  }
  switch (mode) {
    case modeDc:
      fill(buffer, dst, 4, (A + B + C + D + I + J + K + L + 4) >> 3)
      return
    case modeTm:
      trueMotion(buffer, dst, 4)
      return
    case modeVe: {
      const values = [
        avg3(X, A, B),
        avg3(A, B, C),
        avg3(B, C, D),
        avg3(C, D, E),
      ]
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1)
          buffer[dst + x + y * bps] = values[x] ?? 0
      }
      return
    }
    case modeHe: {
      const values = [
        avg3(X, I, J),
        avg3(I, J, K),
        avg3(J, K, L),
        avg3(K, L, L),
      ]
      for (let y = 0; y < 4; y += 1) {
        buffer.fill(values[y] ?? 0, dst + y * bps, dst + y * bps + 4)
      }
      return
    }
    case modeRd:
      put([[0, 3]], avg3(J, K, L))
      put(
        [
          [1, 3],
          [0, 2],
        ],
        avg3(I, J, K),
      )
      put(
        [
          [2, 3],
          [1, 2],
          [0, 1],
        ],
        avg3(X, I, J),
      )
      put(
        [
          [3, 3],
          [2, 2],
          [1, 1],
          [0, 0],
        ],
        avg3(A, X, I),
      )
      put(
        [
          [3, 2],
          [2, 1],
          [1, 0],
        ],
        avg3(B, A, X),
      )
      put(
        [
          [3, 1],
          [2, 0],
        ],
        avg3(C, B, A),
      )
      put([[3, 0]], avg3(D, C, B))
      return
    case modeLd:
      put([[0, 0]], avg3(A, B, C))
      put(
        [
          [1, 0],
          [0, 1],
        ],
        avg3(B, C, D),
      )
      put(
        [
          [2, 0],
          [1, 1],
          [0, 2],
        ],
        avg3(C, D, E),
      )
      put(
        [
          [3, 0],
          [2, 1],
          [1, 2],
          [0, 3],
        ],
        avg3(D, E, F),
      )
      put(
        [
          [3, 1],
          [2, 2],
          [1, 3],
        ],
        avg3(E, F, G),
      )
      put(
        [
          [3, 2],
          [2, 3],
        ],
        avg3(F, G, H),
      )
      put([[3, 3]], avg3(G, H, H))
      return
    case modeVr:
      put(
        [
          [0, 0],
          [1, 2],
        ],
        avg2(X, A),
      )
      put(
        [
          [1, 0],
          [2, 2],
        ],
        avg2(A, B),
      )
      put(
        [
          [2, 0],
          [3, 2],
        ],
        avg2(B, C),
      )
      put([[3, 0]], avg2(C, D))
      put([[0, 3]], avg3(K, J, I))
      put([[0, 2]], avg3(J, I, X))
      put(
        [
          [0, 1],
          [1, 3],
        ],
        avg3(I, X, A),
      )
      put(
        [
          [1, 1],
          [2, 3],
        ],
        avg3(X, A, B),
      )
      put(
        [
          [2, 1],
          [3, 3],
        ],
        avg3(A, B, C),
      )
      put([[3, 1]], avg3(B, C, D))
      return
    case modeVl:
      put([[0, 0]], avg2(A, B))
      put(
        [
          [1, 0],
          [0, 2],
        ],
        avg2(B, C),
      )
      put(
        [
          [2, 0],
          [1, 2],
        ],
        avg2(C, D),
      )
      put(
        [
          [3, 0],
          [2, 2],
        ],
        avg2(D, E),
      )
      put([[0, 1]], avg3(A, B, C))
      put(
        [
          [1, 1],
          [0, 3],
        ],
        avg3(B, C, D),
      )
      put(
        [
          [2, 1],
          [1, 3],
        ],
        avg3(C, D, E),
      )
      put(
        [
          [3, 1],
          [2, 3],
        ],
        avg3(D, E, F),
      )
      put([[3, 2]], avg3(E, F, G))
      put([[3, 3]], avg3(F, G, H))
      return
    case modeHd:
      put(
        [
          [0, 0],
          [2, 1],
        ],
        avg2(I, X),
      )
      put(
        [
          [0, 1],
          [2, 2],
        ],
        avg2(J, I),
      )
      put(
        [
          [0, 2],
          [2, 3],
        ],
        avg2(K, J),
      )
      put([[0, 3]], avg2(L, K))
      put([[3, 0]], avg3(A, B, C))
      put([[2, 0]], avg3(X, A, B))
      put(
        [
          [1, 0],
          [3, 1],
        ],
        avg3(I, X, A),
      )
      put(
        [
          [1, 1],
          [3, 2],
        ],
        avg3(J, I, X),
      )
      put(
        [
          [1, 2],
          [3, 3],
        ],
        avg3(K, J, I),
      )
      put([[1, 3]], avg3(L, K, J))
      return
    default:
      // Horizontal-up.
      put([[0, 0]], avg2(I, J))
      put(
        [
          [2, 0],
          [0, 1],
        ],
        avg2(J, K),
      )
      put(
        [
          [2, 1],
          [0, 2],
        ],
        avg2(K, L),
      )
      put([[1, 0]], avg3(I, J, K))
      put(
        [
          [3, 0],
          [1, 1],
        ],
        avg3(J, K, L),
      )
      put(
        [
          [3, 1],
          [1, 2],
        ],
        avg3(K, L, L),
      )
      put(
        [
          [3, 2],
          [2, 2],
          [0, 3],
          [1, 3],
          [2, 3],
          [3, 3],
        ],
        L,
      )
  }
}

function mul1(value: number): number {
  return ((value * 20_091) >> 16) + value
}

function mul2(value: number): number {
  return (value * 35_468) >> 16
}

/** Inverse 4 × 4 transform of `input[offset..offset+16]`, added to `dst`. */
function addTransform(
  input: Int32Array,
  offset: number,
  buffer: Uint8Array,
  dst: number,
  tmp: Int32Array,
): void {
  for (let i = 0; i < 4; i += 1) {
    const i0 = input[offset + i] ?? 0
    const i4 = input[offset + 4 + i] ?? 0
    const i8 = input[offset + 8 + i] ?? 0
    const i12 = input[offset + 12 + i] ?? 0
    const a = i0 + i8
    const b = i0 - i8
    const c = mul2(i4) - mul1(i12)
    const d = mul1(i4) + mul2(i12)
    tmp[i * 4] = a + d
    tmp[i * 4 + 1] = b + c
    tmp[i * 4 + 2] = b - c
    tmp[i * 4 + 3] = a - d
  }
  for (let i = 0; i < 4; i += 1) {
    const dc = (tmp[i] ?? 0) + 4
    const a = dc + (tmp[8 + i] ?? 0)
    const b = dc - (tmp[8 + i] ?? 0)
    const c = mul2(tmp[4 + i] ?? 0) - mul1(tmp[12 + i] ?? 0)
    const d = mul1(tmp[4 + i] ?? 0) + mul2(tmp[12 + i] ?? 0)
    const row = dst + i * bps
    buffer[row] = clip8(at(buffer, row) + ((a + d) >> 3))
    buffer[row + 1] = clip8(at(buffer, row + 1) + ((b + c) >> 3))
    buffer[row + 2] = clip8(at(buffer, row + 2) + ((b - c) >> 3))
    buffer[row + 3] = clip8(at(buffer, row + 3) + ((a - d) >> 3))
  }
}

function hasCoefficients(input: Int32Array, offset: number): boolean {
  for (let i = offset; i < offset + 16; i += 1) {
    if (input[i] !== 0) return true
  }
  return false
}

function readIntra4Mode(br: BoolDecoder, above: number, left: number): number {
  const base = (above * 10 + left) * 9
  const p = (index: number) => subblockModeProbabilities[base + index] ?? 128
  if (!br.bit(p(0))) return modeDc
  if (!br.bit(p(1))) return modeTm
  if (!br.bit(p(2))) return modeVe
  if (!br.bit(p(3))) {
    if (!br.bit(p(4))) return modeHe
    return br.bit(p(5)) ? modeVr : modeRd
  }
  if (!br.bit(p(6))) return modeLd
  if (!br.bit(p(7))) return modeVl
  return br.bit(p(8)) ? 9 : modeHd
}

export default function decodeVp8(
  data: Uint8Array,
  limits: DecodeLimits,
): PixelSample {
  if (data.length < 10) throw new AvatarDecodeError("corrupt", "VP8 too short")
  const tag = (data[0] ?? 0) | ((data[1] ?? 0) << 8) | ((data[2] ?? 0) << 16)
  if (tag & 1) throw new AvatarDecodeError("unsupported", "VP8 inter frame")
  const partitionLength = tag >> 5
  if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
    throw new AvatarDecodeError("corrupt", "VP8 start code")
  }
  const width = ((data[6] ?? 0) | ((data[7] ?? 0) << 8)) & 0x3fff
  const height = ((data[8] ?? 0) | ((data[9] ?? 0) << 8)) & 0x3fff
  checkSize(width, height, limits)
  const firstStart = 10
  const firstEnd = firstStart + partitionLength
  if (firstEnd > data.length)
    throw new AvatarDecodeError("corrupt", "VP8 partition")
  const br = new BoolDecoder(data, firstStart, firstEnd)
  br.flag() // colour space
  br.flag() // clamping type
  // Segmentation.
  const segmentProbs = [255, 255, 255]
  const segmentQuant = [0, 0, 0, 0]
  let absoluteDelta = false
  let updateMap = false
  const useSegment = br.flag()
  if (useSegment) {
    updateMap = br.flag()
    if (br.flag()) {
      absoluteDelta = br.flag()
      for (let s = 0; s < 4; s += 1)
        segmentQuant[s] = br.flag() ? br.signedLiteral(7) : 0
      for (let s = 0; s < 4; s += 1) if (br.flag()) br.signedLiteral(6)
    }
    if (updateMap) {
      for (let s = 0; s < 3; s += 1)
        segmentProbs[s] = br.flag() ? br.literal(8) : 255
    }
  }
  // Loop filter (parsed and ignored).
  br.flag()
  br.literal(6)
  br.literal(3)
  if (br.flag() && br.flag()) {
    for (let i = 0; i < 8; i += 1) if (br.flag()) br.signedLiteral(6)
  }
  // Token partitions.
  const partitionCount = 1 << br.literal(2)
  const sizesStart = firstEnd
  let partitionStart = sizesStart + 3 * (partitionCount - 1)
  const partitions: BoolDecoder[] = []
  for (let p = 0; p < partitionCount; p += 1) {
    const isLast = p === partitionCount - 1
    const size = isLast
      ? data.length - partitionStart
      : (data[sizesStart + p * 3] ?? 0) |
        ((data[sizesStart + p * 3 + 1] ?? 0) << 8) |
        ((data[sizesStart + p * 3 + 2] ?? 0) << 16)
    partitions.push(
      new BoolDecoder(data, partitionStart, partitionStart + size),
    )
    partitionStart += size
  }
  // Quantisers.
  const baseQ = br.literal(7)
  const deltas = {
    y1Dc: br.flag() ? br.signedLiteral(4) : 0,
    y2Dc: br.flag() ? br.signedLiteral(4) : 0,
    y2Ac: br.flag() ? br.signedLiteral(4) : 0,
    uvDc: br.flag() ? br.signedLiteral(4) : 0,
    uvAc: br.flag() ? br.signedLiteral(4) : 0,
  }
  const quants = [0, 1, 2, 3].map((segment) =>
    quantFor(
      useSegment
        ? (segmentQuant[segment] ?? 0) + (absoluteDelta ? 0 : baseQ)
        : baseQ,
      deltas,
    ),
  )
  br.flag() // refresh entropy probabilities
  const probs = Uint8Array.from(coefficientProbabilities)
  for (let i = 0; i < probs.length; i += 1) {
    if (br.bit(coefficientUpdateProbabilities[i] ?? 255))
      probs[i] = br.literal(8)
  }
  const useSkip = br.flag()
  const skipProbability = useSkip ? br.literal(8) : 0

  const mbColumns = (width + 15) >> 4
  const mbRows = (height + 15) >> 4
  const grid = new SampleGrid(width, height)
  const work = new Uint8Array(workSize)
  const topY = new Uint8Array(mbColumns * 16)
  const topU = new Uint8Array(mbColumns * 8)
  const topV = new Uint8Array(mbColumns * 8)
  const intraTop = new Uint8Array(mbColumns * 4)
  const intraLeft = new Uint8Array(4)
  const topNzY = new Uint8Array(mbColumns * 4)
  const topNzU = new Uint8Array(mbColumns * 2)
  const topNzV = new Uint8Array(mbColumns * 2)
  const topNzDc = new Uint8Array(mbColumns)
  const leftNzY = new Uint8Array(4)
  const leftNzU = new Uint8Array(2)
  const leftNzV = new Uint8Array(2)
  let leftNzDc = 0
  // Per macroblock: 16 luma, 4 U and 4 V blocks of 16 coefficients.
  const coefficients = new Int32Array(384)
  const y2 = new Int32Array(16)
  const transformScratch = new Int32Array(16)
  const subModes = new Uint8Array(16)

  for (let mbY = 0; mbY < mbRows; mbY += 1) {
    const tokens = partitions[mbY & (partitionCount - 1)]
    if (tokens === undefined) {
      throw new AvatarDecodeError("corrupt", "VP8 tokens")
    }
    intraLeft.fill(modeDc)
    leftNzY.fill(0)
    leftNzU.fill(0)
    leftNzV.fill(0)
    leftNzDc = 0
    // Left edge samples and the top-left corner, as libwebp sets them.
    for (let j = 0; j < 16; j += 1) work[yOffset + j * bps - 1] = 129
    for (let j = 0; j < 8; j += 1) {
      work[uOffset + j * bps - 1] = 129
      work[vOffset + j * bps - 1] = 129
    }
    if (mbY > 0) {
      work[yOffset - bps - 1] = 129
      work[uOffset - bps - 1] = 129
      work[vOffset - bps - 1] = 129
    } else {
      work.fill(127, yOffset - bps - 1, yOffset - bps + 20)
      work.fill(127, uOffset - bps - 1, uOffset - bps + 8)
      work.fill(127, vOffset - bps - 1, vOffset - bps + 8)
    }
    for (let mbX = 0; mbX < mbColumns; mbX += 1) {
      // Modes, from the first partition.
      let segment = 0
      if (updateMap) {
        segment = !br.bit(segmentProbs[0] ?? 255)
          ? br.bit(segmentProbs[1] ?? 255)
          : br.bit(segmentProbs[2] ?? 255) + 2
      }
      const skip = useSkip ? br.bit(skipProbability) === 1 : false
      const isIntra4 = !br.bit(145)
      let lumaMode = modeDc
      if (!isIntra4) {
        lumaMode = br.bit(156)
          ? br.bit(128)
            ? modeTm
            : modeHe
          : br.bit(163)
            ? modeVe
            : modeDc
        intraTop.fill(lumaMode, mbX * 4, mbX * 4 + 4)
        intraLeft.fill(lumaMode)
      } else {
        for (let y = 0; y < 4; y += 1) {
          let leftMode = intraLeft[y] ?? 0
          for (let x = 0; x < 4; x += 1) {
            leftMode = readIntra4Mode(br, intraTop[mbX * 4 + x] ?? 0, leftMode)
            intraTop[mbX * 4 + x] = leftMode
            subModes[y * 4 + x] = leftMode
          }
          intraLeft[y] = leftMode
        }
      }
      const chromaMode = !br.bit(142)
        ? modeDc
        : !br.bit(114)
          ? modeVe
          : br.bit(183)
            ? modeTm
            : modeHe

      // Coefficients, from this row's token partition.
      coefficients.fill(0)
      const quant = quants[segment] ?? quants[0]
      if (quant === undefined) {
        throw new AvatarDecodeError("corrupt", "VP8 quant")
      }
      if (skip) {
        topNzY.fill(0, mbX * 4, mbX * 4 + 4)
        topNzU.fill(0, mbX * 2, mbX * 2 + 2)
        topNzV.fill(0, mbX * 2, mbX * 2 + 2)
        leftNzY.fill(0)
        leftNzU.fill(0)
        leftNzV.fill(0)
        if (!isIntra4) {
          topNzDc[mbX] = 0
          leftNzDc = 0
        }
      } else {
        let first = 0
        let lumaType = 3
        if (!isIntra4) {
          y2.fill(0)
          const context = (topNzDc[mbX] ?? 0) + leftNzDc
          const last = readCoefficients(
            tokens,
            probs,
            1,
            context,
            quant.y2[0],
            quant.y2[1],
            0,
            y2,
            0,
          )
          const nonZero = last > 0 ? 1 : 0
          topNzDc[mbX] = nonZero
          leftNzDc = nonZero
          if (last > 1) {
            inverseWht(y2, coefficients)
          } else {
            const dc = ((y2[0] ?? 0) + 3) >> 3
            for (let n = 0; n < 16; n += 1) coefficients[n * 16] = dc
          }
          first = 1
          lumaType = 0
        }
        for (let y = 0; y < 4; y += 1) {
          for (let x = 0; x < 4; x += 1) {
            const context = (topNzY[mbX * 4 + x] ?? 0) + (leftNzY[y] ?? 0)
            const last = readCoefficients(
              tokens,
              probs,
              lumaType,
              context,
              quant.y1[0],
              quant.y1[1],
              first,
              coefficients,
              (y * 4 + x) * 16,
            )
            const nonZero = last > first ? 1 : 0
            topNzY[mbX * 4 + x] = nonZero
            leftNzY[y] = nonZero
          }
        }
        for (const [plane, top, left] of [
          [16, topNzU, leftNzU],
          [20, topNzV, leftNzV],
        ] as const) {
          for (let y = 0; y < 2; y += 1) {
            for (let x = 0; x < 2; x += 1) {
              const context = (top[mbX * 2 + x] ?? 0) + (left[y] ?? 0)
              const last = readCoefficients(
                tokens,
                probs,
                2,
                context,
                quant.uv[0],
                quant.uv[1],
                0,
                coefficients,
                (plane + y * 2 + x) * 16,
              )
              const nonZero = last > 0 ? 1 : 0
              top[mbX * 2 + x] = nonZero
              left[y] = nonZero
            }
          }
        }
      }

      // Reconstruct: rotate in the left samples, bring in the top ones.
      if (mbX > 0) {
        for (let j = -1; j < 16; j += 1) {
          const row = yOffset + j * bps
          work.copyWithin(row - 4, row + 12, row + 16)
        }
        for (let j = -1; j < 8; j += 1) {
          const u = uOffset + j * bps
          const v = vOffset + j * bps
          work.copyWithin(u - 4, u + 4, u + 8)
          work.copyWithin(v - 4, v + 4, v + 8)
        }
      }
      if (mbY > 0) {
        work.set(topY.subarray(mbX * 16, mbX * 16 + 16), yOffset - bps)
        work.set(topU.subarray(mbX * 8, mbX * 8 + 8), uOffset - bps)
        work.set(topV.subarray(mbX * 8, mbX * 8 + 8), vOffset - bps)
      }
      if (isIntra4) {
        const topRight = yOffset - bps + 16
        if (mbY > 0) {
          if (mbX >= mbColumns - 1) {
            work.fill(topY[mbX * 16 + 15] ?? 0, topRight, topRight + 4)
          } else {
            const next = (mbX + 1) * 16
            work.set(topY.subarray(next, next + 4), topRight)
          }
        }
        for (const row of [4, 8, 12]) {
          work.copyWithin(topRight + row * bps, topRight, topRight + 4)
        }
        for (let n = 0; n < 16; n += 1) {
          const dst = yOffset + (blockOffsets[n] ?? 0)
          predictSubblock(work, dst, subModes[n] ?? 0)
          if (hasCoefficients(coefficients, n * 16)) {
            addTransform(coefficients, n * 16, work, dst, transformScratch)
          }
        }
      } else {
        predictBlock(work, yOffset, 16, lumaMode, mbY > 0, mbX > 0)
        for (let n = 0; n < 16; n += 1) {
          if (hasCoefficients(coefficients, n * 16)) {
            const dst = yOffset + (blockOffsets[n] ?? 0)
            addTransform(coefficients, n * 16, work, dst, transformScratch)
          }
        }
      }
      for (const [plane, offset] of [
        [16, uOffset],
        [20, vOffset],
      ] as const) {
        predictBlock(work, offset, 8, chromaMode, mbY > 0, mbX > 0)
        for (let n = 0; n < 4; n += 1) {
          const block = (plane + n) * 16
          if (hasCoefficients(coefficients, block)) {
            const dst = offset + (n & 1) * 4 + (n >> 1) * 4 * bps
            addTransform(coefficients, block, work, dst, transformScratch)
          }
        }
      }
      if (mbY < mbRows - 1) {
        const y = yOffset + 15 * bps
        const u = uOffset + 7 * bps
        const v = vOffset + 7 * bps
        topY.set(work.subarray(y, y + 16), mbX * 16)
        topU.set(work.subarray(u, u + 8), mbX * 8)
        topV.set(work.subarray(v, v + 8), mbX * 8)
      }

      // Sample this macroblock's grid pixels.
      for (let py = 0; py < 16; py += 1) {
        const y = mbY * 16 + py
        if (y >= height || !grid.wantsRow(y)) continue
        for (let px = 0; px < 16; px += 1) {
          const x = mbX * 16 + px
          if (x >= width || x % grid.stepX !== 0) continue
          const luma = 1.164 * (at(work, yOffset + py * bps + px) - 16)
          const u = at(work, uOffset + (py >> 1) * bps + (px >> 1)) - 128
          const v = at(work, vOffset + (py >> 1) * bps + (px >> 1)) - 128
          grid.set(
            x,
            y,
            clampByte(luma + 1.596 * v),
            clampByte(luma - 0.813 * v - 0.391 * u),
            clampByte(luma + 2.018 * u),
            255,
          )
        }
      }
    }
  }
  return grid.sample(width, height)
}
