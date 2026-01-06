import nock from 'nock';
import base64url from 'base64url';

export const initializeSsoMock = (baseUrl) => {
  nock(baseUrl).get('/sso/health').reply(200);

  // OAuth2 authorize endpoint (GET with query params, response_mode=json)
  nock(baseUrl)
    .persist()
    .get(/\/oauth\/authorize.*/)
    .reply(200, {
      deep_link: 'alienapp://authorize_session',
      polling_code: 'polling-code-test-1234-5678',
      expired_at: Math.floor(Date.now() / 1000) + 300,
    });

  // OAuth2 poll endpoint
  nock(baseUrl).persist().post('/oauth/poll').reply(200, {
    status: 'authorized',
    authorization_code: 'auth-code-test-1234-5678',
  });

  // Create OIDC-compliant JWT tokens
  const tokenHeader = JSON.stringify({
    alg: 'EdDSA',
    typ: 'JWT',
  });
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = JSON.stringify({
    iss: 'https://sso.alien.com',
    sub: 'session-address-test',
    aud: 'provider-address-test',
    exp: now + 3600,
    iat: now,
  });
  const accessToken = [
    base64url.encode(tokenHeader),
    base64url.encode(tokenPayload),
    'access-token-signature-test-1234-5678',
  ].join('.');
  const idToken = [
    base64url.encode(tokenHeader),
    base64url.encode(tokenPayload),
    'id-token-signature-test-1234-5678',
  ].join('.');

  // OAuth2 token endpoint (form-urlencoded)
  nock(baseUrl)
    .persist()
    .post('/oauth/token')
    .reply(200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken,
    });

  // OAuth2 userinfo endpoint
  nock(baseUrl).persist().get('/oauth/userinfo').reply(200, {
    sub: 'session-address-test',
  });
};

export const initializeLocalStorageMock = () => {
  class LocalStorageMock {
    store: Record<string, any>;

    constructor() {
      this.store = {};
    }

    clear() {
      this.store = {};
    }

    getItem(key) {
      return this.store[key] || null;
    }

    setItem(key, value) {
      this.store[key] = String(value);
    }

    removeItem(key) {
      delete this.store[key];
    }
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  global.localStorage = new LocalStorageMock();
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  global.sessionStorage = new LocalStorageMock();
};
