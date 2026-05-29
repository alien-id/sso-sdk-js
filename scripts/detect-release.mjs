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

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

async function hasPendingChangesets() {
  const dir = path.join(root, '.changeset');
  if (!existsSync(dir)) return false;
  const entries = await readdir(dir);
  return entries.some(
    (f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md',
  );
}

async function readPublishablePackages() {
  const pkgsDir = path.join(root, 'packages');
  const dirents = await readdir(pkgsDir, { withFileTypes: true });
  const packages = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const manifest = path.join(pkgsDir, dirent.name, 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(await readFile(manifest, 'utf8'));
    if (pkg.private || !pkg.name || !pkg.version) continue;
    packages.push({ name: pkg.name, version: pkg.version });
  }
  return packages;
}

// True if name@version is already on the registry. A genuine "version does
// not exist" (E404) returns false; anything else (network, auth, 5xx) throws
// so the job fails loudly instead of silently mis-deciding.
function isPublished(name, version) {
  const spec = `${name}@${version}`;
  try {
    const out = execFileSync('npm', ['view', spec, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return out.length > 0;
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (/E404|No match found for version/i.test(detail)) return false;
    throw new Error(`npm view failed for ${spec}: ${detail || error.message}`);
  }
}

async function main() {
  const hasChangesets = await hasPendingChangesets();
  const packages = await readPublishablePackages();

  let shouldPublish = false;
  for (const pkg of packages) {
    const published = isPublished(pkg.name, pkg.version);
    if (!published) shouldPublish = true;
    console.log(`${pkg.name}@${pkg.version}: ${published ? 'published' : 'NOT published'}`);
  }

  const result = `hasChangesets=${hasChangesets}\nshouldPublish=${shouldPublish}\n`;
  console.log(`\n${result}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, result);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
