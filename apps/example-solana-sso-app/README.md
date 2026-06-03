# Alien Solana SSO Example dApp

⚠️ **Alpha Version Notice**: This is an early alpha version of the Alien SSO SDK. The SDK is under active development and may contain bugs or undergo breaking changes.

This example shows how to use Alien's Solana SSO as the **identity-verification
primitive** it is — and where the integrator's responsibilities begin.

- **Frontend** (`src/`): runs the **L0 bind ceremony** (enroll a wallet → Alien
  ID via the `SolanaSignInButton` modal) and the **L1 lookup**
  (`verifyAttestation`, a UI hint only).
- **Backend** (`server/index.mjs`): does the part that is *not* Alien's — it
  issues its own nonce, verifies the wallet's Ed25519 signature with
  `verifyPopSignature` (no Alien call), looks up the binding (L1), and mints its
  own **httpOnly session cookie**. This is the only source of "signed in" truth.

See [`docs/solana-integration.md`](../../docs/solana-integration.md) and ADR-0002
for the rationale.

## Setup

```bash
cp .env.example .env
# set VITE_ALIEN_PROVIDER_ADDRESS to a provider registered on the dev devportal
```

Use Phantom on **Devnet**. `localhost` origins are auto-allowed by the provider
middleware on dev.

## Run

```bash
npm run dev
```

This starts **both** processes via `concurrently`:

- `web` — the Vite frontend on http://localhost:3000
- `api` — the example backend on http://localhost:8787 (Vite proxies `/api/*` to it)

Run them separately if you prefer: `npm run server` and `vite`.

## The flow

1. **Connect** a Solana wallet.
2. If the wallet **isn't linked** yet → enroll it with the **Alien App** (the
   modal's QR/oracle ceremony). This is a one-time on-chain binding, not a login.
3. If the wallet **is linked** → click **Sign in**. The frontend signs
   `buildPopMessage(wallet, nonce)` and posts it to the backend, which verifies
   the signature, confirms the binding (L1), and sets a session cookie.
4. **Welcome** is gated on that backend session (`GET /api/me`), never on a
   client-side flag.

## Backend endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/nonce` | issue a single-use, short-lived nonce |
| POST | `/api/verify` | verify possession + L1 lookup → set httpOnly session |
| GET | `/api/me` | read the current session |
| POST | `/api/logout` | clear the session |

> The store is in-memory and single-process — fine for a demo, not for
> production.
