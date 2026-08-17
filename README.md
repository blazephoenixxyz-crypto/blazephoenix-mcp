# BlazePhoenix MCP server

[![solvency](https://img.shields.io/endpoint?url=https%3A%2F%2Fblazephoenix.xyz%2Fapi%2Fbadge)](https://blazephoenix.xyz/solvency)

On-chain DEX aggregator tools for AI agents. The defining property: **every
quote is computed by the on-chain Quoter contract** (`previewPlan`, a free
`eth_call`) — the same logic that executes the swap — so there is no pricing
server to trust and every number an agent relays is reproducible by anyone.

- **Remote endpoint:** `https://blazephoenix.xyz/mcp` (streamable HTTP, stateless)
- **Auth:** none · **API key:** none · **CORS:** open
- **Chains:** Base (8453), Ethereum (1), Optimism (10), Arbitrum (42161), Robinhood Chain (4663)

## Connect

Claude Code / Claude Desktop:

```bash
claude mcp add --transport http blazephoenix https://blazephoenix.xyz/mcp
```

Any MCP client (JSON config):

```json
{ "mcpServers": { "blazephoenix": { "type": "http", "url": "https://blazephoenix.xyz/mcp" } } }
```

## Tools

| Tool | What it does |
|---|---|
| `get_quote` | Swap quote computed on-chain: net output after the 0.28% fee, price impact, the contract-enforced output floor, and a fail-closed safety verdict (`ok / caution / danger / blocked`). With a `recipient`, returns ready-to-sign router calldata — the agent never custodies funds. |
| `check_solvency` | Live staking solvency: `isSolvent()` plus the decoded `solvency()` struct, readable free at any block by anyone. |

## Heavy or production use: bring your own RPC

The hosted MCP/REST endpoints are free and keyless, sized for interactive agent
use. For bulk or production workloads, do what the protocol was designed for
and **compute the quote yourself**: `Quoter.previewPlan` is a free `eth_call`
against your own RPC — the contract IS the API, the hosted endpoint is only a
thin mirror of it. Costs then run on your infrastructure, not anyone else's,
and you trust no one. The SDK (`npm i @blazephoenix/sdk`) wires this for you.

## Verify instead of trusting

Nothing here requires trusting BlazePhoenix — that is the point:

```bash
# the solvency claim, straight from the chain, bypassing the site entirely
cast call 0x3f60C7aa0c36a78D200405feBE143d2Cf3fA0c77 "isSolvent()(bool)" --rpc-url https://mainnet.base.org

# re-execute any published fact live, with its block height
curl -s "https://blazephoenix.xyz/api/verify?fact=solvency-live"

# reproduce every live claim in ~60 seconds
curl -sO https://blazephoenix.xyz/repro/verify-everything.sh && bash verify-everything.sh
```

## More machine surfaces

| Surface | URL |
|---|---|
| OpenAPI 3.1 (same API over REST) | https://blazephoenix.xyz/api/openapi.json |
| Agent task flows (agents.json) | https://blazephoenix.xyz/.well-known/agents.json |
| Installable skill file | https://blazephoenix.xyz/skills/blazephoenix/SKILL.md |
| Capability map | https://blazephoenix.xyz/capabilities.json |
| Proof-carrying facts (claim/proof/url) | https://blazephoenix.xyz/facts.json |
| LLM corpus index | https://blazephoenix.xyz/llms.txt |
| Integration guide for humans | https://blazephoenix.xyz/agents |

## License

This documentation is CC BY 4.0. The protocol contracts are BUSL-1.1 (free to
read, audit and verify; production use before the 2030 change date requires a
license). The mechanisms and terminology (Iron Law Φ, Monoslot, Master
Conservation Identity) are original BlazePhoenix work — attribute with a link.

Contact: contact@blazephoenix.xyz · Security: https://blazephoenix.xyz/.well-known/security.txt
