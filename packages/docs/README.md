# @matchbox/docs

The content of docs.matchbox.markets and every generator that turns it into a site. `apps/docs` renders
what this package builds. Products import only the small generated modules (typed links, the topics index).

## Commands

```sh
pnpm --filter @matchbox/docs build      # dist/ for apps/docs; fails on any docs problem
pnpm --filter @matchbox/docs generate   # rewrite src/*.gen.* after a content change
pnpm --filter @matchbox/docs check      # fail if src/*.gen.* is stale (CI)
pnpm --filter @matchbox/docs test
tsx scripts/mcp-schemas.ts              # refresh src/mcp-tools.gen.json from Stuart's MCP handler
```

## Writing a page

One Markdown file per page in `content/`, at the URL its path gives (`pro/vote.md` is `/pro/vote`,
`pro/index.md` is `/pro`). Every page sits in a tree in `src/site.ts`.

```yaml
---
title: Vote
nav: Vote # page tree label when the title is long
description: One or two plain sentences, used for search and meta.
definition: One or two sentences, shown when another page links here with :term.
status: published # or stub: built nowhere, kept out of every tree
updated: 2026-11-10
topics: # anchors products may link to, beside the page key (pro.vote)
  - pro.vote.optimize#optimize
stuart: [] # reviewed notes for Stuart's knowledge tool, see below
---
```

Markdown with GFM tables, plus:

| Syntax                                             | Renders                                    |
| -------------------------------------------------- | ------------------------------------------ |
| `## Heading {#id}`                                 | A heading with a fixed anchor              |
| `:::note[Title]`, `:::warning`, `:::danger`        | Callouts                                   |
| `::::steps` with `:::step[Title]{tag="Server"}`    | Numbered steps                             |
| `:::code-group` with fences titled `title="curl"`  | Tabbed code                                |
| `:::links` with a list of `[Title](/path) Subline` | Link rows                                  |
| `:::facts` with a list of `**Label** value`        | The facts card                             |
| `:term[epoch]{to="/concepts/epochs"}`              | A definition popover from that page        |
| `::epoch-clock`, `::figure{drawing="vote" …}`      | The live epoch clock, a schematic          |
| `::errors-table`, `::scopes-table` and others      | Tables rendered from `@matchbox/contracts` |

Every `ts` fence compiles against `@matchbox-dev/sdk` (`src/samples.gen.ts`, checked by the typecheck). A
fragment that continues an earlier step takes `prelude="oidc-callback"`, hidden setup in `markdown.ts`.

The build fails on anything that breaks the docs voice (`src/pipeline/copy-lint.ts`): em or en dashes,
middle dots, semicolons, exclamation marks, "bribes", headings not in sentence case or numbered, and more
than two sentences in a paragraph or about 25 words in a sentence. Code is exempt. It also fails on a broken
link or anchor, a duplicate anchor or a tree naming a page that does not exist.

Facts about Mezo must come from code or the chain: see [FACTS.md](FACTS.md).

## What the build makes

| Output                   | For                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `dist/pages/*.json`      | One page chunk each, loaded by apps/docs                                                              |
| `dist/manifest.js`       | Titles, trees, previous and next                                                                      |
| `dist/site/`             | search index, llms.txt, sitemap.xml, robots.txt, `_redirects`, `.md` copies, `developer/openapi.json` |
| `src/links.gen.ts`       | `docsUrl(topic)` for products, typed by `DocsTopic`                                                   |
| `src/topics.gen.json`    | Pages and headings for a product's own Ctrl K                                                         |
| `src/knowledge.gen.ts`   | Stuart's reviewed notes                                                                               |
| `src/samples.gen.ts`     | Every TypeScript sample, compiled against the SDK                                                     |
| `src/mcp-tools.gen.json` | The MCP `tools/list` the tool pages are built from                                                    |

The API reference reads `@matchbox/contracts/openapi.json` in place, so a changed document changes the
pages on the next build. The committed `samples.gen.ts` and `links.gen.ts` make a renamed SDK method or a
removed operation fail `check` and the typecheck.

## Linking from a product

```ts
import { docsUrl } from "@matchbox/docs/links";

docsUrl("pro.vote.optimize"); // https://docs.matchbox.markets/pro/vote#optimize
```

Renaming or removing a page removes its key, so every product linking to it stops compiling.

## Stuart's knowledge

`stuart` blocks in frontmatter use the shape of `KnowledgeEntry` in
`apps/stuart/src/query/knowledge/mezo.ts`. The build writes them to `src/knowledge.gen.ts` as
`docsKnowledge` (with the docs page added as the first source) and `docsKnowledgeVersion` (a content hash),
and the package test applies the rules of Stuart's `knowledge.test.ts`.

For Stuart to read the docs, `apps/stuart` would change `mezo.ts` to
`export const MEZO_KNOWLEDGE = docsKnowledge` and `MEZO_KNOWLEDGE_VERSION = docsKnowledgeVersion`, keeping
`searchMezoKnowledge` and its scoring as they are. Entries not yet moved here (safety, gas, support, savings)
stay in `mezo.ts` until their pages are written.
