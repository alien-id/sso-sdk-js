# 1. Fresh proof-of-possession gates Solana auth

Date: 2026-06-01

## Status

Accepted

## Context

The Solana SSO SDK treated the **existence** of an on-chain
[attestation](../../CONTEXT.md#attestation) as proof of authentication. On modal open,
`getAttestation()` returning truthy immediately flipped the UI to authenticated and skipped
the entire signing ceremony (`SolanaSignInModal.tsx:94-101`); `verifyAttestation` did the
same and additionally trusted a 60s localStorage cache before any server check
(`AlienSolanaSsoProvider.tsx:154-170`). No fresh-signature primitive existed anywhere in
`solanaCore`/`solanaReact`.

This is audit finding **F-06**. An attestation proves a historical
[binding](../../CONTEXT.md#binding) (wallet ↔ identity); it does **not** prove the present
holder controls the wallet's private key. Anything that can influence the wallet address
the SDK reads (XSS, a malicious extension, or a dApp that takes the address from a URL/form
/API) could get auto-authenticated. Scope is bounded to the single platform provider
(`SolanaProviderAddress`), so the audit rates it Low/Medium — but the SDK pattern is wrong.

## Decision

Authentication requires a fresh **[Proof-of-Possession](../../CONTEXT.md#proof-of-possession)**.
The existence of an attestation, and any localStorage cache, may streamline the flow but
**never** grant auth on their own.

- A new SDK primitive performs: server-issued [nonce challenge](../../CONTEXT.md#nonce-challenge)
  → wallet `signMessage` → server Ed25519 verify against the connected pubkey.
- PoP gates **only** the attestation-exists short-circuit. The full QR/oracle ceremony is
  unchanged because it already ends with the wallet signing the create-attestation
  transaction — itself a fresh possession proof.
- `verifyAttestation` is downgraded to **binding-info-only**: it may report the
  [session address](../../CONTEXT.md#session-address) for display but no longer sets
  `auth.sessionAddress`. The localStorage grace path no longer authenticates.
- The nonce is **stateless** — made unforgeable and time-bound by an HMAC-SHA256 MAC over
  `random · expiry` (no new table/migration). The MAC key is **not** the deeplink-signing key
  directly: it is an HKDF-SHA256 subkey derived from that key's seed under a PoP-specific info
  label (`alien-sso/solana-pop/mac/v1`), so the nonce MAC has its own key and never shares one
  secret across two cryptographic purposes. It is not hard single-use: what defeats F-06 is
  requiring a fresh wallet signature an address-spoofer cannot produce; a short TTL over TLS
  bounds replay.
- Scope is strictly Solana. The OAuth/`/sso` middleware (including the `Origin`-empty
  defense-in-depth gap, F-06 addendum (a)) is deliberately **not** touched here.

## Consequences

- **Security:** existence-only and cache-only auth bypasses are closed. Passing a
  non-wallet-adapter-sourced address into `verifyAttestation` can no longer authenticate.
- **UX:** a returning user clicks "Sign in" and approves one `signMessage` per session
  (fast path — no QR when an attestation already exists). The previous silent auto-auth is
  intentionally gone.
- **Contract change (not reversible cheaply):** consumers relying on `verifyAttestation`
  to set auth state, or on cross-reload localStorage auth survival, must move to the PoP
  flow. Documented in JSDoc and the package README.
- **Wallet support:** the wallet adapter must expose `signMessage` (now surfaced in
  `SolanaWalletAdapter`). Its absence is handled per path, not by a single blanket
  fallback:
  - **No attestation (new wallet):** the full QR/oracle ceremony runs and needs no
    `signMessage` — the create-attestation transaction signature is itself the fresh
    possession proof.
  - **Attestation exists (returning wallet) but no `signMessage`:** the fast path cannot
    produce a PoP, and we deliberately do **not** fall through to the QR/oracle ceremony —
    that path re-runs `session_registry`'s non-idempotent `init` against the already-existing
    attestation PDA, which always reverts and permanently locks the user out. The modal surfaces
    a clear "wallet not supported" error instead.
- The `Origin`-empty middleware gap remains open as a separate, non-Solana ticket.
