import { AlienSsoClient } from '../../src/client';
import fetch from 'cross-fetch';
import nock from 'nock';
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
      refresh_token: expect.any(String),
    });

    // Step 4: Verify auth via userinfo endpoint
    const userInfo = await client.verifyAuth();
    expect(userInfo).toEqual({
      sub: expect.any(String),
    });

    // Step 5: Check parsed token data (OIDC claims). `nonce` is present
    // because the SDK sent one on /authorize (OIDC §3.1.2.1) and the
    // mock SSO replays it in the issued id_token (§3.1.3.7.11). Realistic
    // post-cutover flows always carry nonce — only refresh-grant id_tokens
    // omit it.
    const tokenInfo = client.getAuthData();
    expect(tokenInfo).toEqual({
      iss: expect.any(String),
      sub: expect.any(String),
      aud: expect.any(String),
      exp: expect.any(Number),
      iat: expect.any(Number),
      nonce: expect.any(String),
    });

    // Step 6: Check helper methods
    expect(client.getSubject()).toEqual(expect.any(String));
    expect(client.isTokenExpired()).toBe(false);
  });

  // RFC 6749 §10.12: "the client MUST utilize the 'state' request parameter
  // to prevent CSRF". Even in poll-mode flow we mint and persist state so a
  // future redirect-mode integration inherits CSRF protection by default.
  it('emits a CSPRNG-backed state parameter on authorize and persists it', async () => {
    let observedAuthorizeQuery = '';
    nock.cleanAll();
    nock(SSO_BASE_URL)
      .persist()
      .get(/\/oauth\/authorize.*/)
      .reply(function (uri) {
        observedAuthorizeQuery = uri;
        return [
          200,
          {
            deep_link: 'alienapp://authorize_session',
            polling_code: 'polling-code-test-1234-5678',
            expired_at: Math.floor(Date.now() / 1000) + 300,
          },
        ];
      });

    await client.generateDeeplink();

    const url = new URL(observedAuthorizeQuery, SSO_BASE_URL);
    const sentState = url.searchParams.get('state');
    expect(sentState).not.toBeNull();
    expect(sentState!.length).toBeGreaterThanOrEqual(20);
    expect(sessionStorage.getItem('alien-sso_state')).toBe(sentState);

    // Restore the default mock set so subsequent tests in this file pass.
    nock.cleanAll();
    initializeSsoMock(SSO_BASE_URL);
  });

  // RFC 6749 §10.12: when the client sent `state` on /authorize, it MUST
  // verify the AS echoed the same value back. The SDK now enforces this.
  it('rejects pollAuth when response state does not match persisted state', async () => {
    nock.cleanAll();
    nock(SSO_BASE_URL)
      .persist()
      .get(/\/oauth\/authorize.*/)
      .reply(200, {
        deep_link: 'alienapp://authorize_session',
        polling_code: 'polling-code-test-mismatch',
        expired_at: Math.floor(Date.now() / 1000) + 300,
      });
    nock(SSO_BASE_URL).persist().post('/oauth/poll').reply(200, {
      status: 'authorized',
      authorization_code: 'auth-code-mismatch',
      state: 'attacker-controlled-state-value',
    });

    const authorize = await client.generateDeeplink();
    await expect(client.pollAuth(authorize.polling_code)).rejects.toThrow(
      /state/i,
    );

    initializeSsoMock(SSO_BASE_URL);
  });

  it('rejects pollAuth when response is missing state but state was sent', async () => {
    nock.cleanAll();
    nock(SSO_BASE_URL)
      .persist()
      .get(/\/oauth\/authorize.*/)
      .reply(200, {
        deep_link: 'alienapp://authorize_session',
        polling_code: 'polling-code-test-missing',
        expired_at: Math.floor(Date.now() / 1000) + 300,
      });
    nock(SSO_BASE_URL).persist().post('/oauth/poll').reply(200, {
      status: 'authorized',
      authorization_code: 'auth-code-missing',
    });

    const authorize = await client.generateDeeplink();
    await expect(client.pollAuth(authorize.polling_code)).rejects.toThrow(
      /state/i,
    );

    nock.cleanAll();
    initializeSsoMock(SSO_BASE_URL);
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
