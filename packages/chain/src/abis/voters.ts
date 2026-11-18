// The four Mezo voters. Functions from packages/shared/src/contracts on
// Matchbox main; events from the indexer's decode ABIs (boost-voter.ts,
// pools-voter.ts and non-pools-voter.ts), deduplicated: the gauge lifecycle
// events are identical on all four voters, and BoostVoter, ThirdPartyVoter and
// ValidatorsVoter share their vote and gauge creation events. PoolsVoter names
// the second Voted and Abstained argument `pool` (the indexer reads
// args.pool), so its vote events stay separate.

/** Gauge lifecycle events every voter emits. */
export const VOTER_LIFECYCLE_EVENTS_ABI = [
  {
    type: "event",
    name: "DistributeReward",
    anonymous: false,
    inputs: [
      {
        name: "sender",
        type: "address",
        indexed: true,
      },
      {
        name: "gauge",
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
    name: "GaugeKilled",
    anonymous: false,
    inputs: [
      {
        name: "gauge",
        type: "address",
        indexed: true,
      },
    ],
  },
  {
    type: "event",
    name: "GaugeRevived",
    anonymous: false,
    inputs: [
      {
        name: "gauge",
        type: "address",
        indexed: true,
      },
    ],
  },
  {
    type: "event",
    name: "NotifyReward",
    anonymous: false,
    inputs: [
      {
        name: "sender",
        type: "address",
        indexed: true,
      },
      {
        name: "reward",
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

/** Vote, gauge creation and bribe events of the gauge-keyed voters. */
export const GAUGE_VOTER_EVENTS_ABI = [
  {
    type: "event",
    name: "Abstained",
    anonymous: false,
    inputs: [
      {
        name: "voter",
        type: "address",
        indexed: true,
      },
      {
        name: "gauge",
        type: "address",
        indexed: true,
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
      },
      {
        name: "weight",
        type: "uint256",
        indexed: false,
      },
      {
        name: "totalWeight",
        type: "uint256",
        indexed: false,
      },
      {
        name: "timestamp",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "Voted",
    anonymous: false,
    inputs: [
      {
        name: "voter",
        type: "address",
        indexed: true,
      },
      {
        name: "gauge",
        type: "address",
        indexed: true,
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
      },
      {
        name: "weight",
        type: "uint256",
        indexed: false,
      },
      {
        name: "totalWeight",
        type: "uint256",
        indexed: false,
      },
      {
        name: "timestamp",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "GaugeCreated",
    anonymous: false,
    inputs: [
      {
        name: "gauge",
        type: "address",
        indexed: true,
      },
      {
        name: "bribeVotingReward",
        type: "address",
        indexed: true,
      },
      {
        name: "creator",
        type: "address",
        indexed: true,
      },
    ],
  },
  {
    type: "event",
    name: "BribesAdded",
    anonymous: false,
    inputs: [
      {
        name: "gauge",
        type: "address",
        indexed: true,
      },
      {
        name: "token",
        type: "address",
        indexed: true,
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
      },
      {
        name: "sender",
        type: "address",
        indexed: false,
      },
    ],
  },
] as const

/** The events the indexer decodes on BoostVoter. */
export const BOOST_VOTER_EVENTS_ABI = [
  ...VOTER_LIFECYCLE_EVENTS_ABI,
  ...GAUGE_VOTER_EVENTS_ABI,
  ...[
    {
      type: "event",
      name: "BoostPoked",
      anonymous: false,
      inputs: [
        {
          name: "boostableTokenId",
          type: "uint256",
          indexed: true,
        },
        {
          name: "boost",
          type: "uint256",
          indexed: false,
        },
      ],
    },
    {
      type: "event",
      name: "BoostableTokenBurned",
      anonymous: false,
      inputs: [
        {
          name: "boostableTokenId",
          type: "uint256",
          indexed: true,
        },
        {
          name: "gauge",
          type: "address",
          indexed: true,
        },
      ],
    },
  ],
] as const

/** The events the indexer decodes on PoolsVoter. */
export const POOLS_VOTER_EVENTS_ABI = [
  ...VOTER_LIFECYCLE_EVENTS_ABI,
  ...[
    {
      type: "event",
      name: "Abstained",
      anonymous: false,
      inputs: [
        {
          name: "voter",
          type: "address",
          indexed: true,
        },
        {
          name: "pool",
          type: "address",
          indexed: true,
        },
        {
          name: "tokenId",
          type: "uint256",
          indexed: true,
        },
        {
          name: "weight",
          type: "uint256",
          indexed: false,
        },
        {
          name: "totalWeight",
          type: "uint256",
          indexed: false,
        },
        {
          name: "timestamp",
          type: "uint256",
          indexed: false,
        },
      ],
    },
    {
      type: "event",
      name: "GaugeCreated",
      anonymous: false,
      inputs: [
        {
          name: "poolFactory",
          type: "address",
          indexed: true,
        },
        {
          name: "votingRewardsFactory",
          type: "address",
          indexed: true,
        },
        {
          name: "gaugeFactory",
          type: "address",
          indexed: true,
        },
        {
          name: "pool",
          type: "address",
          indexed: false,
        },
        {
          name: "bribeVotingReward",
          type: "address",
          indexed: false,
        },
        {
          name: "feeVotingReward",
          type: "address",
          indexed: false,
        },
        {
          name: "gauge",
          type: "address",
          indexed: false,
        },
        {
          name: "creator",
          type: "address",
          indexed: false,
        },
      ],
    },
    {
      type: "event",
      name: "Voted",
      anonymous: false,
      inputs: [
        {
          name: "voter",
          type: "address",
          indexed: true,
        },
        {
          name: "pool",
          type: "address",
          indexed: true,
        },
        {
          name: "tokenId",
          type: "uint256",
          indexed: true,
        },
        {
          name: "weight",
          type: "uint256",
          indexed: false,
        },
        {
          name: "totalWeight",
          type: "uint256",
          indexed: false,
        },
        {
          name: "timestamp",
          type: "uint256",
          indexed: false,
        },
      ],
    },
  ],
] as const

/**
 * The events the indexer decodes on ThirdPartyVoter and ValidatorsVoter (one
 * NonPoolsVoter ABI in the explorer subgraph).
 */
export const NON_POOLS_VOTER_EVENTS_ABI = [
  ...VOTER_LIFECYCLE_EVENTS_ABI,
  ...GAUGE_VOTER_EVENTS_ABI,
  ...[
    {
      type: "event",
      name: "ThirdPartyGaugeCreated",
      anonymous: false,
      inputs: [
        {
          name: "thirdParty",
          type: "address",
          indexed: true,
        },
        {
          name: "gauge",
          type: "address",
          indexed: true,
        },
        {
          name: "metadata",
          type: "string",
          indexed: false,
        },
      ],
    },
    {
      type: "event",
      name: "ValidatorGaugeCreated",
      anonymous: false,
      inputs: [
        {
          name: "operator",
          type: "address",
          indexed: true,
        },
        {
          name: "gauge",
          type: "address",
          indexed: true,
        },
        {
          name: "beneficiary",
          type: "address",
          indexed: true,
        },
      ],
    },
    {
      type: "event",
      name: "ValidatorLeft",
      anonymous: false,
      inputs: [
        {
          name: "operator",
          type: "address",
          indexed: true,
        },
        {
          name: "gauge",
          type: "address",
          indexed: true,
        },
      ],
    },
  ],
] as const

const BOOST_VOTER_ABI_FUNCTIONS = [
  {
    inputs: [
      { internalType: "address", name: "gaugeFactory", type: "address" },
      { internalType: "uint256", name: "boostableTokenId", type: "uint256" },
      { internalType: "address[]", name: "tokens", type: "address[]" },
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    name: "createBoostGauge",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_tokenId", type: "uint256" },
      { internalType: "address[]", name: "_gaugeVote", type: "address[]" },
      { internalType: "uint256[]", name: "_weights", type: "uint256[]" },
    ],
    name: "vote",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "reset",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "poke",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "boostableTokenId", type: "uint256" },
    ],
    name: "pokeBoost",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256[]",
        name: "boostableTokenIds",
        type: "uint256[]",
      },
    ],
    name: "pokeBoosts",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "boostableTokenId", type: "uint256" },
    ],
    name: "getBoost",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "boostableTokenIdToGauge",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "weights",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "", type: "uint256" },
      { internalType: "address", name: "", type: "address" },
    ],
    name: "votes",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "lastVoted",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "usedWeights",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalWeight",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "isAlive",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "isGauge",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "isWhitelistedToken",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "gaugeToBribe",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "_gauge", type: "address" },
      { internalType: "address[]", name: "_tokens", type: "address[]" },
      { internalType: "uint256[]", name: "_amounts", type: "uint256[]" },
    ],
    name: "addBribes",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address[]", name: "_bribes", type: "address[]" },
      { internalType: "address[][]", name: "_tokens", type: "address[][]" },
      { internalType: "uint256", name: "_tokenId", type: "uint256" },
    ],
    name: "claimBribes",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_timestamp", type: "uint256" }],
    name: "epochStart",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_timestamp", type: "uint256" }],
    name: "epochNext",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [],
    name: "length",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "gauges",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const

export const BOOST_VOTER_ABI = [
  ...BOOST_VOTER_ABI_FUNCTIONS,
  ...BOOST_VOTER_EVENTS_ABI,
] as const

const POOLS_VOTER_ABI_FUNCTIONS = [
  {
    inputs: [
      { internalType: "uint256", name: "_tokenId", type: "uint256" },
      { internalType: "address[]", name: "_poolVote", type: "address[]" },
      { internalType: "uint256[]", name: "_weights", type: "uint256[]" },
    ],
    name: "vote",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "reset",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "poke",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "gauges",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "weights",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "", type: "uint256" },
      { internalType: "address", name: "", type: "address" },
    ],
    name: "votes",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "lastVoted",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "usedWeights",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalWeight",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "isAlive",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "isGauge",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "poolForGauge",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "gaugeToBribe",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "gaugeToFees",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "_token", type: "address" }],
    name: "isWhitelistedToken",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address[]", name: "_bribes", type: "address[]" },
      { internalType: "address[][]", name: "_tokens", type: "address[][]" },
      { internalType: "uint256", name: "_tokenId", type: "uint256" },
    ],
    name: "claimBribes",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address[]", name: "_fees", type: "address[]" },
      { internalType: "address[][]", name: "_tokens", type: "address[][]" },
      { internalType: "uint256", name: "_tokenId", type: "uint256" },
    ],
    name: "claimFees",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_timestamp", type: "uint256" }],
    name: "epochStart",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_timestamp", type: "uint256" }],
    name: "epochNext",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [],
    name: "length",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "pools",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "token", type: "address" }],
    name: "isWhitelistedToken",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const

