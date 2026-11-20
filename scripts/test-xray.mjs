// xray_token tests. Part A replays recorded node transcripts into the pure module (dist/xray.js);
// part B spawns the built server and drives xray_token over stdio against a local HTTP node that
// serves the same transcripts, so the request path (viem, the SDK RPC router, replyOf) is real.
//
// The transcripts (scripts/fixtures/xray-transcripts.json.gz) are the SDK's fake node answering
// runXray; scripts/fixtures/record-xray.mts regenerates them. A request is looked up by the sha256
// of {method, params}; replies to the same request are served in order, the last one repeating.
// Every lookup must hit: a miss means the SDK asked for something the transcript never answered.
//
// The tax oracle is the fake token's own tax (300 bps in happy300; 2000 bps on the sell only in floor,
// kept by the token), set before the run, not read from the output. Other exact amounts are the
// recorded outputs of the same fake. The tier limits are pinned as literals, copied from TIER_LIMITS
// in the SDK (src/xray/tiers.ts) at the version the fixture was recorded with.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { HttpRequestError, MethodNotFoundRpcError, RpcRequestError } from 'viem';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const { xrayToken, shownVerdict, replyOf, transportOver } = await import(join(here, '..', 'dist', 'xray.js'));

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${String(detail).slice(0, 400)}`); }
};

const fx = JSON.parse(gunzipSync(readFileSync(join(here, 'fixtures', 'xray-transcripts.json.gz'))));
const revive = (x) => x && typeof x === 'object'
  ? (Array.isArray(x) ? x.map(revive) : ('$code' in x ? fx.codes[x.$code] : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, revive(v)]))))
  : x;
const key = (q) => createHash('sha256').update(JSON.stringify({ method: q.method, params: q.params })).digest('hex');
/** A replay of one scenario: lookup(req) -> the recorded reply, or undefined (a miss). */
const replay = (name) => {
  const m = new Map();
  for (const [, k, r] of fx.scenarios[name].calls) { if (!m.has(k)) m.set(k, []); m.get(k).push(revive(r)); }
  const st = { misses: 0, lookup: (q) => { const l = m.get(key(q)); if (!l) return undefined; return l.length > 1 ? l.shift() : l[0]; } };
  return st;
};
const input = { ...fx.input, amountIn: BigInt(fx.input.amountIn) };
const NOT_SAID = /safe|clear|honeypot-free/i;
const run = async (name) => {
  const rp = replay(name);
  const out = await xrayToken(async (batch) => batch.map((q) => rp.lookup(q) ?? (rp.misses++, { transportError: 'not in the transcript' })), input);
  return { out, misses: rp.misses };
};
const why = (out) => (out.notMeasured ?? []).map((n) => n.why);
const FOT_BUY = 'buy of a fee-on-transfer token: the Router moves it twice (pool to router, router to buyer), each taxed, but the buy tax is read as one move (D = (1 - t) * net), so it is over-stated (conservative), not measured as two';
const TIER_A_LIMITS = [
  'Nitro chains: block.number seen by contracts is the L1 number; a later-sell gap in L2 blocks does not move it',
  'transfer to the pair: a fee paid to another wallet that donates tokens back into the pair in the same transfer (no swap) offsets the pair balance; no balance read separates it, so that fee is understated',
  'later sell of a fee-on-transfer token: the Router prices it on pair balance minus reserve, so it also takes what the transfer to the pair left in the pair; the seller gets more than the quote and the later sell is NOT_MEASURED (over-credit); that excess is not modelled',
  FOT_BUY,
];
const TIER_B_LIMITS = [
  'tx.origin has code (the injected probe)',
  'transfer to the pair: the token contract balance is not read, so its tax is not measured',
  'the quote safety buffer is not read: a tax is MEASURED only when it plus the protocol maximum (10 bps) is below maxTaxBps',
  'no later sell (one block)',
  'block number/time = pinned block B, not B+1',
  FOT_BUY,
];

console.log('xray: replayed scenarios (pure)');
{
  const { out, misses } = await run('happy300');
  const sim = out.instruments?.find((i) => i.instrument === 'sim')?.values ?? {};
  check('happy300: every request is in the transcript', misses === 0, misses);
  check('happy300: MEASURED, and the SDK said MEASURED', out.verdict === 'MEASURED' && out.sdkVerdict === 'MEASURED', out.verdict);
  check('happy300: buy, sell, swap-side sell and transfer taxes are exactly 300 bps (the fake token tax)',
    sim.buyTaxBps === '300' && sim.sellTaxBps === '300' && sim.sellTaxSwapBps === '300' && sim.transferTaxBps === '300', JSON.stringify(sim));
  check('happy300: exact amounts (gross buy tax 328 bps, sellOut 469132740000000 wei)',
    sim.buyTaxGrossBps === '328' && sim.sellOut === '469132740000000', JSON.stringify(sim));
  check('happy300: pinned block 56632655, tier A:d4, the sell 100 blocks later',
    out.block?.number === '56632655' && out.tier === 'A:d4' && /block 56632655 .*tier A:d4.*the sell 100 blocks later/.test(out.measuredAt ?? ''), out.measuredAt);
  check('happy300: the legs and their exact amounts',
    JSON.stringify(out.legs) === JSON.stringify([{ leg: 'buy', amountIn: '1000000000000000' }, { leg: 'sell', amountIn: '483642000000000000' }, { leg: 'transfer', amountIn: '48364200000000000' }]),
    JSON.stringify(out.legs));
  check('happy300: maxTaxBps and amountIn are echoed', out.maxTaxBps === 500 && out.amountIn === '1000000000000000');
  check('happy300: notMeasured names the tier A limit, owner actions and your own address; the retired round trip is not shown',
    why(out).some((w) => w.startsWith('tier A:d4: Nitro chains')) && !why(out).some((w) => w.startsWith('tier B'))
    && !(out.notMeasured ?? []).some((n) => n.what === 'roundTripLossBps')
    && out.instruments.every((i) => !Object.hasOwn(i.values ?? {}, 'roundTripLossBps'))
    && why(out).some((w) => /future owner actions/.test(w)) && why(out).some((w) => /your own address/.test(w)), JSON.stringify(out.notMeasured));
  check('happy300: tier A covers every class and carries its four limits, from the SDK report',
    JSON.stringify(out.uncovered) === '[]' && JSON.stringify(out.limits) === JSON.stringify(TIER_A_LIMITS)
    && TIER_A_LIMITS.every((l) => why(out).includes(`tier A:d4: ${l}`))
    && !(out.notMeasured ?? []).some((n) => n.what === 'tier uncovered'), JSON.stringify([out.uncovered, out.limits]));
  check('happy300: the economic taxes (sale against the quote) are 300 bps, the floor 300, no quote buffer',
    sim.buyEconBps === '300' && sim.sellEconBps === '300' && sim.sellLaterEconBps === '300' && sim.taxFloorBps === '300' && sim.quoteBufferBps === '0'
    && !(out.notMeasured ?? []).some((n) => /EconBps$|^taxFloorBps$|^quoteBufferBps$/.test(n.what)), JSON.stringify(sim));
  check('happy300: no word of safety in the output', !NOT_SAID.test(JSON.stringify(out)));
}
{
  const { out, misses } = await run('sellRevert');
  const sim = out.instruments?.find((i) => i.instrument === 'sim') ?? {};
  check('sellRevert: every request is in the transcript', misses === 0, misses);
  check('sellRevert: a reverted sell condemns', out.verdict === 'CONDEMN' && sim.status === 'CONDEMN' && sim.values?.sellOk === false, JSON.stringify(sim).slice(0, 300));
  check('sellRevert: the unmeasured swap-side sell tax is listed as not measured', (out.notMeasured ?? []).some((n) => n.what === 'sellTaxSwapBps'));
  check('sellRevert: no word of safety in the output', !NOT_SAID.test(JSON.stringify(out)));
}
{
  const { out, misses } = await run('probe429');
  check('probe429: every request is in the transcript', misses === 0, misses);
  check('probe429: a rate-limited probe is NOT_MEASURED (the SDK said WARN), with no tier',
    out.verdict === 'NOT_MEASURED' && out.sdkVerdict === 'WARN' && out.tier === null, `${out.verdict} ${out.sdkVerdict} ${out.tier}`);
  check('probe429: every instrument NOT_MEASURED, the sim one as provider unavailable',
    out.instruments?.every((i) => i.status === 'NOT_MEASURED') && out.instruments?.find((i) => i.instrument === 'sim')?.reason === 'provider unavailable',
    JSON.stringify(out.instruments));
  check('probe429: no word of safety in the output', !NOT_SAID.test(JSON.stringify(out)));
}
{
  const { out, misses } = await run('tierB');
  check('tierB: every request is in the transcript', misses === 0, misses);
  check('tierB: eth_simulateV1 refused (-32601), measured on tier B', out.verdict === 'MEASURED' && out.tier === 'B', `${out.verdict} ${out.tier}`);
  check('tierB: notMeasured names the tier B limits (one block, a sender with code)',
    why(out).includes('tier B: no later sell (one block)') && why(out).includes('tier B: tx.origin has code (the injected probe)')
    && !why(out).some((w) => w.startsWith('tier C')), JSON.stringify(why(out)));
  check('tierB: uncovered and limits are the SDK report\'s, in the fields and in notMeasured (one producer)',
    JSON.stringify(out.uncovered) === JSON.stringify(['a6', 'a8', 'b2', 'e1', 'i3'])
    && JSON.stringify(out.limits) === JSON.stringify(TIER_B_LIMITS)
    && why(out).includes('classes not covered at tier B: a6, a8, b2, e1, i3')
    && out.limits.every((l) => why(out).includes(`tier B: ${l}`)), JSON.stringify([out.uncovered, out.limits]));
  const sim = out.instruments?.find((i) => i.instrument === 'sim')?.values ?? {};
  check('tierB: the protocol quote buffer (10 bps) is shown, the transfer to the pair is not covered, the unread sell tax is not measured',
    sim.quoteBufferBps === '10' && sim.pairTransferCovered === false && sim.sellTaxBps === null
    && (out.notMeasured ?? []).some((n) => n.what === 'sellTaxBps') && !(out.notMeasured ?? []).some((n) => n.what === 'quoteBufferBps'), JSON.stringify(sim));
}
{
  const { out, misses } = await run('floor');
  const s = out.instruments?.find((i) => i.instrument === 'sim') ?? {};
  check('floor: every request is in the transcript', misses === 0, misses);
  check('floor: a 2000 bps sell tax kept by the token condemns on the economic tax, and the SDK said CONDEMN',
    out.verdict === 'CONDEMN' && out.sdkVerdict === 'CONDEMN' && s.status === 'CONDEMN' && s.reason === 'sellEconBps 2000 >= 500', `${out.verdict} ${out.sdkVerdict} ${s.reason}`);
  check('floor: sellEconBps and the tax floor are 2000 bps (the fake token tax), shown as measured',
    s.values?.sellEconBps === '2000' && s.values?.taxFloorBps === '2000'
    && !(out.notMeasured ?? []).some((n) => n.what === 'sellEconBps' || n.what === 'taxFloorBps'), JSON.stringify(s.values));
  check('floor: the swap-side sell tax the pair did not see is listed as not measured, not as 0',
    s.values?.sellTaxBps === null && (out.notMeasured ?? []).some((n) => n.what === 'sellTaxBps'), JSON.stringify(s.values));
  check('floor: no word of safety in the output', !NOT_SAID.test(JSON.stringify(out)));
}
{
  const out = await xrayToken(async (batch) => batch.map(() => ({ httpStatus: 429, body: 'Too Many Requests' })), input);
  check('every request rate-limited: NOT_MEASURED, no SDK verdict, nothing measured',
    out.verdict === 'NOT_MEASURED' && out.sdkVerdict === null && out.block === null && out.instruments.length === 0
    && out.notMeasured[0]?.what === 'everything', JSON.stringify(out).slice(0, 300));
  check('every request rate-limited: no word of safety in the output', !NOT_SAID.test(JSON.stringify(out)));
  let code = '';
  try { await xrayToken(async (b) => b.map(() => ({ transportError: 'x' })), { ...input, amountIn: 0n }); } catch (e) { code = e.code; }
  check('an input the SDK refuses comes back as bad_request', code === 'bad_request', code);
}

console.log('xray: the shown verdict can only lower the SDK verdict');
const inst = (...s) => s.map((status) => ({ status }));
check('SDK MEASURED with one instrument NOT_MEASURED is shown as WARN', shownVerdict({ verdict: 'MEASURED', instruments: inst('MEASURED', 'NOT_MEASURED') }) === 'WARN');
check('SDK MEASURED with no instruments is shown as WARN', shownVerdict({ verdict: 'MEASURED', instruments: [] }) === 'WARN');
check('SDK WARN with every instrument NOT_MEASURED is shown as NOT_MEASURED', shownVerdict({ verdict: 'WARN', instruments: inst('NOT_MEASURED', 'NOT_MEASURED') }) === 'NOT_MEASURED');
check('SDK WARN with a measured instrument stays WARN', shownVerdict({ verdict: 'WARN', instruments: inst('MEASURED', 'NOT_MEASURED') }) === 'WARN');
check('SDK CONDEMN is shown as CONDEMN whatever the instruments say', shownVerdict({ verdict: 'CONDEMN', instruments: inst('NOT_MEASURED') }) === 'CONDEMN');
check('SDK WARN with every instrument MEASURED is not raised to MEASURED', shownVerdict({ verdict: 'WARN', instruments: inst('MEASURED', 'MEASURED') }) === 'WARN');

console.log('xray: failed requests reach the SDK in the shape it classifies');
const rpcErr = (code, status, data) => new RpcRequestError({ body: {}, error: { code, message: 'node said no', ...(data ? { data } : {}) }, url: 'http://127.0.0.1/', status });
const r400 = replyOf(new MethodNotFoundRpcError(rpcErr(-32601, 400)));
check('HTTP 400 carrying -32601: the status and the JSON-RPC error', r400.httpStatus === 400 && r400.body?.error?.code === -32601, JSON.stringify(r400));
const r200 = replyOf(new MethodNotFoundRpcError(rpcErr(-32601, 200)));
check('HTTP 200 carrying -32601: the JSON-RPC error alone', r200.error?.code === -32601 && r200.httpStatus === undefined, JSON.stringify(r200));
const r3 = replyOf(rpcErr(3, 200, '0x08c379a0'));
check('a revert (code 3) keeps its data', r3.error?.code === 3 && r3.error?.data === '0x08c379a0', JSON.stringify(r3));
const r429 = replyOf(new HttpRequestError({ status: 429, url: 'http://127.0.0.1/', body: {} }));
check('HTTP 429 with no JSON-RPC body: the status', r429.httpStatus === 429 && r429.body === undefined, JSON.stringify(r429));
const rFetch = replyOf(new HttpRequestError({ url: 'http://127.0.0.1/', cause: new TypeError('fetch failed') }));
check('a request that never completed: a transport failure', typeof rFetch.transportError === 'string', JSON.stringify(rFetch));
const tr = await transportOver(async (q) => { if (q.method === 'bad') throw rpcErr(-32602, 200); return '0x1'; })([{ method: 'ok', params: [] }, { method: 'bad', params: [] }]);
check('transportOver answers every request of the batch, in order', tr.length === 2 && tr[0].result === '0x1' && tr[1].error?.code === -32602, JSON.stringify(tr));

console.log('xray_token over stdio');
const server = join(here, '..', 'dist', 'server.js');
const bare = new Client({ name: 'bp-mcp-xray-test', version: '0.0.0' });
await bare.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { PATH: process.env.PATH ?? '' } }));
const { tools } = await bare.listTools();
const xt = tools.find((t) => t.name === 'xray_token');
check('xray_token is listed and read-only', xt?.annotations?.readOnlyHint === true, JSON.stringify(xt?.annotations));
check('xray_token: maxTaxBps is required (the number is the caller\'s)', (xt?.inputSchema?.required ?? []).includes('maxTaxBps'), JSON.stringify(xt?.inputSchema?.required));
check('xray_token: no word of safety in its description', xt !== undefined && !NOT_SAID.test(JSON.stringify(xt)), xt?.description);
const xargs = { chain: 'base', token: fx.input.token, amountIn: fx.input.amountIn, maxTaxBps: fx.input.maxTaxBps };
const noRpc = await bare.callTool({ name: 'xray_token', arguments: xargs });
let noRpcCode = '';
try { noRpcCode = JSON.parse(noRpc.content[0].text).code; } catch { /* not JSON */ }
check('xray_token without an RPC: rpc_required', noRpc.isError === true && noRpcCode === 'rpc_required', noRpc.content?.[0]?.text);
// Refused by the schema, before the RPC is looked up: not the rpc_required of a call that went on with a default.
let noMax = false;
let noMaxText = '';
try {
  const r = await bare.callTool({ name: 'xray_token', arguments: { ...xargs, maxTaxBps: undefined } });
  noMaxText = r.content?.[0]?.text ?? '';
  noMax = r.isError === true && !noMaxText.includes('rpc_required');
} catch { noMax = true; }
check('xray_token without maxTaxBps is refused before any RPC work', noMax, noMaxText);
await bare.close();

// A local node serving one transcript at a time (eth_chainId is answered for the router's chain check).
let scenario = null;
let misses = 0;
const node = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const q = JSON.parse(body);
    const one = (r) => {
      const rep = scenario === '429' ? (r.method === 'eth_chainId' ? { result: '0x2105' } : { httpStatus: 429, body: 'Too Many Requests' })
        : scenario.lookup(r) ?? (r.method === 'eth_chainId' ? { result: '0x2105' } : (misses++, { error: { code: -32000, message: 'not in the transcript' } }));
      return rep;
    };
    const reps = (Array.isArray(q) ? q : [q]).map((r) => [r, one(r)]);
    const http = reps.find(([, rep]) => rep.httpStatus);
    if (http) { res.writeHead(http[1].httpStatus, { 'content-type': 'text/plain' }); res.end(typeof http[1].body === 'string' ? http[1].body : JSON.stringify(http[1].body ?? '')); return; }
    const wire = reps.map(([r, rep]) => ('result' in rep ? { jsonrpc: '2.0', id: r.id, result: rep.result } : { jsonrpc: '2.0', id: r.id, error: rep.error }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(Array.isArray(q) ? wire : wire[0]));
  });
});
await new Promise((r) => node.listen(0, '127.0.0.1', r));
const live = new Client({ name: 'bp-mcp-xray-node', version: '0.0.0' });
await live.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { PATH: process.env.PATH ?? '', BLAZEPHOENIX_RPC_BASE: `http://127.0.0.1:${node.address().port}` } }));
const e2e = async (name) => {
  scenario = name === '429' ? '429' : replay(name);
  misses = 0;
  const r = await live.callTool({ name: 'xray_token', arguments: xargs });
  const text = r.content?.[0]?.text ?? '';
  let body = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { r, text, out: body.result ?? {}, misses };
};
{
  const { r, text, out, misses: m } = await e2e('happy300');
  const sim = out.instruments?.find((i) => i.instrument === 'sim')?.values ?? {};
  check('e2e happy300: MEASURED over HTTP with 300 bps on every tax, every request in the transcript',
    r.isError !== true && m === 0 && out.verdict === 'MEASURED' && out.tier === 'A:d4'
    && sim.buyTaxBps === '300' && sim.sellTaxBps === '300' && sim.sellTaxSwapBps === '300' && sim.transferTaxBps === '300', `${m} ${text.slice(0, 300)}`);
  check('e2e happy300: no word of safety in the output', text !== '' && !NOT_SAID.test(text));
}
{
  const { text, out, misses: m } = await e2e('sellRevert');
  check('e2e sellRevert: CONDEMN over HTTP', m === 0 && out.verdict === 'CONDEMN', `${m} ${text.slice(0, 300)}`);
  check('e2e sellRevert: no word of safety in the output', text !== '' && !NOT_SAID.test(text));
}
{
  const { text, out, misses: m } = await e2e('tierB');
  check('e2e tierB: a node that refuses eth_simulateV1 (-32601 over HTTP) is measured on tier B',
    m === 0 && out.verdict === 'MEASURED' && out.tier === 'B' && why(out).includes('tier B: no later sell (one block)'), `${m} ${text.slice(0, 300)}`);
}
{
  const { text, out, misses: m } = await e2e('floor');
  const s = out.instruments?.find((i) => i.instrument === 'sim') ?? {};
  check('e2e floor: CONDEMN over HTTP on sellEconBps 2000, every request in the transcript',
    m === 0 && out.verdict === 'CONDEMN' && s.reason === 'sellEconBps 2000 >= 500' && s.values?.taxFloorBps === '2000', `${m} ${text.slice(0, 300)}`);
  check('e2e floor: no word of safety in the output', text !== '' && !NOT_SAID.test(text));
}
{
  const { text, out, misses: m } = await e2e('probe429');
  check('e2e probe429: a 429 on the probe is NOT_MEASURED', m === 0 && out.verdict === 'NOT_MEASURED' && out.tier === null, `${m} ${text.slice(0, 300)}`);
}
{
  const { r, text, out } = await e2e('429');
  check('e2e: a node answering 429 to everything is NOT_MEASURED, not an error and not a verdict on the token',
    r.isError !== true && out.verdict === 'NOT_MEASURED' && out.sdkVerdict === null, text.slice(0, 300));
  check('e2e 429: no word of safety and no node URL in the output', text !== '' && !NOT_SAID.test(text) && !text.includes('127.0.0.1'), text.slice(0, 300));
}
await live.close();
node.close();

console.log(failed === 0 ? `✅ ${passed} passed, 0 failed` : `❌ ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
