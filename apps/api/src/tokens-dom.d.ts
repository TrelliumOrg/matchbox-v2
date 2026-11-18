// @matchbox/tokens' entry also exports a client-only helper typed with the
// DOM's HTMLElement. The Worker has no DOM lib; this declares the one member
// that helper uses, so the API can import the preset palettes.
interface HTMLElement {
  setAttribute(name: string, value: string): void
}
