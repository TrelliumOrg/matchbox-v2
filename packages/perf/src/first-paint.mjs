// What may not load before a wallet connects, checked by module rather than
// by text: minified wagmi and viem chunks carry none of the strings a text
// search could look for, so a marker check passes when it should fail. The
// build writes which modules each client chunk holds (chunkModules in
// ./vite.ts); measure.mjs checks every chunk a route loads on first paint.

/** Module ids (forward slashes) that must never be in first-paint JS. */
export const forbiddenFirstPaint = [
  {
    name: "wagmi",
    pattern: /[/]node_modules[/](\.pnpm[/][^/]+[/]node_modules[/])?@wagmi[/]/,
  },
  {
    name: "viem",
    pattern: /[/]node_modules[/](\.pnpm[/][^/]+[/]node_modules[/])?viem[/]/,
  },
  {
    name: "walletconnect",
    pattern:
      /[/]node_modules[/](\.pnpm[/][^/]+[/]node_modules[/])?@walletconnect[/]/,
  },
  {
    name: "@matchbox/wallet runtime",
    pattern:
      /[/]packages[/]wallet[/]src[/](wallet-runtime|wallet-host|connect-drawer)\./,
  },
]

/** "/assets/main-abc.js" or "assets/main-abc.js" to the bundle's file name. */
export function chunkFileName(url) {
  return new URL(url, "http://x").pathname.replace(/^\//, "")
}

/**
 * Every forbidden module in the first-paint chunks. `chunkModules` maps a
 * chunk's file name to its module ids; a first-paint file the map does not
 * know is reported too, so a stale or missing manifest cannot pass.
 */
export function firstPaintViolations(
  chunkModules,
  files,
  forbidden = forbiddenFirstPaint,
) {
  const violations = []
  for (const url of files) {
    const fileName = chunkFileName(url)
    const modules = chunkModules[fileName]
    if (modules === undefined) {
      violations.push({ file: fileName, rule: "unknown chunk", module: null })
      continue
    }
    for (const id of modules) {
      const normalised = id.replaceAll("\\", "/")
      for (const rule of forbidden) {
        if (rule.pattern.test(normalised)) {
          violations.push({
            file: fileName,
            rule: rule.name,
            module: normalised,
          })
        }
      }
    }
  }
  return violations
}
