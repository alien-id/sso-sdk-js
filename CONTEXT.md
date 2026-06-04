# Context: Solana SSO Auth Ceremony

Glossary for the Solana sign-in flow shared by the JS SDK (`@alien-id/sso-solana`,
`@alien-id/sso-solana-react`) and the Go SSO server (`sso/`). Terms only — no
implementation details.

## Glossary

### Proof-of-Possession (PoP)
Fresh evidence that the browser currently controls a wallet's **private key**, produced
by signing a [Nonce Challenge](#nonce-challenge) with the wallet and verifying the
Ed25519 signature against the connected public key. PoP is the **integrator's**
responsibility — they issue the nonce and verify the signature in their own backend;
Alien is not involved (it requires no Alien secret — just standard Ed25519). PoP proves
*control right now* — it says nothing about identity or history.

### Attestation
A historical, on-chain record that a wallet was once linked to an Alien identity. Stored
in a Solana Attestation Service PDA. Proves **binding** (this wallet ↔ this identity) but
**never current possession** — its mere existence does not prove the present holder
controls the key. Treating "attestation exists" as "authenticated" is the F-06 bug.

### Binding
The wallet → Alien-identity relationship recorded by an [Attestation](#attestation). A
stable, deliberately permanent fact. Distinct from [Proof-of-Possession](#proof-of-possession):
binding is *who this wallet belongs to*; possession is *who is holding it now*.

### Session Address
The Axon session address returned by the attestation lookup — the identity end of a
[Binding](#binding). It is bound to an Alien ID and functions as the **owner id**: the
same identity key the regular OIDC SSO carries as the `sub` claim. So a wallet's
binding and a regular Alien login resolve to the same identity, with no extra linkage.
It is public on-chain data, not a secret and not a session token.

### Nonce Challenge
A short-lived, unpredictable value the wallet signs as part of
[Proof-of-Possession](#proof-of-possession), so an old signature cannot be replayed. It
is issued and verified by the **integrator's** backend, not Alien. Never conflated with
the **oracle signed message** (`sessionAddress · solanaAddress(base58) · timestamp_le8`)
that the credential-signer oracle and on-chain program verify during binding.

### Authenticated (Solana SSO)
A state the **integrator** establishes — Alien issues no session. It requires **both** a
successful [Proof-of-Possession](#proof-of-possession) (control now, proven by the
integrator's own backend) **and** a present [Attestation](#attestation) /
[Binding](#binding) (which Alien reports via lookup). Neither alone suffices, and Alien
never sets this state.
