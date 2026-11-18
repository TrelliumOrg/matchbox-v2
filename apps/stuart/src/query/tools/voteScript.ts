import { percentToBps } from "@matchbox/domain/voteMath"
import type {
  Evidence,
  Fact,
  UiBlock,
  VoteBranch,
} from "@matchbox/stuart-ui/contract"
import { z } from "zod"
import {
  cardOptions,
  type DirectoryEntry,
  entryLabel,
  type ParsedScript,
  parseBallotScript,
  parsePick,
  pickId,
  picksFit,
  type ResolvedLine,
  resolveGaugeName,
  resolveScript,
  type ScriptLine,
  splitPicks,
  withPicks,
} from "../ballotScript"
import { clipName, listWithAnd } from "../format"
import {
  type ModelRow,
  makeFact,
  type ToolOutcome,
  traceItem,
} from "../outcome"
import { assetFor, type VotingDomain } from "../providers/voting"
import {
  domainEvidence,
  domainLabel,
  errorOutcome,
  navigateFollowup,
  ZERO_WALLET,
} from "./common"
import { defineTool, type ToolContext } from "./tool"
import { noLocksOutcome, planVotes, presentVotePlan } from "./votes"

// A ballot the user wrote: a pasted governance post ("25% to the
// BTC/MUSD-200 pool ...") or a short "vote 60% X, 40% Y". Every name is
// resolved by code against the live gauge directory (ballotScript.ts).
// Only a ballot whose every line resolved, in one voting domain, adding up
// to 100%, becomes an unsigned proposal; otherwise Stuart shows what
// resolved and asks about the rest.

const BRANCHES: readonly VoteBranch[] = ["pools", "validators", "boost"]
const MAX_LINES = 20

const ASSET_RULE: Record<VoteBranch, string> = {
  pools: "Pool and vault gauges take veBTC votes (PoolsVoter).",
  validators: "Validator gauges take veBTC votes (ValidatorsVoter).",
  boost: "veBTC gauges take veMEZO votes (BoostVoter).",
}

const MEZO_NOTE =
  "MEZO gauges: votes persist across epochs, so the veMEZO votes from last epoch stay. No MEZO gauge ballot prepared."

/** Strips the pool type a display name carries ("BTC/MUSD CL200"). */
function baseName(name: string, label: string | null): string {
  return label !== null && name.endsWith(` ${label}`)
    ? name.slice(0, -label.length - 1)
    : name
}

export function directoryEntries(
  domains: readonly VotingDomain[],
): DirectoryEntry[] {
  const seen = new Set<string>()
  return domains.flatMap((domain) =>
    domain.targets.flatMap((target) => {
      const key = target.targetAddress.toLowerCase()
      if (seen.has(`${domain.branch}:${key}`)) return []
      seen.add(`${domain.branch}:${key}`)
      const label = domain.labels.get(key) ?? null
      return [
        {
          branch: domain.branch,
          target: key,
          gauge: target.gaugeAddress.toLowerCase(),
          name: baseName(target.name, label),
          label,
          tokenId: target.tokenId,
          isAlive: target.isAlive,
        },
      ]
    }),
  )
}

/** Branches the words of the request point at ("validators", "pool"). */
function hintedBranches(text: string, script: ParsedScript): Set<VoteBranch> {
  const lower = text.toLowerCase()
  const hints = new Set<VoteBranch>()
  if (/\bvalidators?\b/.test(lower)) hints.add("validators")
  if (/\b(?:pools?|vaults?|lp)\b/.test(lower)) hints.add("pools")
  if (script.asset === "veMEZO") hints.add("boost")
  return hints
}

/**
 * Settles a name several domains share ("ChooseMe" is a validator and a
 * veBTC gauge) by the domain the request or the other lines point at.
 */
