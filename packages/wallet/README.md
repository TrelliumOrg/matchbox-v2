# @matchbox/wallet

Wallet connection for Pro, Matchscan and ID: the connect drawer (recent,
detected, more wallets and WalletConnect), the wagmi runtime and the wallet
store. The drawer's lists are pure functions, tested without wagmi.

WalletConnect needs a project id from WalletConnect Cloud, a public value.
Each app passes its own (Pro reads `VITE_WALLET_CONNECT_PROJECT_ID` and
otherwise uses the id in its source), so the drawer works locally with no
setup.

A workspace package: it is not published to npm, has no build step and is
imported as TypeScript source by the apps in this repository.

## Tests

```sh
pnpm --filter @matchbox/wallet test       # unit tests (Vitest)
pnpm --filter @matchbox/wallet typecheck
```

The tests need no network, keys or services.
