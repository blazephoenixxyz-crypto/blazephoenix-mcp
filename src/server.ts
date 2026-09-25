// =============================================================================
//  BlazePhoenix MCP server — on-chain DEX aggregator tools for AI agents that
//  run on YOUR machine and read the chain through YOUR RPC.
//
//  Zero custody by construction: every tool is a read (an eth_call on your
//  node) or returns UNSIGNED transactions for a wallet to review and sign. The
//  server never sees a key, never signs, never sends.
// =============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  BlazeError, BlazePhoenix, CHAINS, deepLink, fromBaseUnits, resolveChain, toJSON,
  type Quote, type SupportedChainId, type SwapPlan, type TokenInfo,
} from '@blazephoenix/sdk';

export const SERVER_NAME = 'blazephoenix';
export const SERVER_VERSION = '1.0.0';

const INSTRUCTIONS = [
  'BlazePhoenix on-chain DEX aggregator tools (Base, Ethereum, Optimism, Arbitrum, Robinhood Chain).',
  'Every quote is computed by the on-chain Quoter contract and read through the USER\'S OWN RPC —',
  'no BlazePhoenix server is in the read path, and nothing here holds or asks for a key.',
  'Flow: get_quote (price + Phoenix Check verdict) → build_swap (unsigned, verified transactions) →',
  'simulate_swap (dry-run from the user\'s address) → the user signs in their own wallet.',
  'Quote the checks.verdict (ok / caution / danger / blocked) when asked whether a swap is safe;',
  '"blocked" is a real answer. Amounts: pass `amount` in human units ("1.5") or `amountIn` in base units.',
  'Tokens: 0x addresses, or ETH / WETH / USDC / BZPX. Never guess an address for any other ticker — ask the user.',
  'If a tool reports rpc_required, tell the user to set BLAZEPHOENIX_RPC_<CHAIN> in this server\'s env.',
].join(' ');

const chainArg = z.string().optional()
  .describe('base | eth | optimism | arbitrum | robinhood, or a chain id. Optional when a single RPC is configured.');
const versionArg = z.string().optional()
  .describe('Protocol version: latest (default) | 1 | 2 | 2.0.0 — which deployment to use.');
const amountArgs = {
  amount: z.string().optional().describe('Input in HUMAN units, e.g. "1.5" (decimals are read on-chain).'),
  amountIn: z.string().regex(/^\d+$/).optional().describe('Input in base units (wei-style integer string). Use this OR amount.'),
};
const pairArgs = {
  chain: chainArg,
  tokenIn: z.string().describe('Input token: 0x address, or ETH / WETH / USDC / BZPX.'),
  tokenOut: z.string().describe('Output token: 0x address, or ETH / WETH / USDC / BZPX.'),
  ...amountArgs,
  version: versionArg,
};
const swapArgs = {
  ...pairArgs,
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('Address that receives tokenOut.'),
  slippageBps: z.number().int().min(0).max(5000).optional().describe('Slippage tolerance in bps (default 50 = 0.5%). Never below the on-chain floor.'),
  userMinOut: z.string().regex(/^\d+$/).optional().describe('Explicit minimum output in base units (tightens the floor).'),
  deadlineSec: z.number().int().min(10).max(3600).optional().describe('Deadline horizon in seconds (default 120).'),
  mode: z.enum(['route', 'best']).optional().describe("'route' (default): execute the quoted route. 'best' (2.x): the Router re-solves in the same tx."),
};

type Json = Record<string, unknown>;
const ok = (body: Json) => ({ content: [{ type: 'text' as const, text: JSON.stringify(toJSON(body), null, 2) }] });