function settleByDomain(
  lines: ResolvedLine[],
  hints: ReadonlySet<VoteBranch>,
): ResolvedLine[] {
  const matched = new Set(
    lines.flatMap((line) =>
      line.resolution.kind === "match" ? [line.resolution.entry.branch] : [],
    ),
  )
  const prefer =
    matched.size === 1
      ? matched
      : hints.size > 0
        ? hints
        : new Set<VoteBranch>()
  if (prefer.size === 0) return lines
  return lines.map((line) => {
    if (line.resolution.kind !== "ambiguous") return line
    // Only one name shared across domains is settled here. Different names
    // (a pool type, a partial match) stay a question for the user.
    const names = new Set(
      line.resolution.options.map((option) =>
        entryLabel(option).trim().toLowerCase(),
      ),
    )
    if (names.size !== 1) return line
    const options = line.resolution.options.filter((option) =>
      prefer.has(option.branch),
    )
    const only = options[0]
    if (options.length === 1 && only) {
      return { ...line, resolution: { kind: "match", entry: only } }
    }
    return options.length > 1
      ? { ...line, resolution: { kind: "ambiguous", options } }
      : line
  })
}

type Problem = { line: ResolvedLine | null; text: string }

function pct(bps: number): string {
  const whole = Math.trunc(bps / 100)
  const rest = bps % 100
  return rest === 0
    ? `${whole}%`
    : `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}%`
}

