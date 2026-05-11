# @alien-id/sso

Core TypeScript client for [Alien SSO](https://alien.org) authentication. Provides OIDC-compatible authentication with blockchain and TEE backing.

## ⚠️ Alpha Version Notice

**This is an early alpha version.** The SDK is under active development and may contain bugs or undergo breaking changes. Use with caution in production environments.

## Installation

```bash
npm install @alien-id/sso
```

## Features

- ✅ **TypeScript-first** with full type safety
- ✅ **Runtime validation** via Zod schemas
- ✅ **PKCE support** for secure authorization
- ✅ **Dual exports**: ESM and CJS
- ✅ **Zero UI dependencies** - use in any JavaScript environment
- ✅ **Storage management** for tokens and session data

## Documentation

📚 **Full documentation at [dev.alien.org/docs](https://dev.alien.org/docs)**

- **[Integration Guide](https://dev.alien.org/docs/sso-guide/core-integration)** - Complete integration walkthrough
- **[API Reference](https://dev.alien.org/docs/sso-api-reference/api-reference-core)** - Detailed API documentation
- **[What is Alien Session?](https://dev.alien.org/docs/what-is-alien-session)** - Session architecture explained
- **[Demo App](https://dev.alien.org/docs/sso-demo-app)** - Example application

### React Integration

If you're using React, check out [@alien-id/sso-react](https://www.npmjs.com/package/@alien-id/sso-react) for hooks and pre-built components:

```bash
npm install @alien-id/sso-react
```

## Authentication Flow

1. **Generate deeplink** → Display QR code or redirect
2. **User authenticates** in Alien mobile app
3. **Poll for completion** → Get authorization code
4. **Exchange code** → Receive access token
5. **Verify token** → Validate with server (optional)

## Server-side ID token verification

For backends and edge runtimes that receive an `id_token` from a logged-in
user, this package ships a minimal, standards-strict OIDC verifier that
runs on Web Crypto (no Node-only dependencies — works in Node 18+, browsers,
Cloudflare Workers, Vercel Edge, Deno). For *agent* authentication (where
the caller is a non-human agent on behalf of a human owner), use
[`@alien-id/sso-agent-id`](https://www.npmjs.com/package/@alien-id/sso-agent-id)
instead.

```typescript
import { verifyIdToken, JwksCache } from '@alien-id/sso';

const jwks = new JwksCache('https://sso.alien-api.com/oauth/jwks');

async function authenticate(idToken: string) {
  const result = await verifyIdToken(idToken, {
    jwks: await jwks.get(),
    expectedIssuer: 'https://sso.alien-api.com',
    expectedAudience: process.env.ALIEN_PROVIDER_ADDRESS!, // your OAuth client_id
    expectedNonce: storedNonce, // only if the auth request sent a nonce
  });
  if (!result) return null;   // rejected — failure mode is intentionally opaque
  return result.payload;      // { sub, iss, aud, exp, ... }
}
```

`verifyIdToken` returns the parsed payload on success and `null` on any
failure. The opaqueness is deliberate — an authentication boundary should
not leak which check failed (no oracle), and there is no actionable recovery
for any specific failure mode beyond "reject".

### What gets checked

The JWKS is fetched from the SSO's `/oauth/jwks` endpoint, which is
advertised by `/.well-known/openid-configuration` per OIDC Discovery /
RFC 8414. `verifyIdToken` then enforces, in order:

- Strict RFC 4648 §5 base64url alphabet on every JWT segment (no permissive
  decoding that could smuggle non-canonical bytes)
- Header: `typ` is absent / `JWT` / `application/jwt` (case-insensitive per
  RFC 6838 §4.2); `alg=RS256` only; non-empty `crit` is rejected (RFC 7515
  §4.1.11, RFC 8725 §3.7)
- RS256 signature under a JWKS key matching `kid`, `kty=RSA`,
  `use=sig`-or-absent, pinned `alg`-or-absent (RFC 7515 §10.7), with RSA
  modulus ≥ 2048 bits (RFC 7518 §3.3 / RFC 8725 §3.5)
- `iss == expectedIssuer`; `sub` present and non-empty string
- `aud` contains `expectedAudience`; every `aud` entry is in the trust set
  (defaults to `{expectedAudience}`); `azp` rules enforced for
  multi-audience tokens (OIDC §3.1.3.7.3 / .7.6 / .7.7)
- `exp > now - clockSkewSec`; `nbf` (if present) ≤ `now + clockSkewSec`;
  `iat` (if present) is a `NumericDate` (RFC 7519 §4.1.4-6)
- `nonce == expectedNonce` when supplied (OIDC §3.1.3.7 step 11)

28 unit tests cover the matrix; run `npm test -- tests/unit/verify.test.ts`.

### API

| Export | Purpose |
| --- | --- |
| `verifyIdToken(token, opts)` | Verify a JWS id_token; returns `{ payload }` on success or `null` on any failure |
| `JwksCache(url, opts?)` | TTL-cached JWKS fetcher (default TTL 24 h) — call `.get()` per verification |
| `fetchJwks(url)` | One-shot JWKS fetcher (useful for tests / custom caching) |
| `parseJwt(token)` | Strict JWS structural parser (used internally; exported for tooling) |

| `VerifyIdTokenOptions` | Type | Description |
| --- | --- | --- |
| `jwks` | `JWKS` | Pre-fetched JWKS, typically from `JwksCache.get()` |
| `expectedIssuer` | `string` | Required. Typically `https://sso.alien-api.com` |
| `expectedAudience` | `string` | Required. Your OAuth `client_id` |
| `expectedNonce` | `string` | Required iff the auth request sent a `nonce` |
| `clockSkewSec` | `number` | Default `30` |
| `trustedAudiences` | `readonly string[]` | Additional `aud` values to trust (default `[expectedAudience]`) |

### What this is *not*

- **Not an opaque-token introspector.** This verifies *id_tokens* (signed
  JWS); it does not call `/oauth/introspect` for opaque access tokens.
- **Not an agent verifier.** When the request comes from an autonomous
  agent acting on behalf of a user, the caller signs each request and
  proves they hold the key the id_token was bound to. Use
  `@alien-id/sso-agent-id` for that flow — it walks the full agent →
  binding → id_token chain.

## Storage

The SDK uses browser storage for session management:

- **localStorage**: `alien-sso_access_token` - Access token
- **sessionStorage**: `alien-sso_code_verifier` - PKCE code verifier

## Getting a Provider Address

Register your application at the [Developer Portal](https://dev.alien.org/dashboard) to get your provider credentials.

## TypeScript Support

Includes full TypeScript declarations with Zod runtime validation:

```typescript
import type {
  AlienSsoClientConfig,
  AuthorizeResponse,
  PollResponse,
  ExchangeCodeResponse,
  TokenInfo
} from '@alien-id/sso';
```

## Browser Support

- Modern browsers with ES2020+ support
- Chrome, Firefox, Safari, Edge (latest versions)

## License

MIT

## Links

- [Documentation](https://dev.alien.org/docs)
- [GitHub Repository](https://github.com/alien-id/sso-sdk-js)
- [NPM Package](https://www.npmjs.com/package/@alien-id/sso)
