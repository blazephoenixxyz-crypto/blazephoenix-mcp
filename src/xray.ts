// xray_token: the token X-Ray of @blazephoenix/sdk/xray, run through the user's own RPC.
//
// The SDK produces the measurement and the verdict (one producer). This module only (1) carries the
// SDK's JSON-RPC requests to the user's node and hands back each reply in the shape the SDK classifies
// (a result, a JSON-RPC error, an HTTP status, or a transport failure), and (2) presents the report:
// what was measured, under which conditions, and what was not measured and why. It never says a token
// is fine: MEASURED means nothing failed among what was measured, under the stated conditions.
import { runXray, XrayError, type Rpc, type Transport, type XrayReport } from '@blazephoenix/sdk/xray';
import { scrubUrls, tokenText } from './text.js';

export type ShownVerdict = 'CONDEMN' | 'WARN' | 'NOT_MEASURED' | 'MEASURED';
export type XrayArgs = { chainId: number; token: string; amountIn: bigint; maxTaxBps: number };
type Reply = { jsonrpc: '2.0'; id: 1; result: unknown } | { jsonrpc: '2.0'; id: 1; error: unknown } | { httpStatus: number; body?: unknown } | { transportError: string };

/** A failed request, in the shape the SDK classifies. viem keeps the node's JSON-RPC error (code,
 *  message, data) on its RpcRequestError, and the HTTP status on it or on its HttpRequestError. */
export function replyOf(err: unknown): Reply {
  let rpc: { code: number; message: string; data?: unknown } | undefined;
  let status: number | undefined;
  const seen = new Set<unknown>();
  for (let e = err as any; e && typeof e === 'object' && !seen.has(e); e = e.cause) {
    seen.add(e);
    if (status === undefined && Number.isInteger(e.status)) status = e.status;
    if (e.name === 'RpcRequestError' && Number.isSafeInteger(e.code)) {
      rpc = { code: e.code, message: typeof e.details === 'string' ? e.details : '' };
      if (e.data !== undefined) rpc.data = e.data;
    }
  }
  if (rpc && status !== undefined && (status < 200 || status >= 300)) return { httpStatus: status, body: { jsonrpc: '2.0', id: 1, error: rpc } };
  if (rpc) return { jsonrpc: '2.0', id: 1, error: rpc };
  if (status !== undefined) return { httpStatus: status };
  return { transportError: 'the request did not complete' };
}

/** The SDK's batch, one request at a time over the user's node; every request gets one reply. */
export function transportOver(request: (req: Rpc) => Promise<unknown>): Transport {
  return (batch) => Promise.all(batch.map((req) =>
    request(req).then((result): Reply => ({ jsonrpc: '2.0', id: 1, result }), replyOf)));
}

/** What a rung cannot see, by construction (TIER_UNCOVERED of the SDK: B adds a6, a8, b2, e1, i3; C adds a1, a7). */
const TIER_LIMITS: Record<string, string[]> = {
  A: ['tier A (eth_simulateV1): buy and sell from a fresh address with no code, the sell in a later simulated block; '
    + 'behaviour that depends on your own address, on a delay longer than the simulated gap, or on future randomness is not measured'],
  B: ['tier B (eth_call with a code override): buy and sell run in one call, in one block; delays, cooldowns and same-block rules are '
    + 'not measured (a cooldown can read as a failure)',
  'tier B: the sender has code (tx.origin with code); a token that treats contracts differently from wallets is not measured as it treats a wallet'],
  C: ['tier C (plain eth_call): the caller of the Router is Multicall3, a contract, and the sender balance is fixed; '
    + 'a token that tells callers apart is not measured as it treats a wallet'],
};
const rungLimits = (rung: string | null): string[] => {
  if (rung === null) return [];
  const t = rung[0];
  return t === 'A' ? TIER_LIMITS.A : t === 'B' ? [...TIER_LIMITS.A, ...TIER_LIMITS.B] : t === 'C' ? [...TIER_LIMITS.A, ...TIER_LIMITS.B, ...TIER_LIMITS.C] : [`tier ${rung}: limits unknown`];
};
/** No simulation reaches these, on any tier. */
const NEVER = [
  'future owner actions (a blacklist after the purchase, a fee change, a pause, an upgrade, a liquidity withdrawal) cannot be simulated',
  'other amounts than amountIn, other blocks than the pinned one, and your own address were not measured',
];

const MEANING: Record<ShownVerdict, string> = {
  CONDEMN: 'a measurement failed: a sell reverted or delivered nothing, a transfer to the pool reverted, or a measured tax reached maxTaxBps',
  WARN: 'something failed or was not measured; read the instruments and notMeasured',
  NOT_MEASURED: 'nothing was measured; this is a fact about the node or the route, not about the token',
  MEASURED: 'nothing failed among what was measured, under these conditions; what was not measured is listed in notMeasured',
};