export async function prepareBallot(
  context: ToolContext,
  input: {
    tool: "prepare_vote" | "prepare_vote_script"
    text: string
    script: ParsedScript
    branch: VoteBranch | null
    // Answers to earlier cards, by line index, and the request a new card
    // re-sends with them.
    picks: ReadonlyMap<number, string>
    resend: string
  },
): Promise<ToolOutcome> {
  const { scope } = context
  const { script } = input
  const picks = new Map(input.picks)
  const picked = parsePick(context.choice)
  if (picked !== null) picks.set(picked[0], picked[1])
  const lines = script.lines
  const fallbackTitle =
    input.branch === null
      ? "Your ballot"
      : `Your ${assetFor(input.branch)} ballot`
  if (lines.length === 0 || lines.length > MAX_LINES) {
    return plain(context, input.tool, {
      title: fallbackTitle,
      text:
        lines.length === 0
          ? 'No "N% to gauge" lines found. Write one line per gauge.'
          : "A ballot takes at most twenty lines.",
      facts: [],
    })
  }
  let domains: VotingDomain[]
  try {
    domains = await Promise.all(
      (input.branch === null ? BRANCHES : [input.branch]).map((branch) =>
        context.providers.votingDomain(branch),
      ),
    )
  } catch {
    return errorOutcome({
      scope,
      tool: input.tool,
      intent: "custom_vote",
      title: fallbackTitle,
    })
  }
  const entries = directoryEntries(domains)
  const domainRefs = [
    ...new Set(domains.map((domain) => domainEvidence(scope, domain).id)),
  ]
  const resolved = settleByDomain(
    resolveScript(lines, entries, picks),
    hintedBranches(input.text, script),
  )

  // --- facts every line can cite ----------------------------------------
  const facts: Fact[] = []
  // By line index: a prepare_vote line keeps its place in the post.
  const factsByLine = resolved.map((line) => {
    const share = makeFact({
      scope,
      key: `l${line.index}.pct`,
      label: "Line share",
      value: { kind: "bps", bps: line.bps ?? 0 },
      display: line.bps === null ? `${line.percent}%` : pct(line.bps),
      status: "live",
      evidenceRefs: domainRefs,
    })
    const asked = makeFact({
      scope,
      key: `l${line.index}.ask`,
      label: "As written",
      value: { kind: "text", text: clipName(line.target, 60) },
      display: clipName(line.target, 60),
      status: "live",
      evidenceRefs: domainRefs,
    })
    const name =
      line.resolution.kind === "match"
        ? makeFact({
            scope,
            key: `l${line.index}.gauge`,
            label: "Resolved gauge",
            value: {
              kind: "text",
              text: clipName(entryLabel(line.resolution.entry), 40),
            },
            display: clipName(entryLabel(line.resolution.entry), 40),
            status: "live",
            evidenceRefs: domainRefs,
          })
        : null
    facts.push(share, asked, ...(name ? [name] : []))
    return [line.index, { share, asked, name }] as const
  })
  const lineFacts = new Map(factsByLine)
  const totalBps = resolved.reduce((sum, line) => sum + (line.bps ?? 0), 0)
  const matched = resolved.filter((line) => line.resolution.kind === "match")
  const branches = [
    ...new Set(
      matched.flatMap((line) =>
        line.resolution.kind === "match" ? [line.resolution.entry.branch] : [],
      ),
    ),
  ]
  const totalFact = makeFact({
    scope,
    key: "total",
    label: "Ballot total",
    value: { kind: "bps", bps: totalBps },
    display: pct(totalBps),
    status: "live",
    evidenceRefs: domainRefs,
  })
  const countFact = makeFact({
    scope,
    key: "resolved",
    label: "Lines resolved",
    value: { kind: "count", count: matched.length },
    display: `${matched.length} of ${resolved.length}`,
    status: "live",
    evidenceRefs: domainRefs,
  })
  const resolvedBps = resolved.reduce(
    (sum, line) =>
      sum + (line.resolution.kind === "match" ? (line.bps ?? 0) : 0),
    0,
  )
  const resolvedShareFact = makeFact({
    scope,
    key: "resolved_share",
    label: "Share resolved",
    value: { kind: "bps", bps: resolvedBps },
    display: pct(resolvedBps),
    status: "live",
    evidenceRefs: domainRefs,
  })
  const wantedFact = makeFact({
    scope,
    key: "wanted_total",
    label: "Ballot must total",
    value: { kind: "bps", bps: 10_000 },
    display: "100%",
    status: "live",
    evidenceRefs: domainRefs,
  })
  facts.push(totalFact, countFact, resolvedShareFact, wantedFact)

  // --- what blocks a ballot ------------------------------------------------
  const problems: Problem[] = []
  const mention = (entry: DirectoryEntry, key: string): string => {
    const display = clipName(entryLabel(entry), 24)
    if (facts.length < 56) {
      facts.push(
        makeFact({
          scope,
          key,
          label: "Candidate gauge",
          value: { kind: "text", text: display },
          display,
          status: "live",
          evidenceRefs: domainRefs,
        }),
      )
    }
    return display
  }
  for (const line of resolved) {
    if (line.bps === null) {
      problems.push({ line, text: "not a percent from 0 to 100" })
      continue
    }
    const resolution = line.resolution
    if (resolution.kind === "ambiguous") {
      problems.push({
        line,
        text: `matches ${listWithAnd(resolution.options.slice(0, 3).map((option, index) => mention(option, `l${line.index}.o${index}`)))}, pick one`,
      })
    } else if (resolution.kind === "none") {
      const similar = resolution.options
        .slice(0, 2)
        .map((option, index) => mention(option, `l${line.index}.o${index}`))
      problems.push({
        line,
        text: `${resolution.reason}${similar.length ? `. Similar: ${listWithAnd(similar)}` : ""}`,
      })
    }
  }
  const branch = branches.length === 1 ? (branches[0] ?? null) : null
  if (branches.length > 1) {
    problems.push({
      line: null,
      text: `Lines span ${listWithAnd(branches.map((each) => domainLabel(domainFor(domains, each))))}, which vote separately. Send one ballot per voting domain.`,
    })
  }
  if (
    branch !== null &&
    script.asset !== null &&
    assetFor(branch) !== script.asset
  ) {
    problems.push({
      line: null,
      text: `${ASSET_RULE[branch]} ${script.asset} cannot vote on them.`,
    })
  }
  if (totalBps !== 10_000) {
    problems.push({
      line: null,
      text: `Shares add up to ${totalFact.display}, not ${wantedFact.display}.`,
    })
  }

  const resolvedText = matched
    .map((line) => {
      const facts = lineFacts.get(line.index)
      return `${facts?.share.display ?? ""} ${facts?.name?.display ?? ""}`
    })
    .join(", ")
  const modelRows: ModelRow[] = resolved.map((line) => ({
    share: lineFacts.get(line.index)?.share.display ?? null,
    label: line.target,
    name:
      line.resolution.kind === "match"
        ? entryLabel(line.resolution.entry)
        : null,
    target:
      line.resolution.kind === "match" ? line.resolution.entry.target : null,
    status: line.resolution.kind,
  }))
  const allRefs = facts.map((fact) => fact.id)
  const mezoItem = script.keepMezoGauges
    ? [{ text: MEZO_NOTE, factRefs: [] }]
    : []

  if (problems.length > 0 || branch === null) {
    const first = problems[0]
    // Only picks that settled a line travel on: one for a gauge the card
    // never showed, or for a line that needed none, is dropped.
    const carried = new Map(
      [...picks].filter(([index, value]) =>
        resolved.some(
          (line) =>
            line.index === index &&
            line.resolution.kind === "match" &&
            line.resolution.entry.target.startsWith(value) &&
            resolveGaugeName(line.target, entries).kind !== "match",
        ),
      ),
    )
    // A card re-sends the post with every pick. When that would not fit in
    // a request, say so rather than show a card whose picks get cut off.
    const cardLine = resolved.find(
      (line) =>
        line.resolution.kind !== "match" &&
        cardOptions(line.resolution.options).length > 0,
    )
    const fits =
      cardLine === undefined || picksFit(input.resend, carried, cardLine.index)
    const firstText = !fits
      ? "The post is too long to pick gauges here. Shorten it, or name each gauge exactly (BTC/MUSD CL200)."
      : first?.line
        ? `${first.line.percent}% to ${clipName(first.line.target, 48)}: ${first.text}. No ballot until it resolves.`
        : (first?.text ?? "")
    const why = [
      ...(matched.length
        ? [
            {
              text: `Resolved: ${resolvedText}`.slice(0, 240),
              factRefs: allRefs,
            },
          ]
        : []),
      ...problems.slice(0, 4).map((problem) => ({
        text: (problem.line
          ? `${problem.line.percent}% to ${clipName(problem.line.target, 48)}: ${problem.text}.`
          : problem.text
        ).slice(0, 240),
        factRefs: allRefs,
      })),
      ...mezoItem,
    ].slice(0, 6)
    const card = fits
      ? disambiguationCard(context, resolved, withPicks(input.resend, carried))
      : null
    return {
      tool: input.tool,
      intent: "custom_vote",
      status: card ? "clarify" : "unavailable",
      title:
        branch === null ? fallbackTitle : `Your ${assetFor(branch)} ballot`,
      snapshot: {
        blockNumber: domains[0]?.blockNumber ?? null,
        epoch: null,
        label: "No ballot prepared",
      },
      answer: {
        kind: "clarification",
        templateId: `${input.tool}.unresolved.v1`,
        text: `${countFact.display} lines resolved (${resolvedShareFact.display}). ${firstText}`.slice(
          0,
          400,
        ),
        factRefs: allRefs,
      },
      why: { templateId: `${input.tool}.resolution.v1`, items: why },
      facts,
      evidence: domains.map((domain) => domainEvidence(scope, domain)),
      blocks: card ? [card] : [],
      proposals: [],
      followups: [navigateFollowup(scope, "vote", "Open Vote", "/vote")],
      trace: [
        traceItem({
          scope,
          key: "resolve",
          label: `Resolved ${matched.length} of ${resolved.length} ballot lines`,
          tool: input.tool,
        }),
      ],
      model: {
        rows: modelRows,
        notes: [
          "No proposal: ask the user about the unresolved lines. Never guess a gauge or an address.",
        ],
      },
      surface: "rail",
      checked: [`${entries.length} gauges`],
    }
  }

  // --- every line resolved, one domain, 100%: the unsigned ballot ----------
  const asset = assetFor(branch)
  if (context.wallet.address === ZERO_WALLET) {
    return {
      ...plain(context, input.tool, {
        title: `Your ${asset} ballot`,
        text: `${countFact.display} lines resolved, ${totalFact.display}. Connect or watch a wallet to prepare the ${asset} ballot.`,
        facts,
        refs: [countFact.id, totalFact.id],
        evidence: domains.map((domain) => domainEvidence(scope, domain)),
      }),
      why: {
        templateId: `${input.tool}.resolution.v1`,
        items: [
          {
            text: `Resolved: ${resolvedText}`.slice(0, 240),
            factRefs: allRefs,
          },
          ...mezoItem,
        ],
      },
    }
  }
  try {
    const domainPlan = await planVotes(context, {
      branch,
      lockIds: null,
      manual: new Map(),
    })
    if (!domainPlan) {
      return errorOutcome({
        scope,
        tool: input.tool,
        intent: "custom_vote",
        title: `Your ${asset} ballot`,
      })
    }
    const manual = new Map<string, bigint>()
    for (const line of matched) {
      if (line.resolution.kind !== "match") continue
      const key = line.resolution.entry.target
      manual.set(key, (manual.get(key) ?? 0n) + BigInt(line.bps ?? 0))
    }
    const plan = { ...domainPlan, bps: manual }
    if (plan.eligible.length === 0) {
      return noLocksOutcome(
        context,
        input.tool,
        "custom_vote",
        asset,
        plan.alreadyVoted.length > 0 ? "all_voted" : "no_locks",
      )
    }
    const { outcome } = await presentVotePlan(context, plan, {
      tool: input.tool,
      intent: "custom_vote",
      origin: "user_request",
    })
    return {
      ...outcome,
      why: {
        templateId: `${input.tool}.why.v1`,
        items: [
          {
            text: `Resolved: ${resolvedText}`.slice(0, 240),
            factRefs: allRefs,
          },
          ...mezoItem,
          ...(outcome.why?.items ?? []),
        ].slice(0, 6),
      },
      facts: [...outcome.facts, ...facts],
      model: {
        rows: [...outcome.model.rows, ...modelRows],
        notes: [
          ...outcome.model.notes,
          ...(script.keepMezoGauges ? [MEZO_NOTE] : []),
        ],
      },
    }
  } catch {
    return errorOutcome({
      scope,
      tool: input.tool,
      intent: "custom_vote",
      title: `Your ${asset} ballot`,
    })
  }
}

