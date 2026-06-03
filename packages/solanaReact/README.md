# @alien-id/sso-solana-react

React hooks and components for [Alien SSO](https://alien.org) Solana identity. Built on top of [@alien-id/sso-solana](https://www.npmjs.com/package/@alien-id/sso-solana) with Solana wallet adapter integration.

## ⚠️ Alpha Version Notice

**This is an early alpha version.** The SDK is under active development and may contain bugs or undergo breaking changes. Use with caution in production environments.

## What this is (and is not)

Alien's Solana SSO is a **web3 identity-verification primitive, not an auth
system.** This package is a drop-in widget for the two things only Alien can
provide:

- **L0 — Bind:** a one-time on-chain enrollment that links a wallet to an Alien
  ID (the sign-in modal's QR/Alien-app ceremony).
- **L1 — Lookup:** `verifyAttestation(wallet)` → the `session_address` (owner
  Alien ID) the wallet is bound to, or `null`.

It **never establishes a session and holds no "signed in" state.**
Proof-of-possession, sessions, and tokens belong to **your backend** (or the
regular [OIDC SSO](https://dev.alien.org/docs)). See
[ADR-0002](https://github.com/alien-id/sso-sdk-js) and the
[integration guide](https://github.com/alien-id/sso-sdk-js/blob/main/docs/solana-integration.md).

## Installation

```bash
npm install @alien-id/sso-solana-react @solana/web3.js @solana/wallet-adapter-react
```

## Quick start (enrollment + lookup widget)

```tsx
<AlienSolanaSsoProvider config={{ ssoBaseUrl, providerAddress }}>
  <SolanaSignInButton />   {/* opens the modal; runs the L0 bind ceremony */}
</AlienSolanaSsoProvider>
```

```ts
const { verifyAttestation, openModal } = useSolanaAuth();

// L1 lookup — a UI hint only ("this wallet is linked"). It does NOT sign anyone in.
const sessionAddress = await verifyAttestation(wallet); // string | null
```

## Enrollment flow (L0) — once per wallet, ever

Run only for a wallet that is not bound yet (check L1 first). The user needs the
**Alien App** and pays rent for the on-chain attestation.

1. User **connects wallet** via the Solana wallet adapter and clicks **Sign In**.
2. Modal opens with a **QR code** / deep link.
3. User scans with the **Alien App**; the app + oracle co-sign the binding.
4. The SDK **polls** for authorization, then builds the **create-attestation
   transaction**.
5. User **signs and sends** it — the transaction signature is itself the
   possession proof, so no separate signed nonce is needed.
6. On confirmation, the `wallet ↔ Alien ID` binding exists on-chain,
   permanently. The modal reports success; **it does not authenticate.**

If the wallet is already bound, the modal skips the ceremony and simply reports
that the wallet is linked.

## Authenticating a returning wallet is YOUR backend's job

`verifyAttestation()` (L1) reports the **historical wallet→identity binding
only**. It performs **no signature check**, **never sets auth state**, and
**never signs the user in**. A truthy result proves the wallet was linked at
some point — it proves **neither** current possession of the private key **nor**
a live session. Treating "a binding exists" as "signed in" is exactly the F-06
vulnerability this design prevents: an attacker could pass any address (from a
URL, form, or API response) and otherwise appear authenticated.

To authenticate, your backend proves possession itself and then mints its own
session, using the pure helpers from `@alien-id/sso-solana`:

```
Frontend (this SDK)                Your backend                       Alien SSO
-------------------                ------------                       ---------
connect wallet
GET your nonce  ◀───────────────── issue nonce (random, stored/MAC'd)
signMessage(buildPopMessage(wallet, nonce))
POST {wallet, nonce, signature} ─▶ verifyPopSignature(wallet, msg, sig)   (local, no Alien)
                                   getAttestation(wallet) ───────────▶ POST /solana/attestation
                                   if signature ok && session_address:
                                      mint YOUR session (sub = session_address)
                                      Set-Cookie: httpOnly  ◀──
later requests: your cookie ─────▶ verify your session (no wallet popup)
```

`buildPopMessage` and `verifyPopSignature` ship in the core SDK and make no Alien
call — see [@alien-id/sso-solana](https://www.npmjs.com/package/@alien-id/sso-solana)
and the [integration guide](https://github.com/alien-id/sso-sdk-js/blob/main/docs/solana-integration.md).
Because `session_address` is the same identity key the regular OIDC SSO issues as
`sub`, a wallet binding and a regular Alien login resolve to the same identity —
so you may also authenticate via the OIDC SSO and treat the wallet as a bound
attribute, with no extra glue.

## API

`useSolanaAuth()` returns:

| Member | Purpose |
| --- | --- |
| `verifyAttestation(wallet)` | L1 lookup → `session_address \| null`. Lookup only — never authenticates. |
| `openModal()` / `closeModal()` / `isModalOpen` | Control the enrollment modal. |
| `generateDeeplink` / `pollAuth` / `client` | Lower-level access to the L0 ceremony. |
| `wallet` / `connectionAdapter` | The connected wallet adapter and RPC connection. |

> **Removed in 3.0:** `auth.sessionAddress`, `logout()`, and the modal's
> proof-of-possession fast-path. The modal no longer holds auth state, because a
> client-side flag was never a real security boundary. Move authentication to
> your backend (above).

## Custom Styling

The SDK includes default styles, but you can customize them:

```tsx
import '@alien-id/sso-solana-react/dist/style.css'; // Optional: Import default styles

// Override with your own CSS
.alien-solana-sso-button {
  background: your-color;
  /* ... */
}
```

## TypeScript Support

```typescript
import type {
  AlienSolanaSsoClientConfig,
  SolanaLinkResponse,
  SolanaPollResponse
} from '@alien-id/sso-solana';
```

## Peer Dependencies

- `react` ^19.1.1
- `react-dom` ^19.1.1
- `@solana/web3.js` - Solana blockchain interaction
- `@solana/wallet-adapter-react` - Solana wallet adapter

## Getting a Provider Address

Register your application at the [Developer Portal](https://dev.alien.org/dashboard) to get your provider credentials.

## Browser Support

- Modern browsers with ES2020+ support
- Chrome, Firefox, Safari, Edge (latest versions)

## License

MIT

## Links

- [Documentation](https://dev.alien.org/docs)
- [GitHub Repository](https://github.com/alien-id/sso-sdk-js)
- [NPM Package](https://www.npmjs.com/package/@alien-id/sso-solana-react)
- [Core SDK](https://www.npmjs.com/package/@alien-id/sso-solana)
