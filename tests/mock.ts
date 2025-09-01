import nock from 'nock';

export const initializeSsoMock = (baseUrl) => {
  nock(baseUrl).get('/health').reply(200);
  nock(baseUrl)
    .post('/authorize')
    .reply(200, {
      deep_link: 'alienapp://authorize_session',
      polling_code: 'test-1234-5678',
      expired_at: (Date.now() + 300) * 1000,
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
