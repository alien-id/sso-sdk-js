# @alien-id/sso-solana

Solana client for [Alien SSO](https://alien.org) — a **web3 identity-verification
primitive, not an auth system.** It answers *"which Alien identity is this
wallet?"* and issues no token of its own.

## ⚠️ Alpha Version Notice

**This is an early alpha version.** The SDK is under active development and may contain bugs or undergo breaking changes. Use with caution in production environments.

## What Alien provides

| Layer | Question | SDK |
| --- | --- | --- |
| **L0 — Bind** | link wallet ↔ Alien ID (one-time enrollment) | `generateDeeplink`, `pollAuth`, `buildCreateAttestationTransaction` |
| **L1 — Lookup** | which Alien ID (`session_address`) is this wallet bound to? | `getAttestation` |

**Proof-of-possession, sessions, and tokens are yours, not Alien's.** Proving the
holder controls the wallet is standard Ed25519 over a nonce *you* choose — no
Alien call, no Alien secret. The SDK ships two pure helpers so it is turnkey in
your backend; see the [integration guide](https://github.com/alien-id/sso-sdk-js/blob/main/docs/solana-integration.md)
and [ADR-0002](https://github.com/alien-id/sso-sdk-js).

## Installation

```bash
npm install @alien-id/sso-solana @solana/web3.js
```

## Features

- ✅ **On-chain attestations** - L0 bind ceremony + L1 binding lookup
- ✅ **Proof-of-possession helpers** - `buildPopMessage` + `verifyPopSignature` (pure Ed25519, no Alien call)
- ✅ **PDA derivation utilities** - All necessary account derivations
- ✅ **Transaction building** - Ready-to-sign attestation transactions
- ✅ **TypeScript-first** with full type safety
- ✅ **Runtime validation** via Zod schemas
- ✅ **Multi-program support** - Credential Signer, Session Registry, SAS

## Documentation

📚 **Full documentation at [dev.alien.org/docs](https://dev.alien.org/docs)**

- **[Solana Integration Guide](https://dev.alien.org/docs/solana-sso-guide/core-integration)** - Complete integration walkthrough
- **[API Reference](https://dev.alien.org/docs/solana-sso-api-reference/api-reference-core)** - Detailed API documentation
- **[What is Alien Session?](https://dev.alien.org/docs/what-is-alien-session)** - Session architecture explained
- **[Demo App](https://dev.alien.org/docs/solana-sso-demo-app)** - Example Solana application

### React Integration

For React applications with Solana wallet adapters, check out [@alien-id/sso-solana-react](https://www.npmjs.com/package/@alien-id/sso-solana-react):

```bash
npm install @alien-id/sso-solana-react
```

## Enrollment flow (L0) — once per wallet

1. **User connects** Solana wallet
2. **Generate deeplink** with wallet address → Display QR code
3. **User enrolls** in the Alien mobile app (app + oracle co-sign)
4. **Poll for completion** → Get oracle signature and session data
5. **Build transaction** → Create on-chain attestation
6. **Sign and send** → User signs with wallet, transaction confirms — the
   `wallet ↔ Alien ID` binding now exists on-chain, permanently

This establishes a binding; it is **not** a sign-in.

## Authenticating a returning wallet (your backend)

`getAttestation` (L1) is **information only** — a truthy result proves a
historical binding, never current control. To authenticate, your backend issues
its own nonce, has the wallet sign `buildPopMessage(wallet, nonce)`, and verifies
it locally — then mints its own session:

```ts
import { buildPopMessage, verifyPopSignature } from '@alien-id/sso-solana';

// Frontend: signature = await wallet.signMessage(
//   new TextEncoder().encode(buildPopMessage(wallet, nonce)));

// Your backend (no Alien call for the proof itself):
const ok = verifyPopSignature(wallet, buildPopMessage(wallet, nonce), signatureB64);
if (ok) {
  const sessionAddress = await client.getAttestation(wallet); // L1
  if (sessionAddress) {
    // mint YOUR session, sub = sessionAddress
  }
}
```

`verifyPopSignature` uses `@noble/curves` (the audited Ed25519 library
`@solana/web3.js` itself depends on) and decodes the address with `PublicKey`;
it never throws — malformed input returns `false`. See the
[integration guide](https://github.com/alien-id/sso-sdk-js/blob/main/docs/solana-integration.md).

## On-Chain Programs

The SDK integrates with three Solana programs:

- **Credential Signer** (`9cstDz8WWRAFaq1vVpTjfHz6tjgh6SJaqYFeZWi1pFHG`) - Manages credentials
- **Session Registry** (`DeHa6pyZ2CFSbQQiNMm7FgoCXqmkX6tXG77C4Qycpta6`) - Stores sessions
- **SAS** (`22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`) - Solana Attestation Service

All program IDs are configurable via constructor options.

## Getting a Provider Address

Register your application at the [Developer Portal](https://dev.alien.org/dashboard) to get your provider credentials.

## TypeScript Support

Includes full TypeScript declarations with Zod runtime validation:

```typescript
import type {
  AlienSolanaSsoClientConfig,
  SolanaLinkResponse,
  SolanaPollResponse,
  SolanaAttestationResponse
} from '@alien-id/sso-solana';
```

## Peer Dependencies

- `@solana/web3.js` - Solana blockchain interaction

## License

MIT

## Links

- [Documentation](https://dev.alien.org/docs)
- [GitHub Repository](https://github.com/alien-id/sso-sdk-js)
- [NPM Package](https://www.npmjs.com/package/@alien-id/sso-solana)
- [React Integration](https://www.npmjs.com/package/@alien-id/sso-solana-react)
