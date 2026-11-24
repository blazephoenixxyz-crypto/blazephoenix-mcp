// find_token: candidates for a name or ticker, from @blazephoenix/sdk/find, read through the user's own RPC.
//
// The SDK produces everything (one producer): the addresses the two indexes propose, what each
// candidate's contract says about itself, the depth the Quoter measures, the liquidity the venues
// hold, the order, the label and the warnings. This module only presents it, and adds what an agent
// most needs to read: no candidate is chosen. A second check here can only take the label away.
import { findToken, type FindReader, type FindTokenResult } from '@blazephoenix/sdk/find';
import type { BlazePhoenix, RpcSource } from '@blazephoenix/sdk';

export const NO_CHOICE = 'No candidate is chosen and none is selected for a swap. A ticker does not identify a token: '
  + 'to quote or build a swap, pass the 0x address you verified yourself (xray_token measures one candidate).';

export type FindArgs = { query: string; chainId: number };
/** `rpc` and `client` in the server; `reader` and `fetch` replace the chain and the indexes in tests. */
export type FindDeps = { rpc?: RpcSource; client?: BlazePhoenix; reader?: FindReader; fetch?: typeof fetch };

/** The label "most liquid" stays only on rank 1, and only when its depth was MEASURED. */
const keepsLabel = (c: FindTokenResult['candidates'][number]) =>
  c.label === 'most liquid' && c.rank === 1 && c.depth.status === 'MEASURED';

export function present(r: FindTokenResult) {
  return {
    choice: NO_CHOICE,
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
  const r = await findToken({ query: a.query, chainId: a.chainId, rpc: d.rpc, client: d.client, reader: d.reader, fetch: d.fetch });
  return present(r);
}
