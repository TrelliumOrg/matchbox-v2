import type { PageData } from "@matchbox/docs/render"
import { type ComponentType, type ReactNode, use } from "react"
import type { Drawing as DrawingType } from "./drawings"
import type { OperationBody as OperationBodyType } from "./operation"
import type { ReferenceBody as ReferenceBodyType } from "./reference"
import type { ToolBody as ToolBodyType } from "./tool"

/**
 * The renderers only some pages need (API operations, MCP tools, the
 * reference index, the live epoch clock and the drawings) load as their
 * own chunks, so a prose page's first paint carries none of them.
 *
 * The route loader warms the ones a page uses, and a warmed renderer then
 * renders synchronously. That matters for the prerender: React.lazy
 * suspends on its first render in a process even when its module is
 * already loaded, and a suspended boundary can be flushed as hidden HTML
 * that only an inline script reveals. postbuild fails the build if any
 * page has one. On a first load in the browser the renderer suspends once
 * and React keeps the prerendered HTML until it arrives.
 */

type Chunk<P extends object> = {
  load: () => Promise<ComponentType<P>>
  ready: () => ComponentType<P> | null
}

function chunk<P extends object>(
  importer: () => Promise<ComponentType<P>>,
): Chunk<P> {
  let ready: ComponentType<P> | null = null
  let pending: Promise<ComponentType<P>> | null = null
  return {
    load() {
      pending ??= importer().then((component) => {
        ready = component
        return component
      })
      return pending
    },
    ready: () => ready,
  }
}

/** Renders a chunk's component, suspending only until it has loaded. */
function ChunkBody<P extends object>({
  from,
  props,
}: {
  from: Chunk<P>
  props: P
}): ReactNode {
  const Component = from.ready() ?? use(from.load())
  return <Component {...props} />
}

type PropsOf<C> = C extends (props: infer P) => ReactNode ? P : never

const operation = chunk<PropsOf<typeof OperationBodyType>>(() =>
  import("./operation").then((module) => module.OperationBody),
)
const tool = chunk<PropsOf<typeof ToolBodyType>>(() =>
  import("./tool").then((module) => module.ToolBody),
)
const reference = chunk<PropsOf<typeof ReferenceBodyType>>(() =>
  import("./reference").then((module) => module.ReferenceBody),
)
const clock = chunk<Record<string, never>>(() =>
  import("./epoch-clock").then((module) => module.EpochClock),
)
const drawings = chunk<PropsOf<typeof DrawingType>>(() =>
  import("./drawings").then((module) => module.Drawing),
)

export function OperationBody(
  props: PropsOf<typeof OperationBodyType>,
): ReactNode {
  return <ChunkBody from={operation} props={props} />
}

export function ToolBody(props: PropsOf<typeof ToolBodyType>): ReactNode {
  return <ChunkBody from={tool} props={props} />
}

export function ReferenceBody(
  props: PropsOf<typeof ReferenceBodyType>,
): ReactNode {
  return <ChunkBody from={reference} props={props} />
}

export function EpochClock(): ReactNode {
  return <ChunkBody from={clock} props={{}} />
}

export function Drawing(props: PropsOf<typeof DrawingType>): ReactNode {
  return <ChunkBody from={drawings} props={props} />
}

/** Loads the renderers a page needs, so it renders whole. */
export async function warmBodies(page: PageData): Promise<void> {
  const loads: Promise<unknown>[] = []
  if (page.kind === "operation") loads.push(operation.load())
  if (page.kind === "tool") loads.push(tool.load())
  if (page.kind === "reference") loads.push(reference.load())
  if (page.kind === "prose") {
    const text = JSON.stringify(page.body)
    if (text.includes('"t":"epoch-clock"')) loads.push(clock.load())
    if (text.includes('"t":"figure"')) loads.push(drawings.load())
  }
  await Promise.all(loads)
}
