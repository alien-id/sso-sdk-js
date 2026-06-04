---
"@alien-id/sso-solana": major
"@alien-id/sso-solana-react": major
---

Reposition Solana SSO as an identity-verification primitive (L0 Bind + L1 Lookup); proof-of-possession, sessions, and tokens now belong to the integrator's backend.

**Why:** A binding (`wallet → session_address`) proves a historical link, never current control of the wallet. Treating it — or any client-side flag — as "signed in" is the F-06 vulnerability. Proof-of-possession is plain Ed25519 over a nonce the integrator chooses; it needs no Alien call, so it belongs in the integrator's backend (or the regular OIDC SSO, which keys on the same `session_address`). See ADR-0002.

**Breaking changes**

`@alien-id/sso-solana`:

- **Removed** `AlienSolanaSsoClient.requestNonce()` and `verifyPossession()` (they called dropped Alien endpoints `/solana/nonce` and `/solana/nonce/verify`).
- **Removed** schemas/types `SolanaNonceResponse(Schema)`, `SolanaNonceVerifyRequest(Schema)`, `SolanaNonceVerifyResponse(Schema)`.
- **Added** `verifyPopSignature(wallet, message, signature)` — pure local Ed25519 verification for your backend (no Alien call). Complements the existing `buildPopMessage`.

`@alien-id/sso-solana-react`:

- **Removed** `auth.sessionAddress` and `logout()` from `useSolanaAuth()`; the provider no longer holds any auth/session state.
- **Removed** the sign-in modal's proof-of-possession fast-path for returning wallets. The modal is now an **enrollment + lookup** widget: it runs the L0 bind ceremony and reports an existing binding, but never establishes a session.
- `verifyAttestation()` remains **lookup-only** (L1) and never authenticates.

**Migration:** Move authentication to your backend — issue your own nonce, verify the wallet signature with `verifyPopSignature`, call `getAttestation` (L1) for the bound identity, then mint your own session (`sub = session_address`). See `docs/solana-integration.md`.
