# Cloudflare workers and other server environments

- Respect all rules in typescript.md .
- Don't provide deep error messages in HTTP responses; log them and provide a high-level error to the client.
- Use @matchbox/logger rather than the console for logging. The logger automatically emits JSON in production/workers environments and pretty prints in development environments.
- A Worker's entry module (the `main` in its wrangler config) exports only
  the default handler and classes (Durable Objects, Workflows, named
  entrypoints). Constants such as cron strings go in a sibling module
  (`src/crons.ts`): the runtime refuses to start on any other export.
  `pnpm lint` checks this.
