import { generateKeyPairSync, createSign, createPublicKey } from 'node:crypto';
import {
  fetchJwks,
  JwksCache,
  parseJwt,
  verifyIdToken,
} from '../../src/verify';

const ISSUER = 'https://sso.alien.com';
const AUDIENCE = '0xProvider';

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeRsaKeyPair(): { privateKeyPem: string; jwk: any; kid: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = 'k1';
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' },
    kid,
  };
}

function signRs256(headerObj: object, payloadObj: object, privateKeyPem: string): string {
  const headerB64 = b64url(JSON.stringify(headerObj));
  const payloadB64 = b64url(JSON.stringify(payloadObj));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = createSign('sha256');
  signer.update(signingInput);
  const sig = signer.sign(privateKeyPem);
  return `${signingInput}.${b64url(sig)}`;
}

describe('parseJwt', () => {
  it('throws on tokens without 3 parts (RFC 7519 §7.2)', () => {
    expect(() => parseJwt('a.b')).toThrow();
    expect(() => parseJwt('a.b.c.d')).toThrow();
  });

  it('parses a well-formed JWT into header/payload/segments', () => {
    const header = { alg: 'RS256', typ: 'JWT', kid: 'k1' };
    const payload = { iss: ISSUER, sub: 'u', aud: AUDIENCE, exp: 1, iat: 0 };
    const token = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.sig`;
    const jwt = parseJwt(token);
    expect(jwt.header).toEqual(header);
    expect(jwt.payload).toEqual(payload);
  });

  it('throws when header or payload is not a JSON object', () => {
    const bad = `${b64url(JSON.stringify('not-an-object'))}.${b64url(JSON.stringify({}))}.s`;
    expect(() => parseJwt(bad)).toThrow();
  });

  // RFC 7515 §2 / RFC 4648 §5: base64url is [A-Za-z0-9_-] with no padding
  // and "without the inclusion of any line breaks, whitespace, or other
  // additional characters". Reject before any signature work.
  it('throws when a segment contains characters outside the base64url alphabet (RFC 7515 §2)', () => {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({ iss: 'i' }));
    // Whitespace inside a segment.
    expect(() => parseJwt(`${header}\n.${payload}.sig`)).toThrow(/base64url/i);
    // '+' (standard base64) is not part of the URL-safe alphabet.
    expect(() => parseJwt(`${header}.${payload}+.sig`)).toThrow(/base64url/i);
    // '=' padding is forbidden in JOSE base64url.
    expect(() => parseJwt(`${header}.${payload}=.sig`)).toThrow(/base64url/i);
  });
});

describe('verifyIdToken (OIDC §3.1.3.7 + RFC 7519 §7.2)', () => {
  const now = Math.floor(Date.now() / 1000);
  let keys: ReturnType<typeof makeRsaKeyPair>;
  let validHeader: object;
  let validPayload: any;

  beforeAll(() => {
    keys = makeRsaKeyPair();
  });

  beforeEach(() => {
    validHeader = { alg: 'RS256', typ: 'JWT', kid: keys.kid };
    validPayload = {
      iss: ISSUER,
      sub: 'user-1',
      aud: AUDIENCE,
      exp: now + 3600,
      iat: now,
    };
  });

  function jwks(): { keys: any[] } {
    return { keys: [keys.jwk] };
  }

  it('returns the verified payload on a well-formed RS256 id_token', async () => {
    const token = signRs256(validHeader, validPayload, keys.privateKeyPem);
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).not.toBeNull();
    expect(verified!.payload.sub).toBe('user-1');
  });

  it('rejects a tampered signature (RFC 7519 §7.2 / RFC 7515 §5.2)', async () => {
    const valid = signRs256(validHeader, validPayload, keys.privateKeyPem);
    const [h, p, s] = valid.split('.');
    // Flip the leading byte of the signature so the signed-bytes change.
    const sigBytes = Buffer.from(s, 'base64url');
    sigBytes[0] ^= 0xff;
    const tampered = `${h}.${p}.${b64url(sigBytes)}`;
    const verified = await verifyIdToken(tampered, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('rejects alg=none (RFC 7515 §4.1.1 / RFC 8725 §3.1)', async () => {
    const headerNone = { alg: 'none', typ: 'JWT', kid: keys.kid };
    const token = `${b64url(JSON.stringify(headerNone))}.${b64url(JSON.stringify(validPayload))}.`;
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('rejects when crit header is non-empty (RFC 7515 §4.1.11)', async () => {
    const token = signRs256(
      { ...validHeader, crit: ['exp'] },
      validPayload,
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('rejects when iss does not match expectedIssuer (OIDC §3.1.3.7.2)', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, iss: 'https://attacker.example' },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('rejects when aud does not contain expectedAudience (OIDC §3.1.3.7.3)', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, aud: 'someone-else' },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('accepts multi-aud when azp is present and equals expectedAudience (OIDC §3.1.3.7.6)', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, aud: [AUDIENCE, 'other'], azp: AUDIENCE },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
      trustedAudiences: [AUDIENCE, 'other'], // widen to focus on azp rule
    });
    expect(verified).not.toBeNull();
  });

  it('rejects multi-aud when azp is missing (OIDC §3.1.3.7.6)', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, aud: [AUDIENCE, 'other'] },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
      trustedAudiences: [AUDIENCE, 'other'], // widen to focus on azp rule
    });
    expect(verified).toBeNull();
  });

  // OIDC §3.1.3.7 step 3: "The ID Token MUST be rejected if it ... contains
  // additional audiences not trusted by the Client." Default trust set is
  // {expectedAudience}; an unwidened multi-aud token must be rejected even
  // when azp is present and matches.
  it('rejects multi-aud whose extra aud is not in default trust set (OIDC §3.1.3.7 step 3)', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, aud: [AUDIENCE, 'rogue'], azp: AUDIENCE },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('accepts multi-aud when caller explicitly widens trustedAudiences', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, aud: [AUDIENCE, 'ally'], azp: AUDIENCE },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
      trustedAudiences: [AUDIENCE, 'ally'],
    });
    expect(verified).not.toBeNull();
  });

  it('rejects when azp is present but does not match (OIDC §3.1.3.7.7)', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, azp: 'someone-else' },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('rejects when exp has passed (RFC 7519 §4.1.4)', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, exp: now - 3600 },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('rejects when exp is not a number (RFC 7519 §2 NumericDate)', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, exp: 'never' },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('rejects when nbf is in the future beyond clock skew (RFC 7519 §4.1.5)', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, nbf: now + 600 },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('rejects when iat is not a NumericDate (RFC 7519 §4.1.6)', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, iat: 'now' },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('enforces nonce match when expectedNonce is provided (OIDC §3.1.3.7.11)', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, nonce: 'n-correct' },
      keys.privateKeyPem,
    );
    const ok = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
      expectedNonce: 'n-correct',
    });
    expect(ok).not.toBeNull();
    const bad = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
      expectedNonce: 'n-wrong',
    });
    expect(bad).toBeNull();
  });

  it('rejects when no JWK matches kid (RFC 7515 §4.1.4)', async () => {
    const token = signRs256(
      { ...validHeader, kid: 'unknown' },
      validPayload,
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('accepts typ "application/JWT" long form (RFC 7515 §4.1.9)', async () => {
    const token = signRs256(
      { ...validHeader, typ: 'application/JWT' },
      validPayload,
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).not.toBeNull();
  });

  it('rejects id_token missing sub (RFC 7519 §4.1.2 / OIDC §3.1.3.7)', async () => {
    const { sub: _omit, ...rest } = validPayload;
    const token = signRs256(validHeader, rest, keys.privateKeyPem);
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('rejects id_token whose sub is the empty string', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, sub: '' },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });

  it('rejects id_token whose sub is a non-string (RFC 7519 §4.1.2)', async () => {
    const token = signRs256(
      validHeader,
      { ...validPayload, sub: 12345 },
      keys.privateKeyPem,
    );
    const verified = await verifyIdToken(token, {
      jwks: jwks(),
      expectedIssuer: ISSUER,
      expectedAudience: AUDIENCE,
    });
    expect(verified).toBeNull();
  });
});

describe('JwksCache', () => {
  it('refetches after TTL elapses', async () => {
    let calls = 0;
    const fakeFetch = async (): Promise<{ keys: any[] }> => {
      calls += 1;
      return { keys: [{ kid: `k${calls}`, kty: 'RSA', n: 'x', e: 'AQAB' }] };
    };
    const cache = new JwksCache('https://issuer.example/jwks', {
      ttlMs: 50,
      fetcher: fakeFetch,
    });
    const a = await cache.get();
    const b = await cache.get();
    expect(a).toBe(b);
    expect(calls).toBe(1);
    await new Promise((r) => setTimeout(r, 60));
    await cache.get();
    expect(calls).toBe(2);
  });

  it('inject seeds cache without HTTP', async () => {
    const cache = new JwksCache('https://issuer.example/jwks', {
      fetcher: async () => {
        throw new Error('should not call');
      },
    });
    cache.inject({ keys: [{ kid: 'k', kty: 'RSA', n: 'x', e: 'AQAB' }] });
    const got = await cache.get();
    expect(got.keys[0].kid).toBe('k');
  });
});

describe('fetchJwks', () => {
  it('throws when keys[] is missing', async () => {
    const origFetch = global.fetch;
    (global as any).fetch = async () => ({
      ok: true,
      json: async () => ({ not_keys: [] }),
    });
    try {
      await expect(fetchJwks('https://issuer.example/jwks')).rejects.toThrow();
    } finally {
      (global as any).fetch = origFetch;
    }
  });
});
