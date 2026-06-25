import { vi } from 'vitest';

export const SSO_URL = 'http://localhost:4710';

// A unique providerAddress per test scopes the cache keys, so entries don't
// leak across tests on the module-level QueryClient.
let testSeq = 0;
export const makeConfig = () => ({
  ssoBaseUrl: SSO_URL,
  providerAddress: String(++testSeq).padStart(32, '0'),
  pollingInterval: 25,
});

export type SsoCalls = { authorize: number; poll: number; token: number };

export interface MockSsoOptions {
  /** Poll responses, one per poll call; the last entry repeats. */
  pollStatuses?: string[];
  /** When set, /oauth/token responds with this HTTP status instead of 200. */
  tokenStatus?: number;
}

/** In-process SSO server mocked at the global-fetch boundary. Returns a live
 *  call counter. */
export function mockSso({ pollStatuses = ['pending'], tokenStatus = 200 }: MockSsoOptions = {}) {
  const calls: SsoCalls = { authorize: 0, poll: 0, token: 0 };
  let state: string | null = null;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/oauth/authorize') {
        calls.authorize++;
        state = url.searchParams.get('state');
        return json({
          deep_link: `alien://auth?n=${calls.authorize}`,
          polling_code: `poll-code-${testSeq}-${calls.authorize}`,
          expired_at: Math.floor(Date.now() / 1000) + 300,
        });
      }
      if (url.pathname === '/oauth/poll') {
        calls.poll++;
        const status =
          pollStatuses[Math.min(calls.poll, pollStatuses.length) - 1];
        return json(
          status === 'authorized'
            ? { status, authorization_code: `auth-code-${testSeq}`, state }
            : { status },
        );
      }
      if (url.pathname === '/oauth/token') {
        calls.token++;
        if (tokenStatus !== 200) return json({ error: 'server_error' }, tokenStatus);
        return json({
          access_token: `at-${calls.token}`,
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    }),
  );

  return calls;
}

export const qrLoadingIndicator = () =>
  document.querySelector('[class*="qrCodeSpin"]');
