import { AlienSsoSdkClient } from '../../src/client';

describe('AlienSsoSdkClient', () => {
  let client: AlienSsoSdkClient;

  beforeEach(() => {
    client = new AlienSsoSdkClient({
      serverSdkBaseUrl: 'http://localhost:3000',
      ssoBaseUrl: 'https://sso.alien.com',
    });
  });

  describe('generateCodeVerifier', () => {
    it('should return a non-empty string', () => {
      const codeVerifier = (client as any).generateCodeVerifier();
      expect(typeof codeVerifier).toBe('string');
      expect(codeVerifier.length).toBeGreaterThan(0);
    });

    it('should return a base64url-encoded string', () => {
      const codeVerifier = (client as any).generateCodeVerifier();
      // Base64url: only letters, numbers, -, _
      expect(codeVerifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('should return different values on consecutive calls', () => {
      const v1 = (client as any).generateCodeVerifier();
      const v2 = (client as any).generateCodeVerifier();
      expect(v1).not.toBe(v2);
    });
  });

  describe('generateCodeChallenge', () => {
    it('should return a hex string of SHA-256 hash', async () => {
      const codeVerifier = 'test-verifier';
      const challenge = await (client as any).generateCodeChallenge(
        codeVerifier,
      );

      expect(typeof challenge).toBe('string');
      expect(challenge).toMatch(/^[a-f0-9]+$/); // hex only
      expect(challenge.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
    });

    it('should return consistent hash for same verifier', async () => {
      const verifier = 'same-verifier';
      const hash1 = await (client as any).generateCodeChallenge(verifier);
      const hash2 = await (client as any).generateCodeChallenge(verifier);
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different verifiers', async () => {
      const hash1 = await (client as any).generateCodeChallenge('verifier1');
      const hash2 = await (client as any).generateCodeChallenge('verifier2');
      expect(hash1).not.toBe(hash2);
    });
  });
});
