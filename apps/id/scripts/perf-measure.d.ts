// Types for the plain-JS budget tool (packages/perf/src/measure.mjs), as
// scripts/measure.ts uses it.
declare module "@matchbox/perf/measure" {
  export type MeasureResult = {
    route: string
    status: number
    brotliKb: number
    gzipKb: number
    wallet: boolean
    over: boolean
    files: { url: string; brotliKb: number }[]
  }
  export function measure(options: {
    base: string
    routes: string[]
    budgetKb?: number
    chunkModules: unknown
    fetch?: typeof fetch
  }): Promise<MeasureResult[]>
}
