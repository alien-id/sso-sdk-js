// Behavior test for /.well-known/alien-agent-id.json
// Invokes the route handler with a duck-typed NextRequest and validates
// the emitted JSON via agent-id's parseServiceManifest (the same parser
// that real consumers run). Cross-repo import keeps the contract honest.

import { test, expect } from "bun:test";
import { GET } from "../src/app/.well-known/alien-agent-id.json/route";
// @ts-expect-error — cross-repo absolute path; no types
import {
  parseServiceManifest,
  renderCapabilities,
  SERVICE_MANIFEST_MAX_BYTES,
} from "/Users/truehazker/Workspace/alien/agent-id/skills/alien-agent-id/lib.mjs";

const fakeReq = {
  nextUrl: new URL("http://localhost:3000/.well-known/alien-agent-id.json"),
} as unknown as Parameters<typeof GET>[0];

test("emits version 2 with operations[]", async () => {
  const res = await GET(fakeReq);
  const manifest = await res.json();
  expect(manifest.version).toBe(2);
  expect(Array.isArray(manifest.api.operations)).toBe(true);
  expect(manifest.api.operations.length).toBe(11);
});

test("stays under the 8 KiB manifest size cap", async () => {
  const res = await GET(fakeReq);
  const body = await res.text();
  expect(Buffer.byteLength(body, "utf8")).toBeLessThan(SERVICE_MANIFEST_MAX_BYTES);
});

test("validates against agent-id's parseServiceManifest", async () => {
  const res = await GET(fakeReq);
  const manifest = await res.json();
  const out = parseServiceManifest(manifest, "localhost:3000", { allowInsecure: true });
  expect(out.version).toBe(2);
  expect(out.api.operations.length).toBe(11);
  const names = out.api.operations.map((op: { name: string }) => op.name);
  expect(names).toContain("createPost");
  expect(names).toContain("deletePost");
  expect(names).toContain("whoami");
});

test("renderCapabilities produces a Call: line per operation", async () => {
  const res = await GET(fakeReq);
  const manifest = await res.json();
  const out = parseServiceManifest(manifest, "localhost:3000", { allowInsecure: true });
  const md = renderCapabilities(out);
  expect(md).toContain("# Alienbook — operations");
  expect(md).toContain("Call: `node CLI call --url http://localhost:3000/api/posts --method POST --body-file");
  expect(md).toContain("Call: `node CLI call --url http://localhost:3000/api/posts/{id} --method DELETE`");
  expect(md).toContain("destructive — confirm before calling");
});
