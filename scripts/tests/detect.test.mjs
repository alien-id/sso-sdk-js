import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hasPendingChangesets,
  interpretNpmView,
  needsPublish,
  selectPublishable,
} from '../lib/detect.mjs';

test('hasPendingChangesets: false when only the README is present', () => {
  assert.equal(hasPendingChangesets(['README.md']), false);
});

test('hasPendingChangesets: false for an empty directory', () => {
  assert.equal(hasPendingChangesets([]), false);
});

test('hasPendingChangesets: true when a real changeset markdown exists', () => {
  assert.equal(
    hasPendingChangesets(['README.md', 'funny-pandas-sing.md']),
    true,
  );
});

test('hasPendingChangesets: ignores non-markdown files (e.g. config.json, pre.json)', () => {
  assert.equal(hasPendingChangesets(['config.json', 'pre.json']), false);
});

test('hasPendingChangesets: excludes README case-insensitively', () => {
  assert.equal(hasPendingChangesets(['readme.md']), false);
});

test('selectPublishable: keeps name + version, drops everything else', () => {
  assert.deepEqual(
    selectPublishable([
      { name: '@alien-id/sso', version: '2.0.0', description: 'x' },
    ]),
    [{ name: '@alien-id/sso', version: '2.0.0' }],
  );
});

test('selectPublishable: excludes private packages (the example apps)', () => {
  assert.deepEqual(
    selectPublishable([
      { name: 'example-sso-app', version: '0.1.0', private: true },
      { name: '@alien-id/sso', version: '2.0.0' },
    ]),
    [{ name: '@alien-id/sso', version: '2.0.0' }],
  );
});

test('selectPublishable: skips manifests missing a name or version', () => {
  assert.deepEqual(
    selectPublishable([
      { version: '1.0.0' },
      { name: '@alien-id/sso-react' },
      null,
      { name: '@alien-id/sso', version: '2.0.0' },
    ]),
    [{ name: '@alien-id/sso', version: '2.0.0' }],
  );
});

test('interpretNpmView: published when npm prints the version', () => {
  assert.equal(
    interpretNpmView({ failed: false, stdout: '2.0.0\n' }, '@alien-id/sso@2.0.0'),
    true,
  );
});

test('interpretNpmView: not published when stdout is empty', () => {
  assert.equal(interpretNpmView({ failed: false, stdout: '' }, 'x@1.0.0'), false);
});

test('interpretNpmView: not published on a genuine E404', () => {
  assert.equal(
    interpretNpmView(
      { failed: true, output: 'npm error code E404\nnpm error 404 No match found for version 9.9.9' },
      '@alien-id/sso@9.9.9',
    ),
    false,
  );
});

test('interpretNpmView: throws on a non-404 failure (network/auth/5xx)', () => {
  assert.throws(
    () => interpretNpmView({ failed: true, output: 'ETIMEDOUT request to registry' }, 'x@1.0.0'),
    /npm view failed for x@1\.0\.0/,
  );
});

test('needsPublish: false when every package is already published', () => {
  const pkgs = [
    { name: '@alien-id/sso', version: '2.0.0' },
    { name: '@alien-id/sso-react', version: '2.0.0' },
  ];
  assert.equal(needsPublish(pkgs, () => true), false);
});

test('needsPublish: true when any single package is unpublished', () => {
  const pkgs = [
    { name: '@alien-id/sso', version: '2.0.0' },
    { name: '@alien-id/sso-react', version: '2.1.0' },
  ];
  const isPublished = (_name, version) => version !== '2.1.0';
  assert.equal(needsPublish(pkgs, isPublished), true);
});

test('needsPublish: false for an empty package set', () => {
  assert.equal(needsPublish([], () => false), false);
});
