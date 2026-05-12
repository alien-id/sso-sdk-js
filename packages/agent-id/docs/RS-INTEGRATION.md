# Supporting Alien Agent ID SSO — Resource Server Integration

Guide for service authors who want to accept authenticated requests from any agent on the Alien network.

## TL;DR

Use `@alien-id/sso-agent-id` ≥ 2.1.0 with no per-service configuration:

```typescript
import { fetchAlienJWKS, verifyDPoPRequest } from '@alien-id/sso-agent-id';

const jwks = await fetchAlienJWKS();

// In your request handler:
const result = verifyDPoPRequest(req, { jwks });
if (!result.ok) {
  res.set('WWW-Authenticate', `DPoP error="${result.code}"`);
  return res.status(401).json({ error: result.error });
}
// result.sub — the human owner (signed by SSO)
// result.jkt — the agent's key thumbprint (RFC 7638)
```

That's it. The defaults are correct for any Alien-aware service.

## What the verifier checks

You don't have to think about this — the SDK does it. Listed here so you know what authority chain you're trusting.

| Check | Source | Why |
|---|---|---|
| `iss == https://sso.alien-api.com` | AT claim | Federation anchor — pins to the canonical Alien SSO |
| AT signature verifies against issuer JWKS | RFC 9068 §4 | Authenticity |
| `exp`, `nbf`, `iat` fresh | AT claims | Replay window |
| `aud` includes `expectedIssuer` | AT claim | RFC 9068 §4 + id_token confusion defense |
| AT `typ == at+jwt` | JWT header | Strictly an access token, not an id_token |
| `cnf.jkt` present and matches DPoP proof's `jwk` thumbprint | AT + proof | RFC 9449 §6.1 sender-constraint |
| DPoP `htm` / `htu` match this request | Proof claims | Per-request binding |
| DPoP `ath == sha256(AT)` | Proof claim | Proof binds to *this* AT |
| DPoP `iat` recent, `jti` unseen | Proof + cache | Replay defense (RFC 9449 §11.1) |
| DPoP proof signature verifies with embedded `jwk` | RFC 9449 §4.3 step 7 | Proof-of-possession |

On success, `result.sub` is the human owner's AlienID address (signed by the SSO) and `result.jkt` is the agent's Ed25519 key thumbprint. Both are cryptographically attested.

## The federated-audience contract

The Alien SSO mints every access token with:

```
aud = [<the agent's bound OAuth client_id>, "https://sso.alien-api.com"]
```

Every Alien-aware resource server treats the issuer URL as its own audience identifier. The verifier's default `expectedAudience = expectedIssuer` enforces that — RFC 9068 §4 compliant (the RS validates `aud` against an identifier it claims for itself) and gives you the "one agent, all services" property for free.

You only override `expectedAudience` when you want to *narrow* acceptance:

- **`expectedAudience: 'YOUR_CLIENT_ID'`** — only accept agents bound to your own OAuth client. Use when your service intentionally serves a single tenant.
- **`expectedAudience: 'https://your.api/v1'`** — RFC 8707 resource-indicator style. Forward-compatible with future SSO changes that emit resource-scoped tokens.
- **`expectedAudience: false`** — skip audience check entirely. Test fixtures only.

## Production checklist

- **Pre-fetched JWKS.** Call `fetchAlienJWKS()` once at startup and cache. The SSO rotates signing keys infrequently; refresh every few hours.
- **Reverse proxies.** If you sit behind a load balancer, CDN, or service mesh, reconstruct the URL the agent actually addressed using `X-Forwarded-Proto` / `X-Forwarded-Host`. Otherwise `htu` comparison rejects every request.
- **Shared `jtiStore` for multi-instance deployments.** The default in-memory `jti` store is per-process. A captured proof can be replayed against a sibling worker until the freshness window expires. For >1 replica, inject a Redis/Memcached-backed store via `opts.jtiStore`.
- **Loose clock sync.** The default ±30s window assumes NTP. Tighten via `proofMaxAgeSec` / `clockSkewSec` if you have stricter sync; widen if you don't.
- **`.well-known/alien-agent-id.json`.** Publish a manifest at this path on your service's authority so agents can auto-discover that you support Agent ID. Minimum:

  ```json
  {
    "version": 1,
    "service": { "name": "Your Service", "url": "https://your.service/" },
    "auth": { "header": "Authorization", "scheme": "DPoP" },
    "api": { "base": "https://your.service/api" }
  }
  ```

  Agents fetch this with `node cli.mjs discover-service --url https://your.service/`.

## Access-control patterns

The SDK proves *who* is calling. *What* they're allowed to do is your service's call.

```typescript
// Any owner-bound agent on the Alien network
if (!result.ok) return res.status(401).json({ error: result.error });

// Allow-list by agent key
const ALLOWED_JKTS = new Set(['wEf6o2ux8sBAUG4oQYhP284gfpZwUJMTxXDPH5XxthY']);
if (!ALLOWED_JKTS.has(result.jkt)) return res.status(403).end();

// Allow-list by owner
const ALLOWED_OWNERS = new Set(['00000003010000000000539c741e0df8']);
if (!ALLOWED_OWNERS.has(result.sub)) return res.status(403).end();
```

## Anti-patterns

- **Don't pin `expectedAudience` to your own OAuth `client_id` unless you intentionally want to reject every other agent.** This was the pre-2.1.0 default suggested in examples; it breaks the "out of the box" property and forces every agent owner to re-bind to your provider.
- **Don't skip aud verification by passing `false` in production.** It opens id_token confusion against the same SSO. The default is the right answer.
- **Don't trust unsigned claims.** `accessTokenClaims` and `proofClaims` on the result are raw payloads. The verifier has already validated the claims it consumes (`sub`, `jkt`, `iss`, `aud`, `exp`, `cnf.jkt`, DPoP `htm`/`htu`/`ath`/`iat`/`jti`); anything else in there is just data.

## Reference

- [RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP)](https://www.rfc-editor.org/rfc/rfc9449)
- [RFC 9068 — JWT Profile for OAuth 2.0 Access Tokens](https://www.rfc-editor.org/rfc/rfc9068)
- [RFC 7800 — Proof-of-Possession Key Semantics for JWTs](https://www.rfc-editor.org/rfc/rfc7800)
- [RFC 7638 — JSON Web Key (JWK) Thumbprint](https://www.rfc-editor.org/rfc/rfc7638)
- [Alien Agent ID docs](https://docs.alien.org/agent-id-guide/introduction)
