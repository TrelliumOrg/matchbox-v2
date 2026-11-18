/** "Chrome · macOS" style summary of a stored User-Agent string. */
export function describeUserAgent(userAgent: string | null): string {
  if (userAgent === null || userAgent.length === 0) return "Unknown device"
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser"
  const os = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X|Macintosh/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null
  return os === null ? browser : `${browser} on ${os}`
}

/** Phones and tablets get the phone icon in the sessions list. */
export function isMobileUserAgent(userAgent: string | null): boolean {
  return userAgent !== null && /iPhone|iPad|Android|Mobile/.test(userAgent)
}
