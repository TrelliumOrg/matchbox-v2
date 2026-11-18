/**
 * Zod probes for eval (`new Function`) the first time it builds an object
 * schema, to compile faster parsers. Pro's Content Security Policy forbids
 * eval, so the probe could only fail, and it reports a violation on every
 * page that loads a schema (Stuart, Safe). This turns it off before any
 * schema exists, the way the Worker already runs (eval is off there too).
 *
 * Zod keeps its settings on this global so every copy shares them; setting
 * it here keeps zod itself out of the first paint, where `z.config()` would
 * have pulled it in. zod-jitless.test.ts fails if a zod upgrade moves it.
 *
 * Importing this module applies it: router.tsx imports it first, so it runs
 * before any other module of the app can build a schema. Listed in
 * package.json's sideEffects, so the bundler keeps the bare import.
 */
type ZodGlobal = { __zod_globalConfig?: { jitless?: boolean } }

export function zodJitless(): void {
  const global = globalThis as ZodGlobal
  global.__zod_globalConfig ??= {}
  global.__zod_globalConfig.jitless = true
}

zodJitless()