function domainFor(
  domains: readonly VotingDomain[],
  branch: VoteBranch,
): VotingDomain {
  const found = domains.find((domain) => domain.branch === branch)
  if (found) return found
  // Only reachable for a branch that was loaded.
  throw new Error(`domain ${branch} not loaded`)
}

function optionDetail(entry: DirectoryEntry): string {
  const kind =
    entry.label === "Volatile"
      ? "Basic volatile pool"
      : entry.label === "Stable"
        ? "Basic stable pool"
        : entry.label?.startsWith("CL") === true
          ? entry.label === "CL"
            ? "Concentrated pool"
            : `Concentrated pool, tick spacing ${entry.label.slice(2)}`
          : entry.branch === "pools"
            ? "Pool or vault gauge"
            : entry.branch === "validators"
              ? "Validator gauge"
              : "veBTC gauge"
  return `${kind}, ${entry.target}`
}

/**
 * A card for the first open line with two or more candidates. Each option
 * is that line's pick; the card re-sends the script with earlier picks.
 */
function disambiguationCard(
  context: ToolContext,
  lines: readonly ResolvedLine[],
  resend: string,
): UiBlock | null {
  for (const line of lines) {
    const resolution = line.resolution
    if (resolution.kind === "match") continue
    const options = cardOptions(resolution.options)
    if (options.length === 0) continue
    return {
      type: "clarification_card",
      version: 1,
      id: context.scope.id("b.card"),
      evidenceRefs: [],
      cardId: "entity-disambiguation",
      prompt: `Which gauge for ${clipName(line.target, 60)}?`.slice(0, 120),
      // The pick re-runs the whole ballot with this line and every
      // earlier pick settled.
      query: resend,
      options: options.map((option) => ({
        id: pickId(line.index, option.target),
        label: clipName(entryLabel(option), 60),
        detail: optionDetail(option),
        availability: "available" as const,
      })),
    }
  }
  return null
}

