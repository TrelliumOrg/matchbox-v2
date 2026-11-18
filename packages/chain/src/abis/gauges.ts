// Gauges. NON_STAKING_GAUGE_ABI is the non-staking gauge of BoostVoter,
// ThirdPartyVoter and ValidatorsVoter (packages/shared/src/contracts on
// Matchbox main). GAUGE_EVENTS_ABI is the PoolsVoter LP staking gauge the
// indexer decodes.

export const NON_STAKING_GAUGE_ABI = [
  {
    inputs: [],
    name: "rewardsBeneficiary",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "_account", type: "address" }],
    name: "earned",
    outputs: [{ internalType: "uint256", name: "_earned", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "newBeneficiary", type: "address" },
    ],
    name: "switchRewardsBeneficiary",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const

export const GAUGE_EVENTS_ABI = [
  {
    type: "event",
    name: "Deposit",
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
        name: "from",
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
    name: "ClaimRewards",
    anonymous: false,
    inputs: [
      {
        name: "from",
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
