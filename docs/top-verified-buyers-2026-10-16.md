# Top Verified Buyers — verification

Implemented in `components/asset-sales/TopVerifiedBuyers.tsx` and `lib/proceeds-investigator/top-buyers.ts`, with a small integration beside Top Holders in Asset Sales. No database migration, persistent user-data writes, new dependencies, transaction submission or production publication.

## Behavior

- On-demand ranking for a single exact asset code and issuer, sorted by XLM spent using integer stroops. Controls: 7 days, 30 days, all available history.
- Each buyer shows XLM spent, tokens bought, average XLM/token, distinct purchase-operation count, latest date and transaction evidence. A path recipient is shown separately when different from its payer.
- Only successful, identity/date/hash-matched operation evidence qualifies. Native-side makers are counted by their actual fills; path sources are counted once at verified native-XLM source and target-asset final endpoints. An intermediate XLM conversion from another asset does not qualify as XLM-funded buying.
- Four proof requests in flight, promise cache per operation, full pagination and trade deduplication across pair orientations. Invalid pagination/amounts fail explicitly; unavailable evidence is excluded and reported.
- Results stream while checking; stopped/error results remain explicitly partial. New assets/networks cancel and reset their own check. Buyer checks do not gate Run Analysis or mutate holders/distributors/saved sales.
- Coverage limitations remain visible even with details collapsed. All history means retained Horizon history, not proven complete asset lifetime.

## TRSY public-data check

Captured **2026-10-16T16:49:01.997Z** for exact `TRSY:GDAHP47TPZVR3CX45GAHLRJOOY6QV23HYSSVJ4NGR3P33ULLLJMST2KJ`.

The actual implementation made 1,555 public GET requests in 88.9 seconds. Subsequent 30-day/7-day recomputations used the same captured responses and cutoff timestamp. No transaction endpoints or authenticated writes were called.

| Window | Trades checked | Verified buyers | Excluded |
|---|---:|---:|---:|
| All available | 1,614 | 817 | 7 |
| 30 days | 1,614 | 817 | 7 |
| 7 days | 302 | 117 | 0 |

The seven exclusions are real paths whose source asset was SCOP, XRP or SGB, passing through XLM before delivering TRSY. Counting those intermediate fills as XLM investment would misclassify their funding asset. They remain excluded; other operations are verified independently.

Top observed all-history buyer: `GAA4…D2LV`, 10,006.0000000 XLM across five purchase operations. Top 7-day buyer: `GDGY…X3KD`, 1,622.0251055 XLM across ten purchase operations. These are historical spending figures, not proof of wealth or independent beneficial ownership.

Reproducible public proof sample: `tests/fixtures/proceeds/trsy-verified-buyers.json` contains nine genuine top-buyer fills plus all seven intermediate-XLM exclusions and their operation evidence. `top-buyers-real-trsy.test.ts` checks the three sample buyer totals and exclusions. Full live captures remain outside the repository in `/tmp/trsy-top-buyers-live-{responses,results}.json`; the optional browser replay checks exact ranking, all filters and evidence links against that same capture.

## Review and regression checks

- Independent Astra review covered attribution, path deduplication, money precision, pagination, cancellation and UI honesty. Its coverage-visibility finding was fixed with a persistent summary label.
- Browser regressions caught and fixed duplicate React sibling keys (which interfered with holder reset) and page-level proof prefetch delaying partial results. The new buyer code now has its own key; completed purchases stream without waiting for a stalled peer request.
- Focused tests cover source vs recipient, direct/maker/path purchases, wrong asset/issuer, self-trades, transfers/unsupported operations, malformed or missing proof, window edges, precision, pagination, abort, concurrency and stale-result isolation.

## Limits

This ranks verified classic XLM-market purchases discoverable through that pair. Other pairs, OTC payments and standalone contract swaps are not exhaustively discovered. Prior asset history outside Horizon retention is unproven. Current holdings and subsequent sales are separate analyses and are not used to infer buying or wealth here.
