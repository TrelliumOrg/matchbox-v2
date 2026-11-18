# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately. **Do not open a public issue, pull
request or discussion** for a security problem.

- Preferred: GitHub's private vulnerability reporting. On this repository,
  open the **Security** tab and choose **Report a vulnerability**.
- If that is not available to you: email <contact@trellium.org>.

Include what you found, where (app, route or file), how to reproduce it and
the impact you expect. We will acknowledge your report, keep you informed and
credit you when the fix is published, unless you prefer otherwise. Please
give us a reasonable time to fix the problem before you disclose it.

## Scope

In scope: the code in this repository, including

- Matchbox ID (OIDC provider, sessions, wallet sign-in) and Matchbox
  Developer (API keys, OAuth clients, staff access);
- the Matchbox API and its authentication, rate limits and internal routes;
- Matchbox Pro, Matchscan, the homepage, the docs site and Stuart, including
  how they build or present transactions for a wallet to sign;
- the indexer, jobs and feedback Workers;
- the published SDK (`packages/sdk`, `@matchbox-dev/sdk`).

Out of scope:

- Mezo's own contracts, RPC endpoints and apps, and other third-party
  services: report those to their owners.
- Findings that need a compromised device, browser extension or wallet.
- Denial of service by volume, and missing best-practice headers without a
  demonstrated impact.
- Automated scanner output without a working proof of concept.

Never test against other people's accounts or funds, and do not run load
tests against the production sites. Use a local copy (see
[CONTRIBUTING.md](CONTRIBUTING.md)): every app runs on fixtures or an
in-memory store.

## Supported versions

Only the latest release on `main` is supported.
