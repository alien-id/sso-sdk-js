// Pure publish-ordering logic. No filesystem or network — unit-testable.

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

// Map a version to its npm dist-tag: stable -> 'latest', otherwise the leading
// prerelease identifier (2.1.0-beta.3 -> 'beta', 1.0.0-rc.0 -> 'rc'). Throws on
// a malformed version so a bad publish never silently lands on `latest`.
export function deriveTag(version) {
  const match = SEMVER_RE.exec(version);
  if (!match) throw new Error(`Invalid semver: ${JSON.stringify(version)}`);
  const prerelease = match[4];
  if (!prerelease) return 'latest';
  const identifier = prerelease.split(/[.-]/)[0];
  if (!identifier) {
    throw new Error(`Empty prerelease identifier in ${JSON.stringify(version)}`);
  }
  return identifier;
}

// Internal (workspace) dependency names of a package, given the set of all
// publishable names. Considers regular + peer + optional deps.
export function internalDeps(pkg, names) {
  const all = {
    ...(pkg.dependencies || {}),
    ...(pkg.peerDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
  return Object.keys(all).filter((name) => names.has(name));
}

// Topologically sort packages so every package is published AFTER the internal
// packages it depends on. Input: [{ name, deps: [internalName, ...], ... }].
// Deterministic (ties broken alphabetically). Throws on a dependency cycle.
export function topoSort(packages) {
  const names = new Set(packages.map((p) => p.name));
  const byName = new Map(packages.map((p) => [p.name, p]));
  const indegree = new Map(packages.map((p) => [p.name, 0]));
  const dependents = new Map(packages.map((p) => [p.name, []]));

  for (const pkg of packages) {
    for (const dep of pkg.deps) {
      if (!names.has(dep)) continue; // external dependency — ignore
      dependents.get(dep).push(pkg.name);
      indegree.set(pkg.name, indegree.get(pkg.name) + 1);
    }
  }

  const ready = [...indegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([n]) => n)
    .sort();
  const order = [];
  while (ready.length) {
    const name = ready.shift();
    order.push(byName.get(name));
    for (const dependent of dependents.get(name)) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) ready.push(dependent);
    }
    ready.sort();
  }

  if (order.length !== packages.length) {
    throw new Error('Dependency cycle detected among internal packages');
  }
  return order;
}
