/**
 * Local id_token verifier — minimal JWS RS256 + claims validation.
 *
 * Mirrors the Python SDK's `_verify.py`: full OIDC §3.1.3.7 / RFC 7519 §7.2
 * validation so callers receive only claims from a fully-verified id_token.
 * Browser-compatible — uses Web Crypto (SubtleCrypto). RS256 only, since
 * that is what the SSO backend mints for OIDC.
 */

const DEFAULT_JWKS_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_SEC = 30;

export interface JWK {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

export interface JWKS {
  keys: JWK[];
}

export interface ParsedJwt {
  headerB64: string;
  payloadB64: string;
  signatureB64: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface VerifyIdTokenOptions {
  jwks: JWKS;
  expectedIssuer: string;
  expectedAudience: string;
  expectedNonce?: string;
  clockSkewSec?: number;
  /**
   * OIDC Core 1.0 §3.1.3.7 step 3: "The ID Token MUST be rejected if it
   * contains additional audiences not trusted by the Client." When
   * omitted, the trust set is `{expectedAudience}` — any extra audience
   * is rejected. Pass an explicit list to widen the trust set (e.g. for
   * federated/RFC 8707 resource-indicator scenarios). `expectedAudience`
   * is implicitly trusted regardless of this list.
   */
  trustedAudiences?: readonly string[];
}

export interface VerifiedIdToken {
  payload: Record<string, unknown>;
}

// RFC 4648 §5 / RFC 7515 §2: base64url is [A-Za-z0-9_-] with no padding,
// "without the inclusion of any line breaks, whitespace, or other additional
// characters". Reject anything outside the canonical alphabet so RFC 7519
// §7.2 holds before we touch crypto.
const BASE64URL_REGEX = /^[A-Za-z0-9_-]*$/;

function b64urlToBytes(s: string): Uint8Array {
  if (!BASE64URL_REGEX.test(s)) {
    throw new Error('Invalid base64url: contains characters outside RFC 4648 §5 alphabet');
  }
  // RFC 4648 §5: a 4-char group decodes to 3 bytes; residue 1 is never
  // produced by canonical encoding and indicates corruption.
  if (s.length % 4 === 1) {
    throw new Error('Invalid base64url: invalid length');
  }
  let pad = s.replace(/-/g, '+').replace(/_/g, '/');
  while (pad.length % 4) pad += '=';
  const bin = atob(pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}

export function parseJwt(token: string): ParsedJwt {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 parts');
  }
  const header = JSON.parse(b64urlToString(parts[0]));
  const payload = JSON.parse(b64urlToString(parts[1]));
  if (
    header === null ||
    typeof header !== 'object' ||
    Array.isArray(header) ||
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw new Error('Invalid JWT: header/payload must be JSON objects');
  }
  return {
    headerB64: parts[0],
    payloadB64: parts[1],
    signatureB64: parts[2],
    header,
    payload,
  };
}

function getSubtle(): SubtleCrypto {
  const c =
    (typeof globalThis !== 'undefined' &&
      (globalThis as { crypto?: Crypto }).crypto) ||
    undefined;
  if (!c || !c.subtle) {
    throw new Error('SubtleCrypto unavailable');
  }
  return c.subtle;
}

// RFC 7518 §3.3 / RFC 8725 §3.5: RS256 keys MUST be ≥ 2048 bits. The JWK
// `n` parameter is the unsigned modulus encoded base64url with no leading
// zero byte (RFC 7518 §6.3.1), so 256 bytes corresponds to exactly 2048
// bits.
const MIN_RSA_MODULUS_BYTES = 256;

async function verifyRs256(
  jwt: ParsedJwt,
  jwk: JWK,
): Promise<boolean> {
  if (typeof jwk.n !== 'string' || b64urlToBytes(jwk.n).length < MIN_RSA_MODULUS_BYTES) {
    return false;
  }
  const subtle = getSubtle();
  // RFC 7517 §4: import the JWK as an RSA public key.
  const key = await subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n!, e: jwk.e!, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signingInput = new TextEncoder().encode(
    `${jwt.headerB64}.${jwt.payloadB64}`,
  );
  const sig = b64urlToBytes(jwt.signatureB64);
  return subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    sig as unknown as ArrayBuffer,
    signingInput as unknown as ArrayBuffer,
  );
}

function selectJwk(jwks: JWKS, kid: unknown, alg: string): JWK | null {
  for (const k of jwks.keys ?? []) {
    if (!k || typeof k !== 'object') continue;
    if (k.kty !== 'RSA') continue;
    if (typeof kid === 'string' && k.kid !== kid) continue;
    // RFC 7515 §10.7: when JWK pins alg, it MUST match.
    if (k.alg !== undefined && k.alg !== alg) continue;
    if (k.use !== undefined && k.use !== 'sig') continue;
    if (typeof k.n !== 'string' || typeof k.e !== 'string') continue;
    return k;
  }
  return null;
}

function isNumericDate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export async function verifyIdToken(
  token: string,
  opts: VerifyIdTokenOptions,
): Promise<VerifiedIdToken | null> {
  const skewSec = opts.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC;

  let jwt: ParsedJwt;
  try {
    jwt = parseJwt(token);
  } catch {
    return null;
  }

  // RFC 7515 §4.1.9 + RFC 6838 §4.2: typ comparison is case-insensitive;
  // bare value gets `application/` prepended. id_tokens use `JWT`.
  const typRaw = jwt.header.typ;
  const typLower = typeof typRaw === 'string' ? typRaw.toLowerCase() : 'jwt';
  if (typLower !== 'jwt' && typLower !== 'application/jwt') {
    return null;
  }

  // RFC 7515 §4.1.1 — alg is REQUIRED. RFC 8725 §3.1 — reject `none`.
  if (jwt.header.alg !== 'RS256') {
    return null;
  }

  // RFC 7515 §4.1.11: any unrecognised critical header MUST cause rejection.
  // We support no extensions, so any non-empty `crit` is fatal.
  const crit = jwt.header.crit;
  if (crit !== undefined) {
    if (!Array.isArray(crit) || crit.length > 0) return null;
  }

  const jwk = selectJwk(opts.jwks, jwt.header.kid, 'RS256');
  if (!jwk) return null;

  let sigOk = false;
  try {
    sigOk = await verifyRs256(jwt, jwk);
  } catch {
    return null;
  }
  if (!sigOk) return null;

  const payload = jwt.payload;

  // OIDC §3.1.3.7.2 / RFC 7519 §4.1.1.
  if (payload.iss !== opts.expectedIssuer) return null;

  // RFC 7519 §4.1.2 / OIDC §2 / OIDC Core §3.1.3.7: `sub` is REQUIRED on
  // an id_token. Reject missing or non-string subjects before any caller
  // can trust the parsed payload — the schema layer also rejects, but
  // the type-check belongs at the verifier boundary so callers cannot
  // bypass it by parsing the payload directly.
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return null;
  }

