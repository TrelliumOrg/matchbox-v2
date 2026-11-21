import type { Address } from "viem"
import type { StuartContext } from "./context"
import { shortAddress } from "./format"
import { lower, type OwnedLock } from "./providers/chainActivity"
import { mayCarrySecret } from "./secretShapes"

// Who a question is about: a label ("SNF", "Supernormal Foundation"), a
// gauge or lock name, "#6033", an address, or the selected wallet. Every
// address comes with where the link was read, because a label is a claim
// and ownership is a chain fact: a lock belongs to whoever `ownerOf` names
// now, never to whoever voted with it (a vote's `voter` is msg.sender).

export type SubjectMember = {
  address: Address
  /** "voting Safe", "owner of veBTC #6033 (Enclave)". */
  role: string
  /** Where the link comes from, for the answer's sources. */
  source: string
}

export type Subject = {
  /** The name to print: the entity's, the label, or the address. */
  name: string
  members: SubjectMember[]
  /** Locks the members own now, when Matchscan or the API could say. */
  locks: OwnedLock[] | null
}

export type SubjectResult =
  | { status: "ok"; subject: Subject }
  | { status: "not_found"; tried: string[] }
  | { status: "no_wallet" }

/**
 * Entities Matchbox names by hand, each address checked on chain when it
 * was added. Gauge labels are resolved live: the lock's owner is read
 * from the escrow on every question.
 */
type KnownEntity = {
  name: string
  /** For counterparty names: "SNF voting Safe". */
  short: string
  aliases: readonly string[]
  addresses: ReadonlyArray<{ address: Address; role: string }>
  /** Boost gauge names whose veBTC lock belongs to the entity. */
  gaugeNames: readonly string[]
  source: string
}

export const KNOWN_ENTITIES: readonly KnownEntity[] = [
  {
    name: "Supernormal Foundation (SNF)",
    short: "SNF",
    aliases: ["snf", "supernormal", "supernormal foundation"],
    addresses: [
      {
        // A 3 of 4 Safe holding SNF's veMEZO locks (8 on 16 Nov 2026).
        address: "0xf36593cd2e5eb2cc8ccbe5ad3b5bb2353cf98bc4",
        role: "voting Safe",
      },
    ],
    // veBTC #6033's boost gauge, owned by an Enclave that forwards its
    // rewards to the voting Safe.
    gaugeNames: ["SNF"],
    source: "Matchbox curated entities",
  },
]

const ADDRESS = /\b0x[0-9a-fA-F]{40}\b/
const LOCK =
  /(?:\b(vebtc|vemezo)\s*)?#\s*(\d{1,12})\b|\b(vebtc|vemezo)\s+(?:lock\s+|nft\s+)?(\d{1,12})\b/i
const SELF =
  /^(?:me|my|mine|myself|i|my wallet|this wallet|the selected wallet)$/i

