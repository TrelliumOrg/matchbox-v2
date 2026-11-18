// The panel's stylesheet loads with its chunk (Vite handles the import).
declare module "*.css"

// @matchbox/token-icons imports its coins with Vite's `?url`.
declare module "*.svg?no-inline&url" {
  const url: string
  export default url
}
