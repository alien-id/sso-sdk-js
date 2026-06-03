# Solana SSO — Integration Guide

Alien's Solana SSO is a **web3 identity-verification primitive**, not an auth system.
It tells you which Alien identity a wallet belongs to and issues no token of its own:

| Alien gives you | You provide |
| --- | --- |
| **Identity** — `wallet → session_address` (the owner Alien ID) | **Possession proof** (your nonce + Ed25519 verify) |
| **Binding** — the on-chain wallet ↔ Alien ID enrollment | The **session** (your JWT / cookie / whatever) |

`session_address` is the owner Alien ID — the *same* identity key the regular
[OIDC SSO](https://dev.alien.org/docs) issues as `sub`. So a wallet binding and a
regular Alien login resolve to the same identity, with no extra glue.

> **Proof-of-possession is yours, not ours.** Proving the connected wallet's holder
> controls the private key is standard Ed25519 over a nonce *you* choose — it needs no
> Alien secret and no Alien call. Your backend issues the nonce and verifies the
> signature. Alien only answers "which Alien identity is this wallet?" — the part you
> can't do alone.

## What Alien provides

| Layer | Question | Endpoint | SDK (`@alien-id/sso-solana`) | Provider-gated |
| --- | --- | --- | --- | --- |
| **L0 Bind** | link wallet ↔ Alien ID (one-time enrollment) | `/solana/link`, `/solana/poll`, `/solana/callback/*` | `generateDeeplink`, `pollAuth`, `buildCreateAttestationTransaction` | yes |
| **L1 Lookup** | which Alien ID is this wallet bound to? | `/solana/attestation` | `getAttestation` | yes |

Provider-gated endpoints require an `X-PROVIDER-ADDRESS` header (your registered
provider); the SDK sets it from the `providerAddress` you pass.

**You own proof-of-possession.** The SDK ships two pure, dependency-free helpers so it's
turnkey without Alien in the path:
- `buildPopMessage(wallet, nonce)` — the message your frontend asks the wallet to sign.
- `verifyPopSignature(wallet, message, signature)` — standard Ed25519, run in *your*
  backend. No network call.

## Step 0 — Enrollment (L0), once per wallet, ever

Run only if the wallet isn't bound yet (check L1 first). The user must have the
**Alien app**, and pays rent for the on-chain attestation.

1. Wallet connected in your app. `generateDeeplink(wallet)` → `/solana/link` → QR / deeplink.
2. User scans with the **Alien app**; the app + oracle co-sign the binding.
3. Frontend polls `pollAuth(code)` → `/solana/poll` until `authorized`.
4. User signs + sends the create-attestation transaction (`buildCreateAttestationTransaction`).
5. On confirmation, `wallet ↔ Alien ID` exists on-chain — permanently.

The bind transaction is itself a possession proof (only the wallet holder can sign it),
so enrollment needs no separate PoP.

## Step 1 — Authenticate a returning wallet (your backend)

```
Frontend (Alien SDK)              Your backend                      Alien SSO
--------------------              ------------                      ---------
connect wallet
GET your nonce ◀───────────────── issue nonce (random, stored/MAC'd)
signMessage(buildPopMessage(wallet, nonce))
POST {wallet, nonce, signature} ─▶ verifyPopSignature(wallet, msg, sig)   (local, no Alien)
                                   getAttestation(wallet) ──────────▶ POST /solana/attestation
                                      (X-PROVIDER-ADDRESS)               → session_address | 404
                                   if signature ok && session_address:
                                      mint YOUR session (sub = session_address)
                                      Set-Cookie: httpOnly  ◀──
later requests: your cookie ─────▶ verify your session (no wallet popup)
```

You now KNOW: the holder controls `wallet`, and `wallet` is Alien identity
`session_address`. Prove once, reuse the session — never sign per request.

`getAttestation` (L1) is **information only**: a truthy result proves a historical
binding, never current control. Pairing it with *your* possession proof is what makes it
authentication. Treating "binding exists" as "signed in" is the F-06 vulnerability.

## Step 2 — Do whatever you want with the verified result

- **(a) Issue your own session token** — recommended; the flow above. Sign once → server
  session → reuse.
- **(b) One-shot gate** — sybil-resistant claim / "verified human" check: verify once,
  let the action through, store nothing.
- **(c) Per-action PoP** — re-verify before a single high-value action only; it's a
  wallet popup each time, so never use it as default per-request auth.

> **SIWS:** you don't need a separate library, but you may use one — your PoP message and
> nonce are entirely yours. Either way: identity from Alien (L1), possession + session
> from you.

## React quick-start (enrollment widget)

`@alien-id/sso-solana-react` wraps L0 + L1 in a drop-in component for the **bind
ceremony** and a binding hint. It is an *enrollment + lookup* widget, **not** an auth
system — it does not establish a session. Establish auth in your backend (Step 1).

```tsx
<AlienSolanaSsoProvider config={{ ssoBaseUrl, providerAddress }}>
  <SolanaSignInButton />        {/* opens the modal; runs the L0 bind ceremony */}
</AlienSolanaSsoProvider>
// verifyAttestation() from useSolanaAuth() is L1 only — a UI hint
// ("wallet already linked"); it never authenticates.
```

## Endpoint reference

| Method | Path | Gated | Purpose |
| --- | --- | --- | --- |
| POST | `/solana/link` | yes | start enrollment; returns signed deeplink + polling code |
| POST | `/solana/poll` | yes | poll enrollment; returns oracle signature on success |
| POST | `/solana/callback/{code}` | no | Alien app delivers oracle signature |
| POST | `/solana/attestation` | yes | L1 lookup: wallet → `session_address` (404 if unbound) |

Proof-of-possession has **no Alien endpoint** — it runs entirely in your backend.
