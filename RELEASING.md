# Releasing

Releases are driven by [changesets](https://github.com/changesets/changesets).
You never hand-edit versions, push tags, or run `npm publish` locally — the
pipeline does all of it, gated by three manual checkpoints.

## TL;DR

1. In your feature branch, run `npm run changeset` and describe the change.
2. Open a PR. CI shows the pending changeset (advisory).
3. Merge the feature PR. A **Version PR** ("chore: release packages") opens
   automatically.
4. Review and merge the Version PR. This bumps versions + CHANGELOGs.
5. Approve the **`npm-publish`** environment when prompted. Packages publish to
   npm with provenance.

## The three gates

| Gate | What it controls |
|------|------------------|
| Feature PR merge | Lands code + the changeset file on `main` |
| Version PR merge | Lands the version bumps + CHANGELOGs on `main` |
| `npm-publish` environment approval | Releases the bumped versions to npm |

## How the pipeline decides what to do

`.github/workflows/release.yml` runs on every push to `main`. Its `detect` job
(`scripts/detect-release.mjs`, read-only, no OIDC token) computes two flags from
ground truth:

- **`hasChangesets`** — true if `.changeset/*.md` (excluding `README.md`) exist
  → open/update the Version PR.
- **`shouldPublish`** — true if any publishable package's current version is
  **not** yet on the npm registry → run the publish job.

Because the version bump and the publish are separate pushes, the two real jobs
are mutually exclusive: the Version PR consumes the changeset files, and only
the *next* push (after merging it) flips `shouldPublish` true.

## Adding a changeset

```bash
npm run changeset
```

Pick the changed packages and a bump level (patch/minor/major). Commit the
generated `.changeset/*.md` file with your PR.

Internal-dependency cascade (from `.changeset/config.json`,
`updateInternalDependents: always`):

- `@alien-id/sso` (core) bumps → `@alien-id/sso-react` auto-patches
- `@alien-id/sso-solana` bumps → `@alien-id/sso-solana-react` auto-patches

The three `apps/*` examples are in the `ignore` list and never publish.

## Pre-releases (alpha/beta/rc)

```bash
npx changeset pre enter beta   # start a pre-release line
npm run changeset              # add changesets as normal
# ... merge Version PRs; versions become x.y.z-beta.N
npx changeset pre exit         # return to stable
```

Pre-release versions publish under the matching dist-tag automatically.

## Publishing internals

The publish job runs `npm run ci:publish` = `turbo run build && changeset
publish` (the canonical changesets flow). `changeset publish`:

- publishes only versions not already on the registry (idempotent — safe to
  re-run after a partial failure),
- attaches provenance (`publishConfig.provenance: true`) and the correct
  dist-tag (stable → `latest`, prereleases → their identifier),
- prints the `New tag:` lines `changesets/action` parses to push git tags and
  create GitHub releases.

Authentication is OIDC trusted publishing — no token. The job is pinned to npm
≥ 11.10.0 and runs inside the `npm-publish` environment.

**On publish ordering.** `changeset publish` publishes packages concurrently
rather than in dependency order. This is safe here because internal
dependencies use caret ranges (`@alien-id/sso-react` → `@alien-id/sso@^2.0.0`),
so a dependent that reaches the registry a moment before its dependency still
resolves against the previously published core version. A topological publisher
(as in the Bun-based miniapp-sdk) is only required when internal deps are pinned
to exact versions via the `workspace:*` protocol, where the in-flight version
would not yet exist. If this repo ever adopts exact internal pins, revisit this.

## Troubleshooting

- **`EUNAUTHORIZED` / `ENEEDAUTH` on publish.** The npm **trusted publisher**
  config for that package does not match this workflow. On npmjs.com, set each
  package's trusted publisher to repository `alien-id/sso-sdk-js`, workflow
  `release.yml`, job `publish`. This is required after migrating off the old
  per-package tag workflows.
- **Publish job didn't run after merging the Version PR.** Check the `detect`
  job output — `shouldPublish` is false if the versions are already on the
  registry. Re-running is always safe.
- **A dependency install fails the 3-day cooldown.** Expected for very fresh
  versions (`.npmrc min-release-age=3`). Wait, or pull the fix in via a
  vulnerability-alert path.

## Prerequisites for maintainers

- [mise](https://mise.jdx.dev) ≥ 2026.1.0 installed locally; run `mise install`
  once to get the pinned Node/npm.
- Trusted publisher configured per package on npmjs.com (see above).
- The `npm-publish` GitHub Environment configured with required reviewers.
