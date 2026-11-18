import {
  AvatarDecodeError,
  checkSize,
  type DecodeLimits,
  type PixelSample,
  SampleGrid,
} from "./sample"

// PNG to a sample grid. Inflate runs natively (DecompressionStream) and
// rows are unfiltered as they stream out, so memory stays at two rows
// whatever the size. Interlaced images stop after Adam7's first pass, an
// eighth-scale copy of the whole image.

type Header = {
  width: number
  height: number
  depth: number
  colorType: number
  interlaced: boolean
}

const channelsByColorType: Readonly<Record<number, number>> = {
  0: 1,
  2: 3,
  3: 1,
  4: 2,
  6: 4,
}

const validDepths: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      (((bytes[offset + 1] ?? 0) << 16) |
        ((bytes[offset + 2] ?? 0) << 8) |
        (bytes[offset + 3] ?? 0))) >>>
    0
  )
}

export function isPng(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
}

/** Turns one pixel of an unfiltered row into RGBA. */
type PixelReader = (row: Uint8Array, x: number, out: Uint8Array) => void

function pixelReader(
  header: Header,
  palette: Uint8Array | null,
  transparency: Uint8Array | null,
): PixelReader {
  const { depth, colorType } = header
  const wide = depth === 16
  const step = wide ? 2 : 1
  // tRNS key colours compare raw samples (16-bit when the depth is 16).
  const key = (index: number) =>
    transparency === null
      ? -1
      : ((transparency[index * 2] ?? 0) << 8) |
        (transparency[index * 2 + 1] ?? 0)
  const sample = (row: Uint8Array, offset: number) =>
    wide
      ? ((row[offset] ?? 0) << 8) | (row[offset + 1] ?? 0)
      : (row[offset] ?? 0)
  const toByte = (value: number) => (wide ? value >> 8 : value)
  switch (colorType) {
    case 0: {
      const grayKey = key(0)
      const max = (1 << depth) - 1
      return (row, x, out) => {
        let value: number
        if (depth < 8) {
          const bit = x * depth
          value = ((row[bit >> 3] ?? 0) >> (8 - depth - (bit & 7))) & max
        } else {
          value = sample(row, x * step)
        }
        const gray = depth < 8 ? Math.round((value * 255) / max) : toByte(value)
        out[0] = gray
        out[1] = gray
        out[2] = gray
        out[3] = value === grayKey ? 0 : 255
      }
    }
    case 2: {
      const keys = [key(0), key(1), key(2)]
      return (row, x, out) => {
        const offset = x * 3 * step
        const r = sample(row, offset)
        const g = sample(row, offset + step)
        const b = sample(row, offset + 2 * step)
        out[0] = toByte(r)
        out[1] = toByte(g)
        out[2] = toByte(b)
        out[3] = r === keys[0] && g === keys[1] && b === keys[2] ? 0 : 255
      }
    }
    case 3: {
      if (palette === null) {
        throw new AvatarDecodeError("corrupt", "PNG palette missing")
      }
      const max = (1 << depth) - 1
      return (row, x, out) => {
        let index: number
        if (depth < 8) {
          const bit = x * depth
          index = ((row[bit >> 3] ?? 0) >> (8 - depth - (bit & 7))) & max
        } else {
          index = row[x] ?? 0
        }
        out[0] = palette[index * 3] ?? 0
        out[1] = palette[index * 3 + 1] ?? 0
        out[2] = palette[index * 3 + 2] ?? 0
        out[3] = transparency?.[index] ?? 255
      }
    }
    case 4:
      return (row, x, out) => {
        const offset = x * 2 * step
        const gray = toByte(sample(row, offset))
        out[0] = gray
        out[1] = gray
        out[2] = gray
        out[3] = toByte(sample(row, offset + step))
      }
    default:
      return (row, x, out) => {
        const offset = x * 4 * step
        out[0] = toByte(sample(row, offset))
        out[1] = toByte(sample(row, offset + step))
        out[2] = toByte(sample(row, offset + 2 * step))
        out[3] = toByte(sample(row, offset + 3 * step))
      }
  }
}

