#!/usr/bin/env node
// =============================================================================
//  @blazephoenix/mcp — the LOCAL MCP server.
//
//  Runs on your machine over stdio. Every chain read is an eth_call from this
//  process to the node YOU configure; nothing is quoted by a BlazePhoenix server.
//
//  It never signs and never holds a key: build_swap returns UNSIGNED calldata,
//  simulate_swap dry-runs it, and you sign in your own wallet. The SDK's
//  execute() (which takes a wallet) is deliberately not exposed here.
//
//  RPC comes from the environment only, never from tool arguments:
//    BLAZEPHOENIX_RPC_URL=<one node>            (or, per chain)
//    BLAZEPHOENIX_RPC_BASE / _ETH / _OPTIMISM / _ARBITRUM / _ROBINHOOD
//  A value may hold several URLs separated by commas (your fallback order).
// =============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BlazePhoenix, rpcFromEnv } from '@blazephoenix/sdk';

const VERSION = '1.0.0';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 0x address (40 hex characters)');
const chain = z
  .union([z.string(), z.number()])
  .optional()
  .describe('base | eth | optimism | arbitrum | robinhood, or a numeric chain id. Optional when your RPC has a single chain.');

const quoteShape = {
  chain,
  tokenIn: z.string().describe('input token: a 0x address, or a symbol such as ETH, WETH, USDC, BZPX'),
  tokenOut: z.string().describe('output token: a 0x address, or a symbol such as ETH, WETH, USDC, BZPX'),
  amount: z.string().optional().describe('input amount in human units, for example "1.5"'),
  amountIn: z.string().optional().describe('input amount in base units, as an integer string'),
  userMinOut: z.string().optional().describe('optional explicit minimum output, in base units of tokenOut'),
  version: z.string().optional().describe('protocol version: latest (default) | 1 | 2 | 2.0.0'),
};

const swapShape = {
  ...quoteShape,
  recipient: address.describe('who receives tokenOut'),
  from: address.optional().describe('the account that will send the swap; enables the allowance check'),
  slippageBps: z.number().int().min(0).max(5000).optional().describe('0-5000, default 50; never below the on-chain floor'),
  deadlineSec: z.number().int().min(10).max(3600).optional().describe('deadline horizon in seconds, 10-3600, default 120'),
};

/** JSON.stringify that survives bigint. */
const stringify = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

const ok = (result: unknown) => ({ content: [{ type: 'text' as const, text: stringify({ ok: true, result }) }] });
const fail = (code: string, error: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: stringify({ ok: false, code, error }) }],
});

async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    return fail(typeof err.code === 'string' ? err.code : 'error', typeof err.message === 'string' ? err.message : String(e));
  }
}

function describeRpc(): string {
  let cfg: ReturnType<typeof rpcFromEnv>;
  try {
    cfg = rpcFromEnv();
  } catch (e) {
    return `invalid RPC environment: ${(e as Error).message}`;
  }
  if (cfg === undefined) return 'no RPC configured (set BLAZEPHOENIX_RPC_URL or BLAZEPHOENIX_RPC_<CHAIN>)';
  if (typeof cfg === 'object' && !Array.isArray(cfg) && cfg !== null && Object.getPrototypeOf(cfg) === Object.prototype) {
    return `RPC configured for chains: ${Object.keys(cfg).join(', ')}`;
  }
  return 'RPC configured: one node';
}

type Hex = `0x${string}`;

/** The regex above already guarantees the shape; this only narrows the type for the SDK. */
const asSwap = <T extends { recipient: string; from?: string }>(a: T) => ({
  ...a,
  recipient: a.recipient as Hex,
  from: a.from as Hex | undefined,
});

function requireAmount(a: { amount?: string; amountIn?: string }) {
  if (!a.amount && !a.amountIn) {
    throw Object.assign(new Error('provide amount (human units) or amountIn (base units)'), { code: 'bad_request' });
  }
}

