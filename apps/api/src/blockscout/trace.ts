import {
  type BlockscoutTraceFrame,
  type BlockscoutTraceSummary,
  traceSummarySchema,
} from "@matchbox/contracts/blockscout"
import { z } from "zod"

// `/transactions/{hash}/raw-trace` answers a geth callTracer tree (one
// frame, or a list of them). The proxy serves a flat summary instead: one
// row per call with no input or output data, which is what an explorer's
// "internal calls" view needs while Blockscout's own internal transaction
// index lags months behind the head.

/** Frames kept per trace; deeper or wider traces are marked truncated. */
export const maxTraceFrames = 500

/** A hex quantity ("0x0", "0x2e083"); anything else fails the schema. */
const hexQuantity = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/)

/** Base 10, exact: BigInt, never Number. */
function decimal(hex: string): string {
  return BigInt(hex).toString()
}

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

type CallFrame = {
  type: string
  from: string
  to?: string | null | undefined
  value?: string | null | undefined
  gasUsed?: string | null | undefined
  error?: string | null | undefined
  calls?: CallFrame[] | null | undefined
}

const callFrameSchema: z.ZodType<CallFrame> = z.object({
  type: z.string(),
  from: hexAddress,
  to: hexAddress.nullish(),
  /** Absent on static and delegate calls, which move no value. */
  value: hexQuantity.nullish(),
  gasUsed: hexQuantity.nullish(),
  error: z.string().nullish(),
  get calls() {
    return z.array(callFrameSchema).nullish()
  },
})

function flatten(roots: readonly CallFrame[]): BlockscoutTraceSummary {
  const frames: BlockscoutTraceFrame[] = []
  let truncated = false
  const stack: { frame: CallFrame; depth: number }[] = roots
    .map((frame) => ({ frame, depth: 0 }))
    .reverse()
  while (stack.length > 0) {
    const next = stack.pop()
    if (next === undefined) break
    if (frames.length >= maxTraceFrames) {
      truncated = true
      break
    }
    const { frame, depth } = next
    frames.push({
      depth,
      type: frame.type.toLowerCase(),
      from: frame.from.toLowerCase(),
      to: frame.to?.toLowerCase() ?? null,
      value:
        frame.value === null || frame.value === undefined
          ? "0"
          : decimal(frame.value),
      gas_used:
        frame.gasUsed === null || frame.gasUsed === undefined
          ? null
          : decimal(frame.gasUsed),
      error: frame.error ?? null,
    })
    const children = frame.calls ?? []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]
      if (child !== undefined) stack.push({ frame: child, depth: depth + 1 })
    }
  }
  return { frames, truncated }
}

/** Upstream raw trace in, validated flat summary out. */
export const traceSummaryFromRaw = z
  .union([callFrameSchema, z.array(callFrameSchema)])
  .transform((raw) => flatten(Array.isArray(raw) ? raw : [raw]))
  .pipe(traceSummarySchema)
