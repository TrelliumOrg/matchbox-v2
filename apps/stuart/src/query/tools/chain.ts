import { MUSD_CONTRACTS } from "@matchbox/chain"
import type { Evidence, Fact } from "@matchbox/stuart-ui/contract"
import type { Address } from "viem"
import { z } from "zod"
import {
  byAmountDesc,
  type CompoundedClaim,
  destinationLabel,
  FLOW_METHOD_VERSION,
  type FlowBucket,
  type FlowOutcome,
  type FlowResult,
  summarizeFlows,
  type TokenFlow,
  traceRewardFlows,
} from "../flows"
import {
  clipName,
  displayToken,
  displayTokenDigits,
  listWithAnd,
  shortAddress,
  tokenAmount,
} from "../format"
import {
  type IdScope,
  type ModelRow,
  makeEvidence,
  makeFact,
  type ToolOutcome,
  traceItem,
} from "../outcome"
import {
  ACTIVITY_LIMITS,
  BTC_TOKEN,
  type ChainTransfer,
  lower,
  type OwnedLock,
} from "../providers/chainActivity"
import { resolveSubject, type Subject } from "../subjects"
import {
  addressUrl,
  buildLens,
  type Compounding,
  displayDate,
  type EntityTransfers,
  type Lens,
  type LockTarget,
  lastDays,
  lockUrl,
  memberEvidence,
  type Period,
  periodOf,
  periodSpanText,
  periodUnread,
  periodWord,
  readCompounding,
  readEntityTransfers,
  readHeldBalances,
  resolveLockTargets,
  transfersEvidence,
  txUrl,
  ZERO_ADDRESS,
} from "./chainCommon"
import { errorOutcome, plainOutcome, sourceCluster } from "./common"
import { defineTool, type ToolContext } from "./tool"

// Chain and user activity: who is behind a label, what an address or
// entity did over a period, where its claimed rewards went, and how the
// largest lock holders vote and use their rewards. Read only; every
// answer names its addresses, links Matchscan and states its method.

const subjectSchema = z
  .string()
  .min(1)
  .max(200)
  .nullable()
  .describe(
    "Who: a label or name (SNF, a gauge or validator name), a lock (#6033), or a 0x address the user wrote. Null: the selected wallet.",
  )
const daysSchema = z
  .number()
  .int()
  .min(1)
  .max(365)
  .nullable()
  .describe("Days back from today. Null: 90.")

const sinceSchema = z
  .string()
  .max(20)
  .nullable()
  .describe(
    "Start: 2026-03-01, 23 April, March, this week, month or year, or last week, month or year (the whole calendar one, ending with it). Overrides days. Null: use days.",
  )

const untilSchema = z
  .string()
  .max(20)
  .nullish()
  .describe(
    "End, included: 2026-03-31, 31 March, or March (to its last day). 'In March' is since March, until March. Null: today.",
  )

const DEFAULT_DAYS = 90
/** How far back the largest holders' claims are read. */
const HOLDER_FLOW_DAYS = 60
/** Locks read per question for compounded rebases and chain fees. */
const MAX_LOCKS = 16
const ACTIVITY_LOCKS = 8
const DAY = 86_400
const MUSD = lower(MUSD_CONTRACTS.mainnet.musd)

/**
 * How long each claim is followed: `windowDays` when asked, else to the
 * end of the period. The live data sets the default: SNF's Enclave sweeps
 * rewards every two to three weeks and its Safe holds MEZO for up to two
 * months before relocking, so a fixed 14 days left half of what it later
 * locked or sent "not moved". Lots still open at the end are checked
 * against balances now, so following them longer never overstates held.
 */
function windowSecondsOf(period: Period, windowDays: number | null): number {
  return windowDays === null
    ? period.now - period.since + DAY
    : windowDays * DAY
}

/** "to the end of the period", "to today" when it ended, or "for 14 days". */
function windowText(windowDays: string | null, period: Period): string {
  if (windowDays !== null) return `for ${windowDays} days`
  return period.ended ? "to today" : "to the end of the period"
}

/** The period a tool was asked for could not be read, or is ahead. */
function badPeriod(context: ToolContext, tool: string, title: string) {
  return plainOutcome({
    scope: context.scope,
    tool,
    intent: "chain_activity",
    status: "empty",
    title,
    templateId: `${tool}.bad_period.v1`,
    text: "That period could not be read, or it has not started yet. Name a past start, such as a month or a date.",
    kind: "empty",
    traceLabel: "Period not read",
    notes: [
      "The start or end could not be read, is in the future, or ends before it starts. Ask for a past date. Do not answer for another period.",
    ],
  })
}

/** Builds facts against one evidence set. */
class FactBook {
  readonly facts: Fact[] = []

  constructor(
    private readonly scope: IdScope,
    private readonly refs: string[],
  ) {}

  private add(
    key: string,
    label: string,
    value: Fact["value"],
    display: string,
  ) {
    const fact = makeFact({
      scope: this.scope,
      key,
      label,
      value,
      display,
      status: "historical",
      evidenceRefs: this.refs,
    })
    this.facts.push(fact)
    return fact
  }

  text(key: string, label: string, text: string): Fact {
    const display = clipName(text, 60)
    return this.add(key, label, { kind: "text", text: display }, display)
  }

  count(key: string, label: string, count: number): Fact {
    return this.add(key, label, { kind: "count", count }, String(count))
  }

  token(
    key: string,
    label: string,
    raw: bigint,
    decimals: number,
    symbol: string,
  ): Fact {
    const amount = tokenAmount(raw, decimals, symbol)
    return this.add(key, label, { kind: "token", amount }, displayToken(amount))
  }
}

function plural(count: number, word: string, many = `${word}s`): string {
  return count === 1 ? word : many
}