function plain(
  context: ToolContext,
  tool: string,
  input: {
    title: string
    text: string
    facts: Fact[]
    refs?: string[]
    evidence?: Evidence[]
  },
): ToolOutcome {
  return {
    tool,
    intent: "custom_vote",
    status: "unavailable",
    title: input.title,
    snapshot: { blockNumber: null, epoch: null, label: "No ballot prepared" },
    answer: {
      kind: "unavailable",
      templateId: `${tool}.plain.v1`,
      text: input.text,
      factRefs: input.refs ?? [],
    },
    why: null,
    facts: input.facts,
    evidence: input.evidence ?? [],
    blocks: [],
    proposals: [],
    followups: [],
    trace: [
      traceItem({
        scope: context.scope,
        key: "main",
        label: "Read the ballot",
        tool,
      }),
    ],
    model: { rows: [], notes: [input.text] },
    surface: "rail",
  }
}

export const prepareVoteScriptTool = defineTool({
  name: "prepare_vote_script",
  family: "votes",
  description:
    "A pasted vote script or governance post with 'N% to <gauge>' lines (e.g. '25% to the BTC/MUSD-200 pool, 20% to the MUSD Savings Vault'). Pass the user's text unchanged. Matchbox resolves every name by code (BTC/MUSD-200 = BTC/MUSD CL200, a pair with no type is asked when it has concentrated pools, token order and a bridged token's m prefix ignored, MUSD Savings Vault = sMUSD), picks the voting domain, checks the total is 100% and prepares an unsigned ballot, or lists the lines it could not resolve. Never rewrite or guess names.",
  input: z.object({
    script: z.string().min(1).max(2_000),
  }),
  async run(context, input) {
    // Picks come from the user's own request, never the model's copy.
    const { picks } = splitPicks(context.query)
    const { script } = splitPicks(input.script)
    return prepareBallot(context, {
      tool: "prepare_vote_script",
      text: script,
      script: parseBallotScript(script),
      branch: null,
      picks,
      resend: script,
    })
  },
})

