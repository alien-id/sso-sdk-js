# Security

This repository publishes five public npm packages under `@alien-id/*`. The
supply chain is defended in layers so that no single failure — a leaked token,
a poisoned dependency, a compromised CI step — is enough to ship malicious code
to consumers.

## Reporting a vulnerability

Email **security@alien.org** with details and reproduction steps. Do not open a
public issue for undisclosed vulnerabilities.

## Layer 1 — Accounts & publishing

- **OIDC trusted publishing.** Packages are published from GitHub Actions using
  npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) over OIDC.
  There is **no long-lived `NPM_TOKEN`** in repository secrets; the publish step
  sets `NPM_TOKEN=''` to defeat any fallback to a static credential.
- **Provenance.** Every package sets `publishConfig.provenance: true`, so each
  release carries a signed sigstore attestation linking the tarball to the exact
  workflow run and commit that built it.
- **2FA.** npm and GitHub accounts with publish rights must use WebAuthn/passkey
  2FA.

## Layer 2 — Install-time hardening (`.npmrc`)

- `min-release-age=3` — a **3-day cooldown**: npm refuses to install any package
  version published less than three days ago. Every 2025–2026 npm worm was
  detected within minutes, so a 3-day gate neutralizes the entire class.
  (Requires npm ≥ 11.10.0 — see Layer 3.) Security fixes are pulled in
  out-of-band, so this does not hold up emergency CVEs.
- `ignore-scripts=true` — disables `pre`/`post`-install lifecycle scripts, the
  vector used by ua-parser-js, Nx, Axios, and Shai-Hulud. Verified safe: builds
  use vite/tsdown/tsc via `npm run`, not install hooks.
- `save-exact=true` — exact-version installs, no floating `^`/`~`.
- `engine-strict=true` + `audit-level=high`.
- `registry` pinned to `https://registry.npmjs.org/`.

The committed `package-lock.json` is always installed with `npm ci` (frozen) in
CI and release jobs.

## Layer 3 — Toolchain pinning (`mise.toml`)

- Node is pinned via [mise](https://mise.jdx.dev) to **24.16.0**, whose bundled
  npm (**11.13.0**) is deterministic per release and clears the ≥ 11.10.0 floor
  required for `min-release-age`.
- We deliberately do **not** pin npm via mise's `npm:npm` backend: Node's
  bundled npm shadows it in both `mise exec` and shim resolution, which would
  make the pin claim a version it does not run.
- The `packageManager` field in the root `package.json` exists only because
  Turbo requires it for workspace detection; it is kept matched to the bundled
  npm. Corepack is not enabled, so it never overrides mise.
- The publish job asserts `npm -v >= 11.10.0` before publishing.

## Layer 4 — CI/CD (`.github/workflows`)

- **Default-deny permissions.** Every workflow declares `permissions: {}` at the
  top level; each job re-grants only what it needs.
- **Release split into three jobs.** `detect` (read-only, no id-token) decides
  from ground truth whether there is a Version PR to open (changeset files) or a
  publish to run (registry state). `version-pr` holds only `contents`/
  `pull-requests: write`. `publish` is the **only** job with `id-token: write`,
  and it is gated behind the `npm-publish` GitHub Environment (manual reviewer
  approval).
- **OIDC isolation.** The publish job owns Node + registry context via
  `setup-node` (not mise) so the OIDC-critical step has predictable egress, and
  it does **no dependency caching** — caching while holding an OIDC token was the
  TanStack/Astro 2025 exfiltration vector.
- **harden-runner.** Present on every job. The publish job runs with
  `egress-policy: block` and an explicit allowlist (npm registry, sigstore,
  GitHub). `detect`/`version-pr` run in `audit` mode because mise provisions Node
  from `nodejs.org`, whose endpoints are not fixed — neither job holds an OIDC
  token.
- **Pinned actions.** Every third-party action is pinned to a full commit SHA
  with a version comment. Renovate keeps the digests current.
- **`persist-credentials: false`** on every checkout.
- **Monthly cache purge** (`purge-cache.yml`) defends against poisoned cache
  reuse.

## Layer 5 — Dependency updates (`renovate.json`)

- `minimumReleaseAge: "3 days"` matches the install-time cooldown; vulnerability
  alerts bypass it (`minimumReleaseAge: "0"`).
- `rangeStrategy: pin` for devDependencies; **published packages keep ranges**
  (`replace`) so consumers can dedupe.
- GitHub Action digests are pinned and updated via PR.
