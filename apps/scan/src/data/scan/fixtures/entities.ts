import { BORROW_CONTRACTS, MUSD_CONTRACTS } from "@matchbox/chain"
import { demoPrices } from "@matchbox/contracts/read-models/fixtures"
import { fixtureIds } from "../../blockscout/fixtures"
import address from "../../blockscout/fixtures/address.json"
import addressCounters from "../../blockscout/fixtures/address-counters.json"
import addressTokens from "../../blockscout/fixtures/address-tokens.json"
import block from "../../blockscout/fixtures/block.json"
import blockTransactions from "../../blockscout/fixtures/block-transactions.json"
import transaction from "../../blockscout/fixtures/transaction.json"
import transactionLogs from "../../blockscout/fixtures/transaction-logs.json"
import transactionTokenTransfers from "../../blockscout/fixtures/transaction-token-transfers.json"
import {
  borrowPositionsOf,
  enclaveEvents,
  liveSnapshot,
  troveEvents,
} from "./borrow"
import {
  badRequest,
  type FixtureRoute,
  type FixtureScenario,
  fakeAddress,
  ok,
  page,
  pageAnswer,
} from "./shared"
import {
  allActivity,
  chainOnlyLock,
  labels,
  labelsFor,
  locks,
  lockVotes,
  swapActivity,
  wallet,
  walletActivity,
} from "./world"

/**
 * The composed entity documents (`/entities/tx|address|block`) and the
 * lists around them (`/activity/*`, `/owners/{a}/locks`, `/labels`): the
 * recorded Blockscout parts with the world's rows and labels. The busy
 * address answers every part unavailable, so a page shows per-part
 * degradation.
 */

/** Every part of this address's document is unavailable. */
export const degradedAddress = `0x${"0b".repeat(20)}`
/** An address Blockscout knows nothing about: its parts are not found. */
export const unknownAddress = fakeAddress("dead")

const unavailable = (reason: string) => ({ status: "unavailable", reason })

/** A SCAN_DB part: unavailable (reason disabled) without the database. */
const own = (scenario: FixtureScenario, value: unknown) =>
  scenario === "disabled" ? unavailable("disabled") : value

/** Documents name at most this many distinct addresses (the API's cap). */
const labelLimit = 50
const part = (data: unknown) => ({ status: "ok", data })

// -- the address document's tokens part ------------------------------------

const btcToken = "0x7b7c000000000000000000000000000000000000"
const mezoToken = "0x7b7c000000000000000000000000000000000001"
const musdToken = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"

const tokenPrices = {
  btc_usd: demoPrices.btc?.usd ?? null,
  mezo_usd: demoPrices.mezo?.usd ?? null,
}

/** How the API prices a token: BTC, MEZO, an assumed $1 (MUSD), or not. */
function pricedAs(token: string): "btc" | "mezo" | "usd" | null {
  if (token === btcToken) return "btc"
  if (token === mezoToken) return "mezo"
  if (token === musdToken) return "usd"
  return null
}

