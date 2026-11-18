/**
 * The request header that carries a page's CSP nonce from the Worker entry
 * (src/server.ts) to the router, which puts it on every inline script.
 */
export const nonceHeader = "x-matchbox-csp-nonce"
