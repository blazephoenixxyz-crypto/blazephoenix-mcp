// Stdio integration test: spawns the built server and talks MCP to it.
// No RPC is configured, so this needs no network and no key: it checks the tool
// surface, that errors come back as tool results, and that the server never
// exposes a signing tool.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, '..', 'dist', 'server.js');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

// Start from a clean environment so no ambient RPC variable leaks in.
const env = { PATH: process.env.PATH ?? '' };
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env });
const client = new Client({ name: 'bp-mcp-test', version: '0.0.0' });
await client.connect(transport);

console.log('tools');
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check('exactly the seven read-only tools',
  JSON.stringify(names) === JSON.stringify(['build_swap', 'check_solvency', 'get_deployments', 'get_quote', 'get_token_info', 'simulate_swap', 'verify_deployment']),
  JSON.stringify(names));
check('every tool is marked read-only', tools.every((t) => t.annotations?.readOnlyHint === true));
check('no tool takes an rpc, url, key or private key argument',
  tools.every((t) => !Object.keys(t.inputSchema.properties ?? {}).some((k) => /rpc|url|key|secret|mnemonic|signer|wallet/i.test(k))));
check('no signing or sending tool is exposed', !names.some((n) => /sign|send|execute|broadcast/.test(n)));

console.log('errors come back as tool results');
const noRpc = await client.callTool({ name: 'get_quote', arguments: { tokenIn: 'ETH', tokenOut: 'USDC', amount: '1', chain: 'base' } });
const noRpcBody = JSON.parse(noRpc.content[0].text);
check('get_quote without an RPC returns isError', noRpc.isError === true);
check('...with a stable machine code', noRpcBody.ok === false && typeof noRpcBody.code === 'string', JSON.stringify(noRpcBody));

const noAmount = await client.callTool({ name: 'get_quote', arguments: { tokenIn: 'ETH', tokenOut: 'USDC', chain: 'base' } });
check('missing amount is rejected as bad_request', noAmount.isError === true && JSON.parse(noAmount.content[0].text).code === 'bad_request');

console.log('input validation');
let rejected = false;
try {
  const r = await client.callTool({ name: 'build_swap', arguments: { tokenIn: 'ETH', tokenOut: 'USDC', amount: '1', chain: 'base', recipient: 'not-an-address' } });
  rejected = r.isError === true;
} catch { rejected = true; }
check('a malformed recipient is rejected before any work', rejected);

let slipRejected = false;
try {
  const r = await client.callTool({ name: 'build_swap', arguments: { tokenIn: 'ETH', tokenOut: 'USDC', amount: '1', chain: 'base', recipient: '0x' + '11'.repeat(20), slippageBps: 9999 } });
  slipRejected = r.isError === true;
} catch { slipRejected = true; }
check('slippageBps above 5000 is rejected', slipRejected);

await client.close();
console.log(failed === 0 ? `✅ ${passed} passed, 0 failed` : `❌ ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
