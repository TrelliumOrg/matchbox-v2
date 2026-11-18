import {
  type DocsAskRequest,
  type DocsAskResponse,
  docsAskLimits,
} from "@matchbox/docs/ask"
import { docsKnowledge, docsKnowledgeVersion } from "@matchbox/docs/knowledge"
import { knowledgePage, searchMezoKnowledge } from "./knowledge/mezo"

/**
 * "Ask about this page" on Matchbox Docs. A keyword search over the same
 * reviewed notes Stuart cites, with the reader's page ranked first. It is
 * deliberately all it is: no model, no chain or API read, no wallet, no
 * tools and nothing stored, so an anonymous call costs a few hundred
 * microseconds of CPU and one rate-limit count.
 *
 * It searches only the notes published on the docs site. Stuart's own
 * notes (safety, gas, support, Savings) carry claims the docs have not
 * verified, so they stay in Stuart's chat and never reach this public
 * endpoint.
 */
export default function answerDocsQuestion(
  request: DocsAskRequest,
): DocsAskResponse {
  const matches = searchMezoKnowledge(request.question, {
    limit: docsAskLimits.notes,
    page: request.page,
    entries: docsKnowledge,
  })
  return {
    version: docsKnowledgeVersion,
    notes: matches.map(({ entry }) => ({
      id: entry.id,
      title: entry.title,
      answer: entry.answer,
      detail: entry.detail,
      sources: entry.sources,
      onPage: request.page !== null && knowledgePage(entry) === request.page,
    })),
  }
}
