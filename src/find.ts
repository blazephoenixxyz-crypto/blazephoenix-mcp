// find_token: candidates for a name or ticker, from @blazephoenix/sdk/find, read through the user's own RPC.
//
// Where candidates come from is `sources`: "onchain" by default (discovery from the chain itself, not
// available yet: it plugs in at onchainDiscovery below), or "centralized", the explicit opt-in to two
// third-party indexes (CoinGecko, Dexscreener search) that only propose addresses, labelled as such.
//
// The SDK produces everything (one producer): the addresses the two indexes propose, what each
// candidate's contract says about itself, the depth the Quoter measures, the liquidity the venues
// hold, the order, the label and the warnings. This module only presents it, and adds what an agent
// most needs to read: no candidate is chosen. A second check here can only take the label away.
import { findToken, type FindReader, type FindTokenResult } from '@blazephoenix/sdk/find';
import type { BlazePhoenix, RpcSource } from '@blazephoenix/sdk';

export const NO_CHOICE = 'No candidate is chosen and none is selected for a swap. A ticker does not identify a token: '
  + 'to quote or build a swap, pass the 0x address you verified yourself (xray_token measures one candidate).';

/** Where candidates come from. "onchain" is the default; "centralized" is an explicit opt-in. */
export const SOURCES = ['onchain', 'centralized'] as const;
export type Sources = (typeof SOURCES)[number];
export const CENTRALIZED = 'centralized: CoinGecko and Dexscreener search proposed these addresses (third-party indexes you '
  + 'opted into with sources: "centralized"); everything else was read on your RPC';
export const ONCHAIN_PENDING = 'On-chain candidate discovery (the default, sources: "onchain") is coming and is not available yet. '
  + 'Pass sources: "centralized" to opt into candidates proposed by two third-party, centralized indexes (CoinGecko, '
  + 'Dexscreener search), each read on your RPC.';

export const resolveSources = (s: Sources | undefined): Sources => s ?? 'onchain';

/** The on-chain source enters here. Until it exists, it answers onchain_discovery_unavailable and reads nothing. */
export async function onchainDiscovery(_a: FindArgs): Promise<never> {
  throw Object.assign(new Error(ONCHAIN_PENDING), { code: 'onchain_discovery_unavailable' });
}

export type FindArgs = { query: string; chainId: number; sources?: Sources };
/** `rpc` and `client` in the server; `reader` and `fetch` replace the chain and the indexes in tests. */
export type FindDeps = { rpc?: RpcSource; client?: BlazePhoenix; reader?: FindReader; fetch?: typeof fetch };

/** The label "most liquid" stays only on rank 1, and only when its depth was MEASURED. */
const keepsLabel = (c: FindTokenResult['candidates'][number]) =>
  c.label === 'most liquid' && c.rank === 1 && c.depth.status === 'MEASURED';

export function present(r: FindTokenResult) {
  return {
    choice: NO_CHOICE,
    candidateSource: CENTRALIZED,
    warnings: r.warnings,
    query: r.query,
    chainId: r.chainId,
    candidates: r.candidates.map((c) => {
      const { label: _label, ...rest } = c;
      return keepsLabel(c) ? { ...rest, label: 'most liquid' as const } : rest;
    }),
    sources: r.sources,
    omitted: r.omitted,
    basis: r.basis,
  };
}

export async function findTokenTool(a: FindArgs, d: FindDeps) {
  if (resolveSources(a.sources) !== 'centralized') return onchainDiscovery(a);
  const r = await findToken({ query: a.query, chainId: a.chainId, sources: 'centralized', rpc: d.rpc, client: d.client, reader: d.reader, fetch: d.fetch });
  return present(r);
}