export const POOLS_VOTER_ABI = [
  ...POOLS_VOTER_ABI_FUNCTIONS,
  ...POOLS_VOTER_EVENTS_ABI,
] as const

const VALIDATORS_VOTER_ABI_FUNCTIONS = [
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "validatorToGauge",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "gaugeToBribe",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "weights",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalWeight",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "isAlive",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "isWhitelistedToken",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_tokenId", type: "uint256" },
      { internalType: "address[]", name: "_gaugeVote", type: "address[]" },
      { internalType: "uint256[]", name: "_weights", type: "uint256[]" },
    ],
    name: "vote",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "reset",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "poke",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "", type: "uint256" },
      { internalType: "address", name: "", type: "address" },
    ],
    name: "votes",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "lastVoted",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "usedWeights",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_timestamp", type: "uint256" }],
    name: "epochStart",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "_gauge", type: "address" },
      { internalType: "address[]", name: "_tokens", type: "address[]" },
      { internalType: "uint256[]", name: "_amounts", type: "uint256[]" },
    ],
    name: "addBribes",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "claimable",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address[]", name: "_gauges", type: "address[]" }],
    name: "claimRewards",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address[]", name: "_bribes", type: "address[]" },
      { internalType: "address[][]", name: "_tokens", type: "address[][]" },
      { internalType: "uint256", name: "_tokenId", type: "uint256" },
    ],
    name: "claimBribes",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "rewardToken",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "length",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "gauges",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const

