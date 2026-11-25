// find_token tests, without network. Part A runs the pure module (dist/find.js) on the SDK's
// findToken with a fake chain (a FindReader) and fake indexes (a fetch that answers only the
// CoinGecko and Dexscreener URLs and refuses any other). globalThis.fetch is replaced by one that
// throws, so a request that escapes the injected fetch fails the test instead of reaching the network.
// Part B drives the built server over stdio with no RPC configured.
//
// Every check names, in the comment above it, the mutant that turns it red (verified by applying
// each one alone to src/, rebuilding and running this file).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { findTokenTool, present, NO_CHOICE, CENTRALIZED } = await import(join(here, '..', 'dist', 'find.js'));
const { stringify } = await import(join(here, '..', 'dist', 'text.js'));
const { WARNINGS } = await import('@blazephoenix/sdk/find');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`); }
};

let escaped = 0;
globalThis.fetch = async () => { escaped++; throw new Error('network is off in this test'); };

const A = '0x' + 'a1'.repeat(20);   // PEPE, deep (no impact up to 1M USD)
const B = '0x' + 'b2'.repeat(20);   // PEPE, shallow (constant-product venue)
const C = '0x' + 'c3'.repeat(20);   // "РЕРЕ": Cyrillic letters that look like PEPE
const D = '0x' + 'd4'.repeat(20);   // PEPE on another chain: never proposed on Base
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The indexes, answering only their own URLs. `down` makes Dexscreener answer 503. */
function indexes({ down = false } = {}) {
  const urls = [];
  const f = async (input) => {
    const u = String(input);
    urls.push(u);
    if (u.startsWith('https://api.coingecko.com/api/v3/search?')) return json({ coins: [{ id: 'pepe', symbol: 'PEPE', name: 'Pepe' }, { id: 'pepe-two', symbol: 'PEPE', name: 'Pepe Two' }] });
    if (u.startsWith('https://api.coingecko.com/api/v3/coins/pepe?')) return json({ platforms: { base: A, ethereum: D } });
    if (u.startsWith('https://api.coingecko.com/api/v3/coins/pepe-two?')) return json({ platforms: { base: B } });
    if (u.startsWith('https://api.dexscreener.com/latest/dex/search?')) {
      if (down) return json({ error: 'unavailable' }, 503);
      return json({ pairs: [
        { chainId: 'base', baseToken: { address: A, symbol: 'PEPE', name: 'Pepe' }, quoteToken: { address: USDC, symbol: 'USDC', name: 'USD Coin' } },
        { chainId: 'base', baseToken: { address: C, symbol: 'РЕРЕ', name: 'Pepe' }, quoteToken: { address: USDC, symbol: 'USDC', name: 'USD Coin' } },
        { chainId: 'ethereum', baseToken: { address: D, symbol: 'PEPE', name: 'Pepe' }, quoteToken: { address: USDC, symbol: 'USDC', name: 'USD Coin' } },
      ] });
    }
    throw new Error(`unexpected URL ${u}`);
  };
  return { f, urls };
}

/** The chain: three ERC-20s with 18 decimals, priced at 1 USD (6-decimal dollar token). A and C
 *  answer linearly; B is a constant-product venue holding 20,000 USD a side. */
const TOKENS = { [A.toLowerCase()]: 'PEPE', [B.toLowerCase()]: 'PEPE', [C.toLowerCase()]: 'РЕРЕ' };
const reader = {
  hasCode: async (a) => a.toLowerCase() in TOKENS,
  erc20: async (a) => ({ symbol: TOKENS[a.toLowerCase()], name: 'Pepe', decimals: 18 }),
  balanceOf: async () => null,
  usdValue: async (token, amountIn) => {
    const lin = amountIn / 10n ** 12n;
    const usd = token.toLowerCase() === B.toLowerCase() ? (lin * 20_000_000_000n) / (lin + 20_000_000_000n) : lin;
    return { chainId: 8453, version: '1', label: 'USD (via USDC)', dollarToken: USDC, dollarDecimals: 6, token, amountIn, usdValue: usd, blockNumber: 1n, blockHash: '0x' + '11'.repeat(32), vias: [] };
  },
};

console.log('find_token (module, fake chain and indexes)');
const ix = indexes();
// A rejection becomes an empty answer, so a mutant fails the checks below instead of crashing the file.
const failedCall = (e) => ({ error: String(e), candidates: [], warnings: [] });
// Sources. The default is on-chain discovery, not available yet: it reads nothing and says how to opt in.
const ix0 = indexes();
const dflt = await findTokenTool({ query: 'PEPE', chainId: 8453 }, { reader, fetch: ix0.f }).then(() => ({}), (e) => e);
// mutants: resolveSources defaults to 'centralized'; findTokenTool's sources guard is removed; ONCHAIN_PENDING loses
// "is coming" or the `sources: "centralized"` hint
check('by default (on-chain) no index is called and the answer says on-chain discovery is coming and how to opt in',
  dflt.code === 'onchain_discovery_unavailable' && ix0.urls.length === 0 && /is coming/.test(dflt.message ?? '')
  && /Pass sources: "centralized"/.test(dflt.message ?? ''), JSON.stringify({ code: dflt.code, message: dflt.message, urls: ix0.urls }));

const out = await findTokenTool({ query: 'PEPE', chainId: 8453, sources: 'centralized' }, { reader, fetch: ix.f }).catch(failedCall);
const byAddr = Object.fromEntries(out.candidates.map((c) => [c.address.toLowerCase(), c]));
const text = stringify({ ok: true, result: out });

// mutant: findTokenTool drops `sources: 'centralized'` (the SDK defaults to on-chain and refuses without an rpc)
// mutant: findTokenTool drops `fetch: d.fetch` (the SDK falls back to globalThis.fetch, which throws)
check('the injected indexes are the only ones called, and only their own URLs',
  escaped === 0 && ix.urls.length === 4 && ix.urls.every((u) => /^https:\/\/api\.(coingecko|dexscreener)\.com\//.test(u)), JSON.stringify(ix.urls));
// mutant: findTokenTool drops `reader: d.reader` (the SDK then refuses: no rpc)
check('three candidates on Base, the other chain\'s address left out',
  out.candidates.length === 3 && !(D.toLowerCase() in byAddr), JSON.stringify(out.candidates.map((c) => c.address)));
// mutant: present maps candidates with `.reverse()`
check('ranked by measured depth: the deep token first, the shallow one last',
  out.candidates[0]?.address.toLowerCase() === A.toLowerCase() && out.candidates[2]?.address.toLowerCase() === B.toLowerCase()
  && out.candidates.every((c, i) => c.rank === i + 1), JSON.stringify(out.candidates.map((c) => [c.rank, c.address])));
// mutant: keepsLabel returns true
check('only rank 1 is labelled, and the label is "most liquid"',
  out.candidates[0]?.label === 'most liquid' && out.candidates.slice(1).every((c) => !('label' in c)), JSON.stringify(out.candidates.map((c) => c.label)));
// mutant: present returns `warnings: r.warnings.slice(1)` / drops `warnings`
check('the fixed warnings, verbatim: most liquid not official, N tokens use this ticker, liquidity is not safety',
  Array.isArray(out.warnings) && out.warnings.includes(WARNINGS.mostLiquid) && out.warnings.includes(WARNINGS.notSafety)
  && out.warnings.includes('3 tokens use this ticker; impostors copy tickers; do your own research.'), JSON.stringify(out.warnings));
// mutant: present drops `choice: NO_CHOICE`
check('no candidate is chosen: the answer says so, and carries no chosen address',
  out.choice === NO_CHOICE && /none is selected for a swap/.test(out.choice)
  && !Object.keys(out).some((k) => /^(selected|chosen|token|address|best)$/i.test(k)), JSON.stringify(Object.keys(out)));
// mutant: present drops `candidateSource: CENTRALIZED`
check('the answer labels its candidates as proposed by centralized indexes, opted into',
  out.candidateSource === CENTRALIZED && /^centralized: CoinGecko and Dexscreener search/.test(out.candidateSource ?? '')
  && /sources: "centralized"/.test(out.candidateSource ?? ''), String(out.candidateSource));
// mutant: keepsLabel's label becomes 'official'
check('"official" appears only as the denial in the warning',
  (text.match(/official/gi) ?? []).length === 1 && text.includes('It is not \\"official\\"'), text.match(/.{40}official.{20}/gi)?.join(' | '));
// mutant: present destructures `lookalike: _l` out of each candidate
check('the Cyrillic impostor is flagged, the Latin tickers are not',
  byAddr[C.toLowerCase()]?.lookalike?.suspicious === true && byAddr[A.toLowerCase()]?.lookalike?.suspicious === false,
  JSON.stringify(byAddr[C.toLowerCase()]?.lookalike));
// mutant: present drops `basis`
check('the depth is a measured lower bound, and the answer says how it was measured',
  out.candidates[0]?.depth?.status === 'MEASURED' && typeof out.basis === 'string' && /lower bound/.test(out.basis));
// mutant: stringify's bigint branch becomes `Number(x).toString()` (1e+24 for 10^24 base units)
check('amounts reach the agent as exact decimal strings',
  /"amountIn": "1000000000000000000000000"/.test(text), text.match(/"amountIn": "[^"]*"/g)?.slice(-1)[0]);

console.log('find_token (an index that fails)');
const ix2 = indexes({ down: true });
const out2 = await findTokenTool({ query: 'PEPE', chainId: 8453, sources: 'centralized' }, { reader, fetch: ix2.f }).catch(failedCall);
// mutant: present drops `sources`
check('a failing index is listed as failed, and the other still proposes',
  out2.sources?.some((s) => s.name === 'dexscreener' && s.ok === false) && out2.sources?.some((s) => s.name === 'coingecko' && s.ok === true)
  && out2.candidates.length === 2, JSON.stringify(out2.sources));

console.log('find_token (more proposals than are read: the omitted addresses are named)');
// 13 addresses proposed for one ticker on Base; the SDK reads 10 (DEFAULT_MAX_CANDIDATES) and names the rest.
const FLOOD = Array.from({ length: 13 }, (_, i) => '0x' + (0xe000 + i).toString(16).padStart(40, '0'));
const floodIx = async (input) => {
  const u = String(input);
  if (u.startsWith('https://api.coingecko.com/api/v3/search?')) return json({ coins: [] });
  if (u.startsWith('https://api.dexscreener.com/latest/dex/search?')) return json({ pairs: FLOOD.map((a) => (
    { chainId: 'base', baseToken: { address: a, symbol: 'PEPE', name: 'Pepe' }, quoteToken: { address: USDC, symbol: 'USDC', name: 'USD Coin' } })) });
  throw new Error(`unexpected URL ${u}`);
};
const floodReader = { ...reader, hasCode: async () => true, erc20: async () => ({ symbol: 'PEPE', name: 'Pepe', decimals: 18 }) };
const out3 = await findTokenTool({ query: 'PEPE', chainId: 8453, sources: 'centralized' }, { reader: floodReader, fetch: floodIx }).catch(failedCall);
const read3 = new Set(out3.candidates.map((c) => c.address.toLowerCase()));
const left3 = FLOOD.filter((a) => !read3.has(a));
// Mutant: present drops `omittedAddresses` (the agent learns only a count, not which addresses were left out)
check('every proposed address that was not read is named in omittedAddresses, and only those',
  out3.candidates.length === 10 && out3.omitted === 3 && Array.isArray(out3.omittedAddresses) && out3.omittedAddresses.length === 3
  && left3.every((a) => out3.omittedAddresses.some((o) => o.toLowerCase() === a)), JSON.stringify({ omitted: out3.omitted, omittedAddresses: out3.omittedAddresses }));
// Mutant: present drops `omittedNotMeasured` (an index proposal has no pre-filter measure, so all three are listed)
check('omitted addresses with no measure are named in omittedNotMeasured',
  Array.isArray(out3.omittedNotMeasured) && out3.omittedNotMeasured.length === 3
  && out3.omittedNotMeasured.every((a) => out3.omittedAddresses.includes(a)), JSON.stringify(out3.omittedNotMeasured));
// Mutant: present returns `warnings: r.warnings.slice(0, -1)` (the omitted warning is the last one the SDK pushes here)
check('the omitted warning reaches the agent verbatim', out3.warnings.includes(WARNINGS.omitted(3, 3)), JSON.stringify(out3.warnings));

console.log('present (a second check on the label)');
const base = (rank, status, label) => ({ address: A, rank, label, depth: { status } });
const crafted = (cands) => present({ query: 'X', chainId: 8453, candidates: cands, sources: [], omitted: 0, omittedAddresses: [], omittedNotMeasured: [], warnings: [], basis: '' });
// Mutant: present returns `omittedNotMeasured: r.omittedAddresses` (or swaps the two lists)
const om = present({ query: 'X', chainId: 8453, candidates: [], sources: [], omitted: 2, omittedAddresses: [B, A], omittedNotMeasured: [A], warnings: [], basis: '' });
check('omittedAddresses and omittedNotMeasured pass through as the SDK gives them, in queue order',
  JSON.stringify(om.omittedAddresses) === JSON.stringify([B, A]) && JSON.stringify(om.omittedNotMeasured) === JSON.stringify([A]), JSON.stringify(om));
// mutant: keepsLabel without `c.rank === 1 &&`
check('a label on rank 2 is taken away', !('label' in crafted([base(1, 'MEASURED'), base(2, 'MEASURED', 'most liquid')]).candidates[1]));
// mutant: keepsLabel without `&& c.depth.status === 'MEASURED'`
check('a label on a rank 1 whose depth was not measured is taken away', !('label' in crafted([base(1, 'NOT_MEASURED', 'most liquid')]).candidates[0]));
// mutant: keepsLabel without `c.label === 'most liquid' &&` (a candidate the SDK left unlabelled gains one)
check('a rank 1 the SDK left unlabelled stays unlabelled', !('label' in crafted([base(1, 'MEASURED')]).candidates[0]));

console.log('find_token (server over stdio, no RPC configured)');
const transport = new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'dist', 'server.js')], env: { PATH: process.env.PATH ?? '' } });
const client = new Client({ name: 'bp-mcp-find-test', version: '0.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
const t = tools.find((x) => x.name === 'find_token');
const desc = t?.description ?? '';
// mutant: the description loses any one of these phrases
check('the description carries the fixed warnings and the no-choice rule',
  /labelled "most liquid" only when its depth is MEASURED \(no label when it is NOT_MEASURED\), never "official"/.test(desc) && /impostors copy tickers/.test(desc) && /liquidity is not safety/.test(desc)
  && /never selects one\s+for a swap/.test(desc), desc);
// Mutant: the description loses the omittedAddresses / omittedNotMeasured sentence
check('the description says omitted addresses are named, apart from the ones not measured',
  /omittedAddresses lists them/.test(desc) && /omittedNotMeasured those with no complete measure/.test(desc), desc);
// mutant: the description loses "explicit opt-in" or "centralized indexes", or says "onchain" is not the default
check('the description says on-chain is the default and the centralized indexes are an explicit opt-in',
  /"onchain" \(the default/.test(desc) && /explicit opt-in/.test(desc) && /centralized indexes/.test(desc), desc);
// mutant: the handler's early `sources === 'onchain'` return is removed (the missing RPC then answers first)
const dfltSrv = await client.callTool({ name: 'find_token', arguments: { chain: 'base', query: 'PEPE' } });
const dfltText = dfltSrv.content?.[0]?.text ?? '';
check('by default, even with no RPC configured: onchain_discovery_unavailable, no candidates',
  dfltSrv.isError === true && /onchain_discovery_unavailable/.test(dfltText) && !/candidates"/.test(dfltText), dfltText.slice(0, 200));
// mutant: `sources: z.enum(SOURCES)` becomes `z.string()` (an unknown value then reaches the handler as on-chain)
const badSrc = await client.callTool({ name: 'find_token', arguments: { chain: 'base', query: 'PEPE', sources: 'everything' } });
check('an unknown sources value is refused by the schema', badSrc.isError === true && /onchain/.test(JSON.stringify(badSrc.content))
  && /centralized/.test(JSON.stringify(badSrc.content)) && !/onchain_discovery_unavailable/.test(JSON.stringify(badSrc.content)),
  JSON.stringify(badSrc.content).slice(0, 200));
// mutant: inputSchema `strict({...})` becomes `z.object({...})` (an rpc key would be dropped silently)
const withRpc = await client.callTool({ name: 'find_token', arguments: { chain: 'base', query: 'PEPE', rpc: 'https://example.invalid' } });
check('an rpc argument is refused by the schema: the RPC comes from the environment only',
  withRpc.isError === true && /Unrecognized key\(s\) in object: 'rpc'/.test(JSON.stringify(withRpc.content)), JSON.stringify(withRpc.content).slice(0, 200));
// mutant: `query: z.string().min(1).max(64)` becomes `.max(65)` (the node check then answers instead)
const long = await client.callTool({ name: 'find_token', arguments: { chain: 'base', query: 'P'.repeat(65) } });
check('a query over 64 characters is refused by the schema', long.isError === true && /64/.test(JSON.stringify(long.content)), JSON.stringify(long.content).slice(0, 200));
// mutant: the handler passes `rpc: undefined` and no client (the SDK refuses with bad_request, not the router's rpc error)
const noRpc = await client.callTool({ name: 'find_token', arguments: { chain: 'base', query: 'PEPE', sources: 'centralized' } });
const noRpcText = noRpc.content?.[0]?.text ?? '';
check('with no RPC configured: an error envelope, no candidates', noRpc.isError === true && /"ok": false/.test(noRpcText)
  && !/candidates/.test(noRpcText) && !/bad_request/.test(noRpcText) && !/onchain_discovery_unavailable/.test(noRpcText), noRpcText.slice(0, 200));
await client.close();

console.log(`find: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
