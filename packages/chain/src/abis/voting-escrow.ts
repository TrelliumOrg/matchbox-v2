// VotingEscrow (veMEZO and veBTC). Functions from packages/shared/src/contracts
// on Matchbox main; events from the indexer (apps/matchbox-indexer/src/decode/
// abis/voting-escrow.ts), which took them from the explorer subgraph ABI.

export type LockedBalance = {
  amount: bigint
  end: bigint
  isPermanent: boolean
  boost: bigint
}

export type UserPoint = {
  bias: bigint
  slope: bigint
  ts: bigint
  blk: bigint
  permanent: bigint
  virtualBias: bigint
  virtualSlope: bigint
  virtualPermanent: bigint
}

/** The events the indexer decodes. */
export const VOTING_ESCROW_EVENTS_ABI = [
  {
    type: "event",
    name: "Deposit",
    anonymous: false,
    inputs: [
      {
        name: "provider",
        type: "address",
        indexed: true,
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
      },
      {
        name: "depositType",
        type: "uint8",
        indexed: true,
      },
      {
        name: "value",
        type: "uint256",
        indexed: false,
      },
      {
        name: "locktime",
        type: "uint256",
        indexed: false,
      },
      {
        name: "ts",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "LockPermanent",
    anonymous: false,
    inputs: [
      {
        name: "_owner",
        type: "address",
        indexed: true,
      },
      {
        name: "_tokenId",
        type: "uint256",
        indexed: true,
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_ts",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "Merge",
    anonymous: false,
    inputs: [
      {
        name: "_sender",
        type: "address",
        indexed: true,
      },
      {
        name: "_from",
        type: "uint256",
        indexed: true,
      },
      {
        name: "_to",
        type: "uint256",
        indexed: true,
      },
      {
        name: "_amountFrom",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_amountTo",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_amountFinal",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_locktime",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_ts",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "UnlockPermanent",
    anonymous: false,
    inputs: [
      {
        name: "_owner",
        type: "address",
        indexed: true,
      },
      {
        name: "_tokenId",
        type: "uint256",
        indexed: true,
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
      },
      {
        name: "_ts",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "UpdateBoost",
    anonymous: false,
    inputs: [
      {
        name: "_tokenId",
        type: "uint256",
        indexed: true,
      },
      {
        name: "_boost",
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
        name: "provider",
        type: "address",
        indexed: true,
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
      },
      {
        name: "value",
        type: "uint256",
        indexed: false,
      },
      {
        name: "ts",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "Transfer",
    anonymous: false,
    inputs: [
      {
        name: "from",
        type: "address",
        indexed: true,
      },
      {
        name: "to",
        type: "address",
        indexed: true,
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
      },
    ],
  },
] as const

const VOTING_ESCROW_ABI_FUNCTIONS = [
  {
    inputs: [
      { internalType: "uint256", name: "_value", type: "uint256" },
      { internalType: "uint256", name: "_lockDuration", type: "uint256" },
    ],
    name: "createLock",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "locked",
    outputs: [
      {
        components: [
          { internalType: "int128", name: "amount", type: "int128" },
          { internalType: "uint256", name: "end", type: "uint256" },
          { internalType: "bool", name: "isPermanent", type: "bool" },
          { internalType: "uint256", name: "boost", type: "uint256" },
        ],
        internalType: "struct IVotingEscrow.LockedBalance",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "idToManaged",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "_owner", type: "address" },
      { internalType: "uint256", name: "_index", type: "uint256" },
    ],
    name: "ownerToNFTokenIdList",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "votingPowerOfNFT",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "unboostedVotingPowerOfNFT",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "supply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalVotingPower",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "unboostedTotalVotingPower",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "voted",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "tokenId",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const

export const VOTING_ESCROW_ABI = [
  ...VOTING_ESCROW_ABI_FUNCTIONS,
  ...VOTING_ESCROW_EVENTS_ABI,
] as const
