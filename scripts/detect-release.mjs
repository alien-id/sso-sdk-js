// Read-only release gate for .github/workflows/release.yml.
//
// Decides what a push to main should trigger, from ground truth — never
// from inference — so the OIDC-holding publish job is only reached when
// there is genuinely something to publish:
//
//   hasChangesets  true if .changeset/*.md (excluding README) exist
//                  -> open/update the Version PR
//   shouldPublish  true if any publishable package version is NOT yet on
//                  the npm registry -> run the publish job
//
// Writes both as outputs to $GITHUB_OUTPUT. Requires only Node + npm on
// PATH (no project install), so the detect job stays cheap and isolated.
//
// The decision logic lives in ./lib/detect.mjs (pure, unit-tested); this
// file only wires it to the filesystem and npm.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  hasPendingChangesets,
  interpretNpmView,
  needsPublish,
  selectPublishable,
} from './lib/detect.mjs';

const root = process.cwd();

async function listChangesetEntries() {
  const dir = path.join(root, '.changeset');
  if (!existsSync(dir)) return [];
  return readdir(dir);
}

async function readManifests() {
  const pkgsDir = path.join(root, 'packages');
  const dirents = await readdir(pkgsDir, { withFileTypes: true });
  const manifests = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const manifest = path.join(pkgsDir, dirent.name, 'package.json');
    if (!existsSync(manifest)) continue;
    manifests.push(JSON.parse(await readFile(manifest, 'utf8')));
  }
  return manifests;
}

// Run `npm view name@version version` and classify the result.
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

async function main() {
  const changesets = hasPendingChangesets(await listChangesetEntries());
  const packages = selectPublishable(await readManifests());

  // Memoize so each package is queried once, then reused by needsPublish.
  const cache = new Map();
  const isPublishedOnce = (name, version) => {
    const key = `${name}@${version}`;
    if (!cache.has(key)) cache.set(key, isPublished(name, version));
    return cache.get(key);
  };

  for (const pkg of packages) {
    const published = isPublishedOnce(pkg.name, pkg.version);
    console.log(`${pkg.name}@${pkg.version}: ${published ? 'published' : 'NOT published'}`);
  }
  const shouldPublish = needsPublish(packages, isPublishedOnce);

  const result = `hasChangesets=${changesets}\nshouldPublish=${shouldPublish}\n`;
  console.log(`\n${result}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, result);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
