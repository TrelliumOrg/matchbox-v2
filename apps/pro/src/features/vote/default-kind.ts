import type { GaugeKind, Lock, LockKind } from "../../data/view-models"
import { escrowGroups, gaugeKinds, kindOrder } from "../gauge/kinds"

/**
 * The type `/vote` opens on, and the type to offer when one has nothing
 * funded. A signed-out visitor opened on veBTC gauges with "Funded 0" and
 * every card at "No incentives", while pool gauges held all of the
 * epoch's incentives (P3, 19 Nov 2026).
 *
 * Decided from the loader's data, the same on the server and in the
 * browser, so the page never flashes one type and moves to another. The
 * server ranks the funded types (`GaugeList.fundedKinds`), so no funding
 * maths runs here. Its own module so only the `/vote` component carries
 * it, not the routes.
 */

/** The first type the wallet's locks can vote. */
function lockKind(locks: readonly Lock[]): GaugeKind {
  if (locks.some((lock) => lock.kind === "vemezo")) return "vebtc"
  if (locks.some((lock) => lock.kind === "vebtc")) return "validator"
  return "vebtc"
}

/** The types the wallet's locks vote, when its locks are of one kind. */
function votable(locks: readonly Lock[]): readonly GaugeKind[] {
  const escrows = new Set(locks.map((lock) => lock.kind))
  if (escrows.size !== 1) return kindOrder
  const [only] = escrows
  return escrowGroups.find((group) => group.escrow === only)?.kinds ?? kindOrder
}

/**
 * The first type the wallet's locks vote, while it has funded gauges.
 * Otherwise the most funded type: among those the locks vote when they
 * are all of one kind, among every type when there are none or both.
 * `fundedKinds` is most funded first.
 */
export function defaultKind(
  locks: readonly Lock[],
  fundedKinds: readonly GaugeKind[],
): GaugeKind {
  const first = lockKind(locks)
  if (fundedKinds.includes(first)) return first
  const kinds = votable(locks)
  return fundedKinds.find((kind) => kinds.includes(kind)) ?? first
}

/**
 * For a type with nothing funded, the type to offer instead: the most
 * funded one the locks vote. When the locks vote none that is funded, the
 * most funded of the rest, with the lock it needs (`needs`), so the
 * notice says so: a veMEZO-only wallet was offered "See Pool gauges",
 * which only a veBTC lock votes. Null while the type has funded gauges,
 * or when no other type has.
 */
export function fundedAlternative(
  kind: GaugeKind,
  locks: readonly Lock[],
  fundedKinds: readonly GaugeKind[],
): { kind: GaugeKind; needs: LockKind | null } | null {
  if (fundedKinds.includes(kind)) return null
  const others = fundedKinds.filter((other) => other !== kind)
  const kinds = votable(locks)
  const voted = others.find((other) => kinds.includes(other))
  if (voted !== undefined) return { kind: voted, needs: null }
  const [other] = others
  return other === undefined
    ? null
    : { kind: other, needs: gaugeKinds[other].escrow }
}
