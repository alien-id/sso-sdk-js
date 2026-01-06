import { AlienSsoClient } from '../../src/client';
import fetch from 'cross-fetch';
import { initializeLocalStorageMock, initializeSsoMock } from '../mock';

global.fetch = fetch;

const config = {
  providerAddress: '00000001000000000000000000000000',
};

const SSO_BASE_URL = 'http://localhost:3001';

describe('SSO Integration', () => {
  let client: AlienSsoClient;

  beforeAll(() => {
    client = new AlienSsoClient({
      ssoBaseUrl: SSO_BASE_URL,
      providerAddress: config.providerAddress,
    });

    initializeLocalStorageMock();
    initializeSsoMock(SSO_BASE_URL);
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('successful SSO flow', async () => {
    // Step 1: Generate deeplink
    const authorizeResponse = await client.generateDeeplink();
    expect(authorizeResponse).toEqual({
      deep_link: expect.any(String),
      polling_code: expect.any(String),
      expired_at: expect.any(Number),
    });

    // Step 2: Poll for authorization
    const pollResponse = await client.pollAuth(authorizeResponse.polling_code);
    expect(pollResponse.status).toEqual('authorized');
    expect(pollResponse.authorization_code).toEqual(expect.any(String));

    // Step 3: Exchange authorization code for tokens
    const tokenResponse = await client.exchangeToken(pollResponse.authorization_code!);
    expect(tokenResponse).toEqual({
      access_token: expect.any(String),
      token_type: 'Bearer',
      expires_in: expect.any(Number),
      id_token: expect.any(String),
    });

    // Step 4: Verify auth via userinfo endpoint
    const userInfo = await client.verifyAuth();
    expect(userInfo).toEqual({
      sub: expect.any(String),
    });

    // Step 5: Check parsed token data (OIDC claims)
    const tokenInfo = client.getAuthData();
    expect(tokenInfo).toEqual({
      iss: expect.any(String),
      sub: expect.any(String),
      aud: expect.any(String),
      exp: expect.any(Number),
      iat: expect.any(Number),
    });

    // Step 6: Check helper methods
    expect(client.getSubject()).toEqual(expect.any(String));
    expect(client.isTokenExpired()).toBe(false);
  });

  it('successful logout', async () => {
    // First authenticate
    const authorizeResponse = await client.generateDeeplink();
    const pollResponse = await client.pollAuth(authorizeResponse.polling_code);
    await client.exchangeToken(pollResponse.authorization_code!);

    // Then logout
    client.logout();

    // Verify tokens are cleared
    expect(client.getAccessToken()).toBeNull();
    expect(client.getIdToken()).toBeNull();
    expect(client.getAuthData()).toBeNull();
  });
});
