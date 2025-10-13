import { AlienSsoClient } from '../../src/client';
import fetch from 'cross-fetch';
import { initializeLocalStorageMock, initializeSsoMock } from '../mock';

global.fetch = fetch;

const config = {
  providerAddress: '00000001000000000000000000000000',
  providerPrivateKey:
    'c366d7b8eb1396a486d6a8f8ed1ae5a94b9923264e827e9e33aa6d4b702cf177',
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
    const authorizeResponse = await client.getAuthDeeplink();
    expect(authorizeResponse).toEqual({
      deep_link: expect.any(String),
      polling_code: expect.any(String),
      expired_at: expect.any(Number),
    });

    const authCode = await client.pollAuth(authorizeResponse.polling_code);
    expect(authCode).toEqual(expect.any(String));

    const accessToken = await client.exchangeToken(authCode);
    expect(accessToken).toEqual(expect.any(String));

    const isValid = await client.verifyAuth();
    expect(isValid).toEqual(true);

    const userInfo = client.getAuthData();
    expect(userInfo).toEqual({
      app_callback_session_address: expect.any(String),
      expired_at: expect.any(Number),
      issued_at: expect.any(Number),
    });
  });

  it('successful logout', async () => {
    client.logout();
    await expect(client.verifyAuth()).rejects.toThrow();
  });
});