  // OIDC §3.1.3.7.3 / RFC 7519 §4.1.3.
  const audClaim = payload.aud;
  const audList = Array.isArray(audClaim) ? audClaim : [audClaim];
  if (!audList.includes(opts.expectedAudience)) return null;

  // OIDC §3.1.3.7 step 3: reject when any aud entry is outside the
  // trusted set. Default trust set is {expectedAudience}.
  const trusted = new Set<unknown>(
    opts.trustedAudiences ?? [opts.expectedAudience],
  );
  trusted.add(opts.expectedAudience);
  for (const a of audList) {
    if (!trusted.has(a)) return null;
  }

  // OIDC §3.1.3.7.6: multi-aud requires `azp` present and equal client_id.
  // §3.1.3.7.7: when present, azp MUST equal client_id.
  const azp = payload.azp;
  if (audList.length > 1 && azp === undefined) return null;
  if (azp !== undefined && azp !== opts.expectedAudience) return null;

  // RFC 7519 §4.1.4: exp is REQUIRED-by-OIDC NumericDate; reject when current
  // time is past exp (allowing skew).
  const now = Math.floor(Date.now() / 1000);
  const exp = payload.exp;
  if (!isNumericDate(exp)) return null;
  if (now - skewSec >= exp) return null;

  // RFC 7519 §4.1.5: nbf, when present, MUST be a NumericDate; reject when
  // current time is before nbf.
  const nbf = payload.nbf;
  if (nbf !== undefined) {
    if (!isNumericDate(nbf)) return null;
    if (now + skewSec < nbf) return null;
  }

  // RFC 7519 §4.1.6: iat, when present, MUST be a NumericDate.
  const iat = payload.iat;
  if (iat !== undefined && !isNumericDate(iat)) return null;

  // OIDC §3.1.3.7.11: when caller supplies expectedNonce, payload.nonce MUST
  // match exactly.
  if (opts.expectedNonce !== undefined && payload.nonce !== opts.expectedNonce) {
    return null;
  }

  return { payload };
}

export type JwksFetcher = (url: string) => Promise<JWKS>;

export async function fetchJwks(url: string): Promise<JWKS> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${res.status}`);
  }
  const json = (await res.json()) as JWKS;
  if (!json || !Array.isArray((json as { keys?: unknown }).keys)) {
    throw new Error('JWKS response missing keys[]');
  }
  return json;
}

export interface JwksCacheOptions {
  ttlMs?: number;
  fetcher?: JwksFetcher;
}

export class JwksCache {
  private readonly url: string;
  private readonly ttlMs: number;
  private readonly fetcher: JwksFetcher;
  private cached: JWKS | null = null;
  private fetchedAt = 0;

  constructor(url: string, opts: JwksCacheOptions = {}) {
    this.url = url;
    this.ttlMs = opts.ttlMs ?? DEFAULT_JWKS_TTL_MS;
    this.fetcher = opts.fetcher ?? fetchJwks;
  }

  async get(forceRefresh = false): Promise<JWKS> {
    const expired = Date.now() - this.fetchedAt > this.ttlMs;
    if (forceRefresh || this.cached === null || expired) {
      this.cached = await this.fetcher(this.url);
      this.fetchedAt = Date.now();
    }
    return this.cached;
  }

  inject(jwks: JWKS): void {
    this.cached = jwks;
    this.fetchedAt = Date.now();
  }
}
