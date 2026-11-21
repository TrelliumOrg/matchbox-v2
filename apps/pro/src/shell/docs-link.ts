import type { docsOrigin, docsTopics } from "@matchbox/docs/links"

/**
 * Pro's docs section, checked against @matchbox/docs's topics at compile
 * time: renaming or removing it (or moving the docs origin) stops Pro
 * compiling. The URL is a literal rather than `docsUrl("pro")`, which would
 * put the whole topics table into every page's first paint.
 */
export const proDocs: `${typeof docsOrigin}${(typeof docsTopics)["pro"]}` =
  "https://docs.matchbox.markets/pro"
