import {
  EXPLORER_STATIC_CONTRACTS as CHAIN_EXPLORER_CONTRACTS,
  WAREHOUSE_STATIC_CONTRACTS as CHAIN_WAREHOUSE_CONTRACTS,
  MUSD_BORROWER_OPERATIONS_DEPLOY_BLOCK,
  MUSD_TROVE_MANAGER_DEPLOY_BLOCK,
  type StaticContract,
} from "@matchbox/chain"
import type { Network } from "./networks"
import { NETWORKS } from "./networks"
import type { RegisteredContract } from "./store"

// The explorer subgraph's static data sources, then the warehouse-only ones.
// The addresses live in @matchbox/chain; this file turns them into
// matchbox.contracts rows. Kept in code so the Worker bundle needs no
// manifest; test/ingest/manifest.test.ts fails if the explorer list and the
// manifest drift.
//
// `createdBlock` is the first block ingest fetches the contract's logs from:
// the network start block for core contracts, the creation block for the
// Legacy* reward contracts and the mUSD contracts. It is not the subgraph's
// startBlock (7,739,500).

export {
  MUSD_BORROWER_OPERATIONS_DEPLOY_BLOCK,
  MUSD_TROVE_MANAGER_DEPLOY_BLOCK,
}

function registered(contract: StaticContract): RegisteredContract {
  return {
    network: "mezo",
    address: contract.address,
    kind: contract.kind,
    template: contract.template,
    parent: null,
    pool: contract.pool,
    gauge: contract.gauge,
    createdBlock:
      contract.fromBlock === "networkStart"
        ? (NETWORKS.mezo?.startBlock ?? 0n)
        : contract.fromBlock,
    createdTx: null,
  }
}

export const EXPLORER_STATIC_CONTRACTS: RegisteredContract[] =
  CHAIN_EXPLORER_CONTRACTS.map(registered)

// Not explorer data sources. The mUSD contracts start at their deployment
// block (first block with code), before the network start: trove history
// begins there, and each TroveUpdated delta needs the trove's previous state.
export const WAREHOUSE_STATIC_CONTRACTS: RegisteredContract[] =
  CHAIN_WAREHOUSE_CONTRACTS.map(registered)

export const STATIC_CONTRACTS: Record<Network, RegisteredContract[]> = {
  mezo: [...EXPLORER_STATIC_CONTRACTS, ...WAREHOUSE_STATIC_CONTRACTS],
  "mezo-testnet": [],
}
