import { describe, expect, it } from "vitest"
import { createSseParser, type SseMessage } from "./sse"

function parse(chunks: readonly string[]): SseMessage[] {
  const messages: SseMessage[] = []
  const parser = createSseParser((message) => messages.push(message))
  for (const chunk of chunks) parser.push(chunk)
  parser.end()
  return messages
}

describe("createSseParser", () => {
  it("dispatches a message on a blank line with its event name", () => {
    expect(parse(['event: status\ndata: {"a":1}\n\n'])).toEqual([
      { event: "status", data: '{"a":1}' },
    ])
  })

  it("survives any chunk boundary, including inside a field name", () => {
    const stream =
      'event: status\ndata: {"type":"status","text":"Reading 34 gauges"}\n\nevent: done\ndata: {"type":"done"}\n\n'
    const whole = parse([stream])
    for (let size = 1; size < 12; size += 1) {
      const chunks: string[] = []
      for (let at = 0; at < stream.length; at += size) {
        chunks.push(stream.slice(at, at + size))
      }
      expect(parse(chunks)).toEqual(whole)
    }
    expect(whole).toHaveLength(2)
  })

  it("joins multi-line data with LF and handles CRLF split across chunks", () => {
    expect(parse(["data: one\r", "\ndata: two\r\n\r", "\n"])).toEqual([
      { event: "message", data: "one\ntwo" },
    ])
    expect(parse(["data: a\rdata: b\r\r"])).toEqual([
      { event: "message", data: "a\nb" },
    ])
  })

  it("ignores comments, unknown fields and empty messages", () => {
    expect(
      parse([": keep-alive\n\nid: 7\nretry: 100\n\nfoo: bar\ndata:x\n\n"]),
    ).toEqual([{ event: "message", data: "x" }])
  })

  it("drops an unterminated message at the end of the stream", () => {
    expect(parse(["data: complete\n\ndata: cut off"])).toEqual([
      { event: "message", data: "complete" },
    ])
  })

  it("strips a leading byte order mark", () => {
    expect(parse(["﻿data: hi\n\n"])).toEqual([{ event: "message", data: "hi" }])
  })
})
