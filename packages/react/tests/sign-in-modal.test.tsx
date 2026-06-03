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

type SsoCalls = {
  authorize: number;
  poll: number;
  token: number;
  /** Authorize calls per client_id — distinguishes concurrent providers. */
  authorizeByClient: Record<string, number>;
};

/**
 * In-process mock of the SSO server, driven through global fetch — the same
 * boundary the real AlienSsoClient talks to.
 */
function mockSso({ pollStatuses = ['pending'] }: { pollStatuses?: string[] } = {}) {
  const calls: SsoCalls = { authorize: 0, poll: 0, token: 0, authorizeByClient: {} };
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
        const clientId = url.searchParams.get('client_id') ?? '';
        calls.authorizeByClient[clientId] =
          (calls.authorizeByClient[clientId] ?? 0) + 1;
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

test('the modal survives when a duplicate slot holder unmounts mid-flow', async () => {
  mockSso();
  const config = makeConfig();
  const ui = (showDuplicate: boolean) => (
    <AlienSsoProvider config={config}>
      <SignInButton />
      {showDuplicate && <SignInModal />}
    </AlienSsoProvider>
  );
  const { rerender } = render(ui(true));

  fireEvent.click(screen.getByText('Sign in with Alien ID'));
  await waitFor(() => expect(qrLoadingIndicator()).toBeNull());

  // The manual duplicate mounted first, so it holds the render slot.
  // Unmounting it must hand the slot to the provider's auto-rendered modal
  // without interrupting the open sign-in flow.
  rerender(ui(false));
  await waitFor(() =>
    expect(document.querySelectorAll('[class*="overlay"]')).toHaveLength(1),
  );
  expect(document.querySelector('[data-qr="alien://auth?n=1"]')).toBeTruthy();
});

// The QueryClient is module-level and shared by every provider instance, so
// one provider's close/retry cleanup must never disturb a sibling provider's
// in-flight sign-in.
test("closing one provider's modal leaves another provider's flow untouched", async () => {
  const calls = mockSso();
  const configA = makeConfig();
  const configB = makeConfig();
  render(
    <AlienSsoProvider config={configA}>
      <SignInButton />
    </AlienSsoProvider>,
  );
  render(
    <AlienSsoProvider config={configB}>
      <SignInButton />
    </AlienSsoProvider>,
  );

  // Open both providers' modals and let both QRs load.
  for (const button of screen.getAllByText('Sign in with Alien ID')) {
    fireEvent.click(button);
  }
  await waitFor(() =>
    expect(document.querySelectorAll('[class*="qrCodeSpin"]')).toHaveLength(0),
  );
  expect(calls.authorizeByClient[configA.providerAddress]).toBe(1);
  expect(calls.authorizeByClient[configB.providerAddress]).toBe(1);

  // Close provider A's modal (first in DOM order).
  fireEvent.click(document.querySelector('[class*="closeIcon"]')!);

  // Provider B keeps polling its original code and never refetches a deeplink.
  const pollsSoFar = calls.poll;
  await waitFor(() => expect(calls.poll).toBeGreaterThan(pollsSoFar));
  expect(calls.authorizeByClient[configB.providerAddress]).toBe(1);
});

test('an expired poll shows the link-expired error and stops polling', async () => {
  const calls = mockSso({ pollStatuses: ['expired'] });
  render(
    <AlienSsoProvider config={makeConfig()}>
      <SignInButton />
    </AlienSsoProvider>,
  );

  fireEvent.click(screen.getByText('Sign in with Alien ID'));
  await screen.findByText('Link expired');

  const pollsAtExpiry = calls.poll;
  await new Promise((r) => setTimeout(r, 100));
  expect(calls.poll).toBe(pollsAtExpiry);
});

test('a failing poll endpoint shows the failure screen and stops polling', async () => {
  const calls = mockSso();
  const fetchOk = globalThis.fetch;
  // Authorize succeeds, every poll fails.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).pathname === '/oauth/poll') {
      calls.poll++;
      return new Response('{"error":"server_error"}', { status: 500 });
    }
    return fetchOk(input, init);
  }));
  render(
    <AlienSsoProvider config={makeConfig()}>
      <SignInButton />
    </AlienSsoProvider>,
  );

  fireEvent.click(screen.getByText('Sign in with Alien ID'));
  await screen.findByText('Failed to login');

  const pollsAtFailure = calls.poll;
  await new Promise((r) => setTimeout(r, 100));
  expect(calls.poll).toBe(pollsAtFailure);
});

test('a failing token exchange shows the failure screen', async () => {
  const calls = mockSso({ pollStatuses: ['authorized'] });
  const fetchOk = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).pathname === '/oauth/token') {
      calls.token++;
      return new Response('{"error":"invalid_grant"}', { status: 400 });
    }
    return fetchOk(input, init);
  }));
  render(
    <AlienSsoProvider config={makeConfig()}>
      <SignInButton />
    </AlienSsoProvider>,
  );

  fireEvent.click(screen.getByText('Sign in with Alien ID'));
  await screen.findByText('Failed to login');
  expect(calls.token).toBe(1);
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
