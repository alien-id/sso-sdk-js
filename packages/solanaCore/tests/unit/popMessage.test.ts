import { createPublicKey, verify } from 'node:crypto';
import { buildPopMessage } from '../../src/pop';
import popVector from '../fixtures/popVector.json';

/**
 * The PoP message format is a cross-service contract: the server reconstructs
 * these exact bytes (sso/internal/handler/solana_nonce.go `BuildPopMessage`)
 * before Ed25519-verifying the wallet signature. If this test changes, the Go
 * side MUST change identically or every signature will be rejected.
 */
describe('buildPopMessage', () => {
  it('produces the exact byte layout the server reconstructs', () => {
    const address = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    const nonce = 'abc123';

    expect(buildPopMessage(address, nonce)).toBe(
      'Alien SSO: prove wallet control.\n' +
        `Wallet: ${address}\n` +
        `Nonce: ${nonce}`,
    );
  });

  it('binds both the address and the nonce into the signed bytes', () => {
    expect(buildPopMessage('ADDR', 'N1')).not.toBe(
      buildPopMessage('ADDR', 'N2'),
    );
    expect(buildPopMessage('A1', 'N')).not.toBe(buildPopMessage('A2', 'N'));
  });

  /**
   * Cross-language vector (F-04). This fixture is byte-identical to the Go
   * server's testdata/pop_vector.json. Asserting that buildPopMessage rebuilds
   * the exact `message` AND that a real Ed25519 signature verifies over those
   * bytes guarantees the JS and Go message formats cannot silently diverge: if
   * either side changes the layout, its half of this paired test fails.
   */
  it('matches the shared cross-language Ed25519 vector', () => {
    const message = buildPopMessage(popVector.address, popVector.nonce);
    expect(message).toBe(popVector.message);

    // Build an Ed25519 public key from the raw 32 bytes via JWK (x = base64url).
    const rawPub = Buffer.from(popVector.pubkey_b64, 'base64');
    const publicKey = createPublicKey({
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: rawPub.toString('base64url'),
      },
      format: 'jwk',
    });

    const verified = verify(
      null,
      Buffer.from(message, 'utf8'),
      publicKey,
      Buffer.from(popVector.signature_b64, 'base64'),
    );
    expect(verified).toBe(true);
  });
});
