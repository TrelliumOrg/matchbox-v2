---
title: MCP
description: The Matchbox MCP exposes the tools Stuart uses to AI agents, read only.
updated: 2026-11-10
---

The Matchbox MCP serves the tools Stuart uses to AI agents over the Model Context Protocol. It has 20 tools: Stuart's own, less the support report draft.

:::warning[Not open yet]
The MCP endpoint is switched off in production today. These pages document the tools it will serve.
:::

## What it does {#what-it-does}

Every tool is read only. Tools that prepare a vote, a claim or a lock action return unsigned proposals that nobody can sign through the MCP.

| Setting          | Value                                     |
| ---------------- | ----------------------------------------- |
| Protocol version | `2026-07-28`                              |
| Transport        | JSON-RPC over HTTP `POST /mcp`, stateless |
| Methods          | `tools/list`, `tools/call`                |
| Wallet           | `walletAddress` on each call, read only   |
| Rate limit       | 30 calls a minute and 2,000 a day per IP  |

## Requests {#requests}

Send `MCP-Protocol-Version` and `Mcp-Method` with every request, and `Mcp-Name` with `tools/call`. The version must match the one in the request's `_meta`.

## Tools {#tools}

:::links

- [MCP tools](/developer/mcp/tools) Every tool with its input schema

:::
