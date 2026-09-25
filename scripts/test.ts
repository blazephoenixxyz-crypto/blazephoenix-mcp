// Offline tests: an MCP client talks to the server over an in-memory transport;
// the server's "RPC" is a mock EIP-1193 node. No network. Run: npm test
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  decodeFunctionData, encodeErrorResult, encodeFunctionResult,
} from 'viem';
import {
  BlazePhoenix, CHAINS, EMBEDDED_DEPLOYMENTS, ERC20_ABI, QUOTER_ABI, ROUTER_ABI, STAKING_SOLVENCY_ABI, encodeSwapExactIn,
  type Address, type Hex, type Preview, type Route,
} from '@blazephoenix/sdk';
import { configFromEnv } from '../src/config.js';
import { createServer } from '../src/server.js';

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const WETH = CHAINS[8453].weth;
const USDC = CHAINS[8453].usdc;
const ME = '0x1111111111111111111111111111111111111111' as Address;
const V1 = EMBEDDED_DEPLOYMENTS.versions.find((v) => v.version === '1.0.0')!.chains[8453]!;
const STAKING = CHAINS[8453].staking!;

function mkRoute(tIn: Address, tOut: Address, amountIn: bigint, out: bigint): Route {
  return {
    hops: [{ tokenIn: tIn, tokenOut: tOut, amountIn, expectedOut: out, legs: [{
      pool: '0xd0b53D9277642d899DF5C87A3966A349A798F224', hooks: '0x0000000000000000000000000000000000000000', kind: 2, fee: 500,
      tickSpacing: 10, zeroForOne: true, stable: false, amountIn, expectedOut: out, auxId: `0x${'0'.repeat(64)}`,
    }] }],
    totalOut: out, singleOut: out, singleOutFloor: (out * 9n) / 10n, expectedImpactBps: 15n, confidenceWad: 10n ** 18n,
    estGas: 150_000n, hasSurplus: false, isV4Bundle: false,
  };
}
function mkPreview(route: Route, userMinOut = 0n): Preview {
  const g = route.totalOut; const net = g - (g * 28n + 9_999n) / 10_000n; const floor = route.singleOutFloor;
  return { route, grossOut: g, protocolFee: g - net, safetyBuffer: 0n, netOut: net, ironFloor: floor, userMinOut,
    effectiveMinOut: userMinOut > floor ? userMinOut : floor, estGas: route.estGas, hops: 1n, legs: 1n, topology: 0,
    bridgeUsed: '0x0000000000000000000000000000000000000000', canExecute: true };
}

function node(o: { chainId?: number; noRoute?: boolean; quoter?: string; router?: string; v2?: boolean } = {}) {
  const quoter = (o.quoter ?? V1.quoter).toLowerCase();
  const router = (o.router ?? V1.router).toLowerCase();
  return {
    async request({ method, params }: { method: string; params?: unknown }) {
      const p = params as unknown[];
      if (method === 'eth_chainId') return `0x${(o.chainId ?? 8453).toString(16)}`;
      if (method === 'eth_blockNumber') return '0x1000';
      if (method === 'eth_getCode') return '0x6080';
      if (method === 'eth_getLogs') return [];
      if (method !== 'eth_call') throw new Error(`unexpected ${method}`);
      const { to, data } = p[0] as { to: string; data: Hex };
      const t = to.toLowerCase();
      if (t === quoter) {
        const d = decodeFunctionData({ abi: QUOTER_ABI, data });
        if (o.noRoute) throw Object.assign(new Error('execution reverted'), { code: 3, data: encodeErrorResult({ abi: QUOTER_ABI, errorName: 'SolverE', args: [5] }) });
        const a = d.args as unknown as unknown[];
        const [tIn, tOut, amt] = a as [Address, Address, bigint];
        const route = mkRoute(tIn, tOut, amt, amt * 3_000n / 10n ** 12n);
        if (d.functionName === 'previewPlan' || d.functionName === 'previewPlanWithMinOut') {
          return encodeFunctionResult({ abi: QUOTER_ABI, functionName: d.functionName, result: [mkPreview(route), route, false] as never });
        }
        if (d.functionName === 'previewAndEncode') {
          const pv = mkPreview(route);
          const call = encodeSwapExactIn(route, amt, pv.effectiveMinOut, a[3] as Address, a[4] as bigint);
          return encodeFunctionResult({ abi: QUOTER_ABI, functionName: 'previewAndEncode', result: [pv, call] as never });
        }
        throw new Error(`quoter ${d.functionName}`);
      }
      if (t === router) return encodeFunctionResult({ abi: ROUTER_ABI, functionName: 'swapExactIn', result: 2_995_000_000n });
      if (t === STAKING.toLowerCase()) {
        const d = decodeFunctionData({ abi: STAKING_SOLVENCY_ABI, data });
        if (d.functionName === 'isSolvent') return encodeFunctionResult({ abi: STAKING_SOLVENCY_ABI, functionName: 'isSolvent', result: true });
        return encodeFunctionResult({ abi: STAKING_SOLVENCY_ABI, functionName: 'solvency', result: {
          backing: 10n ** 24n, owed: 5n * 10n ** 23n, surplus: 5n * 10n ** 23n, deficit: 0n, solvent: true,
          collateralRatioWad: 2n * 10n ** 18n, totalStaked: 1n, totalDebt: 0n, rewardReserve: 1n, protocolReserve: 1n,
          pendingDistribution: 0n, totalBadDebt: 0n, totalUncollectedInterest: 0n,
        } });
      }
      const d = decodeFunctionData({ abi: ERC20_ABI, data });
      if (d.functionName === 'decimals') return encodeFunctionResult({ abi: ERC20_ABI, functionName: 'decimals', result: t === USDC.toLowerCase() ? 6 : 18 });
      if (d.functionName === 'symbol') return encodeFunctionResult({ abi: ERC20_ABI, functionName: 'symbol', result: t === USDC.toLowerCase() ? 'USDC' : 'WETH' });
      if (d.functionName === 'name') return encodeFunctionResult({ abi: ERC20_ABI, functionName: 'name', result: 'x' });
      if (d.functionName === 'allowance') return encodeFunctionResult({ abi: ERC20_ABI, functionName: 'allowance', result: 0n });
      throw new Error(`erc20 ${d.functionName}`);
    },
  };
}

