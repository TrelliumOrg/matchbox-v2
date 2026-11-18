---
title: Connected apps
description: The apps you allowed to sign you in, what each can read, and how to revoke one.
updated: 2026-11-10
topics:
  - id.connected-apps.scopes#scopes
---

Connected apps lists every app you allowed to sign you in. Each row shows what the app can read and when you granted it.

## Scopes {#scopes}

A scope is one thing an app asks to read. The consent screen shows each in these words, and marks the ones the app requires.

| On the consent screen   | What the app gets                         |
| ----------------------- | ----------------------------------------- |
| Sign-in ID              | A unique ID for this app                  |
| Wallet                  | Wallet address and network                |
| Discord ID              | Linked Discord user ID                    |
| Discord profile         | Discord username, display name and avatar |
| Mezo Discord membership | When you joined the Mezo Discord server   |

Each app gets its own sign-in ID, so two apps cannot match you by it. Optional scopes have a switch, so you can leave them out.

## Revoke {#revoke}

Press Revoke on an app's row and confirm. Data already shared stays with that app, but it cannot sign you in again without asking.

Ended grants move to a section you can show or hide, with the reason, such as Revoked or Scopes changed.