function notFound(
  context: ToolContext,
  tool: string,
  title: string,
  subject: string | null,
): ToolOutcome {
  const name = (subject ?? "").replace(/["“”]/g, "").slice(0, 60)
  // Template text may only print sourced digits: a name with digits or an
  // address is not echoed back.
  const echo = /\d/.test(name) ? "that name" : `"${name}"`
  return plainOutcome({
    scope: context.scope,
    tool,
    intent: "chain_activity",
    status: "empty",
    title,
    templateId: `${tool}.not_found.v1`,
    text: `Nothing on Mezo is labelled ${echo}. Checked Matchbox's named entities, Matchscan labels and boost gauge names.`,
    kind: "empty",
    traceLabel: "No match",
    notes: [
      `No address, lock or gauge is labelled "${name}". Say so plainly and do not guess an address.`,
    ],
  })
}

function noWallet(context: ToolContext, tool: string, title: string) {
  return plainOutcome({
    scope: context.scope,
    tool,
    intent: "chain_activity",
    status: "empty",
    title,
    templateId: `${tool}.no_wallet.v1`,
    text: "Name an address, label or lock, or connect or watch a wallet.",
    kind: "empty",
    traceLabel: "No wallet selected",
  })
}

function unavailable(context: ToolContext, tool: string, title: string) {
  return plainOutcome({
    scope: context.scope,
    tool,
    intent: "chain_activity",
    status: "unavailable",
    title,
    templateId: `${tool}.unavailable.v1`,
    text: "Token transfers are unavailable right now. Try again shortly.",
    kind: "unavailable",
    traceLabel: "Transfers unavailable",
    traceStatus: "error",
  })
}

type Resolved =
  | { ok: true; subject: Subject }
  | { ok: false; outcome: ToolOutcome }

async function resolved(
  context: ToolContext,
  tool: string,
  title: string,
  text: string | null,
): Promise<Resolved> {
  const result = await resolveSubject(context, text)
  if (result.status === "no_wallet") {
    return { ok: false, outcome: noWallet(context, tool, title) }
  }
  if (result.status === "not_found") {
    return { ok: false, outcome: notFound(context, tool, title, text) }
  }
  return { ok: true, subject: result.subject }
}

function lockLine(locks: readonly OwnedLock[]): string {
  const parts: string[] = []
  for (const asset of ["veBTC", "veMEZO"] as const) {
    const own = locks.filter((lock) => lock.asset === asset)
    if (own.length === 0) continue
    const ids = own
      .slice(0, 2)
      .map((lock) => `#${lock.tokenId}`)
      .join(", ")
    parts.push(
      `${own.length} ${asset} (${ids}${own.length > 2 ? " and more" : ""})`,
    )
  }
  return parts.length ? listWithAnd(parts) : "no locks"
}

// ---------------------------------------------------------------------------
// resolve_holder

export const resolveHolderTool = defineTool({
  name: "resolve_holder",
  family: "entity",
  loose: true,
  description:
    "Who is behind a label, name, gauge, lock or address: the addresses (with the source of each link), whether they are Safes, and the veBTC and veMEZO locks they own now (ownerOf, never who voted). Use for 'who is SNF', 'who owns veBTC #6033', 'which wallet is labelled X'.",
  input: z.object({ subject: subjectSchema }),
  async run(context, input) {
    const tool = "resolve_holder"
    const title = "Holder"
    const { scope } = context
    try {
      const found = await resolved(context, tool, title, input.subject)
      if (!found.ok) return found.outcome
      const subject = found.subject
      const fetchedAt = context.now().toISOString()
      const evidence = memberEvidence(scope, subject, fetchedAt)
      const lockEvidence: Evidence[] = (subject.locks ?? [])
        .slice(0, 4)
        .map((lock, index) =>
          makeEvidence({
            scope,
            key: `lock.${index}`,
            kind: "chain",
            label: `${lock.asset} #${lock.tokenId}`,
            source: `${lock.asset} escrow ownerOf`,
            url: lockUrl(lock.asset, lock.tokenId),
            fetchedAt,
            status: "live",
          }),
        )
      evidence.push(...lockEvidence)
      const refs = evidence.map((item) => item.id)
      const book = new FactBook(scope, refs)
      const signers = await context.providers.chain.safeOwners(
        subject.members.map((member) => member.address),
      )
      const nameFact = book.text("name", "Name", subject.name)
      const memberFacts = subject.members.slice(0, 4).map((member, index) => ({
        member,
        fact: book.text(`m.${index}`, "Address", shortAddress(member.address)),
        role: book.text(`m.${index}.role`, "Role", member.role),
        signers: signers.get(member.address.toLowerCase())?.length ?? 0,
      }))
      const locks = subject.locks ?? []
      const lockCount = book.count("locks", "Locks owned", locks.length)
      const lockText = book.text("lock_line", "Locks", lockLine(locks))
      const name = nameFact.display
      const addressList = listWithAnd(
        memberFacts.map(
          ({ fact, role }) => `${fact.display} (${role.display})`,
        ),
      )
      const text = (
        subject.locks === null
          ? `${name}: ${addressList}. Locks unavailable right now.`
          : `${name}: ${addressList}. ${locks.length === 0 ? "No veBTC or veMEZO locks now." : `Owns ${lockText.display} now.`}`
      ).slice(0, 400)
      const why = memberFacts.map(({ fact, role, signers: count }, index) => {
        const signerFact =
          count > 0 ? book.count(`m.${index}.s`, "Safe signers", count) : null
        return {
          text: `${fact.display}: ${role.display}${signerFact ? `, a Safe with ${signerFact.display} signers` : ""}.`,
          factRefs: [fact.id, role.id, ...(signerFact ? [signerFact.id] : [])],
        }
      })
      return {
        tool,
        intent: "chain_activity",
        status: "ok",
        title: clipName(subject.name, 60),
        snapshot: { blockNumber: null, epoch: null, label: "Owners now" },
        answer: {
          kind: "result",
          templateId: `${tool}.lead.v1`,
          text,
          factRefs: [
            nameFact.id,
            ...memberFacts.flatMap(({ fact, role }) => [fact.id, role.id]),
            lockCount.id,
            lockText.id,
          ],
        },
        why: why.length
          ? { templateId: `${tool}.members.v1`, items: why }
          : null,
        facts: book.facts,
        evidence,
        blocks: [sourceCluster(scope, evidence)],
        proposals: [],
        followups: [],
        trace: [
          traceItem({
            scope,
            key: "resolve",
            label: `Resolved ${subject.members.length} ${plural(subject.members.length, "address", "addresses")}`,
            tool,
          }),
        ],
        model: {
          rows: [
            ...subject.members.map((member) => ({
              address: member.address,
              short: shortAddress(member.address),
              role: member.role,
              // Where the link was read: it may quote a gauge's or a
              // label's name, so it is a name for sourcing.
              sourceName: member.source,
              signers: String(
                signers.get(member.address.toLowerCase())?.length ?? 0,
              ),
            })),
            ...locks.slice(0, 12).map((lock) => ({
              lock: `${lock.asset} #${lock.tokenId}`,
              owner: lock.owner === null ? null : shortAddress(lock.owner),
              locked: displayToken(
                tokenAmount(
                  lock.amount,
                  18,
                  lock.asset === "veBTC" ? "BTC" : "MEZO",
                ),
              ),
            })),
          ],
          notes: [
            "Lock ownership is the escrow's ownerOf now. A vote's voter is msg.sender, not the owner.",
          ],
        },
        surface: "rail",
        checked: [
          `${subject.members.length} ${plural(subject.members.length, "address", "addresses")}`,
        ],
      } satisfies ToolOutcome
    } catch {
      return errorOutcome({ scope, tool, intent: "chain_activity", title })
    }
  },
})

// ---------------------------------------------------------------------------
// trace_rewards

function flowsFor(
  lens: Lens,
  transfers: readonly ChainTransfer[],
  period: Period,
  windowDays: number | null,
  extra: {
    memberSince?: ReadonlyMap<string, number>
    compounded?: readonly CompoundedClaim[]
    balances?: ReadonlyMap<string, bigint>
  } = {},
): FlowResult {
  return traceRewardFlows({
    members: lens.members,
    transfers,
    claimOf: lens.claimOf,
    destinationOf: lens.destinationOf,
    swapLeg: lens.swapLeg,
    swapPair: lens.swapPair,
    windowSeconds: windowSecondsOf(period, windowDays),
    since: period.since,
    until: period.now,
    claimsUntil: period.until,
    ...extra,
  })
}

/** Everything a flow answer needs read for one entity and period. */
type EntityFlows = {
  read: EntityTransfers
  compounding: Compounding
  lens: Lens
  result: FlowResult
}

async function entityFlows(
  context: ToolContext,
  subject: Subject,
  period: Period,
  windowDays: number | null,
  options: {
    pages: number
    native: boolean
    maxLocks: number
    history: boolean
    nftPages?: number
  },
): Promise<EntityFlows | null> {
  const chain = context.providers.chain
  const read = await readEntityTransfers(
    chain,
    subject.members.map((member) => member.address),
    period.since,
    options.pages,
    { native: options.native },
  )
  if (read.unavailable) return null
  // The lens reads lock targets only when flows run, after they are set.
  const targets = new Map<string, LockTarget>()
  const [lens, compounding] = await Promise.all([
    buildLens(chain, subject, read.transfers, targets),
    readCompounding({
      chain,
      subject,
      period,
      transfers: read.transfers,
      maxLocks: options.maxLocks,
      history: options.history,
      ...(options.nftPages === undefined ? {} : { nftPages: options.nftPages }),
    }),
  ])
  const resolved = await resolveLockTargets({
    chain,
    members: lens.members,
    transfers: read.transfers,
    ownerAt: compounding.ownerAt,
  })
  for (const [key, target] of resolved) targets.set(key, target)
  const extra = {
    memberSince: read.memberSince,
    compounded: compounding.claims,
  }
  const first = flowsFor(lens, read.transfers, period, windowDays, extra)
  const balances = await readHeldBalances(chain, first)
  const result =
    balances.size === 0
      ? first
      : flowsFor(lens, read.transfers, period, windowDays, {
          ...extra,
          balances,
        })
  return { read, compounding, lens, result }
}

/** "sent to 0xc62b…3ffc (Safe with the same signers)" with short addresses. */
function bucketText(label: string): string {
  return label.replace(/0x[0-9a-f]{40}/g, (address) => shortAddress(address))
}

/** Lots that stayed where they were, printed after where the rest went. */
const PASSIVE_KINDS = new Set<FlowBucket["kind"]>([
  "unmoved",
  "held",
  "untracked",
])

/** "elsewhere", or "still held" when only held lots are left out. */
function restWord(buckets: readonly FlowBucket[]): string {
  if (buckets.length > 0 && buckets.every((bucket) => bucket.kind === "held")) {
    return "still held"
  }
  return buckets.some((bucket) => PASSIVE_KINDS.has(bucket.kind))
    ? "elsewhere or held"
    : "elsewhere"
}

/** ", 1,528.52 MUSD elsewhere" for the destinations left off a line. */
function restText(
  buckets: readonly FlowBucket[],
  amountOf: (raw: bigint) => string,
): string {
  const rest = buckets.reduce((sum, bucket) => sum + bucket.amount, 0n)
  return rest > 0n ? `, ${amountOf(rest)} ${restWord(buckets)}` : ""
}

/** Not named in the lead: compounded (said apart) and bridge fees. */
const LEAD_SKIPS = new Set<FlowBucket["kind"]>(["compounded", "fee"])

/** One shown liquid destination of one token. */
export type LiquidDestination = {
  /** The counterparty, the destination text, or "swap". */
  key: string
  where: string
  /** For a swap: what the token was swapped to ("MUSD"). */
  swapTo?: readonly string[]
  /** The token's index in the lines. */
  token: number
  /** Its place among the token's liquid places, largest first. */
  rank: number
  refs: string[]
}

/**
 * The main places liquid rewards went: each token's largest destination
 * first (a place two tokens' dust went to never outranks one a token's
 * main amount went to), then the places more tokens went to, then by the
 * token's place in the lines. Swaps on the way are one place, "swapped to
 * MUSD and BTC".
 */
export function liquidPlaces(
  liquid: readonly LiquidDestination[],
): Array<{ where: string; refs: string[] }> {
  const places = new Map<
    string,
    {
      key: string
      where: string
      refs: string[]
      tokens: Set<number>
      rank: number
      swapTo: string[]
    }
  >()
  for (const each of liquid) {
    const place = places.get(each.key) ?? {
      key: each.key,
      where: each.where,
      refs: [],
      tokens: new Set<number>(),
      rank: each.rank,
      swapTo: [],
    }
    place.tokens.add(each.token)
    place.rank = Math.min(place.rank, each.rank)
    for (const symbol of each.swapTo ?? []) {
      if (!place.swapTo.includes(symbol)) place.swapTo.push(symbol)
    }
    for (const ref of each.refs) {
      if (!place.refs.includes(ref)) place.refs.push(ref)
    }
    places.set(each.key, place)
  }
  return [...places.values()]
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.tokens.size - a.tokens.size ||
        Math.min(...a.tokens) - Math.min(...b.tokens),
    )
    .map(({ key, where, refs, swapTo }) => ({
      where: key === "swap" ? `swapped to ${listWithAnd(swapTo)}` : where,
      refs,
    }))
}

/**
 * "sent to A and B, and funded veMEZO #2930": places sent to several
 * addresses share one "sent to", where the first of them stood.
 */
export function joinPlaces(wheres: readonly string[]): string {
  const sent = "sent to "
  const targets = wheres
    .filter((where) => where.startsWith(sent))
    .map((where) => where.slice(sent.length))
  const items: string[] = []
  for (const where of wheres) {
    if (!where.startsWith(sent)) items.push(where)
    else if (where.slice(sent.length) === targets[0]) {
      items.push(`${sent}${listWithAnd(targets)}`)
    }
  }
  if (items.length > 1 && targets.length > 1) {
    return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`
  }
  return listWithAnd(items)
}

/**
 * Whether liquid rewards are still held: by none, some, or all of them
 * (every liquid lot of every token, not only the tokens shown, is held).
 */
export type HeldShare = "none" | "some" | "all"

/**
 * " Liquid rewards: sent to 0xc62b…3ffc, funded veMEZO #2930 for 0x5959…
 * and deposited into CLPool 0xcc37…. Some still held." within `room`
 * characters: as many places as fit (up to four), then the held clause.
 * "Still held." alone only when every liquid reward is.
 */
export function liquidSentence(
  places: ReadonlyArray<{ where: string; refs: string[] }>,
  held: HeldShare,
  room: number,
): { text: string; refs: string[] } {
  for (let count = Math.min(places.length, 4); count >= 1; count -= 1) {
    const shown = places.slice(0, count)
    for (const withHeld of held !== "none" ? [true, false] : [false]) {
      const text = ` Liquid rewards: ${joinPlaces(shown.map((place) => place.where))}${withHeld ? ". Some still held" : ""}.`
      if (text.length <= room) {
        return { text, refs: shown.flatMap((place) => place.refs) }
      }
    }
  }
  const text = " Liquid rewards: still held."
  return held === "all" && places.length === 0 && text.length <= room
    ? { text, refs: [] }
    : { text: "", refs: [] }
}

/** Held by none, some or all of the liquid lots of every token. */
export function heldShare(tokens: readonly TokenFlow[]): HeldShare {
  const liquid = tokens.flatMap((token) =>
    token.buckets.filter((bucket) => !LEAD_SKIPS.has(bucket.kind)),
  )
  const held = liquid.filter((bucket) => bucket.kind === "held").length
  if (held === 0) return "none"
  return held === liquid.length ? "all" : "some"
}

/** What the entity did with the rest of the batch: "added", "sent". */
function batchVerb(kind: FlowBucket["kind"]): string | null {
  switch (kind) {
    case "deposited":
      return "added"
    case "sent":
      return "sent"
    case "locked":
      return "locked"
    case "bridged":
      return "bridged"
    default:
      return null
  }
}

/**
 * " (0xf365…8bc4 read back to 30 Jun 2026 only)": the first member whose
 * history is short, as facts. Empty when every read covers the period.
 */
function coverageClause(
  book: FactBook,
  read: EntityTransfers,
): { text: string; refs: string[] } {
  const gap = read.gaps[0]
  if (gap === undefined) return { text: "", refs: [] }
  const who = book.text(
    "gap.who",
    "History short for",
    shortAddress(gap.address),
  )
  const more = read.gaps.length > 1
  if (gap.reason === "failed") {
    return {
      text: ` (${gap.what} of ${who.display} unavailable${more ? ", others short" : ""})`,
      refs: [who.id],
    }
  }
  if (gap.reason === "module" || gap.reason === "notL2") {
    return {
      text: ` (${gap.what} of ${who.display} ${gap.reason === "module" ? "sent by Safe modules" : "sent without Safe L2 events"} not read${more ? ", others short" : ""})`,
      refs: [who.id],
    }
  }
  if (gap.reason === "undated" || gap.from === null) {
    return {
      text: ` (${gap.what} of ${who.display} undated, not counted${more ? ", others short" : ""})`,
      refs: [who.id],
    }
  }
  const from = book.text("gap.from", "Read back to", displayDate(gap.from))
  return {
    text: ` (${gap.what} of ${who.display} read back to ${from.display} only${more ? ", others short" : ""})`,
    refs: [who.id, from.id],
  }
}

/**
 * The period was not read at all (periodUnread): say so with what was
 * read, and count nothing. "Claimed no rewards" would be a false negative.
 */
function unreadPeriodOutcome(input: {
  context: ToolContext
  tool: string
  title: string
  book: FactBook
  period: Period
  sinceFact: Fact
  coverage: { text: string; refs: string[] }
  name: Fact | string
  read: EntityTransfers
  evidence: Evidence[]
}): ToolOutcome {
  const { book, period, sinceFact, coverage } = input
  const nameFact =
    typeof input.name === "string"
      ? book.text("name", "Name", input.name)
      : input.name
  const text = `The history of ${nameFact.display} ${periodWord(period).toLowerCase()} ${sinceFact.display} could not be read${coverage.text}.`
  const outcome = plainOutcome({
    scope: input.context.scope,
    tool: input.tool,
    intent: "chain_activity",
    status: "empty",
    title: input.title,
    templateId: `${input.tool}.unread.v1`,
    text,
    kind: "empty",
    traceLabel: `Read ${input.read.transfers.length} transfers, none in the period`,
    evidence: input.evidence,
    notes: [
      "The transfer history read does not reach this period, so nothing in it was counted. Say it could not be read. Never say there were no rewards or no activity.",
    ],
  })
  // Only what the sentence says: no counts of a period not read.
  const factRefs = [sinceFact.id, nameFact.id, ...coverage.refs]
  return {
    ...outcome,
    snapshot: { ...outcome.snapshot, label: `partial, ${period.days} days` },
    answer: { ...outcome.answer, factRefs },
    facts: book.facts.filter((fact) => factRefs.includes(fact.id)),
    blocks: [sourceCluster(input.context.scope, input.evidence)],
  }
}

/**
 * "16 of 17 locks": how many of the entity's locks were read for
 * compounded rewards, when the cap left some out. Null when all were.
 */
function lockCoverage(
  book: FactBook,
  compounding: Compounding,
): { text: string; refs: string[] } | null {
  if (compounding.locksSkipped === 0) return null
  const read = book.count("locks.read", "Locks read", compounding.locksRead)
  const all = book.count(
    "locks.all",
    "Locks owned in the period",
    compounding.locksRead + compounding.locksSkipped,
  )
  return {
    text: `${read.display} of ${all.display} locks`,
    refs: [read.id, all.id],
  }
}

function lockEvidenceLabel(compounding: Compounding): string {
  if (compounding.locksSkipped > 0) {
    return `Lock events, ${compounding.locksRead} of ${compounding.locksRead + compounding.locksSkipped} locks`
  }
  return compounding.partial ? "Lock events, partial" : "Lock events"
}

export const traceRewardsTool = defineTool({
  name: "trace_rewards",
  family: "activity",
  loose: true,
  description:
    "Follow the money: the rewards an address or entity claimed over a period (incentives, fees, rebases, per token with tx links) and what happened to each claimed token afterwards (locked, swapped, sent and to whom, bridged out, deposited, or still held), with the attribution method. Use for 'what does SNF do with its incentives', 'where did X's rewards go', 'does X sell or relock'.",
  input: z.object({
    subject: subjectSchema,
    days: daysSchema,
    since: sinceSchema,
    until: untilSchema,
    windowDays: z
      .number()
      .int()
      .min(1)
      .max(60)
      .nullable()
      .describe("Days after each claim to follow it. Null: to today."),
  }),
  async run(context, input) {
    const tool = "trace_rewards"
    const title = "Where rewards went"
    const { scope } = context
    try {
      const found = await resolved(context, tool, title, input.subject)
      if (!found.ok) return found.outcome
      const subject = found.subject
      const period = periodOf(
        context.now(),
        input.days,
        DEFAULT_DAYS,
        input.since,
        input.until ?? null,
      )
      if (period === null) return badPeriod(context, tool, title)
      const windowDays = input.windowDays
      const flows = await entityFlows(context, subject, period, windowDays, {
        pages: ACTIVITY_LIMITS.pagesPerAddress,
        native: true,
        maxLocks: MAX_LOCKS,
        history: true,
      })
      if (flows === null) return unavailable(context, tool, title)
      const { read, compounding, result } = flows
      const partial = read.partial || compounding.partial
      const tokens = summarizeFlows(result)
        .filter((token) => token.claimed > 0n)
        .sort((a, b) => b.claims - a.claims)
      const fetchedAt = context.now().toISOString()
      const evidence: Evidence[] = [
        ...memberEvidence(scope, subject, fetchedAt),
        transfersEvidence({ scope, fetchedAt, partial: read.partial }),
        makeEvidence({
          scope,
          key: "locks",
          kind: "indexer",
          label: lockEvidenceLabel(compounding),
          source:
            "veBTC and veMEZO escrow events of every lock the entity owned in the period, largest first, via the Matchbox API",
          fetchedAt,
          status: compounding.partial ? "stale" : "live",
        }),
        makeEvidence({
          scope,
          key: "method",
          kind: "calculation",
          label: "Claimed first, FIFO",
          source: `Outflows ${windowDays === null ? `after a claim, ${windowText(null, period)}` : `within ${windowDays} days of a claim`} or of reaching another own address, oldest claim first, up to the claimed amount. Held checked against balances now`,
          fetchedAt,
          status: "deterministic",
          calculationVersion: FLOW_METHOD_VERSION,
        }),
      ]
      const refs = evidence.map((item) => item.id)
      const book = new FactBook(scope, refs)
      const sinceFact = book.text(
        "since",
        period.ended ? "Period" : "Since",
        periodSpanText(period),
      )
      const windowFact =
        windowDays === null
          ? null
          : book.count("window", "Window, days", windowDays)
      const claimCount = book.count(
        "claims",
        "Claim transactions",
        new Set(result.claims.map((claim) => claim.tx)).size,
      )
      const tokenCount = book.count("tokens", "Tokens", tokens.length)
      const memberFacts = subject.members
        .slice(0, 3)
        .map((member, index) =>
          book.text(`m.${index}`, "Address", shortAddress(member.address)),
        )
      const nameFact = book.text("name", "Name", subject.name)
      const name = nameFact.display
      const coverage = coverageClause(book, read)
      if (result.claims.length === 0 && periodUnread(read, period.until)) {
        return unreadPeriodOutcome({
          context,
          tool,
          title,
          book,
          period,
          sinceFact,
          coverage,
          name: nameFact,
          read,
          evidence,
        })
      }
      if (result.claims.length === 0) {
        const text = `${name} claimed no rewards ${periodWord(period).toLowerCase()} ${sinceFact.display}${coverage.text}.`
        return {
          ...plainOutcome({
            scope,
            tool,
            intent: "chain_activity",
            status: "empty",
            title,
            templateId: `${tool}.none.v1`,
            text,
            kind: "empty",
            traceLabel: `Read ${read.transfers.length} transfers`,
            evidence,
          }),
          answer: {
            kind: "empty",
            templateId: `${tool}.none.v1`,
            text,
            factRefs: [sinceFact.id, nameFact.id, ...coverage.refs],
          },
          facts: book.facts,
          blocks: [sourceCluster(scope, evidence)],
        }
      }
      // One line per token, the most claimed first: claimed, then the top
      // destinations (each a fact) and the rest as "other".
      const lines: Array<{ text: string; factRefs: string[] }> = []
      const rows: ModelRow[] = []
      const txLinks: Evidence[] = []
      // Where liquid rewards went, for the lead: each token's shown
      // destinations by rank, so the lead names the main ones.
      const liquid: LiquidDestination[] = []
      tokens.slice(0, 5).forEach((token, index) => {
        const claimed = book.token(
          `t.${index}`,
          `${token.symbol} claimed`,
          token.claimed,
          token.decimals,
          token.symbol,
        )
        const count = book.count(`t.${index}.n`, "Claims", token.claims)
        const amountOf = (raw: bigint) =>
          displayToken(tokenAmount(raw, token.decimals, token.symbol))
        const larger = (bucket: FlowBucket) =>
          batchVerb(bucket.kind) !== null &&
          bucket.batchTotal > (bucket.amount * 3n) / 2n
        // What the line prints for a bucket: where it went first (by
        // amount), then what stayed, those without the token symbol.
        // The destination on its own, for the model rows: "sent to ...,
        // part of 5.00 MUSD sent", without the amount in front.
        // `short`: without the "part of N sent" batch total, to make room.
        const short = new Set<FlowBucket>()
        // `named` false: without names read from chain, for model rows.
        const where = (
          bucket: FlowBucket,
          brief = short.has(bucket),
          named = true,
        ) => {
          const verb = batchVerb(bucket.kind)
          const batch =
            verb !== null && larger(bucket) && !brief
              ? verb === "added"
                ? `, part of a ${amountOf(bucket.batchTotal)} add`
                : `, part of ${amountOf(bucket.batchTotal)} ${verb}`
              : ""
          const label = named ? bucket.label : bucket.plain
          return `${clipName(bucketText(label), 60)}${batch}`
        }
        const render = (bucket: FlowBucket, brief = short.has(bucket)) => {
          const passive = PASSIVE_KINDS.has(bucket.kind)
          const amount = passive
            ? amountOf(bucket.amount).replace(` ${token.symbol}`, "")
            : amountOf(bucket.amount)
          return `${amount} ${where(bucket, brief)}`
        }
        const ordered = [
          ...token.buckets.filter((bucket) => !PASSIVE_KINDS.has(bucket.kind)),
          ...token.buckets.filter((bucket) => PASSIVE_KINDS.has(bucket.kind)),
        ]
        const head = `${claimed.display} claimed in ${count.display} ${plural(token.claims, "claim")}: `
        const chosen: FlowBucket[] = []
        const restOf = (shown: readonly FlowBucket[]) =>
          ordered.filter((each) => !shown.includes(each))
        // Largest first, and never a smaller destination in place of a
        // larger one that does not fit: a part that does not fit even
        // without its batch total ends the line, the rest is summed.
        for (const bucket of ordered) {
          if (chosen.length === 4) break
          const fits = (brief: boolean) => {
            const next = [...chosen, bucket]
            const length =
              head.length +
              next
                .map((each) =>
                  render(each, each === bucket ? brief : short.has(each)),
                )
                .join(", ").length +
              restText(restOf(next), amountOf).length +
              1
            return length <= 240
          }
          if (fits(false)) {
            chosen.push(bucket)
          } else if (larger(bucket) && fits(true)) {
            short.add(bucket)
            chosen.push(bucket)
          } else {
            break
          }
        }
        const parts: string[] = []
        const refsOfLine = [claimed.id, count.id]
        // Rank among this token's liquid places only: a compounded or fee
        // bucket ahead of them does not push its main liquid destination
        // behind another token's dust.
        let liquidRank = 0
        chosen.forEach((bucket, slot) => {
          const rank = liquidRank
          const amount = book.token(
            `t.${index}.${slot}`,
            bucketText(bucket.label).slice(0, 60),
            bucket.amount,
            token.decimals,
            token.symbol,
          )
          const whereFact = book.text(
            `t.${index}.${slot}.w`,
            "Destination",
            bucketText(bucket.label),
          )
          refsOfLine.push(amount.id, whereFact.id)
          const placeRefs = [whereFact.id]
          if (bucket.to !== null) {
            const to = book.text(
              `t.${index}.${slot}.to`,
              "Counterparty",
              shortAddress(bucket.to),
            )
            refsOfLine.push(to.id)
            placeRefs.push(to.id)
          }
          // Swapped on the way, then sent or kept: the swap is a place too.
          const swapTo = bucket.via
            .filter((step) => step.startsWith("swapped to "))
            .map((step) => step.slice("swapped to ".length))
          if (swapTo.length > 0) {
            liquid.push({
              key: "swap",
              where: "swapped",
              swapTo,
              token: index,
              rank,
              refs: [whereFact.id],
            })
            liquidRank = rank + 1
          }
          if (!PASSIVE_KINDS.has(bucket.kind) && !LEAD_SKIPS.has(bucket.kind)) {
            liquid.push({
              key: bucket.to ?? bucket.where,
              where: clipName(bucketText(bucket.where), 60),
              token: index,
              rank,
              refs: placeRefs,
            })
            liquidRank = rank + 1
          }
          if (larger(bucket) && !short.has(bucket)) {
            const total = book.token(
              `t.${index}.${slot}.b`,
              `All ${token.symbol} ${batchVerb(bucket.kind)} in those transactions`,
              bucket.batchTotal,
              token.decimals,
              token.symbol,
            )
            refsOfLine.push(total.id)
          }
          const text = render(bucket)
          parts.push(text)
          // Names read from chain go in their own fields, never in the
          // text a row's numbers and addresses are sourced from.
          rows.push({
            // Amounts as digits: the symbol, chain text, is its own field.
            symbol: token.symbol,
            claimed: withoutSymbol(claimed.display, token.symbol),
            amount: withoutSymbol(amount.display, token.symbol),
            destination: where(bucket, false, false),
            destinationName: bucket.names.join(", ") || null,
            tx: bucket.tx,
          })
          if (bucket.tx !== null && txLinks.length < 6) {
            txLinks.push(
              makeEvidence({
                scope,
                key: `tx.${index}.${slot}`,
                kind: "chain",
                label: `${token.symbol} ${whereFact.display}`.slice(0, 60),
                source: `Transaction ${shortAddress(bucket.tx)}`,
                url: txUrl(bucket.tx),
                fetchedAt,
                status: "finalized",
              }),
            )
          }
        })
        const others = restOf(chosen)
        const rest = others.reduce((sum, bucket) => sum + bucket.amount, 0n)
        if (rest > 0n) {
          const other = book.token(
            `t.${index}.rest`,
            "Other destinations",
            rest,
            token.decimals,
            token.symbol,
          )
          refsOfLine.push(other.id)
          parts.push(`${other.display} ${restWord(others)}`)
        }
        lines.push({
          text: `${head}${parts.join(", ")}.`.slice(0, 240),
          factRefs: refsOfLine,
        })
      })
      evidence.push(...txLinks)
      for (const link of txLinks) refs.push(link.id)
      // Token lines come first; the method and gauge lines after them
      // always show, so token lines give way when there are too many.
      const tokenLines = lines.length
      lines.push({
        text: `Method: each claim is followed ${windowText(windowFact?.display ?? null, period)}, also through own addresses. An outflow spends the oldest claimed amount first. Held is checked against balances now. Mixed tokens cannot be tracked exactly.`,
        factRefs: windowFact ? [windowFact.id] : [],
      })
      // Gauges paid the entity too: unstaked principal and emissions,
      // which are not voting rewards and are left out.
      const gaugeCount = new Set(
        read.transfers
          .filter(
            (transfer) =>
              flows.lens.gauges.has(transfer.from) &&
              flows.lens.members.has(transfer.to),
          )
          .map((transfer) => transfer.from),
      ).size
      if (gaugeCount > 0) {
        const gauges = book.count("gauges", "Gauges that paid it", gaugeCount)
        lines.push({
          text: `Not counted as rewards: ${gauges.display} ${gaugeCount === 1 ? "gauge's" : "gauges'"} payouts (staked principal returned, gauge emissions).`,
          factRefs: [gauges.id],
        })
      }
      // Rebases and chain fees compounded into locks, by token.
      const compoundParts: string[] = []
      const compoundRefs: string[] = []
      tokens.forEach((token, index) => {
        if (token.compounded <= 0n) return
        const fact = book.token(
          `c.${index}`,
          `${token.symbol} compounded into locks`,
          token.compounded,
          token.decimals,
          token.symbol,
        )
        const kinds = new Set(
          result.claims
            .filter((claim) => claim.token === token.token)
            .map((claim) => claim.kind),
        )
        const what = kinds.has("chainFees")
          ? "chain fees"
          : kinds.has("rebase")
            ? "rebases"
            : "rewards"
        const asset = token.token === BTC_TOKEN ? "veBTC" : "veMEZO"
        compoundParts.push(`${fact.display} of ${what} into ${asset}`)
        compoundRefs.push(fact.id)
      })
      const across = listWithAnd(memberFacts.map((fact) => fact.display))
      const head = `${periodWord(period)} ${sinceFact.display}${coverage.text}, ${name} claimed rewards in ${claimCount.display} transactions, ${tokenCount.display} ${plural(tokens.length, "token")}, at ${across}.`
      const locksRead = lockCoverage(book, compounding)
      if (locksRead !== null) compoundRefs.push(...locksRead.refs)
      const compoundText = compoundParts.length
        ? ` Compounded into locks${locksRead ? ` (${locksRead.text} read)` : ""}: ${listWithAnd(compoundParts)}.`
        : locksRead
          ? ` Compounded rewards read for ${locksRead.text} only.`
          : ""
      // The lead names where liquid rewards went: the first token's line,
      // amounts and all, when only it has liquid destinations and it
      // fits; else the main places across tokens.
      const base = `${head}${compoundText}`
      const lead = tokens[0]
      const tail = lead ? ` ${lead.symbol}: ${lines[0]?.text ?? ""}` : ""
      const liquidTokens = new Set(liquid.map((each) => each.token))
      const onlyFirst =
        liquidTokens.size === 0 ||
        (liquidTokens.size === 1 && liquidTokens.has(0))
      const fits = onlyFirst && base.length + tail.length <= 400
      const places = fits
        ? { text: "", refs: [] }
        : liquidSentence(
            liquidPlaces(liquid),
            heldShare(tokens),
            400 - base.length,
          )
      const text = `${base}${fits ? tail : places.text}`.slice(0, 400)
      for (const claim of result.claims.slice(-12)) {
        rows.push({
          claim: displayDate(claim.at),
          symbol: claim.symbol,
          amount: displayTokenDigits(
            tokenAmount(claim.amount, claim.decimals, claim.symbol),
          ),
          kind: claim.kind,
          from: shortAddress(claim.from),
          fromName: claim.source,
          by: shortAddress(claim.member),
          lock: claim.lock,
          tx: claim.tx,
        })
      }
      const notes = [
        `Method: claimed first, FIFO, outflows ${windowDays === null ? `after each claim ${windowText(null, period)}` : `within ${windowDays} days of each claim`} or of reaching another own address. State it when you give amounts.`,
        ...(period.ended
          ? [
              `Only claims from ${periodSpanText(period)} are counted. Each is followed past the end, to today.`,
            ]
          : []),
        "Gauge payouts (unstaked LP or vault principal, gauge emissions) are not voting rewards and are not counted.",
        "Rebases and chain fees for live locks go straight into the lock: counted as claimed and compounded, including locks owned then but withdrawn or transferred since.",
        "A deposit into someone else's lock is funding, not relocking. Still held is capped by balances now. Not moved means the window ended with no outflow.",
        read.safes.length > 0
          ? "Native BTC is read from member Safes' own events (execTransaction and multiSend). Other members' native BTC sends are not visible."
          : "Native BTC sends are not visible in token transfers. Held BTC is checked against balances now.",
        ...(read.partial
          ? [
              "History was cut at the page cap or a read failed: earlier claims of that address may be missing. Say from when it was read.",
            ]
          : []),
        ...(compounding.locksSkipped > 0
          ? [
              `Only ${compounding.locksRead} of ${compounding.locksRead + compounding.locksSkipped} locks were read for compounded rewards (largest first): compounded totals are low. Say so.`,
            ]
          : []),
        ...(compounding.partial
          ? [
              "Some lock histories were cut at the page cap: compounded totals may be low.",
            ]
          : []),
      ]
      return {
        tool,
        intent: "chain_activity",
        status: "ok",
        title,
        snapshot: {
          blockNumber: null,
          epoch: null,
          label: `${partial ? "partial, " : ""}${period.days} days`,
        },
        answer: {
          kind: "result",
          templateId: `${tool}.lead.v1`,
          text,
          factRefs: [
            nameFact.id,
            sinceFact.id,
            claimCount.id,
            tokenCount.id,
            ...memberFacts.map((fact) => fact.id),
            ...coverage.refs,
            ...compoundRefs,
            ...(fits ? (lines[0]?.factRefs ?? []) : places.refs),
          ],
        },
        why: {
          templateId: `${tool}.tokens.v1`,
          items: [
            ...lines.slice(
              0,
              Math.min(
                tokenLines,
                Math.max(0, 6 - (lines.length - tokenLines)),
              ),
            ),
            ...lines.slice(tokenLines),
          ].slice(0, 6),
        },
        facts: book.facts.slice(0, 80),
        evidence: evidence.slice(0, 24),
        blocks: [sourceCluster(scope, evidence.slice(0, 24))],
        proposals: [],
        followups: [],
        trace: [
          traceItem({
            scope,
            key: "transfers",
            label: `Read ${read.transfers.length} transfers of ${Math.min(subject.members.length, 3)} ${plural(subject.members.length, "address", "addresses")}`,
            tool,
          }),
          traceItem({
            scope,
            key: "locks",
            label: `Read ${compounding.locksRead} ${plural(compounding.locksRead, "lock")} for compounded rewards`,
            tool,
          }),
          traceItem({
            scope,
            key: "claims",
            label:
              windowDays === null
                ? `Followed ${result.claims.length} claims ${windowText(null, period)}`
                : `Followed ${result.claims.length} claims for ${windowDays} days each`,
            tool,
          }),
        ],
        model: { rows: rows.slice(0, 40), notes },
        surface: "canvas",
        checked: [`${result.claims.length} claims`, `${period.days} days`],
      } satisfies ToolOutcome
    } catch {
      return errorOutcome({ scope, tool, intent: "chain_activity", title })
    }
  },
})

// ---------------------------------------------------------------------------
// address_activity

type Counterparty = {
  address: Address
  in: number
  out: number
}

function counterparties(
  lens: Lens,
  transfers: readonly ChainTransfer[],
): Counterparty[] {
  const map = new Map<string, Counterparty>()
  for (const transfer of transfers) {
    const outgoing = lens.members.has(transfer.from)
    const other = outgoing ? transfer.to : transfer.from
    if (lens.members.has(other) || other === ZERO_ADDRESS) continue
    const entry = map.get(other) ?? { address: other, in: 0, out: 0 }
    if (outgoing) entry.out += 1
    else entry.in += 1
    map.set(other, entry)
  }
  return [...map.values()].sort((a, b) => b.in + b.out - (a.in + a.out))
}

export type ActivityCounts = {
  /** ERC-20 token transfers read. */
  transfers: number
  /** Native BTC sends read from member Safes' events. */
  native: number
  /** Liquid claim transactions. */
  claims: number
  /** Claim transactions that compounded into the members' locks. */
  compounded: number
  /** Deposits into the members' own locks (or locks not identified). */
  locked: number
  /** Deposits into locks someone else owns. */
  funded: number
  swaps: number
  bridgedOut: number
  sentOut: number
  minted: number
}

export function activityCounts(
  lens: Lens,
  transfers: readonly ChainTransfer[],
  compounded: readonly CompoundedClaim[] = [],
): ActivityCounts {
  const byTx = new Map<string, ChainTransfer[]>()
  for (const transfer of transfers) {
    const list = byTx.get(transfer.tx) ?? []
    list.push(transfer)
    byTx.set(transfer.tx, list)
  }
  const claimTxs = new Set<string>()
  let locked = 0
  let funded = 0
  let swaps = 0
  let bridgedOut = 0
  let sentOut = 0
  let minted = 0
  for (const list of byTx.values()) {
    const outs = list.filter(
      (each) => lens.members.has(each.from) && !lens.members.has(each.to),
    )
    const ins = list.filter(
      (each) => lens.members.has(each.to) && !lens.members.has(each.from),
    )
    if (ins.some((each) => lens.claimOf(each) !== null)) {
      claimTxs.add(list[0]?.tx ?? "")
    }
    minted += ins.filter(
      (each) => each.from === ZERO_ADDRESS && each.token === MUSD,
    ).length
    const otherIns = ins.filter((each) => lens.claimOf(each) === null)
    // A swap leg: an outflow that a different token in the same
    // transaction pays for (from its pool or router, or the vault whose
    // shares were burned). A repayment burn beside an unrelated inflow is
    // not one.
    const legs = outs.filter(
      (out) =>
        lens.swapLeg(out) &&
        otherIns.some(
          (inflow) => inflow.token !== out.token && lens.swapPair(out, inflow),
        ),
    )
    if (legs.length > 0) swaps += 1
    for (const out of outs) {
      if (legs.includes(out)) continue
      const destination = lens.destinationOf(out)
      if (destination.kind === "locked") {
        if (destination.own === false) funded += 1
        else locked += 1
      } else if (destination.kind === "bridged") bridgedOut += 1
      else if (destination.kind === "sent") sentOut += 1
    }
  }
  const native = transfers.filter((each) => each.native === true).length
  return {
    transfers: transfers.length - native,
    native,
    claims: claimTxs.size,
    compounded: new Set(compounded.map((claim) => claim.tx)).size,
    locked,
    funded,
    swaps,
    bridgedOut,
    sentOut,
    minted,
  }
}

export const addressActivityTool = defineTool({
  name: "address_activity",
  family: "activity",
  loose: true,
  description:
    "What an address or entity did over a period: reward claims (liquid and compounded into locks), lock deposits (own or funding someone else's), swaps, bridge transfers, MUSD minted (borrowed), transfers by counterparty (labelled), and how its locks voted in the latest epochs. Use for 'what has X been doing', 'who does X send to', 'X's activity since March'.",
  input: z.object({
    subject: subjectSchema,
    days: daysSchema,
    since: sinceSchema,
    until: untilSchema,
  }),
  async run(context, input) {
    const tool = "address_activity"
    const title = "Activity"
    const { scope } = context
    try {
      const found = await resolved(context, tool, title, input.subject)
      if (!found.ok) return found.outcome
      const subject = found.subject
      const period = periodOf(
        context.now(),
        input.days,
        DEFAULT_DAYS,
        input.since,
        input.until ?? null,
      )
      if (period === null) return badPeriod(context, tool, title)
      const members = subject.members.map((member) => member.address)
      const chain = context.providers.chain
      const [read, votes] = await Promise.all([
        readEntityTransfers(chain, members, period.since, 4),
        Promise.all(
          members.slice(0, 3).map((member) => chain.ownerVotes(member)),
        ),
      ])
      if (read.unavailable) return unavailable(context, tool, title)
      const targets = new Map<string, LockTarget>()
      const [lens, compounding] = await Promise.all([
        buildLens(chain, subject, read.transfers, targets),
        readCompounding({
          chain,
          subject,
          period,
          transfers: read.transfers,
          maxLocks: ACTIVITY_LOCKS,
          history: true,
        }),
      ])
      const resolvedTargets = await resolveLockTargets({
        chain,
        members: lens.members,
        transfers: read.transfers,
        ownerAt: compounding.ownerAt,
      })
      for (const [key, target] of resolvedTargets) targets.set(key, target)
      // Read back from now; only what happened by the period's end counts.
      const inPeriod = read.transfers.filter(
        (transfer) => transfer.at <= period.until,
      )
      const counts = activityCounts(lens, inPeriod, compounding.claims)
      const parties = counterparties(lens, inPeriod)
      const partial = read.partial || compounding.partial
      const fetchedAt = context.now().toISOString()
      const evidence: Evidence[] = [
        ...memberEvidence(scope, subject, fetchedAt),
        transfersEvidence({ scope, fetchedAt, partial: read.partial }),
        makeEvidence({
          scope,
          key: "locks",
          kind: "indexer",
          label: lockEvidenceLabel(compounding),
          source:
            "veBTC and veMEZO escrow events of the entity's locks, largest first",
          fetchedAt,
          status: compounding.partial ? "stale" : "live",
        }),
      ]
      const voteRows = votes.flatMap((list) => list ?? [])
      if (voteRows.length > 0) {
        evidence.push(
          makeEvidence({
            scope,
            key: "votes",
            kind: "indexer",
            label: "Lock votes",
            source: "Matchscan lock votes by owner",
            fetchedAt,
            status: "live",
          }),
        )
      }
      const refs = evidence.map((item) => item.id)
      const book = new FactBook(scope, refs)
      const sinceFact = book.text(
        "since",
        period.ended ? "Period" : "Since",
        periodSpanText(period),
      )
      const coverage = coverageClause(book, read)
      if (periodUnread(read, period.until)) {
        return unreadPeriodOutcome({
          context,
          tool,
          title,
          book,
          period,
          sinceFact,
          coverage,
          name: subject.name,
          read,
          evidence,
        })
      }
      const f = {
        transfers: book.count("transfers", "Token transfers", counts.transfers),
        parties: book.count("parties", "Counterparties", parties.length),
        claims: book.count("claims", "Reward claims", counts.claims),
        compounded: book.count(
          "compounded",
          "Claims compounded into locks",
          counts.compounded,
        ),
        locked: book.count("locked", "Lock deposits", counts.locked),
        swaps: book.count("swaps", "Swaps", counts.swaps),
        bridged: book.count("bridged", "Bridged out", counts.bridgedOut),
        minted: book.count("minted", "MUSD minted to it", counts.minted),
      }
      const nativeFact =
        counts.native > 0
          ? book.count("native", "Native BTC sends", counts.native)
          : null
      const funded =
        counts.funded > 0
          ? book.count("funded", "Locks funded for others", counts.funded)
          : null
      const parts = [
        `${f.claims.display} reward ${plural(counts.claims, "claim")}`,
        ...(counts.compounded > 0
          ? [
              `${f.compounded.display} ${plural(counts.compounded, "claim")} compounded into locks`,
            ]
          : []),
        `${f.locked.display} lock ${plural(counts.locked, "deposit")}`,
        ...(funded
          ? [
              `${funded.display} ${plural(counts.funded, "lock")} funded for another address`,
            ]
          : []),
        `${f.swaps.display} ${plural(counts.swaps, "swap")}`,
        `${f.bridged.display} bridge ${plural(counts.bridgedOut, "transfer")} out`,
        ...(counts.minted > 0
          ? [
              `${f.minted.display} MUSD ${plural(counts.minted, "mint")} (borrowed)`,
            ]
          : []),
      ]
      const nameFact = book.text("name", "Name", subject.name)
      const locksRead = lockCoverage(book, compounding)
      if (locksRead !== null && counts.compounded > 0) {
        parts[1] = `${parts[1]} (${locksRead.text} read)`
      }
      const text =
        `${periodWord(period)} ${sinceFact.display}${coverage.text}, ${nameFact.display} made ${f.transfers.display} token transfers${nativeFact ? ` and ${nativeFact.display} native BTC ${plural(counts.native, "send")}` : ""} with ${f.parties.display} counterparties: ${listWithAnd(parts)}.`.slice(
          0,
          400,
        )
      const why: Array<{ text: string; factRefs: string[] }> = []
      parties.slice(0, 4).forEach((party, index) => {
        const who = book.text(
          `p.${index}`,
          "Counterparty",
          shortAddress(party.address),
        )
        const inFact = book.count(`p.${index}.in`, "Transfers in", party.in)
        const outFact = book.count(`p.${index}.out`, "Transfers out", party.out)
        const name = lens.nameOf(party.address)
        const nameOf =
          name === null ? null : book.text(`p.${index}.n`, "Name", name)
        why.push({
          text: `${who.display}${nameOf ? ` (${nameOf.display})` : ""}: ${inFact.display} in, ${outFact.display} out.`,
          factRefs: [
            who.id,
            inFact.id,
            outFact.id,
            ...(nameOf ? [nameOf.id] : []),
          ],
        })
      })
      // Votes: the newest epoch against the one before it.
      const epochs = [...new Set(voteRows.map((vote) => vote.epochStart))].sort(
        (a, b) => b - a,
      )
      const latest = epochs[0]
      if (latest !== undefined) {
        const now = voteRows.filter((vote) => vote.epochStart === latest)
        const before = new Set(
          voteRows
            .filter((vote) => vote.epochStart === epochs[1])
            .map((vote) => vote.gauge),
        )
        const gauges = [...new Set(now.map((vote) => vote.gauge))]
        const added = gauges.filter((gauge) => !before.has(gauge)).length
        const top = [...now].sort((a, b) => byAmountDesc(a.weight, b.weight))[0]
        const epochFact = book.text(
          "epoch",
          "Latest votes",
          displayDate(latest),
        )
        const gaugeFact = book.count("gauges", "Gauges voted", gauges.length)
        const addedFact = book.count("added", "New gauges", added)
        const topFact = top?.gaugeName
          ? book.text("top", "Most votes on", top.gaugeName)
          : null
        why.push({
          text: `Votes of ${epochFact.display}: ${gaugeFact.display} ${plural(gauges.length, "gauge")}${topFact ? `, most on ${topFact.display}` : ""}${epochs.length > 1 ? `, ${addedFact.display} new since the epoch before` : ""}.`,
          factRefs: [
            epochFact.id,
            gaugeFact.id,
            addedFact.id,
            ...(topFact ? [topFact.id] : []),
          ],
        })
      }
      return {
        tool,
        intent: "chain_activity",
        status: counts.transfers + counts.native > 0 ? "ok" : "empty",
        title: clipName(subject.name, 60),
        snapshot: {
          blockNumber: null,
          epoch: null,
          label: `${partial ? "partial, " : ""}${period.days} days`,
        },
        answer: {
          kind: counts.transfers + counts.native > 0 ? "result" : "empty",
          templateId: `${tool}.lead.v1`,
          text,
          factRefs: [
            nameFact.id,
            sinceFact.id,
            ...coverage.refs,
            ...Object.values(f).map((fact) => fact.id),
            ...(funded ? [funded.id] : []),
            ...(nativeFact ? [nativeFact.id] : []),
            ...(locksRead !== null && counts.compounded > 0
              ? locksRead.refs
              : []),
          ],
        },
        why: why.length
          ? { templateId: `${tool}.parties.v1`, items: why.slice(0, 6) }
          : null,
        facts: book.facts,
        evidence,
        blocks: [sourceCluster(scope, evidence)],
        proposals: [],
        followups: [],
        trace: [
          traceItem({
            scope,
            key: "transfers",
            label: `Read ${read.transfers.length} transfers`,
            tool,
          }),
        ],
        model: {
          rows: [
            ...parties.slice(0, 10).map((party) => ({
              counterparty: shortAddress(party.address),
              name: lens.nameOf(party.address),
              in: String(party.in),
              out: String(party.out),
            })),
            ...voteRows.slice(0, 16).map((vote) => ({
              epoch: displayDate(vote.epochStart),
              lock: `${vote.asset} #${vote.tokenId}`,
              gauge: shortAddress(vote.gauge),
              name: vote.gaugeName,
            })),
          ],
          notes: [
            ...(read.partial
              ? [
                  "History was cut at the page cap or a read failed: say from when it was read.",
                ]
              : []),
            ...(compounding.locksSkipped > 0 || compounding.partial
              ? [
                  "Not every lock's events were read: compounded claims may be undercounted.",
                ]
              : []),
          ],
        },
        surface: "rail",
        checked: [`${counts.transfers} transfers`, `${period.days} days`],
      } satisfies ToolOutcome
    } catch {
      return errorOutcome({ scope, tool, intent: "chain_activity", title })
    }
  },
})

