import { AlienSolanaSsoClient } from '../src/client';

describe('generateDeeplink — wallet_name', () => {
  const config = {
    ssoBaseUrl: 'https://sso.develop.alien-api.com',
    providerAddress: '00000001040000000000000100000000',
  };

  const linkResponse = {
    deep_link: 'https://s.alien-api.com/abc',
    polling_code: 'poll-code',
    expired_at: 1780000000,
  };

  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => linkResponse,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const getBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  it('includes wallet_name when provided', async () => {
    const client = new AlienSolanaSsoClient(config);
    await client.generateDeeplink('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 'phantom');

    expect(getBody()).toEqual({
      solana_address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      wallet_name: 'phantom',
    });
  });

  it('omits wallet_name when not provided', async () => {
    const client = new AlienSolanaSsoClient(config);
    await client.generateDeeplink('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');

    const body = getBody();
    expect(body).toEqual({
      solana_address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    });
    expect(body).not.toHaveProperty('wallet_name');
  });
});
