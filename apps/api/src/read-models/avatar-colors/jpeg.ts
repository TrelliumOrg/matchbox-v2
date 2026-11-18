import {
  AvatarDecodeError,
  checkSize,
  clampByte,
  type DecodeLimits,
  type PixelSample,
  SampleGrid,
} from "./sample"

// JPEG to a sample grid from DC coefficients only: a block's DC is its mean,
// so the decoder never runs an inverse DCT. Progressive files stop after
// their first DC scans (the first few kilobytes); baseline files decode the
// Huffman stream and skip every AC value. Huffman-coded baseline, extended
// and progressive frames with one (grey) or three components are supported.

type HuffmanTable = {
  /** Largest code of each length, -1 when the length has no codes. */
  maxCode: Int32Array
  /** Index into `symbols` of each length's first code, minus that code. */
  offset: Int32Array
  symbols: Uint8Array
}

type Component = {
  id: number
  h: number
  v: number
  quantTable: number
  /** Blocks per line and column, padded to whole MCUs. */
  blocksPerLine: number
  blocksPerColumn: number
  /** Blocks that cover the image (non-interleaved scans walk these). */
  usedPerLine: number
  usedPerColumn: number
  dc: Int32Array
  hasDc: boolean
  prediction: number
}

type Frame = {
  progressive: boolean
  width: number
  height: number
  hMax: number
  vMax: number
  mcusPerLine: number
  mcusPerColumn: number
  components: Component[]
}

function buildHuffman(counts: Uint8Array, symbols: Uint8Array): HuffmanTable {
  const maxCode = new Int32Array(17).fill(-1)
  const offset = new Int32Array(17)
  let code = 0
  let index = 0
  for (let length = 1; length <= 16; length += 1) {
    const count = counts[length - 1] ?? 0
    offset[length] = index - code
    if (count > 0) {
      code += count
      index += count
      maxCode[length] = code - 1
    }
    code <<= 1
  }
  return { maxCode, offset, symbols }
}

/** Entropy-coded bits with 0xFF00 stuffing; a marker reads as zeros. */
class ScanReader {
  readonly data: Uint8Array
  position: number
  private bits = 0
  private count = 0

  constructor(data: Uint8Array, position: number) {
    this.data = data
    this.position = position
  }

  bit(): number {
    if (this.count === 0) {
      const byte = this.data[this.position]
      if (byte === undefined) {
        this.bits = 0
      } else if (byte === 0xff) {
        const next = this.data[this.position + 1]
        if (next === 0) {
          this.bits = 0xff
          this.position += 2
        } else {
          this.bits = 0
        }
      } else {
        this.bits = byte
        this.position += 1
      }
      this.count = 8
    }
    this.count -= 1
    return (this.bits >> this.count) & 1
  }

  receive(length: number): number {
    let value = 0
    for (let i = 0; i < length; i += 1) value = (value << 1) | this.bit()
    return value
  }

  /** The signed value of a `length`-bit magnitude category. */
  receiveExtend(length: number): number {
    if (length === 0) return 0
    if (length === 1) return this.bit() === 1 ? 1 : -1
    const value = this.receive(length)
    return value >= 1 << (length - 1) ? value : value - (1 << length) + 1
  }

  decode(table: HuffmanTable): number {
    let code = 0
    for (let length = 1; length <= 16; length += 1) {
      code = (code << 1) | this.bit()
      if (code <= (table.maxCode[length] ?? -1)) {
        const symbol = table.symbols[(table.offset[length] ?? 0) + code]
        if (symbol === undefined) break
        return symbol
      }
    }
    throw new AvatarDecodeError("corrupt", "Bad JPEG Huffman code")
  }

  /** Drops buffered bits and steps over an RSTn marker. */
  restart(): void {
    this.count = 0
    const data = this.data
    while (this.position + 1 < data.length) {
      const next = data[this.position + 1] ?? 0
      if (data[this.position] === 0xff && next >= 0xd0 && next <= 0xd7) {
        this.position += 2
        return
      }
      if (data[this.position] === 0xff && next !== 0 && next !== 0xff) return
      this.position += 1
    }
  }
}

/** The offset of the next marker (not a stuffed byte or RSTn) from `from`. */
function nextMarker(data: Uint8Array, from: number): number {
  for (let i = from; i + 1 < data.length; i += 1) {
    if (data[i] !== 0xff) continue
    const next = data[i + 1] ?? 0
    if (next !== 0 && next !== 0xff && (next < 0xd0 || next > 0xd7)) return i
  }
  return data.length
}

