# Changelog

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
