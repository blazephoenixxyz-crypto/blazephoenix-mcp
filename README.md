# BlazePhoenix MCP server

On-chain DEX aggregator tools for AI agents. The defining property: **every quote
is computed by the on-chain Quoter contract** (`previewPlan`, a free `eth_call`),
the same logic that executes the swap, and it runs **on your own RPC**. There is
no pricing server to trust, and every number an agent relays is reproducible by
anyone.

- **Local server:** `@blazephoenix/mcp` over stdio. Quotes, unsigned calldata,
  and simulation, all read through the node you configure. Proof-of-solvency: coming soon.
- **Remote endpoint:** `https://blazephoenix.xyz/mcp` (streamable HTTP,
  stateless). Deployment registry, ABIs and the pure quote codec. It performs no
  RPC call.
- **Auth:** none · **API key:** none
- **You bring:** an RPC node for each chain the local server reads ([variables](#local-server)). The remote endpoint needs nothing: you run the `eth_call` it prepares on your own node.
- **Chains:** Base (8453), Ethereum (1), Optimism (10), Arbitrum (42161), Robinhood Chain (4663) (protocol V1 is live on all five; V2 is pending and not planned for Ethereum L1)

## BlazePhoenix in one sentence

BlazePhoenix is the fully on-chain DEX aggregator — the route is computed inside the transaction that executes it — paired with an oracle-free staking engine (proof-of-solvency: coming soon). V2, the generation now in development, targets Base, Optimism, Arbitrum, Robinhood Chain and further L2s and is not planned for Ethereum L1. The V1 generation deployed today runs on Base, Ethereum, Optimism, Arbitrum and Robinhood Chain.

**Swap** in the [app](https://blazephoenix.xyz/?tab=swap) · **integrate** with the [SDK](https://github.com/blazephoenixxyz-crypto/SDK) (`npm i @blazephoenix/sdk`) · **connect an agent** to the [MCP server](https://github.com/blazephoenixxyz-crypto/blazephoenix-mcp) (`https://blazephoenix.xyz/mcp`, no key)

## Reading guide by level

- **New to DeFi:** [BlazePhoenix in five minutes](https://blazephoenix.xyz/learn/blazephoenix-in-five-minutes), then [What is a DEX aggregator](https://blazephoenix.xyz/learn/what-is-a-dex-aggregator) and [How to swap tokens safely](https://blazephoenix.xyz/learn/how-to-swap-safely).
- **Comfortable with swaps:** [Anatomy of a DEX aggregator](https://blazephoenix.xyz/learn/anatomy-of-an-aggregator) and [BlazePhoenix vs the established aggregators](https://blazephoenix.xyz/learn/how-we-compare).
- **Engineers and researchers:** the [Technical Whitepaper v2.3](https://blazephoenix.xyz/whitepaper.md) (DOI [10.5281/zenodo.23084091](https://doi.org/10.5281/zenodo.23084091)), the contract source in [Blaze-Phoenix-Dex](https://github.com/blazephoenixxyz-crypto/Blaze-Phoenix-Dex) and [Blaze-Phoenix-Staking](https://github.com/blazephoenixxyz-crypto/Blaze-Phoenix-Staking), and [On-chain quoting](https://blazephoenix.xyz/learn/on-chain-quoting).
- **Models and agents:** [https://blazephoenix.xyz/llms.txt](https://blazephoenix.xyz/llms.txt) and the [reading guide](https://blazephoenix.xyz/reading-guide.md).

## Trust and verification

Each item links to the place where it can be checked. The full list is at [https://blazephoenix.xyz/trust](https://blazephoenix.xyz/trust).

- **Verified contracts:** source-verified on Sourcify and the chain explorers; every address per chain at [/api/deployments](https://blazephoenix.xyz/api/deployments).
- **Source available:** the contract source is public under the [Business Source License 1.1](https://github.com/blazephoenixxyz-crypto/Blaze-Phoenix-Dex/blob/main/LICENSE), converting to GPL-2.0-or-later on 2030-06-01.
- **Public CI:** [GitHub Actions](https://github.com/blazephoenixxyz-crypto/Blaze-Phoenix-Dex/actions) on every push, including the Certora Prover and Halmos.
- **Bug bounty:** a [public programme](https://blazephoenix.xyz/bounty) with [credited researchers](https://blazephoenix.xyz/security/researchers) and [published advisories](https://blazephoenix.xyz/security/advisories).
- **Whitepaper DOI:** [10.5281/zenodo.23084091](https://doi.org/10.5281/zenodo.23084091); papers timestamped with [OpenTimestamps](https://blazephoenix.xyz/provenance/provenance.json).
- **Contact:** contact@blazephoenix.xyz ([security.txt](https://blazephoenix.xyz/.well-known/security.txt)); official channels at [/official](https://blazephoenix.xyz/official).
- **Audit status:** an independent external audit is scheduled before launch.

## Local server

```bash
claude mcp add blazephoenix -e BLAZEPHOENIX_RPC_BASE=<your Base node URL> -- npx -y @blazephoenix/mcp
```

Any MCP client (JSON config):

```json
{
  "mcpServers": {
    "blazephoenix": {
      "command": "npx",
      "args": ["-y", "@blazephoenix/mcp"],
      "env": { "BLAZEPHOENIX_RPC_BASE": "<your Base node URL>" }
    }
  }
}
```

The RPC comes from the environment only, never from a tool argument:

| Variable | Meaning |
|---|---|
| `BLAZEPHOENIX_RPC_URL` | One node, used for every chain it serves |
| `BLAZEPHOENIX_RPC_BASE`, `_ETHEREUM`, `_OPTIMISM`, `_ARBITRUM`, `_ROBINHOOD` | A node per chain. Use either this or `BLAZEPHOENIX_RPC_URL`, not both |
| `BLAZEPHOENIX_VERSION` | Optional protocol version pin: `latest` (default), `1`, `2` or a full version such as `2.0.0`. An invalid value stops the server at start |

A value may hold several URLs separated by commas; they are your fallback order.
The server never prints your URLs, since they may carry a key.

### Tools

| Tool | What it does |
|---|---|
| `get_quote` | Swap quote through your RPC: net output after the fee, the on-chain floor the Quoter reports for the route (`ironFloor`, `effectiveMinOut`), price impact and the Phoenix Check verdict (`ok / caution / danger / blocked`, fails closed). `exact: true` dry-runs every concentrated leg and returns `exactOut` (net of the fee) and `quoterOut` (the Quoter's own scalar), with the Phoenix Check from the default quote of the same request. |
| `build_swap` | Quote and return **unsigned** Router calldata, verified against the request, with the minimum output and deadline baked in. The bytes clear the swap math, not the token transfer: run `simulate_swap` from the paying address before signing. Native ETH input needs a 2.x Router (`unsupported_by_version` on 1.x): wrap to WETH first. |
| `simulate_swap` | Build the swap and dry-run it from a given account with an `eth_call`. |
| `check_solvency` | Proof-of-solvency: coming soon. Answers `coming_soon` and reads no contract. |
| `get_token_info` | Symbol, decimals and name of a token, read from the chain. |
| `get_deployments` | The versioned deployment registry: Core, Hub, Solver, Quoter and Router per chain and version. |
| `verify_deployment` | Check that the registry addresses for a chain and version match what is deployed on-chain. |

Every tool is read-only. **The server never signs and never holds a key.**
`build_swap` returns calldata for you to review and sign in your own wallet, and
the SDK's wallet-taking `execute()` is deliberately not exposed.

## Remote endpoint

```bash
claude mcp add --transport http blazephoenix https://blazephoenix.xyz/mcp
```

```json
{ "mcpServers": { "blazephoenix": { "type": "http", "url": "https://blazephoenix.xyz/mcp" } } }
```

| Tool | What it does |
|---|---|
| `prepare_quote` | The exact `eth_call` to run on your node for a quote, plus a `request` object |
| `decode_quote` | Turns your node's answer into the quote, the Phoenix Check verdict and calldata verified against the request (pure; swap math only: simulate it from the payer before sending) |
| `get_deployments` | The versioned deployment registry |
| `get_abi` | Generated ABI of a protocol contract |

The source of the endpoint is in
[Blaze-Phoenix-API](https://github.com/blazephoenixxyz-crypto/Blaze-Phoenix-API).

## Install as a plugin or extension

**Claude Code plugin** (hosted MCP endpoint plus the BlazePhoenix agent skill):

```bash
claude plugin marketplace add blazephoenixxyz-crypto/blazephoenix-mcp
claude plugin install blazephoenix@blazephoenix
```

**Gemini CLI extension** (hosted MCP endpoint plus a context file):

```bash
gemini extensions install https://github.com/blazephoenixxyz-crypto/blazephoenix-mcp
```

Both connect `https://blazephoenix.xyz/mcp`, which needs no key and performs no
RPC. For the full toolset on your own node, use the [local server](#local-server).

## Verify instead of trusting

Nothing here requires trusting BlazePhoenix:

```bash
# re-execute any published fact live, with its block height
curl -s "https://blazephoenix.xyz/api/verify?fact=leg-floor"

# reproduce every live claim in ~60 seconds
curl -sO https://blazephoenix.xyz/repro/verify-everything.sh && bash verify-everything.sh
```

## Build and test

```bash
npm install
npm run build
npm test
```

The test spawns the built server over stdio with no RPC configured and checks the
tool surface, that failures come back as tool results, and that no tool takes an
RPC, key or signer argument or signs anything. It then points the server at local
loopback JSON-RPC stand-ins (no network, no key) to drive `get_quote`, `build_swap`,
`simulate_swap` and `check_solvency`, and checks that a failing RPC's error does not
echo the key in its URL, that the per-chain variables in the README are the ones the
SDK reads, that every manifest carries the package version, and that
`BLAZEPHOENIX_VERSION` pins the protocol version.

## More machine surfaces

| Surface | URL |
|---|---|
| OpenAPI 3.1 | https://blazephoenix.xyz/api/openapi.json |
| Agent task flows (agents.json) | https://blazephoenix.xyz/.well-known/agents.json |
| Installable skill file | https://blazephoenix.xyz/skills/blazephoenix/SKILL.md |
| Capability map | https://blazephoenix.xyz/capabilities.json |
| Proof-carrying facts (claim/proof/url) | https://blazephoenix.xyz/facts.json |
| This package for agents ([llmstxt.org](https://llmstxt.org) format) | [llms.txt](./llms.txt) |
| LLM corpus index | https://blazephoenix.xyz/llms.txt |
| Integration guide for humans | https://blazephoenix.xyz/agents |

## Security

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## License

The code is MIT (see `LICENSE`). This documentation is © 2026 BlazePhoenix, all rights reserved. The protocol
contracts are BUSL-1.1 (free to read, audit and verify; production use before the
2030 change date requires a license). The mechanisms and terminology (Iron Law Φ,
Monoslot, Master Conservation Identity) are original BlazePhoenix work: attribute
with a link.

Contact: contact@blazephoenix.xyz · Security: https://blazephoenix.xyz/.well-known/security.txt
