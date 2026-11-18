// Vite resolves `?url` imports to the emitted asset's URL.
declare module "*.svg?url&no-inline" {
  const url: string
  export default url
}