/** Reverses one row's filter in place; `previous` is the row above. */
function unfilter(
  filter: number,
  row: Uint8Array,
  previous: Uint8Array,
  bpp: number,
): void {
  const length = row.length
  switch (filter) {
    case 0:
      return
    case 1:
      for (let i = bpp; i < length; i += 1) {
        row[i] = (row[i] ?? 0) + (row[i - bpp] ?? 0)
      }
      return
    case 2:
      for (let i = 0; i < length; i += 1) {
        row[i] = (row[i] ?? 0) + (previous[i] ?? 0)
      }
      return
    case 3:
      for (let i = 0; i < length; i += 1) {
        const left = i >= bpp ? (row[i - bpp] ?? 0) : 0
        row[i] = (row[i] ?? 0) + ((left + (previous[i] ?? 0)) >> 1)
      }
      return
    case 4:
      for (let i = 0; i < length; i += 1) {
        const a = i >= bpp ? (row[i - bpp] ?? 0) : 0
        const b = previous[i] ?? 0
        const c = i >= bpp ? (previous[i - bpp] ?? 0) : 0
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        row[i] = (row[i] ?? 0) + predictor
      }
      return
    default:
      throw new AvatarDecodeError("corrupt", `PNG filter ${filter}`)
  }
}

function inflate(parts: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
  return source.pipeThrough(new DecompressionStream("deflate"))
}

export default async function decodePng(
  bytes: Uint8Array,
  limits: DecodeLimits,
): Promise<PixelSample> {
  if (!isPng(bytes)) throw new AvatarDecodeError("corrupt", "Not a PNG")
  let header: Header | null = null
  let palette: Uint8Array | null = null
  let transparency: Uint8Array | null = null
  const data: Uint8Array[] = []
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = u32(bytes, offset)
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    )
    const start = offset + 8
    const end = start + length
    if (end > bytes.length) break
    const body = bytes.subarray(start, end)
    if (type === "IHDR") {
      header = {
        width: u32(body, 0),
        height: u32(body, 4),
        depth: body[8] ?? 0,
        colorType: body[9] ?? 0,
        interlaced: body[12] === 1,
      }
    } else if (type === "PLTE") {
      palette = body
    } else if (type === "tRNS") {
      transparency = body
    } else if (type === "IDAT") {
      data.push(body)
    } else if (type === "IEND") {
      break
    }
    offset = end + 4
  }
  if (header === null || data.length === 0) {
    throw new AvatarDecodeError("corrupt", "PNG without IHDR or IDAT")
  }
  const channels = channelsByColorType[header.colorType]
  if (
    channels === undefined ||
    !(validDepths[header.colorType] ?? []).includes(header.depth)
  ) {
    throw new AvatarDecodeError(
      "unsupported",
      `PNG colour type ${header.colorType} depth ${header.depth}`,
    )
  }
  checkSize(header.width, header.height, limits)
  // Adam7's first pass holds every eighth pixel of every eighth row.
  const width = header.interlaced ? Math.ceil(header.width / 8) : header.width
  const height = header.interlaced
    ? Math.ceil(header.height / 8)
    : header.height
  const bitsPerPixel = channels * header.depth
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8)
  const read = pixelReader(header, palette, transparency)
  const grid = new SampleGrid(width, height)
  const pixel = new Uint8Array(4)
  let row = new Uint8Array(rowBytes + 1)
  let previous = new Uint8Array(rowBytes + 1)
  let filled = 0
  let y = 0
  const reader = inflate(data).getReader()
  try {
    while (y < height) {
      const chunk = await reader.read()
      if (chunk.done) break
      let position = 0
      const value = chunk.value
      while (position < value.length && y < height) {
        const take = Math.min(row.length - filled, value.length - position)
        row.set(value.subarray(position, position + take), filled)
        filled += take
        position += take
        if (filled < row.length) break
        const pixels = row.subarray(1)
        unfilter(row[0] ?? 0, pixels, previous.subarray(1), bpp)
        if (grid.wantsRow(y)) {
          for (let x = 0; x < width; x += grid.stepX) {
            read(pixels, x, pixel)
            grid.set(
              x,
              y,
              pixel[0] ?? 0,
              pixel[1] ?? 0,
              pixel[2] ?? 0,
              pixel[3] ?? 0,
            )
          }
        }
        const swap = previous
        previous = row
        row = swap
        filled = 0
        y += 1
      }
    }
  } catch (error) {
    // A truncated or corrupt stream still yields the rows before the damage.
    if (y === 0) {
      throw new AvatarDecodeError(
        "corrupt",
        `PNG inflate failed: ${String(error)}`,
      )
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }
  if (y === 0) throw new AvatarDecodeError("corrupt", "PNG has no rows")
  return grid.sample(header.width, header.height)
}
