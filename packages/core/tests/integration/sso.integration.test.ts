import { AlienSsoSdkClient } from '../../src/client';
import fetch from 'cross-fetch';
import * as http from 'node:http';
import { initializeLocalStorageMock, initializeSsoMock } from '../mock';

global.fetch = fetch;

const config = {
  providerAddress: '00000001000000000000000000000000',
  providerPrivateKey:
    'c366d7b8eb1396a486d6a8f8ed1ae5a94b9923264e827e9e33aa6d4b702cf177',
};

const SSO_BASE_URL = 'http://localhost:3001';

describe('SSO Integration', () => {
  let clientSdk: AlienSsoSdkClient;
  let server: http.Server;

  beforeAll(() => {
    clientSdk = new AlienSsoSdkClient({
      ssoBaseUrl: SSO_BASE_URL,
      providerAddress: config.providerAddress,
    });

    initializeLocalStorageMock();
    initializeSsoMock(SSO_BASE_URL);
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('successful SSO flow', async () => {
    const authorizeResponse = await clientSdk.getAuthDeeplink();
    expect(authorizeResponse).toEqual({
      deep_link: expect.any(String),
      polling_code: expect.any(String),
      expired_at: expect.any(Number),
    });

    const authCode = await clientSdk.pollAuth(authorizeResponse.polling_code);
    expect(authCode).toEqual(expect.any(String));

    const accessToken = await clientSdk.exchangeToken(authCode);
    expect(accessToken).toEqual(expect.any(String));

    const isValid = await clientSdk.verifyAuth();
    expect(isValid).toEqual(true);

    const userInfo = clientSdk.getAuthData();
    expect(userInfo).toEqual({
      app_callback_session_address: expect.any(String),
      expired_at: expect.any(Number),
      issued_at: expect.any(Number),
    });
  });

  it('successful logout', async () => {
    clientSdk.logout();
    await expect(clientSdk.verifyAuth()).rejects.toThrow();
  });
});
