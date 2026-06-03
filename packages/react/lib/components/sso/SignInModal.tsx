import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import styles from './SignInModal.module.css';
import { useAuth } from "../../providers";
import { ModalBase } from '../base/ModalBase';
import { QrIcon } from "../assets/QrIcon";
import { useIsMobile } from "../hooks/useIsMobile";
import { RightIcon } from "../assets/RightIcon";
import clsx from "clsx";
import { SpinIcon } from "../assets/SpinIcon";
import { SuccessIcon } from "../assets/SuccessIcon";
import { ErrorIcon } from "../assets/ErrorIcon";
import { RetryIcon } from "../assets/RetryIcon";
import { CopyIcon } from "../assets/CopyIcon";
import { CheckIcon } from "../assets/CheckIcon";
import QRCodeStyling from "qr-code-styling";
import { qrOptions } from "../consts/qrConfig";
import { getLogoUri } from "../consts/logoUri";

const AGENT_INSTALL_COMMAND = 'npx skills add alien-id/agent-id';

export const SignInModal = () => {
  const {
    isModalOpen: isOpen,
    closeModal: onClose,
    generateDeeplink,
    pollAuth,
    exchangeToken,
    pollingInterval,
    queryClient,
    agentIdEnabled,
    client,
    claimModalSlot,
    releaseModalSlot,
  } = useAuth();
  const [authMode, setAuthMode] = useState<'human' | 'agent'>('human');
  const [copied, setCopied] = useState(false);
  const isMobile = useIsMobile();

  // Create QR code instance inside component to avoid `window is not defined` during SSR
  const qrCode = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new QRCodeStyling({
      ...qrOptions,
      image: getLogoUri(),
    });
  }, []);

  const qrInstanceRef = useRef<QRCodeStyling | null>(qrCode);
  const [qrElement, setQrElement] = useState<HTMLDivElement | null>(null);

  // The provider auto-renders one SignInModal. If a consumer renders another
  // one manually, both instances mount and stack on top of each other — the
  // top overlay then shadows the working modal. Claim a per-provider slot so
  // only one instance renders; the others stay mounted but invisible.
  const slotInstanceRef = useRef<object>({});
  const [hasSlot, setHasSlot] = useState(false);
  useEffect(() => {
    // Re-attempt the claim on every open so a surviving instance takes over
    // if the previous slot holder unmounted.
    setHasSlot(claimModalSlot(slotInstanceRef.current));
  }, [claimModalSlot, isOpen]);
  useEffect(() => {
    const instance = slotInstanceRef.current;
    return () => releaseModalSlot(instance);
  }, [releaseModalSlot]);

  // All sign-in state below is DERIVED from query results, never set from
  // inside queryFn. With more than one mounted SignInModal (or any other
  // observer of these keys), react-query deduplicates the fetch and runs
  // only one instance's queryFn — side effects in that closure would update
  // only that instance, leaving every other one stuck on the loading state.
  // Derived state keeps every observer correct because the shared cache is
  // the single source of truth.

  // Scope the deeplink key by SSO origin + provider so two providers with
  // different configs sharing the module-level QueryClient don't serve each
  // other's deeplink.
  const { data: deeplinkData, isError: isDeeplinkError } = useQuery({
    queryKey: ['auth-deeplink', client.ssoBaseUrl, client.providerAddress],
    queryFn: () => generateDeeplink(),
    enabled: isOpen,
    // The deeplink must stay stable while the modal is open; a fresh one is
    // requested explicitly on close / try again (see handleClose/handleRetry).
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const deeplink = deeplinkData?.deep_link ?? '';
  const pollingCode = deeplinkData?.polling_code ?? '';
  const isLoadingQr = !deeplink;

  // Polling stops on error or a terminal status. 'authorized' is only
  // terminal once it carries the authorization_code — a code-less authorized
  // heartbeat keeps polling. Focus/reconnect refetches (eager poll when the
  // user returns from the Alien App) obey the same lifecycle.
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
    enabled: isOpen && !!pollingCode,
    refetchInterval: (query) => (pollAlive(query) ? pollingInterval : false),
    retry: false,
    refetchOnWindowFocus: pollAlive,
    refetchOnReconnect: pollAlive,
  });

  const authorizationCode =
    pollData?.status === 'authorized' && pollData.authorization_code
      ? pollData.authorization_code
      : '';

  // Exchange the authorization code exactly once. Running this as a query on
  // the shared QueryClient means concurrent observers deduplicate into a
  // single /oauth/token call (an authorization code is single-use).
  const { data: tokenData, isError: isExchangeError } = useQuery({
    queryKey: ['auth-exchange', authorizationCode],
    queryFn: () => exchangeToken(authorizationCode),
    enabled: isOpen && !!authorizationCode,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
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

  // Draw the QR as soon as the deeplink lands in the shared cache. Every
  // instance updates its own canvas, so this stays correct regardless of
  // which observer's queryFn performed the fetch.
  useEffect(() => {
    if (deeplink) {
      qrInstanceRef.current?.update({
        data: deeplink,
      });
    }
  }, [deeplink]);

  useEffect(() => {
    if (qrElement) {
      qrElement.style.display = authMode === 'agent' ? 'none' : 'block';
    }
  }, [authMode, qrElement]);

  // While the modal stays open (Try again) the deeplink observers must be
  // notified and refetched — resetQueries does both, removeQueries would
  // leave mounted observers holding their last result. Poll/exchange entries
  // are dropped outright: their keys rotate with the fresh deeplink, so no
  // observer should ever resurrect (or re-poll) the old polling code.
  const handleRetry = () => {
    queryClient.removeQueries({ queryKey: ['auth-poll'] });
    queryClient.removeQueries({ queryKey: ['auth-exchange'] });
    queryClient.resetQueries({ queryKey: ['auth-deeplink'] });
  };

  // On close the modal unrenders, so dropping the cache entries is enough;
  // the next open starts from a clean fetch.
  const handleClose = () => {
    onClose();
    queryClient.removeQueries({ queryKey: ['auth-deeplink'] });
    queryClient.removeQueries({ queryKey: ['auth-poll'] });
    queryClient.removeQueries({ queryKey: ['auth-exchange'] });
  };

  if (!hasSlot) {
    return null;
  }

  if (isSuccess) {
    return (
      <ModalBase onClose={handleClose} isOpen={isOpen} showClose={false}>
        <div className={styles.successfulContainer}>
          <SuccessIcon />
          <div className={styles.successfulTitle}>Sign in successful!</div>
          <div className={styles.successfulSubtitle}>You have signed in successfully.</div>
          <div className={styles.successfulButton} onClick={handleClose}>Done</div>
        </div>
      </ModalBase>
    )
  }

  if (errorMessage) {
    return (
      <ModalBase onClose={handleClose} isOpen={isOpen}>
        <div className={styles.errorContainer}>
          <ErrorIcon />
          <div className={styles.errorTitle}>{errorMessage || 'Error occurred'}</div>
          <div className={styles.errorSubtitle}>
            {errorDescription || 'An error occurred. Please try again.'}
          </div>
          <div className={styles.errorButton} onClick={handleRetry}><RetryIcon />Try again</div>
        </div>
      </ModalBase>
    )
  }

  return (
    <ModalBase onClose={handleClose} isOpen={isOpen}>
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
              <a href={deeplink} target="_blank" className={styles.mobileOpenButton}><span>Open in Alien App</span> <RightIcon /></a>
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
              <a href="https://alien.org" target="_blank" className={styles.footerButton}>Download</a>
            </div>
          </>
        ) : (
          <div className={styles.mobileFooter}>
            <div className={styles.mobileFooterTitle}>Don't have an Alien App yet?</div>
            <div className={styles.mobileFooterSubtitle}>
              Available on iOS and Android.{' '}
              <a className={styles.mobileFooterButton} target='_blank' href="https://alien.org">Download</a>
            </div>
          </div>
        )}
      </div>
    </ModalBase>
  )
};