function fail(e: unknown) {
  const b = e instanceof BlazeError ? e : undefined;
  const code = b?.code ?? 'error';
  const hints: Record<string, string> = {
    rpc_required: 'Configure your own node for that chain in this MCP server\'s env: BLAZEPHOENIX_RPC_BASE=https://… (or _ETHEREUM, _OPTIMISM, _ARBITRUM, _ROBINHOOD). Any provider\'s free tier works.',
    rpc_chain_mismatch: 'The configured node serves a different chain — set one variable per chain (BLAZEPHOENIX_RPC_<CHAIN>).',
    rpc_error: 'The user\'s node failed or rate-limited — retry shortly or add a fallback node (comma-separated).',
    no_route: 'No executable route for this pair and size — try a smaller amount or another pair.',
    not_executable: 'The Quoter says the route cannot settle now — try a smaller size or a looser minimum.',
    unsupported_by_version: 'This deployment version lacks that entry point (e.g. native ETH on 1.x): wrap ETH to WETH first, or choose version 2 where deployed.',
    deployment_unverified: 'A registry deployment failed on-chain verification and was refused. Pin BLAZEPHOENIX_VERSION=1 or set BLAZEPHOENIX_REGISTRY=embedded.',
    calldata_mismatch: 'The Quoter returned calldata that does not match the request; it was refused. Do not sign anything for this swap.',
  };
  const body: Json = {
    ok: false,
    error: code,
    message: (e as Error)?.message ?? String(e),
    ...(b?.revert ? { revert: b.revert } : {}),
    ...(hints[code] ? { hint: hints[code] } : {}),
  };
  return { content: [{ type: 'text' as const, text: JSON.stringify(toJSON(body), null, 2) }], isError: true };
}

const human = (raw: bigint, t: TokenInfo | undefined) => ({
  raw: raw.toString(),
  ...(t ? { human: fromBaseUnits(raw, t.decimals, 8), symbol: t.symbol } : {}),
});

export interface ServerDeps {
  blaze: BlazePhoenix;
  /** Configured-RPC summary for the status tool (never URLs). */
  summary?: Json;
}

