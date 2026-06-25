import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import QRCodeStyling from 'qr-code-styling';
import styles from './SignInPanel.module.css';
import { useAuth } from '../../providers';
import { QrIcon } from '../assets/QrIcon';
import { useIsMobile } from '../hooks/useIsMobile';
import { RightIcon } from '../assets/RightIcon';
import { SpinIcon } from '../assets/SpinIcon';
import { SuccessIcon } from '../assets/SuccessIcon';
import { ErrorIcon } from '../assets/ErrorIcon';
import { RetryIcon } from '../assets/RetryIcon';
import { CopyIcon } from '../assets/CopyIcon';
import { CheckIcon } from '../assets/CheckIcon';
import { qrOptions } from '../consts/qrConfig';
import { getLogoUri } from '../consts/logoUri';

const AGENT_INSTALL_COMMAND = 'npx skills add alien-id/agent-id';

// A single-use authorization code must hit /oauth/token at most once. The
// query flags below stop react-query's auto-refetches, but a remount/enable
// race can still re-run an errored (data-less, always-stale) query — so we
// also track attempted codes and refuse a second send outright. Module-scoped
// so the guard survives a remount; codes rotate on retry, so it never blocks a
// legitimate fresh attempt.
const attemptedExchangeCodes = new Set<string>();

export interface SignInPanelProps {
  /** Queries run only while active. Defaults true (inline); modal passes `isOpen`. */
  active?: boolean;
  /** When set, the success screen renders a Done button calling it. */
  onClose?: () => void;
  /** Wrap each state — the modal supplies its shell here. */
  wrap?: (content: ReactNode, ctx: { isSuccess: boolean }) => ReactNode;
}

/**
 * The Alien sign-in flow + screens (QR / agent / success / error). Renders
 * inline as `<SignInPanel />`; `SignInModal` wraps it via `wrap`.
 *
 * State is derived from the queries, never set inside a queryFn — react-query
 * runs one observer's queryFn, so side effects there would desync the others.
 * The shared cache is the single source of truth.
 */
