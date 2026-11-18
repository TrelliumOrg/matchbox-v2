import { searchTransactionsTool } from "./activity"
import {
  addressActivityTool,
  compareHoldersTool,
  resolveHolderTool,
  traceRewardsTool,
} from "./chain"
import { prepareClaimRelockTool } from "./claimRelock"
import { walletEarningsTool } from "./earnings"
import { resolveEntityTool, walletContextTool } from "./entity"
import { explainGaugeTool } from "./explain"
import { mezoKnowledgeTool } from "./knowledge"
import {
  claimSurplusTool,
  getLoanPositionTool,
  prepareRepayTool,
  scenarioLiquidationTool,
} from "./loans"
import { lockActionTool } from "./lockActions"
import { protocolStatsTool } from "./protocol"
import { listClaimableTool, prepareClaimTool } from "./rewards"
import { draftSupportReportTool } from "./support"
import type { RegisteredTool } from "./tool"
import { prepareVoteScriptTool, prepareVoteTool } from "./voteScript"
import { optimizeVotesTool, rankGaugesTool } from "./votes"
import { prepareZapTool, quoteZapTool } from "./zap"

// Deterministic order: the tool list renders first in every Claude request
// and is part of the cached prefix.
export const STUART_TOOLS: readonly RegisteredTool[] = [
  resolveEntityTool,
  walletContextTool,
  protocolStatsTool,
  mezoKnowledgeTool,
  rankGaugesTool,
  explainGaugeTool,
  optimizeVotesTool,
  prepareVoteTool,
  prepareVoteScriptTool,
  listClaimableTool,
  prepareClaimTool,
  walletEarningsTool,
  getLoanPositionTool,
  scenarioLiquidationTool,
  prepareRepayTool,
  claimSurplusTool,
  quoteZapTool,
  prepareZapTool,
  searchTransactionsTool,
  draftSupportReportTool,
  prepareClaimRelockTool,
  lockActionTool,
  // Chain and user activity: always loose (non-strict) tools.
  resolveHolderTool,
  addressActivityTool,
  traceRewardsTool,
  compareHoldersTool,
]

const BY_NAME = new Map(STUART_TOOLS.map((tool) => [tool.name, tool]))

export function toolByName(name: string): RegisteredTool | null {
  return BY_NAME.get(name) ?? null
}