function u16(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function readFrame(
  segment: Uint8Array,
  progressive: boolean,
  limits: DecodeLimits,
): Frame {
  if (segment[0] !== 8) {
    throw new AvatarDecodeError("unsupported", `JPEG precision ${segment[0]}`)
  }
  const height = u16(segment, 1)
  const width = u16(segment, 3)
  checkSize(width, height, limits)
  const count = segment[5] ?? 0
  if (count !== 1 && count !== 3) {
    throw new AvatarDecodeError("unsupported", `JPEG with ${count} components`)
  }
  const raw = Array.from({ length: count }, (_, index) => {
    const base = 6 + index * 3
    const sampling = segment[base + 1] ?? 0x11
    return {
      id: segment[base] ?? 0,
      h: Math.max(1, sampling >> 4),
      v: Math.max(1, sampling & 15),
      quantTable: (segment[base + 2] ?? 0) & 3,
    }
  })
  const hMax = Math.max(...raw.map((component) => component.h))
  const vMax = Math.max(...raw.map((component) => component.v))
  const mcusPerLine = Math.ceil(width / (8 * hMax))
  const mcusPerColumn = Math.ceil(height / (8 * vMax))
  const components = raw.map((component): Component => {
    const blocksPerLine = mcusPerLine * component.h
    const blocksPerColumn = mcusPerColumn * component.v
    return {
      ...component,
      blocksPerLine,
      blocksPerColumn,
      usedPerLine: Math.ceil(Math.ceil((width * component.h) / hMax) / 8),
      usedPerColumn: Math.ceil(Math.ceil((height * component.v) / vMax) / 8),
      dc: new Int32Array(blocksPerLine * blocksPerColumn),
      hasDc: false,
      prediction: 0,
    }
  })
  return {
    progressive,
    width,
    height,
    hMax,
    vMax,
    mcusPerLine,
    mcusPerColumn,
    components,
  }
}

type Scan = {
  components: {
    component: Component
    dcTable: HuffmanTable
    acTable: HuffmanTable | null
  }[]
  start: number
  end: number
  high: number
  low: number
}

/** Decodes one scan's DC values; AC values are read and dropped. */
function decodeScan(
  reader: ScanReader,
  frame: Frame,
  scan: Scan,
  restartInterval: number,
): void {
  const single = scan.components.length === 1
  const first = scan.components[0]
  const totalMcus =
    single && first !== undefined
      ? first.component.usedPerLine * first.component.usedPerColumn
      : frame.mcusPerLine * frame.mcusPerColumn
  const decodeBlock = (
    entry: Scan["components"][number],
    row: number,
    column: number,
  ) => {
    const { component, dcTable, acTable } = entry
    const category = reader.decode(dcTable)
    const difference = reader.receiveExtend(category)
    component.prediction += difference
    component.dc[row * component.blocksPerLine + column] =
      component.prediction * (1 << scan.low)
    if (frame.progressive) return
    if (acTable === null) {
      throw new AvatarDecodeError("corrupt", "JPEG scan without an AC table")
    }
    // Baseline: walk the AC run-lengths to reach the next block.
    for (let k = 1; k < 64; ) {
      const symbol = reader.decode(acTable)
      const run = symbol >> 4
      const size = symbol & 15
      if (size === 0) {
        if (run !== 15) break
        k += 16
        continue
      }
      k += run
      reader.receive(size)
      k += 1
    }
  }
  for (const entry of scan.components) entry.component.prediction = 0
  for (let mcu = 0; mcu < totalMcus; mcu += 1) {
    if (restartInterval > 0 && mcu > 0 && mcu % restartInterval === 0) {
      reader.restart()
      for (const entry of scan.components) entry.component.prediction = 0
    }
    if (single && first !== undefined) {
      const perLine = first.component.usedPerLine
      decodeBlock(first, Math.floor(mcu / perLine), mcu % perLine)
      continue
    }
    const mcuRow = Math.floor(mcu / frame.mcusPerLine)
    const mcuColumn = mcu % frame.mcusPerLine
    for (const entry of scan.components) {
      const { h, v } = entry.component
      for (let y = 0; y < v; y += 1) {
        for (let x = 0; x < h; x += 1) {
          decodeBlock(entry, mcuRow * v + y, mcuColumn * h + x)
        }
      }
    }
  }
  for (const entry of scan.components) entry.component.hasDc = true
}

function toSample(
  frame: Frame,
  dcScale: Map<Component, number>,
  rgb: boolean,
): PixelSample {
  const columns = Math.ceil(frame.width / 8)
  const rows = Math.ceil(frame.height / 8)
  const grid = new SampleGrid(columns, rows)
  const mean = (component: Component, row: number, column: number) => {
    const blockRow = Math.floor((row * component.v) / frame.vMax)
    const blockColumn = Math.floor((column * component.h) / frame.hMax)
    const dc =
      component.dc[blockRow * component.blocksPerLine + blockColumn] ?? 0
    return (dc * (dcScale.get(component) ?? 1)) / 8 + 128
  }
  const [first, second, third] = frame.components
  if (first === undefined)
    throw new AvatarDecodeError("corrupt", "No JPEG components")
  for (let row = 0; row < rows; row += grid.stepY) {
    for (let column = 0; column < columns; column += grid.stepX) {
      const y = mean(first, row, column)
      if (second === undefined || third === undefined) {
        const gray = clampByte(y)
        grid.set(column, row, gray, gray, gray, 255)
        continue
      }
      const cb = mean(second, row, column)
      const cr = mean(third, row, column)
      if (rgb) {
        grid.set(column, row, clampByte(y), clampByte(cb), clampByte(cr), 255)
        continue
      }
      grid.set(
        column,
        row,
        clampByte(y + 1.402 * (cr - 128)),
        clampByte(y - 0.344_136 * (cb - 128) - 0.714_136 * (cr - 128)),
        clampByte(y + 1.772 * (cb - 128)),
        255,
      )
    }
  }
  return grid.sample(frame.width, frame.height)
}

export default function decodeJpeg(
  data: Uint8Array,
  limits: DecodeLimits,
): PixelSample {
  if (!isJpeg(data)) throw new AvatarDecodeError("corrupt", "Not a JPEG")
  const quantDc = new Map<number, number>()
  const dcTables = new Map<number, HuffmanTable>()
  const acTables = new Map<number, HuffmanTable>()
  let frame: Frame | null = null
  let restartInterval = 0
  let adobeTransform: number | null = null
  let position = 2
  while (position < data.length) {
    if (data[position] !== 0xff) {
      position = nextMarker(data, position)
      continue
    }
    const marker = data[position + 1] ?? 0
    position += 2
    if (marker === 0xff) {
      position -= 1
      continue
    }
    if (marker === 0xd9) break
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue
    const length = u16(data, position)
    const segment = data.subarray(position + 2, position + length)
    const segmentEnd = position + length
    if (marker === 0xdb) {
      for (let offset = 0; offset < segment.length; ) {
        const info = segment[offset] ?? 0
        const wide = info >> 4 === 1
        quantDc.set(
          info & 15,
          wide ? u16(segment, offset + 1) : (segment[offset + 1] ?? 1),
        )
        offset += 1 + (wide ? 128 : 64)
      }
    } else if (marker === 0xc4) {
      for (let offset = 0; offset < segment.length; ) {
        const info = segment[offset] ?? 0
        const counts = segment.subarray(offset + 1, offset + 17)
        const total = counts.reduce((sum, count) => sum + count, 0)
        const symbols = segment.slice(offset + 17, offset + 17 + total)
        const table = buildHuffman(counts, symbols)
        if (info >> 4 === 0) dcTables.set(info & 15, table)
        else acTables.set(info & 15, table)
        offset += 17 + total
      }
    } else if (marker === 0xdd) {
      restartInterval = u16(segment, 0)
    } else if (marker === 0xee) {
      const isAdobe = String.fromCharCode(...segment.subarray(0, 5)) === "Adobe"
      if (isAdobe) adobeTransform = segment[11] ?? null
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      frame = readFrame(segment, marker === 0xc2, limits)
    } else if (
      marker >= 0xc3 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      throw new AvatarDecodeError("unsupported", `JPEG SOF${marker - 0xc0}`)
    } else if (marker === 0xda) {
      if (frame === null)
        throw new AvatarDecodeError("corrupt", "JPEG scan before frame")
      const currentFrame = frame
      const count = segment[0] ?? 0
      const components: Scan["components"] = []
      for (let index = 0; index < count; index += 1) {
        const id = segment[1 + index * 2]
        const tables = segment[2 + index * 2] ?? 0
        const component = currentFrame.components.find(
          (entry) => entry.id === id,
        )
        const dcTable = dcTables.get(tables >> 4)
        if (component === undefined) {
          throw new AvatarDecodeError("corrupt", "JPEG scan names no component")
        }
        components.push({
          component,
          dcTable:
            dcTable ?? buildHuffman(new Uint8Array(16), new Uint8Array(0)),
          acTable: acTables.get(tables & 15) ?? null,
        })
      }
      const base = 1 + count * 2
      const scan: Scan = {
        components,
        start: segment[base] ?? 0,
        end: segment[base + 1] ?? 63,
        high: (segment[base + 2] ?? 0) >> 4,
        low: (segment[base + 2] ?? 0) & 15,
      }
      const isDcFirst = scan.start === 0 && scan.high === 0
      if (isDcFirst && components.some((entry) => !entry.component.hasDc)) {
        const reader = new ScanReader(data, segmentEnd)
        decodeScan(reader, currentFrame, scan, restartInterval)
        position = nextMarker(data, reader.position)
      } else {
        position = nextMarker(data, segmentEnd)
      }
      if (currentFrame.components.every((entry) => entry.hasDc)) break
      continue
    }
    position = segmentEnd
  }
  if (frame === null || !frame.components.every((entry) => entry.hasDc)) {
    throw new AvatarDecodeError("corrupt", "JPEG ended before its DC scans")
  }
  const dcScale = new Map(
    frame.components.map((component) => [
      component,
      quantDc.get(component.quantTable) ?? 1,
    ]),
  )
  const ids = frame.components.map((component) => component.id)
  const rgb =
    adobeTransform === 0 ||
    (adobeTransform === null && ids[0] === 82 && ids[1] === 71 && ids[2] === 66)
  return toSample(frame, dcScale, rgb)
}
