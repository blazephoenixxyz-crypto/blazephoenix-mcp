# BlazePhoenix MCP server

[![solvency](https://img.shields.io/endpoint?url=https%3A%2F%2Fblazephoenix.xyz%2Fapi%2Fbadge)](https://blazephoenix.xyz/solvency)

On-chain DEX aggregator tools for AI agents — **running on your machine, reading the chain
through YOUR RPC.** Every quote is computed by the BlazePhoenix Quoter contract (the same
logic that settles the swap) via an `eth_call` on your own node. No BlazePhoenix server sits
in the read path, nobody else pays for (or can see) your reads, and nothing here holds a key.

- **Transport:** stdio (local process) · **Auth / API key:** none · **Custody:** none — tools
  return *unsigned* transactions for your wallet
- **Chains:** Base (8453), Ethereum (1), Optimism (10), Arbitrum (42161), Robinhood Chain (4663)
- **Protocol versions:** `1.0.0` (live) and `2.0.0` (the final Core / Hub / Solver / Quoter /
  Router — picked up automatically the day it is deployed, after on-chain verification)
- Built on [`@blazephoenix/sdk`](https://github.com/blazephoenixxyz-crypto/SDK) 1.x

## Connect

Bring one node per chain you want (any provider's free tier works; comma-separate several
URLs for a fallback list).

**Claude Code**

```bash
claude mcp add blazephoenix \
  -e BLAZEPHOENIX_RPC_BASE=https://your-base-node.example/KEY \
  -e BLAZEPHOENIX_RPC_ETHEREUM=https://your-eth-node.example/KEY \
  -- npx -y @blazephoenix/mcp
```

**Claude Desktop / Cursor / Windsurf / any MCP client**

```json
{
  "mcpServers": {
    "blazephoenix": {
      "command": "npx",
      "args": ["-y", "@blazephoenix/mcp"],
      "env": {
        "BLAZEPHOENIX_RPC_BASE": "https://your-base-node.example/KEY",
        "BLAZEPHOENIX_RPC_ARBITRUM": "https://your-arb-node.example/KEY"
      }
    }
  }
}
```

Requires `@blazephoenix/sdk` 1.x on npm (release order: SDK first, then this package).

## Configuration (environment)

| Variable | Meaning |
|---|---|
| `BLAZEPHOENIX_RPC_BASE` · `_ETHEREUM` · `_OPTIMISM` · `_ARBITRUM` · `_ROBINHOOD` | your node per chain (also `BLAZEPHOENIX_RPC_<chainId>`); comma-separated = fallback order |
| `BLAZEPHOENIX_RPC_URL` | a single node — serves the chain it reports |
| `BLAZEPHOENIX_VERSION` | `latest` (default) · `1` · `2` · `2.0.0` |
| `BLAZEPHOENIX_CONTRACTS` | JSON overrides, e.g. `{"base":{"router":"0x…","quoter":"0x…","version":"2.0.0"}}` |
| `BLAZEPHOENIX_REGISTRY` | `auto` (default: embedded pins + the site's published registry) · `embedded` (never fetch addresses) |
| `BLAZEPHOENIX_REGISTRY_URL` | alternative registry document |
| `BLAZEPHOENIX_SLIPPAGE_BPS` · `BLAZEPHOENIX_DEADLINE_SEC` | defaults for `build_swap` (50 bps · 120 s) |

Without any RPC the server still starts and every on-chain tool answers `rpc_required` with
the exact variable to set — an agent can tell its user how to fix it.

## Tools

All tools are read-only: they read your node or return unsigned transactions.

| Tool | What it does |
|---|---|
| `get_quote` | Quoter preview on your RPC: net output after the 0.28% fee, the minimum the Router enforces on-chain, price impact, route shape, and the fail-closed **Phoenix Check** verdict (`ok / caution / danger / blocked`). |
| `build_swap` | The ordered **unsigned** transactions (approval if needed, then the swap), the enforced minimum and the deadline. On 2.x the Router calldata comes from the Quoter itself (`previewAndEncode`) and is verified field by field against the request before it is returned. |
| `simulate_swap` | Builds the swap and `eth_call`s it from the sender: realised output if it would settle now, or the decoded revert (e.g. `RouterE(5)` slippage). Reports a missing approval honestly. |
| `get_token_info` | symbol / name / decimals. |
| `get_deployments` | Core, Hub, Solver, Quoter, Router per chain and version, and where each address came from (embedded pin, site registry, your override). |
| `verify_deployment` | On your RPC: code at every address; on 2.x also `VERSION()` and the Hub/Solver wiring of Quoter, Router and Solver. |
| `check_solvency` | The staking engine's live `isSolvent()` + `solvency()` report on Base, at a named block. |
| `get_fills` | Recent Router fills (`Swap`, plus `ExecutionProof` — quoted vs realised vs floor — on 2.x). |

Tokens are 0x addresses or `ETH` / `WETH` / `USDC` / `BZPX`. The server never guesses an address
from any other ticker — it asks for the address instead.

## Why an agent can trust the calldata

The Quoter's own source says it: *"a compromised Quoter fools the interface — and cannot move a
single wei, because the Router re-measures everything."* The SDK underneath goes one step
further for the part that CAN hurt you — what you sign: it decodes the Quoter's bytes with the
Router ABI and refuses them (`calldata_mismatch`) unless amount, recipient, deadline, route and
a minimum at least the on-chain floor all match the request. Slippage only ever tightens it.

## The hosted endpoint

`https://blazephoenix.xyz/mcp` remains for discovery and offline work, and it performs **no
RPC**: it serves the deployment registry, ABIs, and a codec (`prepare_quote` returns the exact
`eth_call` to run on your node; `decode_quote` turns the node's answer into the quote, checks
and transaction). For one-step quoting, run this server locally.

## Verify instead of trusting

```bash
# the solvency claim, straight from the chain, on your own node
cast call 0x3f60C7aa0c36a78D200405feBE143d2Cf3fA0c77 "isSolvent()(bool)" --rpc-url $BASE_RPC_URL

# the published deployments this server resolves against
curl -s https://blazephoenix.xyz/api/deployments
```

## Develop

```bash
npm install          # until @blazephoenix/sdk 1.x is on npm: npm i --no-save ../SDK (a local checkout)
npm run build && npm test   # offline: in-memory MCP client + mock node + the real stdio binary
```

## License

MIT for this server. The protocol contracts are BUSL-1.1. The mechanisms and terminology
(Iron Law Φ, Monoslot, Master Conservation Identity) are original BlazePhoenix work —
attribute with a link.

Contact: contact@blazephoenix.xyz · Security: https://blazephoenix.xyz/.well-known/security.txt
