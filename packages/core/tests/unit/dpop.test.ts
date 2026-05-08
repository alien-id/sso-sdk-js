import {
  createDPoPKeypair,
  createDPoPProof,
  dpopJwkThumbprint,
} from '../../src/dpop';

function decodeJwtSegment(seg: string): unknown {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? b64 + '='.repeat(4 - (b64.length % 4)) : b64;
  return JSON.parse(Buffer.from(pad, 'base64').toString('utf-8'));
}

describe('dpopJwkThumbprint', () => {
  test('matches RFC 8037 Appendix A.3 Ed25519 vector', async () => {
    // RFC 8037 §A.3 example: x = "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
    // produces thumbprint "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k".
    const jwk = {
      kty: 'OKP',
      crv: 'Ed25519',
      x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
    } as const;
    expect(await dpopJwkThumbprint(jwk)).toBe(
      'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k',
    );
  });
});

describe('createDPoPKeypair', () => {
  test('emits public JWK with kty=OKP, crv=Ed25519 and a non-empty x', async () => {
    const kp = await createDPoPKeypair();
    expect(kp.publicJwk.kty).toBe('OKP');
    expect(kp.publicJwk.crv).toBe('Ed25519');
    expect(typeof kp.publicJwk.x).toBe('string');
    expect(kp.publicJwk.x.length).toBeGreaterThan(0);
  });
});

describe('createDPoPProof', () => {
  test('produces a 3-segment JWT whose header has typ=dpop+jwt, alg=EdDSA, public-only jwk', async () => {
    const kp = await createDPoPKeypair();
    const proof = await createDPoPProof(kp, {
      htm: 'POST',
      htu: 'https://sso.example/oauth/token',
    });
    const parts = proof.split('.');
    expect(parts).toHaveLength(3);
    const header = decodeJwtSegment(parts[0]) as Record<string, unknown>;
    expect(header.typ).toBe('dpop+jwt');
    expect(header.alg).toBe('EdDSA');
    const jwk = header.jwk as Record<string, unknown>;
    expect(jwk.kty).toBe('OKP');
    expect(jwk.crv).toBe('Ed25519');
    expect(typeof jwk.x).toBe('string');
    // RFC 9449 §4.1: jwk MUST be the public key — no private members.
    for (const priv of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']) {
      expect(jwk[priv]).toBeUndefined();
    }
  });

  test('payload carries htm preserved, canonicalised htu, NumericDate iat, and a jti', async () => {
    const kp = await createDPoPKeypair();
    const before = Math.floor(Date.now() / 1000);
    const proof = await createDPoPProof(kp, {
      htm: 'POST',
      // Trailing query/fragment MUST be stripped per RFC 9449 §4.3.
      htu: 'https://sso.example/oauth/token?foo=1#bar',
    });
    const after = Math.ceil(Date.now() / 1000);
    const payload = decodeJwtSegment(proof.split('.')[1]) as Record<string, unknown>;
    expect(payload.htm).toBe('POST');
    expect(payload.htu).toBe('https://sso.example/oauth/token');
    expect(typeof payload.iat).toBe('number');
    expect(payload.iat as number).toBeGreaterThanOrEqual(before);
    expect(payload.iat as number).toBeLessThanOrEqual(after);
    expect(typeof payload.jti).toBe('string');
    expect((payload.jti as string).length).toBeGreaterThan(0);
  });

  test('payload includes ath = base64url(SHA-256(accessToken)) when provided', async () => {
    const kp = await createDPoPKeypair();
    const proof = await createDPoPProof(kp, {
      htm: 'GET',
      htu: 'https://sso.example/oauth/userinfo',
      accessToken: 'access_token_xyz',
    });
    const payload = decodeJwtSegment(proof.split('.')[1]) as Record<string, unknown>;
    // base64url(SHA-256("access_token_xyz")) — precomputed.
    const expectedAth = Buffer.from(
      require('crypto')
        .createHash('sha256')
        .update('access_token_xyz')
        .digest(),
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(payload.ath).toBe(expectedAth);
  });

  test('payload omits ath when no accessToken supplied', async () => {
    const kp = await createDPoPKeypair();
    const proof = await createDPoPProof(kp, {
      htm: 'POST',
      htu: 'https://sso.example/oauth/token',
    });
    const payload = decodeJwtSegment(proof.split('.')[1]) as Record<string, unknown>;
    expect(payload.ath).toBeUndefined();
  });

  test('payload includes nonce when provided', async () => {
    const kp = await createDPoPKeypair();
    const proof = await createDPoPProof(kp, {
      htm: 'POST',
      htu: 'https://sso.example/oauth/token',
      nonce: 'srv-nonce-abc',
    });
    const payload = decodeJwtSegment(proof.split('.')[1]) as Record<string, unknown>;
    expect(payload.nonce).toBe('srv-nonce-abc');
  });

  test('signature verifies with the embedded public jwk', async () => {
    const kp = await createDPoPKeypair();
    const proof = await createDPoPProof(kp, {
      htm: 'POST',
      htu: 'https://sso.example/oauth/token',
    });
    const [h, p, s] = proof.split('.');
    const header = decodeJwtSegment(h) as { jwk: JsonWebKey };
    const verifyKey = await crypto.subtle.importKey(
      'jwk',
      header.jwk,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const sig = Uint8Array.from(
      Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    );
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      verifyKey,
      sig,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });
});
