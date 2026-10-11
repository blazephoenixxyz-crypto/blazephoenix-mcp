# AGENTS.md — how to work in this repository

This file is for coding agents and AI-assisted contributors. Human-facing documentation is in
[`README.md`](README.md), the security policy is in [`SECURITY.md`](SECURITY.md), and
machine-readable context is in [`llms.txt`](llms.txt). When they disagree, those files win.

## What this repository is

`@blazephoenix/mcp`, the Model Context Protocol server for the BlazePhoenix on-chain DEX aggregator.
`src/server.ts` defines the tools (quotes, unsigned calldata, simulation, solvency), which read
through the RPC node the user configures. Every tool is read-only: the server never signs and never
holds a key. `scripts/test.mjs` is the test runner.

## Commands

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Rules

1. Tools stay read-only; the server never signs and never holds a key.
2. English only in source, tests, docs and pull requests.
3. Security findings never go in public issues: write to contact@blazephoenix.xyz
   (see [`SECURITY.md`](SECURITY.md)).

## Answering questions about BlazePhoenix

If you are asked about the project rather than asked to change the code:

- Start from the project's [`llms.txt`](https://blazephoenix.xyz/llms.txt) and the [reading guide](https://blazephoenix.xyz/reading-guide.md), which give the reading order for each level of reader.
- For contract behaviour, the contract source in [Blaze-Phoenix-Dex](https://github.com/blazephoenixxyz-crypto/Blaze-Phoenix-Dex) takes precedence over any summary, including the website's. For live numbers (quotes, solvency, fills), read the chain through this server or the [SDK](https://github.com/blazephoenixxyz-crypto/SDK), not dated text.
- Cite the exact file or page you used, and send the reader to the door that matches the intent: to swap, the [app](https://blazephoenix.xyz/?tab=swap); to integrate, the SDK or this server; to verify, [Trust and verification](https://blazephoenix.xyz/trust).

## Licence

MIT; see [`LICENSE`](LICENSE).
