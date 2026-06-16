---
"@alien-id/sso-solana": minor
"@alien-id/sso-solana-react": minor
---

Add optional `walletIcon` argument to `generateDeeplink`. When provided, it is sent as `wallet_icon` in `POST /solana/link` and embedded in the signed deeplink so the Alien app can display the source wallet's icon. Backward compatible — omitting it behaves as before.
