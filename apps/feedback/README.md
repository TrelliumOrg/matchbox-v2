# matchbox-feedback

The Worker behind the in-product feedback widget (`@matchbox/feedback-ui`) on
the Matchbox v2 surfaces. It stores each report in D1, keeps the optional
screenshot in R2 for 90 days, checks every report with Turnstile, and posts
it to one Discord channel as the Matchbox bot. Free tier only: Workers, D1,
R2, a SQLite Durable Object for the rate limit, Turnstile and a cron.

The wire contract is `@matchbox/contracts/feedback` (zod). Designs: Doop
canvas `hFp5UsQ4BA`, page "Feedback widget"; the Discord message is frame
`XFJNepq-CT`.

## Endpoints

| Method and path                  | Request                              | Response                                      |
| -------------------------------- | ------------------------------------ | --------------------------------------------- |
| `GET /v1/health`                 | none                                 | `feedbackHealthResponseSchema`                |
| `GET /v1/config`                 | allowed `Origin`                     | `feedbackConfigResponseSchema` (site key)     |
| `POST /v1/reports`               | `feedbackReportRequestSchema` (JSON) | `feedbackReportResponseSchema`, 201           |
| `PUT /v1/reports/:id/screenshot` | PNG, JPEG or WebP body, bearer token | `{ "ok": true }`                              |
| `OPTIONS *`                      | CORS preflight                       | allowed origins echoed, others get no headers |

A report that announces a screenshot (`screenshot: true`) gets a one-time
upload token. Its Discord post waits for the upload; if none arrives within
10 minutes the cron posts it without one.

Every non-2xx body is `feedbackErrorSchema`:
`{ "error": { "code", "message", "retryAfterSeconds" } }`.

| Status | Code                                                     |
| ------ | -------------------------------------------------------- |
| 400    | `invalid_request` (not the contract, bad JSON)           |
| 403    | `forbidden_origin`, `check_failed` (Turnstile)           |
| 404    | `not_found` (unknown report or wrong upload token)       |
| 409    | `upload_closed` (already uploaded, or the window ended)  |
| 413    | `payload_too_large` (report over 16 kB, image over 5 MB) |
| 415    | `unsupported_media_type`                                 |
| 429    | `rate_limited`, with a `retry-after` header              |
| 503    | `unavailable` (Turnstile not configured or unreachable)  |

## What a report holds

Sent, and listed in the panel before the user presses Send:

- the type (bug, idea, other) and the message (3 to 2,000 characters);
- the surface, the page path (no query string, no fragment), the build;
- the viewport, the theme, the user agent, the wallet's in-app browser if
  the page runs in one, and the chain id if a wallet is connected;
- the wallet address, only when the user ticks the box that shows it;
- a contact (email, Discord or Telegram handle), only when the user types
  one;
- a screenshot, only when the user takes one. It is deleted after 90 days.

Never collected: cookies, local storage, console logs, form field values,
balances, Stuart conversations, or anything else personal. The client IP
is used for the rate limit (as a /24 or /48 prefix, in the Durable Object)
and is never stored with a report or logged. Logs carry report ids, types,
surfaces and outcomes only.

## Limits

- 3 reports a minute and 20 a day per IP prefix; 5 uploads a minute and
  25 a day. A request that fails validation does not count.
- Message 2,000 characters, report body 16 kB, image 5 MB, PNG, JPEG or
  WebP (the bytes must match the declared type).

## Deploy

Nothing here is created by CI or by agents. A person runs these, in order,
from `apps/feedback`. Repeat with `--env preview` (and the preview names in
`wrangler.jsonc`) for the preview Worker.

1. **D1.** `npx wrangler d1 create matchbox-feedback`, put the id in
   `wrangler.jsonc` in place of `REPLACE_WITH_MATCHBOX_FEEDBACK_D1_ID`, then
   `npx wrangler d1 migrations apply matchbox-feedback --remote`.
2. **R2.** `npx wrangler r2 bucket create matchbox-feedback-screenshots`,
   then the 90-day rule:
   `npx wrangler r2 bucket lifecycle add matchbox-feedback-screenshots expire-screenshots screenshots/ --expire-days 90`.
   The cron also deletes screenshots older than 90 days and marks their rows
   expired, so the rule and the rows agree.
3. **Turnstile.** In the Cloudflare dashboard, add a widget in Invisible
   (or Managed) mode for the surfaces' hostnames (the production list in
   `src/env.ts`). Put its site key in `TURNSTILE_SITE_KEY` in
   `wrangler.jsonc`, then `npx wrangler secret put TURNSTILE_SECRET_KEY`.
   Without both the Worker refuses every report (503).
4. **Discord.** In the Matchbox Discord application, give the bot View
   Channel, Send Messages, Embed Links and Attach Files on the feedback
   channel. `npx wrangler secret put DISCORD_BOT_TOKEN`, and set
   `DISCORD_FEEDBACK_CHANNEL_ID` in `wrangler.jsonc` to the channel's id.
   Without them reports are stored and not posted; the health route says
   `discord: off`.
5. **Worker.** `npx wrangler deploy`. Check `GET /v1/health`.
6. **Surfaces.** Build each surface with `VITE_FEEDBACK_URL` set to the
   Worker's origin. A build without it shows no Feedback entry.

Resources and secrets, per environment:

| Kind           | Production                      | Preview                                 |
| -------------- | ------------------------------- | --------------------------------------- |
| Worker         | `matchbox-feedback`             | `matchbox-feedback-preview`             |
| D1             | `matchbox-feedback`             | `matchbox-feedback-preview`             |
| R2             | `matchbox-feedback-screenshots` | `matchbox-feedback-screenshots-preview` |
| Durable Object | `RateLimiter` (migration v1)    | `RateLimiter` (migration v1)            |
| Var            | `TURNSTILE_SITE_KEY`            | `TURNSTILE_SITE_KEY`                    |
| Var            | `DISCORD_FEEDBACK_CHANNEL_ID`   | `DISCORD_FEEDBACK_CHANNEL_ID`           |
| Secret         | `TURNSTILE_SECRET_KEY`          | `TURNSTILE_SECRET_KEY`                  |
| Secret         | `DISCORD_BOT_TOKEN`             | `DISCORD_BOT_TOKEN`                     |
| Cron           | `*/15 * * * *`                  | `*/15 * * * *`                          |

Optional var `FEEDBACK_ALLOWED_ORIGINS` adds page origins (the preview env
lists the surfaces' preview Workers).

## Try it locally

```sh
cp .dev.vars.example .dev.vars        # Turnstile test keys, no Discord
npx wrangler d1 migrations apply matchbox-feedback --local
pnpm --filter @matchbox/feedback dev  # http://localhost:8787
VITE_FEEDBACK_URL=http://localhost:8787 pnpm --filter @matchbox/pro dev
```

Open Pro on port 3000 and press Feedback at the foot of the sidebar. The
report lands in the local D1 (`npx wrangler d1 execute matchbox-feedback
--local --command "SELECT reference, kind, route FROM feedback_reports"`).

## Later: Create GitHub issue

Not in v1. The seam is `reportActions()` in `src/discord.ts`: return a
button row there and add a Discord interactions endpoint that verifies the
request signature and files the issue. The post and the stored report do
not change.

## Tests

`pnpm --filter @matchbox/feedback test` runs the unit tests and the Workers
tests (`src/*.workers.test.ts`, real D1 and R2 in Miniflare, Turnstile and
Discord faked): the happy path with and without a screenshot, a bad
contract, a failed check, the rate limit, foreign origins, Discord down
(the report is kept and the cron posts it), an oversize screenshot and the
90-day expiry.