export const SignInPanel = ({ active = true, onClose, wrap = (c) => c }: SignInPanelProps) => {
  const {
    generateDeeplink,
    pollAuth,
    exchangeToken,
    pollingInterval,
    queryClient,
    agentIdEnabled,
    client,
  } = useAuth();
  const [authMode, setAuthMode] = useState<'human' | 'agent'>('human');
  const [copied, setCopied] = useState(false);
  const isMobile = useIsMobile();

  // Built inside the component (SSR-safe — no `window` at module load).
  const qrCode = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new QRCodeStyling({ ...qrOptions, image: getLogoUri() });
  }, []);
  const qrInstanceRef = useRef<QRCodeStyling | null>(qrCode);
  const [qrElement, setQrElement] = useState<HTMLDivElement | null>(null);

  // Key scoped by SSO origin + provider so providers sharing the module-level
  // QueryClient don't serve each other's deeplink. Stable while active; a
  // fresh one is requested explicitly on close / try again.
  const { data: deeplinkData, isError: isDeeplinkError } = useQuery({
    queryKey: ['auth-deeplink', client.ssoBaseUrl, client.providerAddress],
    queryFn: () => generateDeeplink(),
    enabled: active,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const deeplink = deeplinkData?.deep_link ?? '';
  const pollingCode = deeplinkData?.polling_code ?? '';
  const isLoadingQr = !deeplink;

  // Terminal on rejected/expired, or authorized *with* a code — a code-less
  // authorized heartbeat keeps polling. Gates interval + focus/reconnect.
  const pollDone = (data?: { status?: string; authorization_code?: string }) =>
    data?.status === 'rejected' ||
    data?.status === 'expired' ||
    (data?.status === 'authorized' && !!data.authorization_code);
  const pollAlive = (query: {
    state: { status: string; data?: Parameters<typeof pollDone>[0] };
  }) => query.state.status !== 'error' && !pollDone(query.state.data);

  const { data: pollData, isError: isPollError } = useQuery({
    queryKey: ['auth-poll', pollingCode],
    queryFn: () => pollAuth(pollingCode),
    enabled: active && !!pollingCode,
    refetchInterval: (query) => (pollAlive(query) ? pollingInterval : false),
    retry: false,
    refetchOnMount: pollAlive,
    refetchOnWindowFocus: pollAlive,
    refetchOnReconnect: pollAlive,
  });

  const authorizationCode =
    pollData?.status === 'authorized' && pollData.authorization_code
      ? pollData.authorization_code
      : '';

  // Keyed by the single-use code → observers dedupe into one /oauth/token
  // call. Re-sending a consumed code 409s, so every re-run vector is closed:
  // all refetch/retry off, and `enabled` omits `active` (a false→true toggle
  // would refetch an errored query). Retry is user-driven (Try again).
  const { data: tokenData, isError: isExchangeError } = useQuery({
    queryKey: ['auth-exchange', authorizationCode],
    queryFn: () => {
      if (attemptedExchangeCodes.has(authorizationCode)) {
        return Promise.reject(new Error('Authorization code already used'));
      }
      attemptedExchangeCodes.add(authorizationCode);
      return exchangeToken(authorizationCode);
    },
    enabled: !!authorizationCode,
    staleTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const isSuccess = !!tokenData;

  let errorMessage = '';
  let errorDescription = '';
  if (isDeeplinkError || isPollError || isExchangeError) {
    errorMessage = 'Failed to login';
    errorDescription = 'Login could not be completed';
  } else if (pollData?.status === 'rejected') {
    errorMessage = 'Access rejected';
    errorDescription = 'You did not allow access to sign in';
  } else if (pollData?.status === 'expired') {
    errorMessage = 'Link expired';
    errorDescription = 'Login could not be completed';
  }

  useEffect(() => {
    if (qrElement) {
      qrInstanceRef.current?.append(qrElement);
    }
  }, [qrElement]);

  // Draw the QR as soon as the deeplink lands in the shared cache.
  useEffect(() => {
    if (deeplink) {
      qrInstanceRef.current?.update({ data: deeplink });
    }
  }, [deeplink]);

  useEffect(() => {
    if (qrElement) {
      qrElement.style.display = authMode === 'agent' ? 'none' : 'block';
    }
  }, [authMode, qrElement]);

  // Try again: drop the consumed poll/exchange entries and refetch a fresh
  // deeplink (its new code rotates the keys, so the old code is never reused).
  const handleRetry = () => {
    queryClient.removeQueries({ queryKey: ['auth-poll'] });
    queryClient.removeQueries({ queryKey: ['auth-exchange'] });
    queryClient.resetQueries({ queryKey: ['auth-deeplink'] });
  };

  let content: ReactNode;
  if (isSuccess) {
    content = (
      <div className={styles.successfulContainer}>
        <SuccessIcon />
        <div className={styles.successfulTitle}>Sign in successful!</div>
        <div className={styles.successfulSubtitle}>You have signed in successfully.</div>
        {onClose && (
          <div className={styles.successfulButton} onClick={onClose}>Done</div>
        )}
      </div>
    );
  } else if (errorMessage) {
    content = (
      <div className={styles.errorContainer}>
        <ErrorIcon />
        <div className={styles.errorTitle}>{errorMessage}</div>
        <div className={styles.errorSubtitle}>{errorDescription}</div>
        <div className={styles.errorButton} onClick={handleRetry}><RetryIcon />Try again</div>
      </div>
    );
  } else {
    content = (
      <div className={styles.container}>
        <div className={styles.title}>{authMode === 'agent' ? 'Sign in with Alien Agent ID' : 'Sign in with Alien App'}</div>

        {agentIdEnabled && (
          <div className={styles.modeSwitcher}>
            <div className={clsx(styles.modeSwitcherSlider, authMode === 'agent' && styles.modeSwitcherSliderAgent)} />
            <button type="button" className={styles.modeSwitcherButton} onClick={() => setAuthMode('human')}>Human</button>
            <button type="button" className={styles.modeSwitcherButton} onClick={() => setAuthMode('agent')}>Agent</button>
          </div>
        )}

        {authMode === 'agent' ? (
          <div className={styles.agentContent}>
            <div className={styles.agentCommandBox}>
              <div className={styles.agentCommandInner}>
                <div className={styles.agentCommandLabel}>Register your agent</div>
                <div className={styles.agentCommandText}>{AGENT_INSTALL_COMMAND}</div>
              </div>
              <button
                type="button"
                className={styles.agentCopyButton}
                onClick={() => {
                  navigator.clipboard.writeText(AGENT_INSTALL_COMMAND);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
            <ol className={styles.agentSteps}>
              <li>Install and set up Agent ID using command above</li>
              <li>
                <span>
                  Paste{" "}
                  <pre>{typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : ''}</pre>
                  {" "}to your agent and ask it to authorize
                </span>
              </li>
              <li>Once authenticated, your agent is set</li>
            </ol>
          </div>
        ) : (
          <>
            <div className={styles.subtitle}>Scan this QR code with an Alien App!</div>
            <div className={styles.qrCodeContainer}>
              {isLoadingQr ? (
                <div className={styles.qrCodeSpinContainer}>
                  <div className={styles.qrCodeSpin}><SpinIcon /></div>
                </div>
              ) : null}
              <div className={clsx(styles.qrCode, isLoadingQr && styles.qrCodeLoading)} ref={setQrElement} />
            </div>

            <div className={styles.description}>
              Open Alien App and tap <br /> the scan button
              <div className={styles.descriptionIcon}><QrIcon /></div>
            </div>

            {isMobile && deeplink && (
              <a href={deeplink} target="_blank" rel="noopener noreferrer" className={styles.mobileOpenButton}><span>Open in Alien App</span> <RightIcon /></a>
            )}
          </>
        )}

        {!isMobile ? (
          <>
            <div className={styles.line} />
            <div className={styles.footer}>
              <div>
                <div className={styles.footerTitle}>Don't have an Alien App yet?</div>
                <div className={styles.footerSubtitle}>Available on iOS and Android.</div>
              </div>
              <a href="https://alien.org" target="_blank" rel="noopener noreferrer" className={styles.footerButton}>Download</a>
            </div>
          </>
        ) : (
          <div className={styles.mobileFooter}>
            <div className={styles.mobileFooterTitle}>Don't have an Alien App yet?</div>
            <div className={styles.mobileFooterSubtitle}>
              Available on iOS and Android.{' '}
              <a className={styles.mobileFooterButton} target='_blank' rel="noopener noreferrer" href="https://alien.org">Download</a>
            </div>
          </div>
        )}
      </div>
    );
  }

  return wrap(content, { isSuccess });
};