const allocationInput = z.object({
  target: z
    .string()
    .min(1)
    .max(80)
    .describe(
      "Gauge as the user wrote it: name, 'BTC/MUSD CL200', '#6033' or address.",
    ),
  percent: z
    .string()
    .regex(/^\d{1,3}(?:\.\d{1,2})?$/)
    .describe('Percent of voting power, up to 2 decimals, e.g. "33.33".'),
})

export const prepareVoteTool = defineTool({
  name: "prepare_vote",
  family: "votes",
  description:
    "A ballot the user specified as a list (e.g. '30% to Boar, 70% to ChooseMe'). Percentages must total 100. Names are resolved by code, and branch null lets Matchbox pick the voting domain from the names. Prepares unsigned ballots for every eligible lock in one voting domain, never mixes domains. For pasted posts use prepare_vote_script.",
  input: z.object({
    branch: z.enum(["boost", "validators", "pools"]).nullable(),
    allocations: z.array(allocationInput).min(1).max(30),
  }),
  async run(context, input) {
    const { script, picks } = splitPicks(context.query)
    const parsed = parseBallotScript(script)
    // Lines keep their place in the user's post, so picks (which name a
    // post line) land on the same line; a line the post does not have
    // takes an index no pick can name.
    const unused = new Set(parsed.lines.map((line) => line.index))
    const lines: ScriptLine[] = input.allocations.map((allocation, order) => {
      const wanted = allocation.target.trim().toLowerCase()
      const same = parsed.lines.find(
        (line) =>
          unused.has(line.index) &&
          line.target.trim().toLowerCase() === wanted &&
          line.percent === allocation.percent,
      )
      if (same) unused.delete(same.index)
      return {
        index: same?.index ?? 100 + order,
        raw: `${allocation.percent}% to ${allocation.target}`,
        target: allocation.target,
        percent: allocation.percent,
        bps: percentToBps(allocation.percent),
        linked: true,
      }
    })
    return prepareBallot(context, {
      tool: "prepare_vote",
      text: script,
      script: { ...parsed, lines },
      branch: input.branch,
      picks,
      resend: script,
    })
  },
})