// ---------------------------------------------------------------------------
// compare_holders

type Holder = {
  owner: Address
  locks: OwnedLock[]
  amount: bigint
}

function holdersOf(locks: readonly OwnedLock[], limit: number): Holder[] {
  const byOwner = new Map<string, Holder>()
  for (const lock of locks) {
    if (lock.owner === null) continue
    const entry = byOwner.get(lock.owner) ?? {
      owner: lock.owner,
      locks: [],
      amount: 0n,
    }
    entry.locks.push(lock)
    entry.amount += lock.amount
    byOwner.set(lock.owner, entry)
  }
  return [...byOwner.values()]
    .sort((a, b) => byAmountDesc(a.amount, b.amount))
    .slice(0, limit)
}

/** How one claim's main outcome reads in a habit count. */
function habitOf(outcome: FlowOutcome): string {
  const destination = outcome.destination
  const swapped = outcome.via.length > 0
  switch (destination.kind) {
    case "compounded":
      return "compounded"
    case "locked":
      // Into someone else's lock is funding, not relocking.
      return destination.own === false ? "funded a lock" : "relocked"
    case "held":
      return swapped ? "swapped" : "held"
    case "unmoved":
      return swapped ? "swapped" : "not moved"
    case "untracked":
      return "left untracked"
    default:
      return swapped ? "swapped" : destination.kind
  }
}

