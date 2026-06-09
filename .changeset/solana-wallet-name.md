---
"@alien-id/sso-solana": minor
"@alien-id/sso-solana-react": minor
---

Add optional `walletName` argument to `generateDeeplink`. When provided, it is sent as `wallet_name` in `POST /solana/link` and embedded in the signed deeplink so the Alien app can display the source wallet (e.g. phantom, solflare). Backward compatible — omitting it behaves as before.
