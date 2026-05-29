// Pure release-gate decision logic. No filesystem or network access — every
// side effect is injected by the caller — so the decisions that drive the
// release workflow are unit-testable in isolation.

// True if a `.changeset` directory listing contains at least one real
// changeset (any `*.md` other than the README).
export function hasPendingChangesets(entries) {
  return entries.some(
    (name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md',
  );
}

// Reduce a list of raw package.json objects to the publishable ones:
// non-private, with both a name and a version.
export function selectPublishable(manifests) {
  return manifests
    .filter((pkg) => pkg && !pkg.private && pkg.name && pkg.version)
    .map((pkg) => ({ name: pkg.name, version: pkg.version }));
}

// Interpret the outcome of `npm view <spec> version`. Returns true if the
// version is on the registry, false if it genuinely does not exist (E404),
// and throws on anything else (network, auth, 5xx) so the caller fails loudly
// instead of silently mis-deciding whether to publish.
export function interpretNpmView({ failed = false, stdout = '', output = '' }, spec) {
  if (!failed) return stdout.trim().length > 0;
  if (/E404|No match found for version/i.test(output)) return false;
  throw new Error(`npm view failed for ${spec}: ${output || 'unknown error'}`);
}

// True if any package's exact version is not yet published. `isPublished` is
// injected as (name, version) => boolean.
export function needsPublish(packages, isPublished) {
  return packages.some((pkg) => !isPublished(pkg.name, pkg.version));
}
