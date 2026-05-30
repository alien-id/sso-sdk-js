import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveTag, internalDeps, topoSort } from '../lib/publish.mjs';

test('deriveTag: stable version -> latest', () => {
  assert.equal(deriveTag('2.0.0'), 'latest');
});

test('deriveTag: prerelease -> leading identifier', () => {
  assert.equal(deriveTag('2.1.0-beta'), 'beta');
  assert.equal(deriveTag('2.1.0-beta.3'), 'beta');
  assert.equal(deriveTag('2.1.0-alpha.1'), 'alpha');
  assert.equal(deriveTag('3.0.0-rc.0'), 'rc');
});

test('deriveTag: throws on a malformed version', () => {
  assert.throws(() => deriveTag('not-a-version'), /Invalid semver/);
});

test('internalDeps: keeps workspace deps, drops external ones', () => {
  const names = new Set(['@alien-id/sso', '@alien-id/sso-react']);
  const pkg = {
    dependencies: { '@alien-id/sso': '^2.0.0', 'react-query': '^5.0.0' },
    peerDependencies: { react: '^19.0.0' },
  };
  assert.deepEqual(internalDeps(pkg, names), ['@alien-id/sso']);
});

test('topoSort: dependency is ordered before its dependent', () => {
  const order = topoSort([
    { name: '@alien-id/sso-react', deps: ['@alien-id/sso'] },
    { name: '@alien-id/sso', deps: [] },
  ]).map((p) => p.name);
  assert.ok(order.indexOf('@alien-id/sso') < order.indexOf('@alien-id/sso-react'));
});

test('topoSort: full SSO graph publishes cores before their react packages', () => {
  const order = topoSort([
    { name: '@alien-id/sso-react', deps: ['@alien-id/sso'] },
    { name: '@alien-id/sso-solana-react', deps: ['@alien-id/sso-solana'] },
    { name: '@alien-id/sso', deps: [] },
    { name: '@alien-id/sso-solana', deps: [] },
    { name: '@alien-id/sso-agent-id', deps: [] },
  ]).map((p) => p.name);
  assert.ok(order.indexOf('@alien-id/sso') < order.indexOf('@alien-id/sso-react'));
  assert.ok(
    order.indexOf('@alien-id/sso-solana') < order.indexOf('@alien-id/sso-solana-react'),
  );
  assert.equal(order.length, 5);
});

test('topoSort: deterministic ordering for independent leaves', () => {
  const run = () =>
    topoSort([
      { name: 'c', deps: [] },
      { name: 'a', deps: [] },
      { name: 'b', deps: [] },
    ]).map((p) => p.name);
  assert.deepEqual(run(), ['a', 'b', 'c']);
  assert.deepEqual(run(), run());
});

test('topoSort: throws on a dependency cycle', () => {
  assert.throws(
    () => topoSort([
      { name: 'a', deps: ['b'] },
      { name: 'b', deps: ['a'] },
    ]),
    /cycle/i,
  );
});
