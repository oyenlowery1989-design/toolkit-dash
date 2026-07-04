# Stellar Toolkit

A personal power-user dashboard for the Stellar blockchain. Built with Next.js (App Router), SQLite (local) / Supabase (cloud), and the Stellar SDK.

---

## What it does

Full analysis, payment, and asset-lifecycle toolkit organized in a sidebar:

### Analysis
| Module | Description |
|---|---|
| **Asset Lookup** | Look up any Stellar asset — issuer info, supply, holders, home domain, ancestry tracing |
| **Asset Sales** | XLM proceeds analysis for a single asset's distributor(s) |
| **Bulk Asset Sales** | Same analysis for a list of assets in one scan |
| **Account Investigator** | Full account profile — balances, top senders/receivers, payment history |
| **Intermediary Tracer** | Trace the real creator of an account through known intermediaries |
| **Transaction Explorer** | Browse and decode raw Stellar transactions |

### Payments
| Module | Description |
|---|---|
| **Single Payment** | Multi-leg payments with path finding, claimable balances, fee bump |
| **Bulk Payments** | Send XLM/assets to hundreds of recipients in batched transactions |
| **Ghost Payments** | Minimal-value payments with memo — on-chain proof of eligibility/signature |
| **Account Funder** | Generate N keypairs and fund them from a parent account |
| **Auto-Send Groups** | Scheduled proportional XLM distribution groups (cron scheduler) |
| **Tiered Rewards** | Per-holder reward distribution based on asset balance tiers |
| **Wallet Balances** | Live XLM balance across all saved wallets; filter by folder or group |

### Asset Lifecycle
| Module | Description |
|---|---|
| **Asset Creator** | 4-step wizard: accounts → config → preflight → issue; auto-saves to Asset Groups |
| **Token Control** | Set AUTH_REQUIRED / AUTH_REVOCABLE / AUTH_CLAWBACK flags; freeze/unfreeze holders |
| **Trustline Manager** | Add/remove trustlines (single or bulk matrix); drain before remove; offer cancel |
| **Soroban Contracts** | Wrap a classic asset with a Stellar Asset Contract (SAC) |

### DEX
| Module | Description |
|---|---|
| **DEX Orderbook** | Live bid/ask tables, stats cards, depth chart for any trading pair |

### My Data
| Module | Description |
|---|---|
| **Address Book** | Personal notes and labels for Stellar addresses |
| **Asset Groups** | Group addresses by role (issuer, distributor, bank, etc.) per asset |
| **Saved Analyses** | Auto-saved asset proceeds results with cross-asset destination aggregation |
| **Search History** | Recent account lookups |

### Tools
| Module | Description |
|---|---|
| **My Wallet** | Connected wallet overview — balances, offers, trustlines, payment history, merge |
| **Address Generator** | Vanity keypair generator (Web Worker, client-side only) |
| **Wallet Manager** | Folders + wallets + connect/disconnect; secret keys stored in SQLite |

---

## Quick Start (local)

**Prerequisites:** Node.js 20+

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No auth required for local dev — SQLite is created automatically at `stellar-toolkit.db` in the project root.

---

## Environment Variables

See `.env.example` for the full list and comments. The only required vars for local dev are none — it works out of the box with SQLite.

For Vercel deployment, set:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL (server-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side) |
| `NEXT_PUBLIC_SUPABASE_URL` | Same URL (client-side, for auth) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client-side) |
| `DB_PROVIDER=supabase` | Switches storage from SQLite to Supabase |

---

## Architecture

```
app/                    Next.js App Router pages
  (analysis)/           Analysis modules
  (tools)/              Payment + tool modules
  (data)/               My Data modules
  (config)/             Settings
  api/db/               DB CRUD API routes (SQLite ↔ Supabase dual-write)

components/             Panel components (one per module)
hooks/                  React hooks — DB-backed caches (createDbCache pattern)
lib/
  navigation.ts         Sidebar menu definition
  db.ts                 SQLite schema + query helpers
  db-client.ts          createDbCache<T>() — React hook factory for DB tables
  settings.ts           App-wide settings (network, Horizon URL)
  format.ts             formatXlm(), shortAddr(), parseAddresses()
  asset-groups/         Asset group types + constants
  bulk-payments/        Bulk payment builder + runner
  auto-send/            Auto-send scheduler + runner
```

### Storage

- **Local dev:** SQLite (`stellar-toolkit.db`) — all data stays on your machine.
- **Vercel:** Supabase — ephemeral filesystem means SQLite can't persist; set `DB_PROVIDER=supabase`.
- Secret keys are stored in the local SQLite DB. This is a single-user personal tool — do not expose it publicly without adding authentication.

### Data hooks pattern

Every persistent data type uses `createDbCache<T>()` from `lib/db-client.ts`:

```ts
const _cache = createDbCache<WalletEntry>();

export function useWalletsV2() {
  const [wallets, setWallets] = useState(_cache.get());
  useEffect(() => { _cache.subscribe(setWallets); _cache.load("/api/db/wallets-v2"); }, []);
  // optimistic writes via dbPost/dbPatch/dbDelete
}
```

All components reading the same cache share one in-memory state — no prop drilling.

---

## Networks

Switchable in Settings:
- **Public (mainnet)** — `https://horizon.stellar.org`
- **Testnet** — `https://horizon-testnet.stellar.org`
- **Futurenet**
- **Custom Horizon URL**

---

## Rules for contributors

See `CLAUDE.md` for the full ruleset. Key points:
- Never modify a working signed-off module while fixing another.
- Never force-uppercase Stellar asset codes.
- Always use `/accounts/{address}/payments` — never `?account=` query param form.
- All persistent data goes in SQLite/Supabase — never localStorage for new features.
- Display all Stellar addresses as `GABC…WXYZ` via `ShortAddress` component.
