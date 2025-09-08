import nock from 'nock';
import base64url from 'base64url';

export const initializeSsoMock = (baseUrl) => {
  nock(baseUrl).get('/health').reply(200);
  nock(baseUrl)
    .post('/authorize')
    .reply(200, {
      deep_link: 'alienapp://authorize_session',
      polling_code: 'polling-code-test-1234-5678',
      expired_at: Math.floor(Date.now() / 1000) + 300,
    });
  nock(baseUrl).post('/poll').reply(200, {
    status: 'authorized',
    authorization_code: 'auth-code-test-1234-5678',
  });

  const tokenHeader = JSON.stringify({
    alg: 'HS256',
    typ: 'JWT',
  });
  const tokenPayload = JSON.stringify({
    app_callback_payload: JSON.stringify({
      session_address: 'session-address-test',
    }),
    app_callback_session_signature: 'test-session-signature',
    app_callback_session_address: 'session-address-test',
    expired_at: Math.floor(Date.now() / 1000) + 3600,
    issued_at: Math.floor(Date.now() / 1000),
  });
  nock(baseUrl)
    .post('/access_token/exchange')
    .reply(200, {
      access_token: [
        base64url.encode(tokenHeader),
        base64url.encode(tokenPayload),
        'access-token-signature-test-1234-5678',
      ].join('.'),
    });

  nock(baseUrl).post('/access_token/verify').reply(200, {
    is_valid: true,
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
