import { buildPopMessage, verifyPopSignature } from '../../src/pop';
import popVector from '../fixtures/popVector.json';

/**
 * `verifyPopSignature` is the backend-side half of proof-of-possession: standard
 * Ed25519 over the bytes `buildPopMessage` produced, with no Alien call. These
 * tests reuse the canonical cross-language vector (a real signature over the
 * real message), so they also guard against the verify path drifting from the
 * shared PoP message format.
 */
describe('verifyPopSignature', () => {
  const { address, nonce, message, signature_b64 } = popVector;

  it('accepts a valid signature over the canonical vector', () => {
    expect(verifyPopSignature(address, message, signature_b64)).toBe(true);
  });

  it('accepts the message rebuilt from address + nonce', () => {
    expect(
      verifyPopSignature(address, buildPopMessage(address, nonce), signature_b64),
    ).toBe(true);
  });

  it('accepts raw byte inputs as well as encoded strings', () => {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = Uint8Array.from(
      Buffer.from(signature_b64, 'base64'),
    );
    expect(verifyPopSignature(address, messageBytes, signatureBytes)).toBe(true);
  });

  it('rejects a signature over a different message', () => {
    expect(
      verifyPopSignature(address, buildPopMessage(address, 'other-nonce'), signature_b64),
    ).toBe(false);
  });

  it('rejects a signature checked against a different wallet', () => {
    // A well-formed but unrelated Solana address (32-byte base58 pubkey).
    const otherWallet = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    expect(verifyPopSignature(otherWallet, message, signature_b64)).toBe(false);
  });

  it('returns false (never throws) on malformed input', () => {
    expect(verifyPopSignature('not-base58-!!!', message, signature_b64)).toBe(false);
    expect(verifyPopSignature(address, message, 'not-base64-!!!')).toBe(false);
    expect(verifyPopSignature(address, message, 'AAAA')).toBe(false); // wrong length
  });
});
