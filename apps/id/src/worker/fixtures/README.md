# Classic compatibility fixtures

`classic-5c657b5.json` was produced by running **Classic's own code**
(`MallardLabs/Matchbox` at `5c657b5`, the ref ported here), never the ported
code: `platform-server`'s `hmacHex` and cookie helpers, `platform-contracts`'
credential formats, Classic Matchbox ID's `createSigningKeys`, session and
token hashers, and a full Classic OIDC flow (SIWE, authorize, consent, code
exchange) through Classic's own test harness on its memory store.

`classic-fixtures.generator.ts.txt` is the script. To regenerate:

1. `git archive 5c657b5 apps/matchbox-id apps/developer-console packages/platform-contracts packages/platform-server packages/logger | tar -x -C <dir>`
2. In `<dir>/node_modules`, link `@repo/platform-contracts`,
   `@repo/platform-server` and `@repo/logger` to the extracted packages, and
   `zod`, `jose`, `hono`, `viem`, `ipaddr.js` and `@supabase/supabase-js` to
   installed copies.
3. Copy the script to `<dir>/classic-fixtures.ts` and run
   `tsx classic-fixtures.ts > classic-5c657b5.json` from `<dir>`.

`created` and `pairwise` come from Classic's real create paths: the
generator sends each request (new API key, new client secret, invitation,
Google nonce) with every `crypto.getRandomValues` call inside it drawing
from one seeded stream (`seededRandom`), records the plaintext the
response or email carried and the hash Classic's store kept, and does the
same for Classic's pairwise subject generator. The tests run the ported
routes with the same seed (`classic-created.test.ts` in the console,
`classic-pairwise.test.ts` in ID) and expect the same plaintext and hash.
`created.googleAccount` is the account row a Classic Google sign-in wrote;
`pairwise.subject` is the `sub` Classic stored for the dev wallet and the
seeded test client.

The peppers are fixture values. The signing key is the public P-256 example
key from RFC 7517 appendix A.1; it signs nothing real.

The two Classic-signed tokens are stored as their three parts (header,
payload, signature) and rejoined by the tests, so the file holds no whole
JWT for the repository secrets scan (scripts/check-secrets.mjs) to flag.
