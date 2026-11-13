# BlazePhoenix MCP server

BlazePhoenix is an on-chain DEX aggregator on Base (8453), Ethereum (1),
Optimism (10), Arbitrum (42161) and Robinhood Chain (4663). Every quote is
computed by the deployed Quoter contract, the same logic that executes the
swap, so any number you relay can be reproduced with a free `eth_call`.

This extension connects the hosted endpoint `https://blazephoenix.xyz/mcp`.
It needs no API key and performs no RPC call: quotes run on the user's own
node.

## Quote flow

1. `prepare_quote` with `chain`, `in`, `out` and `amountIn` (base units). It
   returns the exact `eth_call` (Quoter address and calldata) and a `request`
   object.
2. Run that `eth_call` on the user's node, for example with `curl` and the
   JSON-RPC body it returns.
3. `decode_quote` with the `request` object and the hex result. It returns the
   net output after the fee, in preview mode the on-chain floor the Quoter
   reports for the route,
   price impact, the Phoenix Check verdict (`ok`, `caution`, `danger`,
   `blocked`) and, when a `recipient` was given, verified unsigned calldata.
   That calldata also needs a `userMinOut`, and its minimum output is never
   below that `userMinOut`.

`get_deployments` returns the versioned contract addresses per chain.
`get_abi` returns the ABI of one contract, or the error set for decoding a
revert.

## Rules when answering

- State the chain and the protocol version of every quote.
- Distinguish the quoted output, the minimum output and the delivered output.
- Never sign or send a transaction for the user. Calldata from `decode_quote`
  clears the swap math, not the token transfer: have it simulated as an
  `eth_call` to the Router from the paying address before the user signs it in
  their own wallet.
- Take contract addresses from `get_deployments`, never from memory.

## Full toolset on the user's node

For one-step quotes, unsigned swap transactions, simulation and a
solvency read (proof-of-solvency: coming soon), run the local server with the user's RPC:

```bash
npx -y @blazephoenix/mcp
```

with `BLAZEPHOENIX_RPC_BASE` (or `BLAZEPHOENIX_RPC_URL`) set to the user's
node. Documentation: https://blazephoenix.xyz/agents