/** Base units times a decimal price, to cents, as a decimal string. */
function usdOf(value: string, decimals: number, price: string): string {
  const [whole = "0", fraction = ""] = price.split(".")
  const scaled = BigInt(`${whole}${fraction.padEnd(6, "0").slice(0, 6)}`)
  const cents = (BigInt(value) * scaled) / 10n ** BigInt(decimals + 4)
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`
}

function tokenItem(
  token: { address: string; symbol: string; name: string; decimals: number },
  value: string,
) {
  const priced = pricedAs(token.address)
  const price =
    priced === "btc"
      ? tokenPrices.btc_usd
      : priced === "mezo"
        ? tokenPrices.mezo_usd
        : priced === "usd"
          ? "1"
          : null
  return {
    token,
    value,
    value_usd: price === null ? null : usdOf(value, token.decimals, price),
    priced_as: price === null ? null : priced,
  }
}

/** The API reads one page of an address's balances: Blockscout's 50. */
export const balancesPage = 50

/**
 * ERC-20 balances, as the API's `tokens` part answers them: the recorded
 * Blockscout balances for the recorded address, then airdropped tokens to
 * a full first page with more after it (as a live contract that collects
 * them), and a few for the wallet.
 */
function tokensPart(who: string) {
  if (who === fixtureIds.address) {
    const recorded = addressTokens.items
      .filter((each) => each.token.type === "ERC-20")
      .map((each) =>
        tokenItem(
          {
            address: each.token.address_hash.toLowerCase(),
            symbol: each.token.symbol,
            name: each.token.name,
            decimals: Number(each.token.decimals),
          },
          each.value,
        ),
      )
    const airdropped = Array.from(
      { length: balancesPage - recorded.length },
      (_, index) =>
        tokenItem(
          {
            address: fakeAddress(`a1d0${index.toString(16).padStart(2, "0")}`),
            symbol: `DROP${index + 1}`,
            name: `Airdrop ${index + 1}`,
            decimals: 18,
          },
          "1000000000000000000",
        ),
    )
    return part({
      items: [...recorded, ...airdropped],
      next_page_params: { items_count: balancesPage, value: "1" },
      prices: tokenPrices,
    })
  }
  if (who === wallet) {
    return part({
      items: [
        tokenItem(
          {
            address: musdToken,
            symbol: "MUSD",
            name: "Mezo USD",
            decimals: 18,
          },
          "1250000000000000000000",
        ),
        tokenItem(
          { address: mezoToken, symbol: "MEZO", name: "Mezo", decimals: 18 },
          "18402550000000000000000",
        ),
      ],
      next_page_params: null,
      prices: tokenPrices,
    })
  }
  return unavailable("not_found")
}

function walletSummary() {
  return {
    hash: transaction.from.hash,
    name: null,
    is_contract: false,
    is_verified: false,
    implementations: null,
    coin_balance: "48210000000000000",
    exchange_rate: null,
    block_number_balance_updated_at: transaction.block_number,
    creator_address_hash: null,
    creation_transaction_hash: null,
    proxy_type: null,
    token: null,
    has_logs: false,
    has_token_transfers: true,
    has_tokens: true,
    has_validated_blocks: false,
  }
}

function addressDocument(who: string, scenario: FixtureScenario) {
  if (who === degradedAddress) {
    return {
      address: who,
      summary: unavailable("rate_limited"),
      counters: unavailable("rate_limited"),
      label: null,
      locks: unavailable("upstream"),
      borrow: unavailable("upstream"),
      activity: unavailable("rate_limited"),
      tokens: unavailable("rate_limited"),
    }
  }
  // As the API lays the chain's lock set over the stored page: the lock
  // the store does not have yet is listed too, in the page's order.
  const owned = [...locks, chainOnlyLock]
    .filter((each) => each.owner === who)
    .sort(
      (a, b) =>
        a.escrow.localeCompare(b.escrow) ||
        a.token_id.localeCompare(b.token_id),
    )
  const activity = allActivity.filter(
    (row) => row.actor === who || row.recipient === who,
  )
  const firstPage = page(activity, new URLSearchParams())
  const summary =
    who === fixtureIds.address
      ? part(address)
      : who === wallet
        ? part(walletSummary())
        : unavailable("not_found")
  const counters =
    who === fixtureIds.address
      ? part(addressCounters)
      : who === wallet
        ? part({
            transactions_count: "214",
            token_transfers_count: "61",
            gas_usage_count: null,
            validations_count: "0",
          })
        : unavailable("not_found")
  return {
    address: who,
    summary,
    counters,
    label: scenario === "disabled" ? null : (labels[who] ?? null),
    locks: own(scenario, part({ data: owned, nextCursor: null })),
    borrow:
      scenario === "filling"
        ? unavailable("upstream")
        : own(scenario, {
            ...part(borrowPositionsOf(who)),
            // As on every live Borrow answer: how old the snapshot is.
            snapshot: liveSnapshot(scenario),
          }),
    activity: own(scenario, part(firstPage)),
    labels:
      scenario === "disabled"
        ? {}
        : labelsFor([
            who,
            ...owned.map((lock) => lock.owner),
            ...(firstPage?.data ?? []).flatMap((row) => [
              row.actor,
              row.recipient,
              row.gauge,
              row.pool,
            ]),
          ]),
    labelLimit,
    labelsTruncated: false,
    // Blockscout's, not the database's: there without SCAN_DB too.
    tokens: tokensPart(who),
  }
}

const hash = /^0x[0-9a-f]{64}$/
const anAddress = /^0x[0-9a-f]{40}$/

/** An indexed address topic: twelve zero bytes, then the address. */
const addressTopic = (address: string) =>
  `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`

/**
 * Two loan transactions, built around the recorded one: the fixture
 * wallet's trove borrowing 4,000 MUSD (a TroveUpdated from
 * BorrowerOperations naming the borrower) and the wallet's Enclave
 * position opening (a PositionOpened from EnclaveDebtManager naming the
 * position). Their stored events are the borrow fixtures'.
 */
function loanTransaction(
  id: string,
  emitter: string,
  topics: string[],
  method: string,
  at: { block: number; timestamp: number },
) {
  const [log] = transactionLogs.items
  return {
    transaction: {
      ...transaction,
      hash: id,
      // The stored event's block and time: the transaction it came from.
      block_number: at.block,
      timestamp: new Date(at.timestamp * 1000).toISOString(),
      method,
      from: { ...transaction.from, hash: wallet },
      to: { ...transaction.to, hash: emitter, name: null, implementations: [] },
      token_transfers: [],
      decoded_input: null,
    },
    logs: {
      items:
        log === undefined
          ? []
          : [
              {
                ...log,
                transaction_hash: id,
                block_number: at.block,
                index: 0,
                address: {
                  ...log.address,
                  hash: emitter,
                  name: null,
                  implementations: [],
                },
                topics,
                decoded: null,
              },
            ],
      next_page_params: null,
    },
  }
}

const [troveLoanEvent] = troveEvents
const [enclaveLoanEvent] = enclaveEvents

/** The loan transactions' hashes, for tests. */
export const loanTransactions = {
  trove: troveLoanEvent?.tx_hash ?? "",
  enclave: enclaveLoanEvent?.tx_hash ?? "",
}

const loanDocuments: Readonly<
  Record<string, ReturnType<typeof loanTransaction>>
> = {
  [loanTransactions.trove]: loanTransaction(
    loanTransactions.trove,
    MUSD_CONTRACTS.mainnet.borrowerOperations,
    [
      // TroveUpdated(address,uint256,uint256,uint256,uint256,uint8)
      "0xf575eb5cdee005607f56587351e18943ddacd11756b9d37980ec251797ff136c",
      addressTopic(wallet),
    ],
    "withdrawMUSD",
    {
      block: troveLoanEvent?.block_number ?? 0,
      timestamp: troveLoanEvent?.timestamp ?? 0,
    },
  ),
  [loanTransactions.enclave]: loanTransaction(
    loanTransactions.enclave,
    BORROW_CONTRACTS.mainnet.enclaveDebtManager,
    [
      // PositionOpened(bytes32,address,address,uint256,...)
      "0x71b8cfcb91be8c2c8670be096e68d6366139b0e2d777e4f77ade632a4d721196",
      enclaveLoanEvent?.position_id ?? "",
    ],
    "execute",
    {
      block: enclaveLoanEvent?.block_number ?? 0,
      timestamp: enclaveLoanEvent?.timestamp ?? 0,
    },
  ),
}

export const entityFixtures: FixtureRoute[] = [
  {
    pattern: /^entities\/tx\/(0x[0-9a-f]{64})$/,
    answer: (match, _query, scenario) => {
      const id = match[1] ?? ""
      const loan = loanDocuments[id]
      if (loan !== undefined) {
        return ok({
          data: {
            hash: id,
            transaction: part(loan.transaction),
            logs: part(loan.logs),
            tokenTransfers: part({ items: [], next_page_params: null }),
            activity: own(scenario, part([])),
            labels: {},
            labelLimit,
            labelsTruncated: false,
            final: scenario !== "disabled",
          },
        })
      }
      if (id !== fixtureIds.transaction) {
        return ok({
          data: {
            hash: id,
            transaction: unavailable("not_found"),
            logs: unavailable("not_found"),
            tokenTransfers: unavailable("not_found"),
            activity: own(scenario, part([])),
            labels: {},
            labelLimit,
            labelsTruncated: false,
            final: false,
          },
        })
      }
      return ok({
        data: {
          hash: id,
          transaction: part(transaction),
          logs: part(transactionLogs),
          tokenTransfers: part(transactionTokenTransfers),
          activity: own(scenario, part([swapActivity])),
          labels:
            scenario === "disabled"
              ? {}
              : labelsFor([
                  transaction.from.hash,
                  transaction.to.hash,
                  ...transactionTokenTransfers.items.flatMap((each) => [
                    each.from.hash,
                    each.to.hash,
                  ]),
                  swapActivity.pool,
                ]),
          labelLimit,
          labelsTruncated: false,
          final: scenario !== "disabled",
        },
      })
    },
  },
  {
    pattern: /^entities\/address\/(0x[0-9a-f]{40})$/,
    answer: (match, _query, scenario) =>
      ok({ data: addressDocument(match[1] ?? "", scenario) }),
  },
  {
    pattern: /^entities\/block\/([0-9a-z]+)$/,
    answer: (match, _query, scenario) => {
      const id = match[1] ?? ""
      const known =
        id === String(fixtureIds.block) || id === fixtureIds.blockHash
      if (!known) {
        if (!/^[0-9]+$/.test(id) && !hash.test(id)) return null
        return ok({
          data: {
            id,
            block: unavailable("not_found"),
            transactions: unavailable("not_found"),
            labels: {},
            labelLimit,
            labelsTruncated: false,
            final: false,
          },
        })
      }
      return ok({
        data: {
          id,
          block: part(block),
          transactions: part(blockTransactions),
          labels:
            scenario === "disabled"
              ? {}
              : labelsFor([
                  block.miner.hash,
                  ...blockTransactions.items.flatMap((each) => [
                    each.from.hash,
                    each.to?.hash,
                  ]),
                ]),
          labelLimit,
          labelsTruncated: false,
          final: scenario !== "disabled",
        },
      })
    },
  },
  {
    pattern: /^activity$/,
    answer: (_match, query) => pageAnswer(allActivity, query),
  },
  {
    pattern: /^activity\/tx\/(0x[0-9a-f]{64})$/,
    answer: (match, query) =>
      pageAnswer(
        allActivity.filter((row) => row.tx_hash === match[1]),
        query,
      ),
  },
  {
    pattern: /^activity\/address\/(0x[0-9a-f]{40})$/,
    answer: (match, query) => {
      const who = match[1] ?? ""
      const role = query.get("role") ?? "any"
      const rows = (who === wallet ? walletActivity : allActivity).filter(
        (row) =>
          (role !== "recipient" && row.actor === who) ||
          (role !== "actor" && row.recipient === who),
      )
      const rest = new URLSearchParams(query)
      rest.delete("role")
      return pageAnswer(rows, rest)
    },
  },
  {
    pattern: /^owners\/(0x[0-9a-f]{40})\/locks$/,
    answer: (match, query) =>
      pageAnswer(
        locks.filter((each) => each.owner === match[1]),
        query,
      ),
  },
  {
    // Every vote of the locks the address owns now: by lock, each lock's
    // newest epoch first, then gauge, with the page's gauge labels.
    pattern: /^owners\/(0x[0-9a-f]{40})\/votes$/,
    answer: (match, query) => {
      const owned = new Set(
        locks
          .filter((each) => each.owner === match[1])
          .map((each) => `${each.escrow}:${each.token_id}`),
      )
      const epoch = query.get("epoch")
      const rows = lockVotes
        .filter((vote) => owned.has(`${vote.escrow}:${vote.token_id}`))
        .filter((vote) => epoch === null || String(vote.epoch_start) === epoch)
        .sort(
          (a, b) =>
            a.escrow.localeCompare(b.escrow) ||
            Number(BigInt(a.token_id) - BigInt(b.token_id)) ||
            b.epoch_start - a.epoch_start ||
            a.gauge.localeCompare(b.gauge),
        )
      const rest = new URLSearchParams(query)
      rest.delete("epoch")
      const result = page(rows, rest)
      if (result === null) return badRequest
      const gauges = [...new Set(result.data.map((vote) => vote.gauge))]
      return ok({
        ...result,
        meta: { skipped: 0 },
        labels: labelsFor(gauges.slice(0, labelLimit)),
        labelLimit,
        labelsTruncated: gauges.length > labelLimit,
      })
    },
  },
  {
    pattern: /^labels$/,
    answer: (_match, query) => {
      const wanted = (query.get("address") ?? "")
        .split(",")
        .filter((each) => anAddress.test(each))
      return ok({ data: labelsFor(wanted) })
    },
  },
]