async function main() {
  // The RPC is read from the environment, once. URLs are never echoed: they may carry a key.
  let client: BlazePhoenix;
  try {
    client = new BlazePhoenix({ rpc: rpcFromEnv() });
  } catch (e) {
    process.stderr.write(`blazephoenix-mcp: ${(e as Error).message}\n`);
    process.exit(1);
  }

  const server = new McpServer({ name: 'blazephoenix', version: VERSION });
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

  server.registerTool(
    'get_quote',
    {
      title: 'Get a swap quote',
      description:
        'Quote a swap on-chain through YOUR RPC: net output after the fee, the minimum the Router enforces, price impact and the Phoenix '
        + 'Check verdict (ok / caution / danger / blocked; it fails closed). Set exact=true for an execution-grade dry-run of every leg.',
      inputSchema: { ...quoteShape, exact: z.boolean().optional().describe('true: previewPlanExact, every concentrated leg dry-run') },
      annotations: readOnly,
    },
    async (a) =>
      run(async () => {
        requireAmount(a);
        const { exact, ...req } = a;
        return exact ? client.quoteExact(req) : client.quote(req);
      }),
  );

  server.registerTool(
    'build_swap',
    {
      title: 'Build unsigned swap calldata',
      description:
        'Quote a swap and return verified UNSIGNED calldata for the Router, with the minimum output and deadline baked in. '
        + 'Nothing is signed or sent: review it, then sign in your own wallet.',
      inputSchema: swapShape,
      annotations: readOnly,
    },
    async (a) =>
      run(async () => {
        requireAmount(a);
        return client.buildSwap(asSwap(a));
      }),
  );

  server.registerTool(
    'simulate_swap',
    {
      title: 'Simulate a swap',
      description:
        'Build the swap, then dry-run it from the given account with an eth_call on your node. Returns the plan and the simulation. '
        + 'Nothing is signed or sent.',
      inputSchema: { ...swapShape, from: address.describe('the account the simulation runs from') },
      annotations: readOnly,
    },
    async (a) =>
      run(async () => {
        requireAmount(a);
        const plan = await client.buildSwap(asSwap(a));
        return { plan, simulation: await client.simulate(plan, a.from as Hex) };
      }),
  );

  server.registerTool(
    'check_solvency',
    {
      title: 'Check staking solvency',
      description: 'Live staking solvency read from the chain: isSolvent() and the decoded solvency() struct. Defaults to Base.',
      inputSchema: { chain },
      annotations: readOnly,
    },
    async (a) => run(() => client.solvency(a.chain ?? 8453)),
  );

  server.registerTool(
    'get_token_info',
    {
      title: 'Get token info',
      description: 'Symbol, decimals and name of a token, read from the chain through your RPC.',
      inputSchema: { chain, token: z.string().describe('a 0x address, or a symbol such as USDC') },
      annotations: readOnly,
    },
    async (a) => run(() => client.tokenInfo(a.chain, a.token)),
  );

  server.registerTool(
    'get_deployments',
    {
      title: 'Get the deployment registry',
      description: 'The versioned deployment registry: Core, Hub, Solver, Quoter and Router addresses per chain and protocol version.',
      inputSchema: {},
      annotations: readOnly,
    },
    async () => run(() => client.deployments()),
  );

  server.registerTool(
    'verify_deployment',
    {
      title: 'Verify a deployment on-chain',
      description: 'Check that the registry addresses for a chain and version match what is deployed on-chain, through your RPC.',
      inputSchema: { chain, version: z.string().optional().describe('latest (default) | 1 | 2 | 2.0.0') },
      annotations: readOnly,
    },
    async (a) => run(() => client.verifyDeployment({ chain: a.chain, version: a.version })),
  );

  await server.connect(new StdioServerTransport());
  process.stderr.write(`blazephoenix-mcp ${VERSION} on stdio; ${describeRpc()}\n`);
}

main().catch((e) => {
  process.stderr.write(`blazephoenix-mcp: ${(e as Error).message}\n`);
  process.exit(1);
});
