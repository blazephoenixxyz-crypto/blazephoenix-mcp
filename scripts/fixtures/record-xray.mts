// Records the request/reply transcripts that scripts/test-xray.mjs replays: the SDK's own fake node
// (test/xray/fake.ts of the SDK repository) answering runXray. Requests are kept as the sha256 of
// {method, params}; the router, quoter, WETH and Multicall3 runtimes appear once, under `codes`.
// Regenerate, from an SDK checkout: SDK_DIR=$PWD npx tsx <mcp>/scripts/fixtures/record-xray.mts out.json
//   then gzip -9 -n -c out.json > <mcp>/scripts/fixtures/xray-transcripts.json.gz
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const key = (q: any) => createHash('sha256').update(JSON.stringify({ method: q.method, params: q.params })).digest('hex');
const SDK = process.env.SDK_DIR ?? process.cwd();
const { runXray } = await import(SDK + '/src/xray/index.ts');
const { fakeNode, TOKEN, BASE_CODE } = await import(SDK + '/test/xray/fake.ts');
const IN = { chainId: 8453, token: TOKEN, amountIn: 10n ** 15n, maxTaxBps: 500 };
const down = { error: { code: -32601, message: 'the method eth_simulateV1 does not exist/is not available' } };
const lim = { httpStatus: 429, body: 'Too Many Requests' };
const SC: Record<string, any> = {
  happy300: { taxBps: 300n },
  sellRevert: { sellRevert: true },
  probe429: { probe: { 'A:d4': lim, 'A:d2': lim, B: lim, C: lim } },
  tierB: { probe: { 'A:d4': down, 'A:d2': down } },
  // A 2000 bps sell-only tax kept by the token (no swapback: cap never reached): its own balance rises on the sale.
  floor: { swapback: { taxBps: 2000n, cap: 10n ** 30n, start: 0n } },
};
const codeName = new Map(Object.entries(BASE_CODE).map(([k, v]) => [v, k]));
const ded = (x: any): any => (typeof x === 'string' && codeName.has(x) ? { $code: codeName.get(x) } : Array.isArray(x) ? x.map(ded) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ded(v)])) : x);
const out: any = { source: 'sdk-wt-xray test/xray/fake.ts', input: { chainId: IN.chainId, token: IN.token, amountIn: String(IN.amountIn), maxTaxBps: IN.maxTaxBps }, codes: BASE_CODE, scenarios: {} };
for (const [name, o] of Object.entries(SC)) {
  const f = fakeNode(o); const log: any[] = [];
  const r = await runXray(async (b: any[]) => { const rep = await f.transport(b); b.forEach((q: any, i: number) => log.push([q.method, key(q), ded(rep[i])])); return rep; }, IN);
  JSON.stringify(log, (_k, v) => { if (typeof v === 'bigint') throw new Error('bigint in transcript'); return v; });
  out.scenarios[name] = { calls: log, sdkVerdict: r.verdict, rung: r.rung };
  console.log(name, r.verdict, r.rung, log.length, JSON.stringify(r.instruments.map((i: any) => [i.name, i.status, i.reason])));
}
writeFileSync(process.argv[2], JSON.stringify(out));