async function connect(blaze: BlazePhoenix) {
  const server = createServer({ blaze, summary: { rpc: ['Base (8453)'] } });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { type: string; text: string }[])[0]?.text ?? '';
    return { isError: !!r.isError, body: JSON.parse(text) as Record<string, any> };
  };
  return { client, call };
}

console.log('config');
{
  const c = configFromEnv({ BLAZEPHOENIX_RPC_BASE: 'https://node-a.example', BLAZEPHOENIX_VERSION: '2', BLAZEPHOENIX_REGISTRY: 'embedded', BLAZEPHOENIX_SLIPPAGE_BPS: '30' });
  check('env → per-chain rpc, version, registry, slippage',
    JSON.stringify(c.client.rpc) === JSON.stringify({ '8453': 'https://node-a.example' }) && c.client.version === '2'
    && c.client.registry?.mode === 'embedded' && c.client.slippageBps === 30);
  check('no env → no rpc (server still starts)', configFromEnv({}).summary.rpcChains === 'none');
  check('bad registry mode refused', (() => { try { configFromEnv({ BLAZEPHOENIX_REGISTRY: 'x' }); return false; } catch { return true; } })());
  check('bad contracts JSON refused', (() => { try { configFromEnv({ BLAZEPHOENIX_CONTRACTS: '{' }); return false; } catch { return true; } })());
  const o = configFromEnv({ BLAZEPHOENIX_CONTRACTS: '{"base":{"router":"0x00000000000000000000000000000000000000a3","quoter":"0x00000000000000000000000000000000000000a4","version":"2.0.0"}}' });
  check('contracts override parsed', (o.client.contracts as any)?.base?.version === '2.0.0');
}

