/**
 * `cloudflare:workers` under vitest, which cannot resolve the Workers
 * runtime. Tests replace it with vi.mock when they need an env.
 */
export const env: Record<string, unknown> = {}

export function waitUntil(promise: Promise<unknown>): void {
  void promise
}
