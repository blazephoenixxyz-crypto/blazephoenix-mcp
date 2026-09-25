// =============================================================================
//  Configuration — environment variables only (the `env` block of any MCP
//  client config). Nothing here has a default endpoint: the server reads the
//  chain through YOUR nodes or not at all.
//
//    BLAZEPHOENIX_RPC_BASE / _ETHEREUM / _OPTIMISM / _ARBITRUM / _ROBINHOOD
//        your node per chain (comma-separated for a fallback list)
//    BLAZEPHOENIX_RPC_URL          one node (serves the chain it reports)
//    BLAZEPHOENIX_VERSION          protocol version: latest (default) | 1 | 2 | 2.0.0
//    BLAZEPHOENIX_CONTRACTS        JSON overrides, e.g. {"base":{"router":"0x…","quoter":"0x…","version":"2.0.0"}}
//    BLAZEPHOENIX_REGISTRY         auto (default) | embedded — embedded never fetches addresses
//    BLAZEPHOENIX_REGISTRY_URL     alternative registry document URL
//    BLAZEPHOENIX_SLIPPAGE_BPS     default slippage for build_swap (default 50)
//    BLAZEPHOENIX_DEADLINE_SEC     default deadline horizon (default 120)
// =============================================================================

import { rpcFromEnv, type ClientOptions, type ContractOverrides } from '@blazephoenix/sdk';

export interface ServerConfig {
  client: ClientOptions;
  /** Human summary of what is configured (URLs redacted). */
  summary: { rpcChains: string[] | 'single-node' | 'none'; version: string; registry: string };
}

export function configFromEnv(env: Record<string, string | undefined> = process.env, onWarning?: (m: string) => void): ServerConfig {
  const rpc = rpcFromEnv(env);
  const version = (env.BLAZEPHOENIX_VERSION ?? 'latest').trim() || 'latest';
  const registryMode = (env.BLAZEPHOENIX_REGISTRY ?? 'auto').trim().toLowerCase();
  if (registryMode !== 'auto' && registryMode !== 'embedded') {
    throw new Error(`BLAZEPHOENIX_REGISTRY must be "auto" or "embedded", got "${registryMode}"`);
  }
  let contracts: ContractOverrides | undefined;
  if (env.BLAZEPHOENIX_CONTRACTS && env.BLAZEPHOENIX_CONTRACTS.trim()) {
    try {
      contracts = JSON.parse(env.BLAZEPHOENIX_CONTRACTS) as ContractOverrides;
    } catch {
      throw new Error('BLAZEPHOENIX_CONTRACTS is not valid JSON');
    }
  }
  const num = (k: string): number | undefined => {
    const v = env[k];
    if (v === undefined || v.trim() === '') return undefined;
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Error(`${k} must be an integer`);
    return n;
  };
  const slippageBps = num('BLAZEPHOENIX_SLIPPAGE_BPS');
  const deadlineSec = num('BLAZEPHOENIX_DEADLINE_SEC');
  const client: ClientOptions = {
    ...(rpc !== undefined ? { rpc } : {}),
    version,
    ...(contracts ? { contracts } : {}),
    registry: {
      mode: registryMode,
      ...(env.BLAZEPHOENIX_REGISTRY_URL ? { url: env.BLAZEPHOENIX_REGISTRY_URL } : {}),
      ...(onWarning ? { onWarning } : {}),
    },
    ...(slippageBps !== undefined ? { slippageBps } : {}),
    ...(deadlineSec !== undefined ? { deadlineSec } : {}),
  };
  const rpcChains = rpc === undefined
    ? 'none'
    : typeof rpc === 'string' || Array.isArray(rpc) ? 'single-node' : Object.keys(rpc as object);
  return { client, summary: { rpcChains, version, registry: registryMode } };
}
