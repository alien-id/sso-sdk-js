import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import QRCodeStyling from "qr-code-styling";
import { qrOptions } from "../consts/qrConfig";

type FlowState = 'loading' | 'ready' | 'polling' | 'success' | 'error';

const qrInstance = new QRCodeStyling(qrOptions)

export const SignInModal = () => {
  const { isModalOpen: isOpen, closeModal: onClose, getAuthDeeplink, pollAuth, exchangeToken, client } = useAuth();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();

  const [flowState, setFlowState] = useState<FlowState>('ready');
  const [pollingCode, setPollingCode] = useState<string>('');
  const [deeplink, setDeeplink] = useState<string>('');

  const qrInstanceRef = useRef<QRCodeStyling>(qrInstance);
  const qrElementRef = useRef<HTMLDivElement>(null);

  // Initialize auth and get deeplink
  const { data: authData, isLoading: isLoadingAuth, error: authError } = useQuery({
    queryKey: ['auth-deeplink'],
    queryFn: async () => {
      const response = await getAuthDeeplink();
      setDeeplink(response.deep_link);
      setPollingCode(response.polling_code);
      qrInstanceRef.current.update({ data: response.deep_link });
      return response;
    },
    enabled: isOpen && !deeplink,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Polling query
  const { data: pollData } = useQuery({
    queryKey: ['auth-poll', pollingCode],
    queryFn: () => pollAuth(pollingCode),
    enabled: isOpen && !!pollingCode && flowState !== 'success' && flowState !== 'error',
    refetchInterval: client.pollingInterval,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (qrElementRef.current) {
      qrInstanceRef.current.append(qrElementRef.current);
    }
  }, [qrElementRef.current]);

  useEffect(() => {
    qrInstanceRef.current.update({
      data: deeplink,
    });
  }, [deeplink]);

  useEffect(() => {
    if (authError) {
      setFlowState('error');
    }
  }, [authError]);

  useEffect(() => {
    if (isLoadingAuth) {
      setFlowState('loading');
    } else if (authData && !isLoadingAuth) {
      setFlowState('ready');
    }
  }, [isLoadingAuth, authData]);

  // Handle poll responses
  useEffect(() => {
    if (!pollData) return;

    const handlePollResponse = async () => {
      if (pollData.status === 'authorized' && pollData.authorization_code) {
        try {
          await exchangeToken(pollData.authorization_code);
          setFlowState('success');
        } catch (error) {
          console.error('Token exchange failed:', error);
          setFlowState('error');
        }
      } else if (pollData.status === 'rejected') {
        setFlowState('error');
      }
    };

    handlePollResponse();
  }, [pollData, exchangeToken]);

  const resetState = () => {
    setFlowState('ready');
    setDeeplink('');
    setPollingCode('');
    queryClient.removeQueries({ queryKey: ['auth-deeplink'] });
    queryClient.removeQueries({ queryKey: ['auth-poll'] });
  };

  const handleRetry = () => {
    resetState();
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const isLoading = flowState === 'loading';
  const isSuccess = flowState === 'success';
  const isError = flowState === 'error';

  if (isSuccess) {
    return (
      <ModalBase onClose={handleClose} isOpen={isOpen}>
        <div className={styles.successfulContainer}>
          <SuccessIcon />
          <div className={styles.successfulTitle}>Sign in successful!</div>
          <div className={styles.successfulSubtitle}>You have signed in successfully.</div>
          <div className={styles.successfulButton} onClick={handleClose}>Done</div>
        </div>
      </ModalBase>
    )
  }

  if (isError) {
    return (
      <ModalBase onClose={handleClose} isOpen={isOpen}>
        <div className={styles.errorContainer}>
          <ErrorIcon />
          <div className={styles.errorTitle}>Access rejected</div>
          <div className={styles.errorSubtitle}>
            You did not allow access to sign in.<br />
            Please try again if you want to proceed.
          </div>
          <div className={styles.errorButton} onClick={handleRetry}><RetryIcon />Try again</div>
        </div>
      </ModalBase>
    )
  }

  return (
    <ModalBase onClose={handleClose} isOpen={isOpen}>
      <div className={styles.container}>
        <div className={styles.title}>Sign in with Alien App</div>

        <div className={styles.subtitle}>Scan this QR code with an Alien App!</div>
        <div className={styles.qrCodeContainer}>
          {isLoading ? (
            <div className={styles.qrCodeSpinContainer}>
              <div className={styles.qrCodeSpin}><SpinIcon /></div>
            </div>
          ) : null}
          <div className={clsx(styles.qrCode, isLoading && styles.qrCodeLoading)} ref={qrElementRef} />
        </div>

        <div className={styles.description}>
          Open an Alien App and tap <br /> the scan button
          <div className={styles.descriptionIcon}><QrIcon /></div>
        </div>

        {!isMobile ? (
          <>
            <div className={styles.line} />

            <div className={styles.footer}>
              <div>
                <div className={styles.footerTitle}>Don't have an Alien app yet?</div>
                <div className={styles.footerSubtitle}>Available on iOS and Android.</div>
              </div>

              <a href="https://alien.org" target="_blank" className={styles.footerButton}>Download</a>
            </div>
          </>
        ) : (
          <>
            <a href={deeplink || "https://alien.org"} target="_blank" className={styles.mobileOpenButton}><span>Open in Alien App</span> <RightIcon /></a>
            <div className={styles.mobileFooter}>
              <div className={styles.mobileFooterTitle}>Don't have an Alien app yet?</div>
              <div className={styles.mobileFooterSubtitle}>
                Available on iOS and Android.{' '}
                <a className={styles.mobileFooterButton} target='_blank' href="https://alien.org">Download</a>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalBase>
  )
};
