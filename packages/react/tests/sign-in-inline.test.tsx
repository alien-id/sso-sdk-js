import { expect, test } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AlienSsoProvider, SignInPanel } from '../lib/main';
import { makeConfig, mockSso, qrLoadingIndicator } from './ssoMock';

// SignInPanel renders inline: mounting it starts the flow (active defaults true).

test('mounting the inline panel loads the QR for the fetched deeplink', async () => {
  mockSso();
  render(
    <AlienSsoProvider config={makeConfig()}>
      <SignInPanel />
    </AlienSsoProvider>,
  );

  expect(qrLoadingIndicator()).toBeTruthy();
  await waitFor(() => expect(qrLoadingIndicator()).toBeNull());
  expect(document.querySelector('[data-qr="alien://auth?n=1"]')).toBeTruthy();
});

test('an authorized poll exchanges the code once and shows success with no Done button', async () => {
  const calls = mockSso({ pollStatuses: ['pending', 'authorized'] });
  render(
    <AlienSsoProvider config={makeConfig()}>
      <SignInPanel />
    </AlienSsoProvider>,
  );

  await screen.findByText('Sign in successful!');
  expect(calls.token).toBe(1);
  // Done renders only with an onClose (the modal); inline has nowhere to close.
  expect(screen.queryByText('Done')).toBeNull();
});

test('a rejected poll shows the error, stops polling, and Try again restarts inline', async () => {
  // Post-retry polls stay pending so the restarted QR view is stable to assert.
  const calls = mockSso({ pollStatuses: ['rejected', 'pending'] });
  render(
    <AlienSsoProvider config={makeConfig()}>
      <SignInPanel />
    </AlienSsoProvider>,
  );

  await screen.findByText('Access rejected');

  // Polling stops on the terminal status.
  const pollsAtRejection = calls.poll;
  await new Promise((r) => setTimeout(r, 100));
  expect(calls.poll).toBe(pollsAtRejection);

  fireEvent.click(screen.getByText('Try again'));
  await waitFor(() => expect(calls.authorize).toBe(2));
  await waitFor(() =>
    expect(document.querySelector('[data-qr="alien://auth?n=2"]')).toBeTruthy(),
  );
});

test('remounting after a failed exchange does not re-send the consumed code', async () => {
  // Token endpoint fails → exchange settles in an error state (always stale).
  // Remount must not re-run it; the code is consumed and a re-send would 409.
  const config = makeConfig();
  const calls = mockSso({ pollStatuses: ['authorized'], tokenStatus: 500 });

  const { unmount } = render(
    <AlienSsoProvider config={config}>
      <SignInPanel />
    </AlienSsoProvider>,
  );

  await screen.findByText('Failed to login');
  expect(calls.token).toBe(1);

  // Same config → shared QueryClient keeps the errored exchange cached.
  unmount();
  render(
    <AlienSsoProvider config={config}>
      <SignInPanel />
    </AlienSsoProvider>,
  );

  await new Promise((r) => setTimeout(r, 100));
  expect(calls.token).toBe(1);
});

test('toggling active off then on after a failed exchange does not re-send the code', async () => {
  const calls = mockSso({ pollStatuses: ['authorized'], tokenStatus: 500 });
  const config = makeConfig();
  const { rerender } = render(
    <AlienSsoProvider config={config}>
      <SignInPanel active />
    </AlienSsoProvider>,
  );

  await screen.findByText('Failed to login');
  expect(calls.token).toBe(1);

  // Hide then show (e.g. a modal close/open) without clearing the cache.
  rerender(
    <AlienSsoProvider config={config}>
      <SignInPanel active={false} />
    </AlienSsoProvider>,
  );
  rerender(
    <AlienSsoProvider config={config}>
      <SignInPanel active />
    </AlienSsoProvider>,
  );

  await new Promise((r) => setTimeout(r, 100));
  expect(calls.token).toBe(1);
});

test('remounting after success does not re-poll the consumed code', async () => {
  const calls = mockSso({ pollStatuses: ['authorized'] });
  const config = makeConfig();
  const { unmount } = render(
    <AlienSsoProvider config={config}>
      <SignInPanel />
    </AlienSsoProvider>,
  );

  await screen.findByText('Sign in successful!');
  const pollsAtSuccess = calls.poll;

  unmount();
  render(
    <AlienSsoProvider config={config}>
      <SignInPanel />
    </AlienSsoProvider>,
  );

  // Terminal poll data must not be refetched on remount.
  await new Promise((r) => setTimeout(r, 100));
  expect(calls.poll).toBe(pollsAtSuccess);
});
