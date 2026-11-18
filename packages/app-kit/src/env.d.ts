/**
 * The bindings every Matchbox frontend Worker shares. Apps add their own
 * (`PRO_DATA`, `SCAN_DATA`) in their `env.d.ts`; the declarations merge.
 */
declare namespace Cloudflare {
  interface Env {
    /** Used when the API service binding is missing (local dev against a deployed API). */
    API_ORIGIN: string
    /** Shared secret for the API Worker's internal routes. */
    INTERNAL_TOKEN?: string
    API?: Fetcher
    /** Public Mezo RPC the browser polls for eth_blockNumber when the BlockHub socket drops. */
    MEZO_RPC_URL?: string
  }
}
