# Changelog

## 2.1.2

### Patch Changes

- [`440abcf`](https://github.com/alien-id/sso-sdk-js/commit/440abcf19af2dcb3e52450a9d227681539a49ff9) Thanks [@truehazker-eti](https://github.com/truehazker-eti)! - Rebuild and republish under the refreshed build toolchain — Node 24.17.0 and `@types/node` 24.13.2. No source or public API changes.

## 2.1.2-beta.0

### Patch Changes

- [`440abcf`](https://github.com/alien-id/sso-sdk-js/commit/440abcf19af2dcb3e52450a9d227681539a49ff9) Thanks [@truehazker-eti](https://github.com/truehazker-eti)! - Rebuild and republish under the refreshed build toolchain — Node 24.17.0 and `@types/node` 24.13.2. No source or public API changes.

## 2.1.1

### Patch Changes

- [#22](https://github.com/alien-id/sso-sdk-js/pull/22) [`e7f5176`](https://github.com/alien-id/sso-sdk-js/commit/e7f517683b6ebd41d3d6b853eec97dab2cb4407e) Thanks [@truehazker-eti](https://github.com/truehazker-eti)! - docs: state the unit (seconds) for `proofMaxAgeSec` and `clockSkewSec` in the API table

## 2.1.0

### Federated audience by default

The verifier now defaults `expectedAudience` to `expectedIssuer` instead of skipping the audience check.

The Alien SSO mints `aud = [client_id, issuer]` on every access token. Any agent-id token presented to any Alien-aware resource server satisfies an `aud.includes(issuer)` check — so the default lets one agent identity work against the whole Alien network out of the box, no per-RS configuration. This matches the documented "supports any agent on the Alien SSO" property.

The new default tightens defense-in-depth on top of the existing `typ == at+jwt` check (`index.ts:195`): an `id+jwt` from the same SSO carries `aud = client_id` only (no issuer), so even if the `typ` check were ever weakened, the federated-audience default rejects it. The primary block on id_token confusion remains the `typ` check.

#### Behavior change

| `expectedAudience` value | Pre-2.1.0                         | 2.1.0+                                  |
| ------------------------ | --------------------------------- | --------------------------------------- |
| omitted                  | skip aud check                    | require `aud` contains `expectedIssuer` |
| `string`                 | require `aud` contains the string | _(unchanged)_                           |
| `false`                  | _(rejected — not a valid type)_   | skip aud check (test fixtures only)     |

#### Migration

- **You did not pass `expectedAudience`:** no action needed. Real Alien-SSO tokens already carry the issuer in `aud` and pass the new default.
- **You passed `expectedAudience: <your_client_id>`:** consider removing it unless you specifically want to scope tokens to your own OAuth client. Dropping it lets any agent bound to any Alien OAuth client authenticate against your service — the recommended pattern for ecosystem services.
- **You relied on the old "skip" default:** pass `expectedAudience: false` explicitly. Discouraged outside of test fixtures.

#### Why this is a minor (not a major)

Real-world Alien tokens always include the issuer in `aud` (`sso/internal/service/jwt.go` `CreateAccessToken`), so the default change does not reject any production token. Synthetic tokens that omit the issuer from `aud` (test fixtures, foreign issuers) are newly rejected — which is the desired tightening.

## 2.0.0

RFC 9449 DPoP cutover. See repository release notes.
