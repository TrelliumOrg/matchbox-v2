// Tiny encoded avatars for tests. 8 × 8 PNGs, deflate-stored (no
// compression), so they need no encoder at test time.

/** CRC-free PNG of `width × height` RGBA pixels, every pixel `rgba`. */
export function solidPng(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): Uint8Array {
  const rowBytes = width * 4 + 1
  const raw = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw.set(rgba, y * rowBytes + 1 + x * 4)
  }
  // zlib header, one stored block, Adler-32 (unchecked by the decoder).
  const stored = new Uint8Array(2 + 5 + raw.length + 4)
  stored.set([0x78, 0x01, 0x01, raw.length & 255, raw.length >> 8])
  stored.set([~raw.length & 255, (~raw.length >> 8) & 255], 5)
  stored.set(raw, 7)
  let adlerA = 1
  let adlerB = 0
  for (const byte of raw) {
    adlerA = (adlerA + byte) % 65_521
    adlerB = (adlerB + adlerA) % 65_521
  }
  const adler = ((adlerB << 16) | adlerA) >>> 0
  stored.set(
    [adler >>> 24, (adler >>> 16) & 255, (adler >>> 8) & 255, adler & 255],
    7 + raw.length,
  )
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length)
    new DataView(out.buffer).setUint32(0, body.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(body, 8)
    return out
  }
  const header = new Uint8Array(13)
  new DataView(header.buffer).setUint32(0, width)
  new DataView(header.buffer).setUint32(4, height)
  header[8] = 8
  header[9] = 6
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", stored),
    chunk("IEND", new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** A fake fetch serving `images` by URL and counting requests. */
export function fakeImageFetch(images: ReadonlyMap<string, Uint8Array>) {
  const requests: string[] = []
  const fetcher = async (url: string): Promise<Response> => {
    requests.push(url)
    const image = images.get(url)
    if (image === undefined) return new Response("missing", { status: 404 })
    return new Response(image, { headers: { "content-type": "image/png" } })
  }
  return { fetcher, requests }
}
