# 2. Solana SSO is a web3 identity-verification primitive, not an auth system

Date: 2026-06-02

## Status

Accepted. Supersedes the earlier draft of this ADR, which proposed issuing a JWT
triad from the Solana scope ("Option F / L3"). That proposal is **rejected** — see
"Rejected alternative" below.

## Context

Two identities are in play (see [CONTEXT.md](../../CONTEXT.md)): the **wallet** ("what
you hold") and the **Alien ID** ("who you are"). Plain Sign-In-With-Solana only proves
the wallet; Alien's product is the **binding** between the two, recorded on the Solana
Attestation Service — the same category as Civic/Solid verifiable credentials, not SIWS
auth libraries.

Two facts about every integration make a separate Solana auth system redundant:

1. **The integrating app is always a registered Alien provider.** `/solana/*` is gated
   on `X-PROVIDER-ADDRESS` + on-chain `GetProvider`.
2. **Every bindable user already has an Alien ID.** A [Binding](../../CONTEXT.md#binding)
   maps `wallet → session_address`, and that session is minted by the Alien app, so it
   presupposes an Alien identity.

The decisive fact: **`session_address` is bound to an Alien ID — it is the owner id**,
the *same* identity key the regular OIDC SSO already issues as `sub`. The attestation
lookup's provider check (`solana_attestation.go:232`) returns the `session_address` for
*this* provider, i.e. exactly the `sub` the OIDC flow would issue for the same owner at
the same provider.

## Decision

**Scope Solana SSO to exactly two server capabilities — the things only Alien can
provide — and nothing more:**

- **L0 Bind** (`/solana/link` + poll + callback → SAS): link a wallet to an Alien ID.
  Needs the Alien app + oracle; irreducible.
- **L1 Lookup** (`/solana/attestation`): which Alien ID (`session_address`) is this
  wallet bound to? Provider-gated.

**Proof-of-Possession is NOT an Alien capability — it belongs to the integrator's
backend.** Proving the holder controls the wallet right now is standard Ed25519 over a
nonce the integrator chooses; it requires no Alien secret and no Alien call. The
integrator issues its own nonce and verifies the signature itself. Alien being in that
path only ever made sense for a *backend-less* SDK modal — and a real app always has a
backend, so that case isn't worth serving. (This revises ADR-0001's PoP, which put a
nonce endpoint on the Alien server: the security fix that matters — *a lookup is never
authentication* — stays; the Alien-side nonce machinery is dropped.)

So the integrator's flow is: **its backend proves possession (own nonce + Ed25519), then
calls Alien L1 for the binding, then issues its own session.** Both shapes work with **no
extra linkage**, because the identity key is shared:

- run their own session off "verified wallet → bound Alien identity"; or
- authenticate the human via the **regular OIDC SSO** (which keys on the same
  `session_address`) and treat the wallet proof as a bound attribute.

**Authentication, possession-proof, and token management all live with the integrator
(or the regular OIDC SSO).** The Solana scope issues no credential and verifies no
signatures.

## Rejected alternative — issuing tokens from the Solana scope ("Option F / L3")

An earlier draft proposed a `/solana/token` endpoint that mints the OIDC JWT triad
after PoP, reusing `JWTService`/`createRefreshToken`/DPoP. Verified feasible (three
read-only audits confirmed the minting has no authorization-code prerequisite and the
SDK change was small). **Rejected anyway** because it is redundant: the regular OIDC
SSO already issues tokens keyed on the same `session_address`, so a separate Solana
token system would duplicate an existing capability for no new value. Dropping it keeps
the design DRY, keeps the product boundary clean (primitive vs. full auth), and removes
all the machinery L3 would have required (`/solana/token`, a single-use nonce table,
SDK token methods, React token storage, a `solana_wallet` id_token claim).

Also dropped with it: the proposed `domain` binding on the PoP message. Cross-provider
replay is already prevented by the provider check plus the global 1:1 binding, so the
canonical PoP message stays byte-identical (no break to the cross-language vector).

## Consequences

- **Alien exposes only L0 + L1.** The backend PoP endpoints (`/solana/nonce`,
  `/solana/nonce/verify`) and their rate-limiter — built but never committed — are
  **shelved, not deployed**. Nothing PoP-related ships server-side.
- **SDK reshape (JS):** keep the F-06 safety change (`verifyAttestation` is lookup-only,
  no localStorage auth) and the pure `buildPopMessage` helper; **add** a pure local
  `verifyPopSignature` the integrator runs in its own backend (standard Ed25519, no Alien
  call); **remove** `requestNonce`/`verifyPossession` (they called the dropped Alien
  endpoints).
- **React modal reframed** as an *enrollment + lookup* widget: it runs the bind ceremony
  and reports the binding; it does not claim "signed in" and does not hold an auth
  session. Authentication is the integrator's.
- Integrators wanting Alien-managed auth use the regular OIDC SSO independently; the
  shared `session_address` key makes the two compose without glue.
- Testing on dev needs only L0 + L1, already live — no PoP deploy required.
- The F-06 SDK change remains breaking and still needs a **major changeset**; the
  shipped SDK work is uncommitted.

## Open follow-ups

1. **Global-not-per-provider binding:** on-chain `["solana", solana_address]` uses
   `init`, so a wallet binds to exactly one Alien session Alien-wide. Fine for the
   primitive; revisit only if multi-provider binding is ever wanted.
