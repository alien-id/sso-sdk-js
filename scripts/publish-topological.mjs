// Topological publisher for `npm run ci:publish`.
//
// `changeset publish` publishes with concurrency, not dependency order, so a
// dependent (e.g. @alien-id/sso-react) can hit the registry before the core
// package it requires — and if the core publish then fails, the registry is
// left holding a package that references a non-existent internal version.
// This publisher sorts packages dependency-first and publishes them in order,
// idempotently (already-published versions are skipped, so re-runs after a
// partial failure are safe).
//
// Decision logic lives in ./lib/publish.mjs and ./lib/detect.mjs (pure,
// unit-tested); this file is the filesystem + npm wiring.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { interpretNpmView } from './lib/detect.mjs';
import { deriveTag, internalDeps, topoSort } from './lib/publish.mjs';

const root = process.cwd();

function readPublishable() {
  const pkgsDir = path.join(root, 'packages');
  const manifests = [];
  for (const dirent of readdirSync(pkgsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const file = path.join(pkgsDir, dirent.name, 'package.json');
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (pkg.private || !pkg.name || !pkg.version) continue;
    manifests.push(pkg);
  }
  const names = new Set(manifests.map((p) => p.name));
  return manifests.map((p) => ({
    name: p.name,
    version: p.version,
    deps: internalDeps(p, names),
  }));
}

function isPublished(name, version) {
  const spec = `${name}@${version}`;
  try {
    const stdout = execFileSync('npm', ['view', spec, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return interpretNpmView({ failed: false, stdout }, spec);
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}` || error.message;
    return interpretNpmView({ failed: true, output }, spec);
  }
}

function publish(pkg) {
  const tag = deriveTag(pkg.version);
  // access + provenance come from each package's publishConfig.
  execFileSync('npm', ['publish', '--workspace', pkg.name, '--tag', tag], {
    stdio: 'inherit',
  });
  // Emit the line changesets/action parses to push tags and create releases.
  console.log(`New tag:  ${pkg.name}@${pkg.version}`);
}

function main() {
  const ordered = topoSort(readPublishable());
  for (const pkg of ordered) {
    if (isPublished(pkg.name, pkg.version)) {
      console.log(`Skipping ${pkg.name}@${pkg.version} (already on registry)`);
      continue;
    }
    publish(pkg);
  }
}

main();