export const VALIDATORS_VOTER_ABI = [
  ...VALIDATORS_VOTER_ABI_FUNCTIONS,
  ...NON_POOLS_VOTER_EVENTS_ABI,
] as const

const THIRD_PARTY_VOTER_ABI_FUNCTIONS = [
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "gaugeToBribe",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "weights",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalWeight",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "isAlive",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "isWhitelistedToken",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "isWhitelistedNFT",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "maxVotingNum",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_tokenId", type: "uint256" },
      { internalType: "address[]", name: "_gaugeVote", type: "address[]" },
      { internalType: "uint256[]", name: "_weights", type: "uint256[]" },
    ],
    name: "vote",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "reset",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "poke",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "", type: "uint256" },
      { internalType: "address", name: "", type: "address" },
    ],
    name: "votes",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "lastVoted",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "usedWeights",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_timestamp", type: "uint256" }],
    name: "epochStart",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_timestamp", type: "uint256" }],
    name: "epochNext",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "_gauge", type: "address" },
      { internalType: "address[]", name: "_tokens", type: "address[]" },
      { internalType: "uint256[]", name: "_amounts", type: "uint256[]" },
    ],
    name: "addBribes",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address[]", name: "_bribes", type: "address[]" },
      { internalType: "address[][]", name: "_tokens", type: "address[][]" },
      { internalType: "uint256", name: "_tokenId", type: "uint256" },
    ],
    name: "claimBribes",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const

export const THIRD_PARTY_VOTER_ABI = [
  ...THIRD_PARTY_VOTER_ABI_FUNCTIONS,
  ...NON_POOLS_VOTER_EVENTS_ABI,
] as const