/** The verdict shown. MEASURED only when the SDK says MEASURED and every instrument is MEASURED
 *  (a second, independent predicate: it can only lower the verdict). WARN with nothing measured is NOT_MEASURED. */
export function shownVerdict(r: Pick<XrayReport, 'verdict' | 'instruments'>): ShownVerdict {
  const all = (s: string) => r.instruments.length > 0 && r.instruments.every((i) => i.status === s);
  if (r.verdict === 'CONDEMN') return 'CONDEMN';
  if (r.verdict === 'MEASURED' && all('MEASURED')) return 'MEASURED';
  if (all('NOT_MEASURED')) return 'NOT_MEASURED';
  return 'WARN';
}

/** Every bigint as a decimal string, at any depth. */
const plain = (x: unknown): unknown => typeof x === 'bigint' ? x.toString()
  : Array.isArray(x) ? x.map(plain)
    : x !== null && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, plain(v)])) : x;

export function present(r: XrayReport, a: XrayArgs) {
  const verdict = shownVerdict(r);
  const sim = r.instruments.find((i) => i.name === 'sim');
  const c = (sim ?? r.instruments[0])?.conditions;
  const measuredAt = `measured at block ${r.block.number} (${r.block.hash}) on chain ${r.chainId}${r.rung ? `, tier ${r.rung}` : ''}, `
    + `buying with ${r.amountIn} wei${c?.sender ? ` from ${c.sender}` : ''}${c && c.blocksLater > 0 ? `, the sell ${c.blocksLater} blocks later` : ''}`
    + `${c?.gasPrice !== null && c?.gasPrice !== undefined ? `, gas price ${c.gasPrice} wei` : ''}`;
  const notMeasured: { what: string; why: string }[] = [];
  for (const i of r.instruments) if (i.status === 'NOT_MEASURED') notMeasured.push({ what: i.name, why: i.reason });
  if (sim && sim.status !== 'NOT_MEASURED') {
    for (const [k, v] of Object.entries(sim.values)) if (v === null) notMeasured.push({ what: k, why: 'not measured in this run' });
    for (const n of (sim.values.notes as string[] | undefined) ?? []) notMeasured.push({ what: 'sim', why: n });
  }
  for (const l of rungLimits(r.rung)) notMeasured.push({ what: 'tier limit', why: l });
  for (const l of NEVER) notMeasured.push({ what: 'any tier', why: l });
  return plain({
    verdict,
    meaning: MEANING[verdict],
    sdkVerdict: r.verdict,
    chainId: r.chainId,
    token: r.target,
    amountIn: r.amountIn,
    maxTaxBps: a.maxTaxBps,
    block: r.block,
    tier: r.rung,
    measuredAt,
    legs: r.legs,
    instruments: r.instruments.map((i) => ({ instrument: i.name, status: i.status, reason: i.reason, values: i.values, conditions: i.conditions })),
    notMeasured,
    text: r.text,
  }) as Record<string, unknown>;
}

/** A run that could not pin a block or read the deployment (a rate limit, a node that is down, a
 *  codehash that differs from the pin) measured nothing: NOT_MEASURED, with the reason. */
function notMeasuredRun(a: XrayArgs, why: string) {
  return plain({
    verdict: 'NOT_MEASURED' as ShownVerdict,
    meaning: MEANING.NOT_MEASURED,
    sdkVerdict: null,
    chainId: a.chainId,
    token: a.token,
    amountIn: a.amountIn,
    maxTaxBps: a.maxTaxBps,
    block: null,
    tier: null,
    measuredAt: null,
    instruments: [],
    notMeasured: [{ what: 'everything', why }, ...NEVER.map((l) => ({ what: 'any tier', why: l }))],
  }) as Record<string, unknown>;
}

export async function xrayToken(transport: Transport, a: XrayArgs) {
  let r: XrayReport;
  try {
    r = await runXray(transport, { chainId: a.chainId, token: a.token, amountIn: a.amountIn, maxTaxBps: a.maxTaxBps });
  } catch (e) {
    if (e instanceof XrayError && e.code === 'bad_input') {
      throw Object.assign(new Error(`X-Ray input refused: ${e.message.replace(/^bad_input: /, '')}`), { code: 'bad_request' });
    }
    return notMeasuredRun(a, `the run stopped before any measurement: ${tokenText(scrubUrls(String((e as Error)?.message ?? e)), 300)}`);
  }
  return present(r, a);
}
