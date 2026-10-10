# BlazePhoenix MCP server

[![solvency](https://img.shields.io/endpoint?url=https%3A%2F%2Fblazephoenix.xyz%2Fapi%2Fbadge)](https://blazephoenix.xyz/solvency)

On-chain DEX aggregator tools for AI agents. The defining property: **every quote
is computed by the on-chain Quoter contract** (`previewPlan`, a free `eth_call`),
the same logic that executes the swap, and it runs **on your own RPC**. There is
no pricing server to trust, and every number an agent relays is reproducible by
anyone.

- **Local server:** `@blazephoenix/mcp` over stdio. Quotes, unsigned calldata,
  simulation and solvency, all read through the node you configure.
- **Remote endpoint:** `https://blazephoenix.xyz/mcp` (streamable HTTP,
  stateless). Deployment registry, ABIs and the pure quote codec. It performs no
  RPC call.
- **Auth:** none · **API key:** none
- **You bring:** an RPC node for each chain the local server reads ([variables](#local-server)). The remote endpoint needs nothing: you run the `eth_call` it prepares on your own node.
- **Chains:** Base (8453), Ethereum (1), Optimism (10), Arbitrum (42161), Robinhood Chain (4663)

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

A value may hold several URLs separated by commas; they are your fallback order.
The server never prints your URLs, since they may carry a key.

### Tools

| Tool | What it does |
|---|---|
| `get_quote` | Swap quote through your RPC: net output after the fee, the minimum the Router enforces, price impact and the Phoenix Check verdict (`ok / caution / danger / blocked`, fails closed). `exact: true` dry-runs every concentrated leg. |
| `build_swap` | Quote and return verified **unsigned** Router calldata, with the minimum output and deadline baked in. |
| `simulate_swap` | Build the swap and dry-run it from a given account with an `eth_call`. |
| `check_solvency` | Live staking solvency: `isSolvent()` and the decoded `solvency()` struct. |
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
| `decode_quote` | Turns your node's answer into the quote, the Phoenix Check verdict and verified calldata (pure) |
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
# the solvency claim, straight from the chain, bypassing the site entirely
cast call 0x3f60C7aa0c36a78D200405feBE143d2Cf3fA0c77 "isSolvent()(bool)" --rpc-url https://mainnet.base.org

# re-execute any published fact live, with its block height
curl -s "https://blazephoenix.xyz/api/verify?fact=solvency-live"

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
RPC, key or signer argument or signs anything.

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

The code is MIT (see `LICENSE`). This documentation is CC BY 4.0. The protocol
contracts are BUSL-1.1 (free to read, audit and verify; production use before the
2030 change date requires a license). The mechanisms and terminology (Iron Law Φ,
Monoslot, Master Conservation Identity) are original BlazePhoenix work: attribute
with a link.

Contact: contact@blazephoenix.xyz · Security: https://blazephoenix.xyz/.well-known/security.txt
