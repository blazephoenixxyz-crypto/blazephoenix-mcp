# Changelog

## Unreleased

- `find_token`: candidates for a name or ticker on one chain, from `findToken` of
  `@blazephoenix/sdk/find` (1.8.0), read through your own RPC. Two third-party indexes (CoinGecko,
  Dexscreener search) only propose addresses; code, symbol, name, decimals, the look-alike warning,
  the depth the Quoter measures and the venue liquidity are read on your node, with what was
  `NOT_MEASURED` and why. Candidates are ranked by measured depth; only rank 1 with a `MEASURED`
  depth keeps the label "most liquid", never "official". No candidate is chosen or selected for a
  swap, and the fixed warnings ("N tokens use this ticker; impostors copy tickers; do your own
  research", "liquidity is not safety") come verbatim. A failing index is listed by name.
- `find_token` `sources`: `"onchain"` by default (on-chain discovery, not available yet: it answers
  `onchain_discovery_unavailable`, reads nothing and says how to opt in); the CoinGecko and Dexscreener
  indexes only with `sources: "centralized"`, labelled as centralized in `candidateSource`. An unknown
  value is refused by the schema.
- `@blazephoenix/sdk` ^1.8.0.

## 1.3.0

- `xray_token`: the token X-Ray of `@blazephoenix/sdk/xray` (1.6.0), run through your own RPC on a
  pinned block. It reports the measured taxes in bps, the amounts, the block, the tier the node
  allowed and the conditions, and lists what was not measured and why. A rate-limited or
  unavailable node is `NOT_MEASURED`; `MEASURED` is shown only when every instrument measured.
  `maxTaxBps` is required.
- `@blazephoenix/sdk` pinned to 1.6.0.

## 1.2.0

- Token text: every character a reader cannot see is removed by Unicode property (control,
  format, default-ignorable), not from a list. U+061C (Arabic letter mark), the soft hyphen,
  word joiners and variation selectors no longer pass through.
- Every error a tool returns is cleaned the same way (printable, one line) and capped at 400
  characters: a revert reason chosen by a token reaches the agent as text, never as layout.
- Every string a tool returns, under any key and at any depth (arrays included), goes through the
  same cleaning, decided by what the string holds rather than by the name of its key. A lone
  surrogate is removed too, and a capped text never ends in half a character. Line feed and tab
  are kept; addresses, calldata and numbers come back unchanged.
- BZPX: coming soon. Every tool refuses the `BZPX` ticker before any SDK call or RPC, with
  the SDK's message ("BZPX: coming soon — the token address is not published yet; pass a
  token address"); tool descriptions no longer list it as built in.
- Proof-of-solvency: coming soon. `check_solvency` reads no contract and has no default
  chain: it answers `coming_soon` as an error result, never a verdict. This supersedes the
  1.1.3 note on `check_solvency`. The README drops the solvency badge.

## 1.1.3 — what a tool returns is what it says

- Requires `@blazephoenix/sdk` 1.2.1: `get_quote` with `exact: true` reports `exactOut` net of the
  protocol fee on a 1.x Quoter, and `quoterOut` as the Quoter returned it.
- `get_quote` with `exact: true` returns the Phoenix Check `checks`, taken from the default
  quote of the same request, next to `exactOut`.
- `simulate_swap` answers `ok: false` with code `simulation_reverted` when the simulated swap
  reverts; the revert text is cleaned (printable, one line) and capped, since a token chose it.
- `amount` and `amountIn` in the same call are refused (`bad_request`) instead of one silently
  winning.

## 1.1.2 — protocol version pin

- New optional variable `BLAZEPHOENIX_VERSION`, passed to the SDK as the protocol version pin
  (`latest`, `1`, `2` or a full version such as `2.0.0`). Without it every call resolves
  `latest`, as before. Documented in the README.
- An invalid value stops the server at start with a clear error instead of being ignored.
- Tests: an invalid pin is refused, and a pin to a version not yet deployed refuses the swap
  that `latest` builds.

## 1.1.1 — version drift fixed

- The server, `gemini-extension.json` and the Claude plugin manifest now announce the package
  version (1.1.0 announced 1.0.1). The test suite checks that all of them match `package.json`.
- No change to tools or behaviour.

## 1.1.0 — the minimum rules of `@blazephoenix/sdk` 1.2.0

- Requires `@blazephoenix/sdk` `^1.2.0`.
- `build_swap` and `simulate_swap` take `exact: true`: the minimum comes from
  `previewPlanExact` read in the same block as the route, with a fixed 50 bps safety margin
  and then `slippageBps` off it, never below the default minimum.
- A `userMinOut` is the minimum the transaction carries, as given. One below the quote net of
  `slippageBps` (or the on-chain floor) comes back as `min_implausible`; with `exact: true`,
  one above `exactOut` less the margin comes back as `min_above_exact`. These match the rules
  of the site's `/api/quote/decode`.
- `check_solvency` answers `not_deployed` where no staking engine is registered (Base
  included, until one is). The README and the skill no longer name a staking address.
- The test suite now drives `build_swap` and `check_solvency` against a local JSON-RPC node.
