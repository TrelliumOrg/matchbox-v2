import type { docsOrigin, docsTopics } from "@matchbox/docs/links"

/**
 * Developer's pages on Matchbox Docs, checked against @matchbox/docs's
 * topics at compile time: renaming or removing one (or moving the docs
 * origin) stops the console compiling. Literals rather than `docsUrl()`,
 * which would put the whole topics table into the console's first paint.
 * Pro and Matchscan link the same way.
 */
type DocsUrl<Topic extends keyof typeof docsTopics> =
  `${typeof docsOrigin}${(typeof docsTopics)[Topic]}`

export const developerDocsUrl: DocsUrl<"developer"> =
  "https://docs.matchbox.markets/developer"

export const changelogDocsUrl: DocsUrl<"developer.changelog"> =
  "https://docs.matchbox.markets/developer/changelog"
