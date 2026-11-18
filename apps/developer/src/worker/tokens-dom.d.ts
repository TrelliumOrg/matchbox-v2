// @matchbox/tokens' entry also exports a client-only helper typed with the
// DOM's HTMLElement. The Worker has no DOM lib; this declares the one member
// that helper uses, so the Worker can import the theme script it hashes for
// the CSP. (Same shim as apps/api/src/tokens-dom.d.ts.)
interface HTMLElement {
  setAttribute(name: string, value: string): void
}
