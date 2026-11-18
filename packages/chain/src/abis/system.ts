// Mezo emission, distribution and savings contracts. Event fragments from
// the indexer's decode ABIs (originally the explorer subgraph ABIs), limited
// to the events it handles.

export const SPLITTER_EVENTS_ABI = [
  {
    type: "event",
    name: "Nudge",
    anonymous: false,
    inputs: [
      {
        name: "_period",
        type: "uint256",
        indexed: true,
      },
      {
        name: "_oldRate",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_newRate",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "PeriodUpdated",
    anonymous: false,
    inputs: [
      {
        name: "oldPeriod",
        type: "uint256",
        indexed: false,
      },
      {
        name: "newPeriod",
        type: "uint256",
        indexed: false,
      },
      {
        name: "firstRecipientAmount",
        type: "uint256",
        indexed: false,
      },
      {
        name: "secondRecipientAmount",
        type: "uint256",
        indexed: false,
      },
    ],
  },
] as const

export const MEZO_MINTER_EVENTS_ABI = [
  {
    type: "event",
    name: "EmissionsEnabled",
    anonymous: false,
    inputs: [
      {
        name: "activePeriod",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "EpochProcessed",
    anonymous: false,
    inputs: [
      {
        name: "period",
        type: "uint256",
        indexed: true,
      },
      {
        name: "epochIndex",
        type: "uint256",
        indexed: true,
      },
      {
        name: "emission",
        type: "uint256",
        indexed: false,
      },
      {
        name: "rebase",
        type: "uint256",
        indexed: false,
      },
      {
        name: "rewards",
        type: "uint256",
        indexed: false,
      },
      {
        name: "totalSupply",
        type: "uint256",
        indexed: false,
      },
      {
        name: "caller",
        type: "address",
        indexed: false,
      },
    ],
  },
] as const

export const REBASE_DISTRIBUTOR_EVENTS_ABI = [
  {
    type: "event",
    name: "CheckpointToken",
    anonymous: false,
    inputs: [
      {
        name: "time",
        type: "uint256",
        indexed: false,
      },
      {
        name: "tokens",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    anonymous: false,
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
      },
      {
        name: "epochStart",
        type: "uint256",
        indexed: true,
      },
      {
        name: "epochEnd",
        type: "uint256",
        indexed: true,
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
      },
    ],
  },
] as const

export const MERKLE_DISTRIBUTOR_EVENTS_ABI = [
  {
    type: "event",
    name: "Claimed",
    anonymous: false,
    inputs: [
      {
        name: "distributionId",
        type: "uint256",
        indexed: true,
      },
      {
        name: "index",
        type: "uint256",
        indexed: false,
      },
      {
        name: "account",
        type: "address",
        indexed: true,
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "DistributionAdded",
    anonymous: false,
    inputs: [
      {
        name: "distributionId",
        type: "uint256",
        indexed: true,
      },
      {
        name: "merkleRoot",
        type: "bytes32",
        indexed: false,
      },
      {
        name: "startTimestamp",
        type: "uint256",
        indexed: false,
      },
      {
        name: "handler",
        type: "address",
        indexed: false,
      },
      {
        name: "handlerData",
        type: "bytes",
        indexed: false,
      },
    ],
  },
] as const

export const MUSD_SAVINGS_RATE_EVENTS_ABI = [
  {
    type: "event",
    name: "Deposit",
    anonymous: false,
    inputs: [
      {
        name: "user",
        type: "address",
        indexed: true,
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "ProtocolYieldReceived",
    anonymous: false,
    inputs: [
      {
        name: "amount",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "StrategyYieldReceived",
    anonymous: false,
    inputs: [
      {
        name: "amount",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "Withdraw",
    anonymous: false,
    inputs: [
      {
        name: "user",
        type: "address",
        indexed: true,
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "YieldClaimed",
    anonymous: false,
    inputs: [
      {
        name: "user",
        type: "address",
        indexed: true,
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
      },
    ],
  },
] as const

export const PCV_EVENTS_ABI = [
  {
    type: "event",
    name: "PCVDistribution",
    anonymous: false,
    inputs: [
      {
        name: "_recipient",
        type: "address",
        indexed: false,
      },
      {
        name: "_amount",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "PCVDebtPayment",
    anonymous: false,
    inputs: [
      {
        name: "_paidDebt",
        type: "uint256",
        indexed: false,
      },
    ],
  },
] as const
