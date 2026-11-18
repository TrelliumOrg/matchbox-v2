/**
 * `import.meta.env.DEV`, which Vite (and Vitest) define, for this package's
 * own typecheck. Apps compile these sources with vite/client's full type.
 */
interface ImportMeta {
  readonly env: { readonly DEV: boolean }
}
