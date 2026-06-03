import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AlienSsoProvider, SignInButton, SignInModal } from '../lib/main';

// qr-code-styling draws on a real canvas, which jsdom can't provide. Mock the
// external boundary with the same public surface the modal uses.
vi.mock('qr-code-styling', () => ({
  default: class QRCodeStylingMock {
    data = '';
    container: HTMLElement | null = null;
    update(options?: { data?: string }) {
      if (options?.data) this.data = options.data;
      this.container?.setAttribute('data-qr', this.data);
    }
    append(container: HTMLElement) {
      this.container = container;
      container.setAttribute('data-qr', this.data);
    }
  },
}));

const SSO_URL = 'http://localhost:4710';

// The provider's QueryClient is module-level and outlives each test's render.
// A unique providerAddress per test scopes the deeplink query keys (and the
// polling codes below scope the rest), so no cache entries leak across tests.
let testSeq = 0;
const makeConfig = () => ({
  ssoBaseUrl: SSO_URL,
  providerAddress: String(++testSeq).padStart(32, '0'),
  pollingInterval: 25,
});

type SsoCalls = { authorize: number; poll: number; token: number };

/**
 * In-process mock of the SSO server, driven through global fetch — the same
 * boundary the real AlienSsoClient talks to.
 */
function mockSso({ pollStatuses = ['pending'] }: { pollStatuses?: string[] } = {}) {
  const calls: SsoCalls = { authorize: 0, poll: 0, token: 0 };
  let state: string | null = null;

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
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

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const qrLoadingIndicator = () =>
  document.querySelector('[class*="qrCodeSpin"]');

test('opening the modal loads the QR for the fetched deeplink', async () => {
  mockSso();
  render(
    <AlienSsoProvider config={makeConfig()}>
      <SignInButton />
    </AlienSsoProvider>,
  );

  fireEvent.click(screen.getByText('Sign in with Alien ID'));

  // Loading indicator shows while the deeplink is in flight, then resolves.
  expect(qrLoadingIndicator()).toBeTruthy();
  await waitFor(() => expect(qrLoadingIndicator()).toBeNull());

  // The rendered QR encodes the deeplink returned by the SSO.
  expect(document.querySelector('[data-qr="alien://auth?n=1"]')).toBeTruthy();
});

// Regression: pixel-battle rendered <SignInModal /> manually on top of the
// one the provider auto-renders. The duplicate observer made react-query
// dedupe the deeplink fetch into one instance's queryFn, and the visible
// modal stayed on the loading spinner forever.
test('QR still loads when a consumer mounts a duplicate SignInModal', async () => {
  mockSso();
  render(
    <AlienSsoProvider config={makeConfig()}>
      <SignInButton />
      <SignInModal />
    </AlienSsoProvider>,
  );

  fireEvent.click(screen.getByText('Sign in with Alien ID'));

  // Exactly one modal renders — duplicates must not stack overlays.
  expect(document.querySelectorAll('[class*="overlay"]')).toHaveLength(1);

  // Every visible loading indicator resolves into a drawn QR.
  await waitFor(() => expect(qrLoadingIndicator()).toBeNull());
  expect(document.querySelector('[data-qr="alien://auth?n=1"]')).toBeTruthy();
});

test('closing and reopening the modal starts a fresh sign-in attempt', async () => {
  const calls = mockSso();
  render(
    <AlienSsoProvider config={makeConfig()}>
      <SignInButton />
    </AlienSsoProvider>,
  );

  fireEvent.click(screen.getByText('Sign in with Alien ID'));
  await waitFor(() => expect(qrLoadingIndicator()).toBeNull());

  fireEvent.click(document.querySelector('[class*="closeIcon"]')!);
  fireEvent.click(screen.getByText('Sign in with Alien ID'));

  // A new deeplink is fetched and its QR replaces the stale one.
  await waitFor(() => expect(calls.authorize).toBe(2));
  await waitFor(() =>
    expect(document.querySelector('[data-qr="alien://auth?n=2"]')).toBeTruthy(),
  );
});

test('an authorized poll exchanges the code once and shows success', async () => {
  const calls = mockSso({ pollStatuses: ['pending', 'authorized'] });
  // The duplicate makes this also guard the single-use authorization code:
  // concurrent observers must still produce exactly one /oauth/token call.
  render(
    <AlienSsoProvider config={makeConfig()}>
      <SignInButton />
      <SignInModal />
    </AlienSsoProvider>,
  );

  fireEvent.click(screen.getByText('Sign in with Alien ID'));
  await screen.findByText('Sign in successful!');
  expect(calls.token).toBe(1);

  // Done closes the modal.
  fireEvent.click(screen.getByText('Done'));
  await waitFor(() =>
    expect(document.querySelectorAll('[class*="overlay"]')).toHaveLength(0),
  );
});

test('a rejected poll shows the error and Try again restarts the flow', async () => {
  // First poll rejects; polls after the retry stay pending so the restarted
  // QR view is stable while we assert on it.
  const calls = mockSso({ pollStatuses: ['rejected', 'pending'] });
  render(
    <AlienSsoProvider config={makeConfig()}>
      <SignInButton />
    </AlienSsoProvider>,
  );

  fireEvent.click(screen.getByText('Sign in with Alien ID'));
  await screen.findByText('Access rejected');

  // Polling must stop on a terminal status.
  const pollsAtRejection = calls.poll;
  await new Promise((r) => setTimeout(r, 100));
  expect(calls.poll).toBe(pollsAtRejection);

  fireEvent.click(screen.getByText('Try again'));

  // A fresh deeplink is fetched and the QR view returns.
  await waitFor(() => expect(calls.authorize).toBe(2));
  await waitFor(() =>
    expect(document.querySelector('[data-qr="alien://auth?n=2"]')).toBeTruthy(),
  );
});

test('a failing authorize endpoint shows the failure screen without retry loops', async () => {
  const fetchMock = vi.fn(async () => new Response('{"error":"server_error"}', { status: 500 }));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <AlienSsoProvider config={makeConfig()}>
      <SignInButton />
    </AlienSsoProvider>,
  );

  fireEvent.click(screen.getByText('Sign in with Alien ID'));
  await screen.findByText('Failed to login');

  await new Promise((r) => setTimeout(r, 100));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
