# @matchbox/chain

Mezo chain data: the chains, contract addresses and ABIs (voters, escrows,
gauges, reward contracts, pools, mUSD), the events the indexer stores, Safe
helpers and pricing inputs. Contract addresses and ABIs live only here, so
every app reads the same ones. Built on [viem](https://viem.sh).

Token prices come from the token registry in `src/pricing.ts`, by contract
address only. Incentive tokens are permissionless, so a token's symbol is
never used to price it: a token the registry does not list is unpriced,
whatever it is called.

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/chain test       # unit tests (Vitest)
pnpm --filter @matchbox/chain typecheck
```

The tests need no network, keys or services.