export function createServer({ blaze, summary }: ServerDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: 'BlazePhoenix on-chain DEX tools (your RPC)', version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  const tokenCache = new Map<string, Promise<TokenInfo | undefined>>();
  const token = (chainId: number, address: string, native: boolean): Promise<TokenInfo | undefined> => {
    const key = `${chainId}|${native ? 'ETH' : address.toLowerCase()}`;
    let p = tokenCache.get(key);
    if (!p) {
      p = blaze.tokenInfo(chainId, native ? 'ETH' : address).catch(() => undefined);
      tokenCache.set(key, p);
    }
    return p;
  };

  const describeQuote = async (q: Quote) => {
    const [tin, tout] = await Promise.all([
      token(q.chainId, q.tokenIn, q.nativeIn),
      token(q.chainId, q.tokenOut, q.nativeOut),
    ]);
    return {
      chain: `${CHAINS[q.chainId as SupportedChainId]?.name ?? q.chainId} (${q.chainId})`,
      protocolVersion: q.version,
      deployment: { source: q.deploymentSource, quoter: q.quoter, router: q.router },
      tokenIn: { address: q.nativeIn ? 'ETH (native)' : q.tokenIn, ...(tin ? { symbol: tin.symbol, decimals: tin.decimals } : {}) },
      tokenOut: { address: q.tokenOut, ...(tout ? { symbol: tout.symbol, decimals: tout.decimals } : {}), ...(q.nativeOut ? { note: 'delivered as WETH — unwrap to get native ETH' } : {}) },
      amountIn: human(q.amountIn, tin),
      amountOut: human(q.amountOut, tout),
      minimumEnforcedOnChain: human(q.preview.effectiveMinOut, tout),
      protocolFeeEffect: human(q.preview.protocolFee, tout),
      priceImpactBps: q.checks.priceImpact.bps,
      route: {
        hops: q.route.hops.length,
        legs: q.route.hops.reduce((n, h) => n + h.legs.length, 0),
        path: [q.route.hops[0]?.tokenIn, ...q.route.hops.map((h) => h.tokenOut)].filter(Boolean),
      },
      estGas: q.preview.estGas,
      canExecute: q.preview.canExecute,
      checks: q.checks,
      readVia: 'eth_call on your own RPC',
    };
  };

  const describePlan = async (plan: SwapPlan) => {
    const q = plan.quote;
    const tout = await token(q.chainId, q.tokenOut, false);
    const steps = plan.steps.map((tx, i) => ({
      step: i + 1,
      action: plan.approval && i === 0
        ? `approve the Router to pull ${plan.approval.amount === (1n << 256n) - 1n ? 'unlimited' : plan.approval.amount.toString()} of ${plan.approval.token}`
        : `${plan.entry} on the BlazePhoenix Router (${q.version})`,
      tx: { chainId: tx.chainId, to: tx.to, data: tx.data, value: tx.value },
    }));
    return {
      quote: await describeQuote(q),
      unsignedTransactions: steps,
      minimumOut: human(plan.minOut, tout),
      slippageBps: plan.slippageBps,
      deadline: new Date(Number(plan.deadline) * 1000).toISOString(),
      calldata: plan.encodedBy === 'quoter'
        ? 'encoded by the Quoter (previewAndEncode) and verified field by field against this request'
        : 'encoded locally from the previewed route',
      approval: plan.approval
        ? { needed: plan.approval.current === undefined ? 'unless already approved (pass `from` to check)' : true, currentAllowance: plan.approval.current }
        : { needed: false },
      unwrapAfter: plan.unwrapAfter,
      signInBrowser: deepLink({ chain: q.chainId, tokenIn: q.nativeIn ? 'ETH' : q.tokenIn, tokenOut: q.tokenOut }),
      custody: 'Unsigned. Review and sign in your own wallet — this server never holds a key.',
    };
  };

  const req = (a: { chain?: string; tokenIn: string; tokenOut: string; amount?: string; amountIn?: string; version?: string }) => ({
    ...(a.chain ? { chain: a.chain } : {}),
    tokenIn: a.tokenIn,
    tokenOut: a.tokenOut,
    ...(a.amount !== undefined ? { amount: a.amount } : {}),
    ...(a.amountIn !== undefined ? { amountIn: a.amountIn } : {}),
    ...(a.version ? { version: a.version } : {}),
  });

  server.registerTool('get_quote', {
    title: 'Quote a swap (on-chain, your RPC)',
    description:
      'On-chain DEX aggregator quote computed by the BlazePhoenix Quoter contract and read through the user\'s own RPC. '
      + 'Returns net output after the 0.28% fee, the minimum the Router enforces on-chain, price impact, route shape, '
      + 'and the Phoenix Check verdict (ok / caution / danger / blocked — fails closed). Quote checks.verdict when asked if a swap is safe.',
    inputSchema: pairArgs,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (a) => {
    try {
      return ok(await describeQuote(await blaze.quote(req(a))));
    } catch (e) { return fail(e); }
  });

  server.registerTool('build_swap', {
    title: 'Build unsigned swap transactions',
    description:
      'Prepare the swap for a wallet to sign: the ordered unsigned transactions (approval if needed, then the swap), the minimum '
      + 'output enforced, and the deadline. On 2.x deployments the Router calldata comes from the Quoter itself (previewAndEncode) and '
      + 'is verified field by field against the request before it is returned. Pass `from` to check the current allowance. Never signs.',
    inputSchema: { ...swapArgs, from: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe('Sender address — enables the allowance check.') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (a) => {
    try {
      const plan = await blaze.buildSwap({
        ...req(a),
        recipient: a.recipient as `0x${string}`,
        ...(a.from ? { from: a.from as `0x${string}` } : {}),
        ...(a.slippageBps !== undefined ? { slippageBps: a.slippageBps } : {}),
        ...(a.userMinOut ? { userMinOut: a.userMinOut } : {}),
        ...(a.deadlineSec ? { deadlineSec: a.deadlineSec } : {}),
        ...(a.mode ? { mode: a.mode } : {}),
      });
      return ok(await describePlan(plan));
    } catch (e) { return fail(e); }
  });

  server.registerTool('simulate_swap', {
    title: 'Dry-run a swap from an address',
    description:
      'Build the swap and eth_call it from the sender\'s address on the user\'s RPC: returns the realised output if it would settle '
      + 'right now, or the decoded revert reason (e.g. RouterE(5) slippage). Reports when the approval is still missing. Never sends.',
    inputSchema: { ...swapArgs, from: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('Sender address to simulate from.') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (a) => {
    try {
      const from = a.from as `0x${string}`;
      const plan = await blaze.buildSwap({
        ...req(a),
        recipient: a.recipient as `0x${string}`,
        from,
        ...(a.slippageBps !== undefined ? { slippageBps: a.slippageBps } : {}),
        ...(a.userMinOut ? { userMinOut: a.userMinOut } : {}),
        ...(a.deadlineSec ? { deadlineSec: a.deadlineSec } : {}),
        ...(a.mode ? { mode: a.mode } : {}),
      });
      const sim = await blaze.simulate(plan, from);
      const tout = await token(plan.quote.chainId, plan.quote.tokenOut, false);
      return ok({
        wouldSettle: sim.ok,
        ...(sim.amountOut !== undefined ? { amountOut: human(sim.amountOut, tout) } : {}),
        ...(sim.error ? { revert: sim.error } : {}),
        minimumOut: human(plan.minOut, tout),
        approvalPending: !!plan.approval,
        plan: await describePlan(plan),
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool('get_token_info', {
    title: 'Token symbol / decimals',
    description: 'Read an ERC-20\'s symbol, name and decimals on the user\'s RPC.',
    inputSchema: { chain: chainArg, token: z.string().describe('0x address, or ETH / WETH / USDC / BZPX.') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (a) => {
    try { return ok({ ...(await blaze.tokenInfo(a.chain, a.token)) }); } catch (e) { return fail(e); }
  });

  server.registerTool('get_deployments', {
    title: 'Deployments and versions',
    description:
      'Which BlazePhoenix contracts (Core, Hub, Solver, Quoter, Router) are deployed at which address, per chain and protocol version, '
      + 'and where each address came from (embedded pin, site registry, or user override). Also shows this server\'s configuration.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async () => {
    try {
      const d = await blaze.deployments();
      return ok({
        server: { name: SERVER_NAME, version: SERVER_VERSION, ...(summary ?? {}) },
        registry: d.registry,
        deployments: d.rows.map((r) => ({
          chain: `${CHAINS[r.chainId].name} (${r.chainId})`, version: r.version, status: r.status, source: r.source, contracts: r.contracts,
        })),
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool('verify_deployment', {
    title: 'Verify a deployment on-chain',
    description:
      'Cross-check the contracts a chain would use, on the user\'s RPC: code exists at every address and, on 2.x, VERSION() matches '
      + 'and the Quoter, Router and Solver are wired to the same Hub and Solver.',
    inputSchema: { chain: chainArg, version: versionArg },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (a) => {
    try { return ok({ ...(await blaze.verifyDeployment({ ...(a.chain ? { chain: a.chain } : {}), ...(a.version ? { version: a.version } : {}) })) }); }
    catch (e) { return fail(e); }
  });

  server.registerTool('check_solvency', {
    title: 'Staking proof-of-solvency',
    description:
      'Read the BlazePhoenix staking engine\'s live solvency on Base through the user\'s RPC: isSolvent() and the full solvency() '
      + 'report (backing, owed, surplus, collateral ratio, reserves) at a named block. Requires a Base RPC.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async () => {
    try {
      const s = await blaze.solvency(8453);
      return ok({ ...s, collateralRatioPct: Number(s.collateralRatioWad / 10n ** 14n) / 100, units: 'BZPX base units (18 decimals)' });
    } catch (e) { return fail(e); }
  });

  server.registerTool('get_fills', {
    title: 'Recent fills',
    description:
      'Recent swaps settled by the BlazePhoenix Router on a chain (Swap events; on 2.x each carries its ExecutionProof: quoted vs '
      + 'realised vs floor), read with eth_getLogs on the user\'s RPC.',
    inputSchema: {
      chain: chainArg,
      version: versionArg,
      lookbackBlocks: z.number().int().min(1).max(50_000).optional().describe('How far back to scan (default ≈ 1 hour of blocks).'),
      limit: z.number().int().min(1).max(100).optional().describe('Max fills returned, newest first (default 25).'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (a) => {
    try {
      const fills = await blaze.getFills({
        ...(a.chain ? { chain: a.chain } : {}),
        ...(a.version ? { version: a.version } : {}),
        ...(a.lookbackBlocks ? { lookbackBlocks: BigInt(a.lookbackBlocks) } : {}),
      });
      const newest = [...fills].sort((x, y) => (x.blockNumber === y.blockNumber ? y.logIndex - x.logIndex : Number(y.blockNumber - x.blockNumber)));
      return ok({ count: fills.length, fills: newest.slice(0, a.limit ?? 25) });
    } catch (e) { return fail(e); }
  });

  return server;
}

/** Chain ids → names, for the status summary. */
export function chainNames(keys: string[]): string[] {
  return keys.map((k) => {
    try { const id = resolveChain(k); return `${CHAINS[id].name} (${id})`; } catch { return k; }
  });
}
