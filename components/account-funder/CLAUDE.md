## Account Funder
- Route: `app/(tools)/account-funder/page.tsx`
- Panel: `components/account-funder/AccountFunderPanel.tsx`
- **Purpose**: Generate N new Stellar keypairs and fund them in one step from a parent account
- **Parent**: existing saved wallet (picker) OR freshly generated keypair
- **Children**: N new accounts created by the parent via `createAccount`
- **Three creation modes**: Direct (parent pays reserve), Sponsored (begin/end sponsoring), Close (close sponsorship)
- **Network**: from `useSettings()` — `resolveNetworkPassphrase(settings.network)` (NOT the whole `settings` object)
- Save parent + all children to one Asset Group on completion
- Keys generated client-side in browser