function clean(text: string): string {
  return text
    .replace(/[?.!,;:]+$/g, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/(?:'s|’s)$/i, "")
    .replace(/\s+(?:wallet|safe|multisig|address|treasury)$/i, "")
    .trim()
}

/**
 * Names to try, most specific first: "labelled X" and the like, each
 * parenthesis, then the text without them. "the Supernormal Foundation
 * (SNF) (the wallet that owns the veBTC NFT labelled SNF)" gives "SNF",
 * "the wallet that owns ...", "Supernormal Foundation".
 */
export function subjectCandidates(text: string): string[] {
  const out: string[] = []
  const add = (value: string | undefined) => {
    const each = clean(value ?? "")
    if (each && each.length <= 64 && !out.includes(each)) out.push(each)
  }
  for (const match of text.matchAll(
    /\b(?:label(?:l)?ed|called|named|tagged)\s+["“]?([^"”(),]+?)["”]?(?=$|[\s,()?.!]|\s)/gi,
  )) {
    add(match[1])
  }
  for (const match of text.matchAll(/\(([^()]{1,80})\)/g)) add(match[1])
  add(text.replace(/\([^()]*\)/g, " ").replace(/\s+/g, " "))
  return out
}

function words(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9#]+/g, " ")} `
}

function knownEntityFor(text: string): KnownEntity | null {
  const haystack = words(text)
  for (const entity of KNOWN_ENTITIES) {
    if (entity.aliases.some((alias) => haystack.includes(` ${alias} `))) {
      return entity
    }
  }
  return null
}

type Draft = Map<string, SubjectMember>

function addMember(draft: Draft, member: SubjectMember): void {
  const key = member.address.toLowerCase()
  const existing = draft.get(key)
  if (existing) {
    if (!existing.role.includes(member.role)) {
      existing.role = `${existing.role}, ${member.role}`.slice(0, 120)
    }
    return
  }
  draft.set(key, { ...member, address: lower(member.address) })
}

async function lockOwner(
  context: Pick<StuartContext, "providers">,
  asset: "veBTC" | "veMEZO",
  tokenId: string,
): Promise<Address | null> {
  try {
    const states = await context.providers.lockStates(asset, [BigInt(tokenId)])
    const owner = states.locks[0]?.owner ?? null
    return owner === null ? null : lower(owner)
  } catch {
    return null
  }
}

/** Boost gauges named exactly `name`: their veBTC lock ids. */
async function gaugeLocks(
  context: Pick<StuartContext, "providers">,
  names: readonly string[],
): Promise<Array<{ name: string; tokenId: string }>> {
  if (names.length === 0) return []
  const wanted = new Set(names.map((name) => name.toLowerCase()))
  try {
    const domain = await context.providers.votingDomain("boost")
    return domain.targets.flatMap((target) =>
      target.tokenId !== null && wanted.has(target.name.toLowerCase())
        ? [{ name: target.name, tokenId: target.tokenId }]
        : [],
    )
  } catch {
    return []
  }
}

async function ownersOfGauges(
  context: Pick<StuartContext, "providers">,
  draft: Draft,
  names: readonly string[],
): Promise<void> {
  for (const gauge of await gaugeLocks(context, names)) {
    const owner = await lockOwner(context, "veBTC", gauge.tokenId)
    if (owner === null) continue
    addMember(draft, {
      address: owner,
      role: `owner of veBTC #${gauge.tokenId}`,
      source: `Boost gauge "${gauge.name}" is veBTC #${gauge.tokenId}, owner from veBTC ownerOf`,
    })
  }
}

async function attachLocks(
  context: Pick<StuartContext, "providers">,
  members: readonly SubjectMember[],
): Promise<OwnedLock[] | null> {
  const all: OwnedLock[] = []
  let read = false
  for (const member of members.slice(0, 4)) {
    const scanned = await context.providers.chain.ownerLocks(member.address)
    if (scanned !== null) {
      read = true
      all.push(...scanned)
      continue
    }
    try {
      const [mezo, btc] = await Promise.all([
        context.providers.walletLocks(member.address, "veMEZO"),
        context.providers.walletLocks(member.address, "veBTC"),
      ])
      read = true
      for (const lock of [...mezo, ...btc]) {
        all.push({
          asset: lock.asset,
          tokenId: lock.tokenId.toString(),
          owner: member.address,
          amount: lock.amount,
          isPermanent: lock.isPermanent,
          unlockAt: lock.isPermanent ? null : Number(lock.end),
        })
      }
    } catch {
      // Neither source answered for this member.
    }
  }
  if (!read) return null
  const seen = new Set<string>()
  return all.filter((lock) => {
    const id = `${lock.asset}:${lock.tokenId}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export async function resolveSubject(
  context: Pick<StuartContext, "providers" | "wallet">,
  text: string | null,
): Promise<SubjectResult> {
  const raw = (text ?? "").trim()
  const draft: Draft = new Map()
  let name = raw
  if (raw === "" || SELF.test(clean(raw))) {
    if (/^0x0{40}$/.test(context.wallet.address)) return { status: "no_wallet" }
    addMember(draft, {
      address: context.wallet.address,
      role: "selected wallet",
      source: "Selected in Matchbox",
    })
    name = context.wallet.label || context.wallet.address
  }
  const address = ADDRESS.exec(raw)?.[0]
  if (draft.size === 0 && address !== undefined) {
    addMember(draft, {
      address: lower(address),
      role: "address",
      source: "Address in the question",
    })
    const labels = await context.providers.chain.labels([lower(address)])
    const label = labels.get(address.toLowerCase())
    name = label ? label.name : shortAddress(address)
  }
  const lock = LOCK.exec(raw)
  if (draft.size === 0 && lock !== null) {
    const asset =
      (lock[1] ?? lock[3] ?? "vebtc").toLowerCase() === "vemezo"
        ? "veMEZO"
        : "veBTC"
    const tokenId = lock[2] ?? lock[4] ?? ""
    const owner = await lockOwner(context, asset, tokenId)
    if (owner !== null) {
      addMember(draft, {
        address: owner,
        role: `owner of ${asset} #${tokenId}`,
        source: `${asset} ownerOf(${tokenId})`,
      })
      name = `${asset} #${tokenId}`
    }
  }
  const tried = draft.size === 0 ? subjectCandidates(raw) : []
  if (draft.size === 0) {
    const entity = knownEntityFor(raw)
    if (entity !== null) {
      for (const member of entity.addresses) {
        addMember(draft, { ...member, source: entity.source })
      }
      await ownersOfGauges(context, draft, entity.gaugeNames)
      name = entity.name
    }
  }
  if (draft.size === 0) {
    for (const candidate of tried) {
      await ownersOfGauges(context, draft, [candidate])
      if (draft.size > 0) {
        name = candidate
        break
      }
      // A name is searched on Matchscan through the API Worker, which logs
      // its request URLs: never text that may carry a key or phrase.
      if (mayCarrySecret(raw) || mayCarrySecret(candidate)) continue
      const labels = await context.providers.chain.labelSearch(candidate)
      const exact = labels.filter(
        (label) => label.name.toLowerCase() === candidate.toLowerCase(),
      )
      for (const label of exact.slice(0, 4)) {
        addMember(draft, {
          address: label.address,
          role: label.kind,
          source: `Matchscan label "${label.name}" (${label.source})`,
        })
      }
      if (draft.size > 0) {
        name = candidate
        break
      }
    }
  }
  if (draft.size === 0) return { status: "not_found", tried }
  const members = [...draft.values()]
  return {
    status: "ok",
    subject: {
      name: name.slice(0, 60),
      members,
      locks: await attachLocks(context, members),
    },
  }
}