console.log('tools');
{
  const blaze = new BlazePhoenix({ rpc: { base: node() }, registry: { mode: 'embedded' } });
  const { client, call } = await connect(blaze);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  check('tools/list', JSON.stringify(tools) === JSON.stringify(['build_swap', 'check_solvency', 'get_deployments', 'get_fills', 'get_quote', 'get_token_info', 'simulate_swap', 'verify_deployment']), tools.join(','));
  const all = (await client.listTools()).tools;
  check('every tool is annotated read-only (nothing signs or sends)', all.every((t) => t.annotations?.readOnlyHint === true));

  const q = await call('get_quote', { chain: 'base', tokenIn: 'WETH', tokenOut: 'USDC', amount: '1' });
  check('get_quote: on-chain quote through the user RPC', !q.isError && q.body.protocolVersion === '1.0.0' && q.body.amountOut.symbol === 'USDC' && q.body.readVia.includes('your own RPC'), JSON.stringify(q.body).slice(0, 300));
  check('get_quote: human amounts with on-chain decimals', q.body.amountIn.human === '1' && q.body.amountOut.human === '2991.6', `${q.body.amountIn.human} → ${q.body.amountOut.human}`);
  check('get_quote: Phoenix Check verdict', q.body.checks.verdict === 'ok');

  const b = await call('build_swap', { chain: 'base', tokenIn: 'WETH', tokenOut: 'USDC', amount: '1', recipient: ME, from: ME });
  check('build_swap: approve + swap, unsigned', !b.isError && b.body.unsignedTransactions.length === 2
    && b.body.unsignedTransactions[1].tx.to === V1.router && b.body.custody.startsWith('Unsigned'), JSON.stringify(b.body).slice(0, 300));
  check('build_swap: minimum + deadline', typeof b.body.minimumOut.raw === 'string' && /Z$/.test(b.body.deadline));

  const s = await call('simulate_swap', { chain: 'base', tokenIn: 'WETH', tokenOut: 'USDC', amount: '1', recipient: ME, from: ME });
  check('simulate_swap: reports the pending approval instead of a fake success', !s.isError && s.body.wouldSettle === false && s.body.approvalPending === true);

  const eth = await call('get_quote', { chain: 'eth', tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1' });
  check('chain without RPC → rpc_required + how to configure', eth.isError && eth.body.error === 'rpc_required' && eth.body.hint.includes('BLAZEPHOENIX_RPC_BASE'));

  const unk = await call('get_quote', { chain: 'base', tokenIn: 'PEPE', tokenOut: 'USDC', amountIn: '1' });
  check('unknown ticker refused (no guessing)', unk.isError && unk.body.error === 'bad_request');

  const d = await call('get_deployments');
  check('get_deployments: versions × chains with sources', !d.isError && d.body.deployments.some((r: any) => r.version === '2.0.0' && r.status === 'pending')
    && d.body.deployments.some((r: any) => r.version === '1.0.0' && r.source === 'embedded') && d.body.registry.mode === 'embedded');

  const v = await call('verify_deployment', { chain: 'base' });
  check('verify_deployment: code at every address', !v.isError && v.body.ok === true && v.body.checks.length >= 4);

  const sol = await call('check_solvency');
  check('check_solvency: isSolvent + ratio', !sol.isError && sol.body.isSolvent === true && sol.body.collateralRatioPct === 200);

  const f = await call('get_fills', { chain: 'base' });
  check('get_fills', !f.isError && f.body.count === 0);

  const ti = await call('get_token_info', { chain: 'base', token: 'USDC' });
  check('get_token_info', !ti.isError && ti.body.decimals === 6);
}

console.log('errors');
{
  const { call } = await connect(new BlazePhoenix({ rpc: node({ noRoute: true }), registry: { mode: 'embedded' } }));
  const r = await call('get_quote', { tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1' });
  check('no route → decoded SolverE(5) + hint', r.isError && r.body.error === 'no_route' && r.body.revert?.name === 'SolverE' && !!r.body.hint);
  const { call: c2 } = await connect(new BlazePhoenix({ rpc: { base: node({ chainId: 1 }) }, registry: { mode: 'embedded' } }));
  const w = await c2('get_quote', { chain: 'base', tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1' });
  check('node on the wrong chain → rpc_chain_mismatch', w.isError && w.body.error === 'rpc_chain_mismatch');
  const { call: c3 } = await connect(new BlazePhoenix({ registry: { mode: 'embedded' } }));
  const n = await c3('get_quote', { chain: 'base', tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1' });
  check('no RPC at all → rpc_required', n.isError && n.body.error === 'rpc_required');
}

console.log('2.x deployment (override)');
{
  const R = '0x00000000000000000000000000000000000000a3', Q = '0x00000000000000000000000000000000000000a4';
  const blaze = new BlazePhoenix({ rpc: node({ quoter: Q, router: R }), registry: { mode: 'embedded' }, contracts: { base: { router: R as Address, quoter: Q as Address, version: '2.0.0' } } });
  const { call } = await connect(blaze);
  const b = await call('build_swap', { tokenIn: 'WETH', tokenOut: 'USDC', amount: '1', recipient: ME });
  check('2.x build_swap: calldata from the Quoter, verified', !b.isError && b.body.calldata.startsWith('encoded by the Quoter') && b.body.quote.protocolVersion === '2.0.0', JSON.stringify(b.body).slice(0, 200));
}

console.log('stdio binary');
if (existsSync('dist/index.js')) {
  const out = await new Promise<string>((resolve) => {
    const p = spawn(process.execPath, ['dist/index.js'], { env: { PATH: process.env.PATH ?? '', BLAZEPHOENIX_REGISTRY: 'embedded' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let err = '';
    const timer = setTimeout(() => { p.kill(); resolve(buf + '\nSTDERR:' + err); }, 8_000);
    p.stdout.on('data', (d) => {
      buf += String(d);
      if (buf.includes('"id":2')) { clearTimeout(timer); p.kill(); resolve(buf + '\nSTDERR:' + err); }
      else if (buf.includes('"id":1')) {
        p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
      }
    });
    p.stderr.on('data', (d) => { err += String(d); });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) + '\n');
  });
  check('stdio: initialize answered on stdout', out.includes('"serverInfo"') && out.includes('blazephoenix'), out.slice(0, 300));
  check('stdio: tools/list over the real transport', out.includes('"get_quote"') && out.includes('"build_swap"'));
  check('stdio: missing RPC explained on stderr, not stdout', out.split('STDERR:')[1]?.includes('no RPC configured') && !out.split('STDERR:')[0].includes('no RPC configured'));
} else {
  check('stdio binary built (run `npm run build` first)', false);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
