/**
 * Incremental Server-Sent Events parser (WHATWG event stream format). Feed
 * it decoded text in any chunking: lines may end in LF, CR or CRLF (a CR at
 * the end of a chunk waits for the next one), several `data:` lines join
 * with LF, comments and unknown fields are ignored, and a message is
 * dispatched on a blank line. An unterminated message at the end is dropped,
 * as the spec says.
 */

export type SseMessage = {
  /** The `event:` field, "message" when absent. */
  event: string
  data: string
}

export type SseParser = {
  push: (chunk: string) => void
  /** End of stream: forgets any unterminated message. */
  end: () => void
}

export function createSseParser(
  onMessage: (message: SseMessage) => void,
): SseParser {
  let buffer = ""
  let event = ""
  let data: string[] = []
  let started = false

  function dispatch(): void {
    if (data.length > 0) {
      onMessage({
        event: event === "" ? "message" : event,
        data: data.join("\n"),
      })
    }
    event = ""
    data = []
  }

  function line(text: string): void {
    if (text === "") {
      dispatch()
      return
    }
    if (text.startsWith(":")) return
    const colon = text.indexOf(":")
    const field = colon === -1 ? text : text.slice(0, colon)
    let value = colon === -1 ? "" : text.slice(colon + 1)
    if (value.startsWith(" ")) value = value.slice(1)
    if (field === "event") event = value
    else if (field === "data") data.push(value)
  }

  function push(chunk: string): void {
    buffer += chunk
    if (!started && buffer.length > 0) {
      started = true
      if (buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1)
    }
    let start = 0
    for (let index = 0; index < buffer.length; index += 1) {
      const char = buffer[index]
      if (char === "\n") {
        line(buffer.slice(start, index))
        start = index + 1
      } else if (char === "\r") {
        if (index === buffer.length - 1) break
        line(buffer.slice(start, index))
        start = buffer[index + 1] === "\n" ? index + 2 : index + 1
        if (buffer[index + 1] === "\n") index += 1
      }
    }
    buffer = buffer.slice(start)
  }

  function end(): void {
    // A CR held back for a possible LF is a whole line ending at the end.
    if (buffer.endsWith("\r")) line(buffer.slice(0, -1))
    buffer = ""
    event = ""
    data = []
  }

  return { push, end }
}
