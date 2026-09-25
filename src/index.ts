#!/usr/bin/env node
// =============================================================================
//  blazephoenix-mcp — stdio entry point.
//
//    claude mcp add blazephoenix -e BLAZEPHOENIX_RPC_BASE=https://your-node -- npx -y @blazephoenix/mcp
//
//  stdout is the protocol channel: everything human goes to stderr.
// =============================================================================

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BlazePhoenix } from '@blazephoenix/sdk';
import { configFromEnv } from './config.js';
import { SERVER_VERSION, chainNames, createServer } from './server.js';

const log = (m: string) => process.stderr.write(`[blazephoenix-mcp] ${m}\n`);

async function main() {
  const cfg = configFromEnv(process.env, (w) => log(`registry: ${w}`));
  const blaze = new BlazePhoenix(cfg.client);
  const rpc = cfg.summary.rpcChains;
  const summary = {
    rpc: rpc === 'none' ? 'none configured' : rpc === 'single-node' ? 'one node (serves the chain it reports)' : chainNames(rpc),
    version: cfg.summary.version,
    registry: cfg.summary.registry,
  };
  if (rpc === 'none') {
    log('no RPC configured — tools will answer rpc_required. Set BLAZEPHOENIX_RPC_BASE (or _ETHEREUM, _OPTIMISM, _ARBITRUM, _ROBINHOOD, or BLAZEPHOENIX_RPC_URL).');
  }
  const server = createServer({ blaze, summary });
  await server.connect(new StdioServerTransport());
  log(`v${SERVER_VERSION} ready · rpc: ${Array.isArray(summary.rpc) ? summary.rpc.join(', ') : summary.rpc} · version: ${summary.version} · registry: ${summary.registry}`);
}

main().catch((e) => {
  log(`fatal: ${(e as Error)?.message ?? e}`);
  process.exit(1);
});