/** Each claim's main destination, counted: "3 relocked, 2 sent". */
export function claimHabits(result: FlowResult): Record<string, number> {
  const habits: Record<string, number> = {}
  result.claims.forEach((claim) => {
    const outcomes = result.outcomes.filter(
      (each) => each.claim === claim.index,
    )
    const main = [...outcomes].sort((a, b) =>
      byAmountDesc(a.amount, b.amount),
    )[0]
    if (main === undefined) return
    const kind = habitOf(main)
    habits[kind] = (habits[kind] ?? 0) + 1
  })
  return habits
}

export const compareHoldersTool = defineTool({
  name: "compare_holders",
  family: "votes",
  loose: true,
  description:
    "The largest veBTC or veMEZO holders by locked amount (grouped by owner), what they voted for in the latest epoch, and with measure rewards, what each did with claimed rewards (relocked, swapped, sent, bridged, held). Use for 'largest veBTC holders and what they vote for', 'which voters sell incentives vs relock'.",
  input: z.object({
    asset: z.enum(["veBTC", "veMEZO"]),
    limit: z.number().int().min(1).max(8).nullable(),
    measure: z.enum(["votes", "rewards"]),
  }),
  async run(context, input) {
    const tool = "compare_holders"
    const title = `Largest ${input.asset} holders`
    const { scope } = context
    try {
      const limit =
        input.measure === "rewards"
          ? Math.min(input.limit ?? 5, 5)
          : (input.limit ?? 5)
      const locks = await context.providers.chain.topLocks(input.asset, 100)
      if (locks === null) {
        return plainOutcome({
          scope,
          tool,
          intent: "chain_activity",
          status: "unavailable",
          title,
          templateId: `${tool}.unavailable.v1`,
          text: "Lock holders are unavailable right now. Try again shortly.",
          kind: "unavailable",
          traceLabel: "Locks unavailable",
          traceStatus: "error",
        })
      }
      const holders = holdersOf(locks, limit)
      const owners = holders.map((holder) => holder.owner)
      const [labels, votes] = await Promise.all([
        context.providers.chain.labels(owners),
        Promise.all(
          owners.map((owner) => context.providers.chain.ownerVotes(owner)),
        ),
      ])
      // veBTC locks with a boost gauge carry its name ("SNF").
      const gaugeNames = new Map<string, string>()
      if (input.asset === "veBTC") {
        try {
          const domain = await context.providers.votingDomain("boost")
          for (const target of domain.targets) {
            if (target.tokenId !== null)
              gaugeNames.set(target.tokenId, target.name)
          }
        } catch {
          // Names are optional.
        }
      }
      const period = lastDays(context.now(), HOLDER_FLOW_DAYS)
      const habits = new Map<string, Record<string, number>>()
      // Holders whose history was cut short or could not be read.
      const short: Address[] = []
      if (input.measure === "rewards") {
        for (const holder of holders) {
          const subject: Subject = {
            name: holder.owner,
            members: [
              {
                address: holder.owner,
                role: "holder",
                source: "Matchscan locks",
              },
            ],
            locks: holder.locks,
          }
          // Two pages of transfers, one page of lock NFT moves (so claims
          // from before the holder had a lock are not theirs) and its two
          // largest locks; no native BTC decoding.
          const flows = await entityFlows(context, subject, period, null, {
            pages: 2,
            native: false,
            maxLocks: 2,
            history: true,
            nftPages: 1,
          })
          if (flows === null) {
            short.push(holder.owner)
            continue
          }
          if (flows.read.partial || flows.compounding.partial) {
            short.push(holder.owner)
          }
          habits.set(holder.owner, claimHabits(flows.result))
        }
      }
      const partial = short.length > 0
      const fetchedAt = context.now().toISOString()
      const evidence: Evidence[] = [
        makeEvidence({
          scope,
          key: "locks",
          kind: "indexer",
          label: `${input.asset} locks by amount`,
          source: "Matchscan locks, grouped by current owner",
          fetchedAt,
          status: "live",
        }),
        ...holders.slice(0, 5).map((holder, index) =>
          makeEvidence({
            scope,
            key: `h.${index}`,
            kind: "chain",
            label: shortAddress(holder.owner),
            source: `${holder.locks.length} ${input.asset} ${plural(holder.locks.length, "lock")}`,
            url: addressUrl(holder.owner),
            fetchedAt,
            status: "live",
          }),
        ),
      ]
      if (input.measure === "rewards") {
        evidence.push(
          transfersEvidence({ scope, fetchedAt, partial }),
          makeEvidence({
            scope,
            key: "method",
            kind: "calculation",
            label: "Claimed first, FIFO",
            source: `Each claim's largest outcome to the end of the period, last ${HOLDER_FLOW_DAYS} days`,
            fetchedAt,
            status: "deterministic",
            calculationVersion: FLOW_METHOD_VERSION,
          }),
        )
      }
      const refs = evidence.map((item) => item.id)
      const book = new FactBook(scope, refs)
      const unit = input.asset === "veBTC" ? "BTC" : "MEZO"
      const lines = holders.map((holder, index) => {
        const who = book.text(
          `h.${index}`,
          "Holder",
          shortAddress(holder.owner),
        )
        const locked = book.token(
          `h.${index}.locked`,
          "Locked",
          holder.amount,
          18,
          unit,
        )
        const label =
          labels.get(holder.owner)?.name ??
          holder.locks
            .map((lock) => gaugeNames.get(lock.tokenId))
            .find((name) => name !== undefined) ??
          null
        const latest = (votes[index] ?? []).reduce(
          (max, vote) => Math.max(max, vote.epochStart),
          0,
        )
        const current = (votes[index] ?? []).filter(
          (vote) => vote.epochStart === latest,
        )
        const top = [...current].sort((a, b) =>
          byAmountDesc(a.weight, b.weight),
        )[0]
        const gauges = new Set(current.map((vote) => vote.gauge)).size
        const gaugeFact = book.count(`h.${index}.g`, "Gauges voted", gauges)
        const habit = habits.get(holder.owner)
        const habitText = habit
          ? Object.entries(habit)
              .sort((a, b) => b[1] - a[1])
              .map(([kind, count]) => `${count} ${kind}`)
              .join(", ")
          : null
        const habitFacts = habit
          ? Object.entries(habit).map(([kind, count]) =>
              book.count(`h.${index}.${kind}`, `Claims ${kind}`, count),
            )
          : []
        const topFact = top?.gaugeName
          ? book.text(`h.${index}.top`, "Most votes on", top.gaugeName)
          : null
        const labelFact =
          label === null ? null : book.text(`h.${index}.label`, "Name", label)
        const lockCount = book.count(
          `h.${index}.n`,
          "Locks",
          holder.locks.length,
        )
        const voteText =
          latest === 0
            ? "no votes recorded"
            : `voted ${gaugeFact.display} ${plural(gauges, "gauge")}${topFact ? `, most on ${topFact.display}` : ""}`
        return {
          text: `${who.display}${labelFact ? ` (${labelFact.display})` : ""}: ${locked.display} in ${lockCount.display} ${plural(holder.locks.length, "lock")}, ${voteText}${habitText ? `. Claims: ${habitText}` : ""}.`.slice(
            0,
            240,
          ),
          factRefs: [
            who.id,
            locked.id,
            gaugeFact.id,
            lockCount.id,
            ...(topFact ? [topFact.id] : []),
            ...(labelFact ? [labelFact.id] : []),
            ...habitFacts.map((fact) => fact.id),
          ],
          // The line's values one by one, names apart: the line itself
          // quotes the holder's and the top gauge's names.
          row: {
            holder: who.display,
            name: labelFact?.display ?? null,
            locked: locked.display,
            locks: lockCount.display,
            // Lock ids from the escrow: a gauge without a profile is named
            // after its lock ("veBTC #5910"), which `name` cannot source.
            lockIds: holder.locks
              .map((lock) => `${lock.asset} #${lock.tokenId}`)
              .join(", "),
            gauges: latest === 0 ? "no votes recorded" : gaugeFact.display,
            gaugeName: topFact?.display ?? null,
            claims: habitText,
          } satisfies ModelRow,
        }
      })
      const count = book.count("holders", "Holders", holders.length)
      const shortFact = partial
        ? book.count("short", "Holders with partial history", short.length)
        : null
      const first = lines[0]
      const caveat = shortFact
        ? ` Claims read partly for ${shortFact.display} ${plural(short.length, "holder")}.`
        : ""
      const text = (
        holders.length === 0
          ? `No ${input.asset} locks found.`
          : `Top ${count.display} ${input.asset} holders by locked amount.${caveat} ${first?.text ?? ""}`
      ).slice(0, 400)
      return {
        tool,
        intent: "chain_activity",
        status: holders.length ? "ok" : "empty",
        title,
        snapshot: {
          blockNumber: null,
          epoch: null,
          label: partial ? "Owners now, partial claims" : "Owners now",
        },
        answer: {
          kind: holders.length ? "result" : "empty",
          templateId: `${tool}.lead.v1`,
          text,
          factRefs: [
            count.id,
            ...(shortFact ? [shortFact.id] : []),
            ...(first?.factRefs ?? []),
          ],
        },
        why: lines.length
          ? {
              templateId: `${tool}.holders.v1`,
              items: lines.slice(0, 6).map(({ text: line, factRefs }) => ({
                text: line,
                factRefs,
              })),
            }
          : null,
        facts: book.facts.slice(0, 64),
        evidence,
        blocks: [sourceCluster(scope, evidence)],
        proposals: [],
        followups: [],
        trace: [
          traceItem({
            scope,
            key: "holders",
            label: `Ranked ${holders.length} ${input.asset} holders`,
            tool,
          }),
        ],
        model: {
          rows: [
            ...lines.map((line) => line.row),
            ...(input.measure === "rewards"
              ? [{ window: `last ${HOLDER_FLOW_DAYS} days` }]
              : []),
          ],
          notes:
            input.measure === "rewards"
              ? [
                  `Claims are classified by each claim's largest outcome to the end of the period (claimed first, FIFO), last ${HOLDER_FLOW_DAYS} days, including rebases and chain fees compounded into each holder's two largest locks while the holder owned them. Gauge payouts are not claims.`,
                  "Not read here: native BTC sends, locks past the two largest, and transfers past two pages per holder.",
                  ...(partial
                    ? [
                        `History was partial for ${short.map(shortAddress).join(", ")}: their counts may be low.`,
                      ]
                    : []),
                ]
              : [],
        },
        surface: "canvas",
        checked: [`${holders.length} holders`],
      } satisfies ToolOutcome
    } catch {
      return errorOutcome({ scope, tool, intent: "chain_activity", title })
    }
  },
})

export { destinationLabel }

/** "50.00 MUSD" less its symbol: "50.00". Other text is left as it is. */
function withoutSymbol(display: string, symbol: string): string {
  return display.endsWith(` ${symbol}`)
    ? display.slice(0, -(symbol.length + 1))
    : display
}
