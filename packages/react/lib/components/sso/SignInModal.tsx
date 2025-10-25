import { useEffect, useRef, useState } from 'react';
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
import QRCodeStyling from "qr-code-styling";
import { qrOptions } from "../consts/qrConfig";

const qrCode = new QRCodeStyling(qrOptions)

export const SignInModal = () => {
  const { isModalOpen: isOpen, closeModal: onClose, generateDeeplink, pollAuth, exchangeToken, client, queryClient } = useAuth();
  const isMobile = useIsMobile();

  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [errorDescription, setErrorDescription] = useState<string>('');
  const [pollingCode, setPollingCode] = useState<string>('');
  const [deeplink, setDeeplink] = useState<string>('');

  const qrInstanceRef = useRef<QRCodeStyling>(qrCode);
  const [qrElement, setQrElement] = useState<HTMLDivElement | null>(null);

  const [isLoadingQr, setIsLoadingQr] = useState<boolean>(true);

  // Initialize auth and get deeplink
  useQuery({
    queryKey: ['auth-deeplink'],
    queryFn: async () => {
      try {
        setIsLoadingQr(true);
        const response = await generateDeeplink();
        setDeeplink(response.deep_link);
        setPollingCode(response.polling_code);

        qrInstanceRef.current.update({
          data: response.deep_link,
        });
      } catch (error) {
        setErrorMessage('Failed to login');
        setErrorDescription('Login could not be completed');
        throw error;
      } finally {
        setIsLoadingQr(false);
      }
    },
    enabled: isOpen && !deeplink,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Polling query
  const { data: pollData } = useQuery({
    queryKey: ['auth-poll', pollingCode],
    queryFn: async () => {
      try {
        return await pollAuth(pollingCode);
      } catch (error: any) {
        setErrorMessage('Failed to login');
        setErrorDescription('Login could not be completed');
        throw error;
      }
    },
    enabled: isOpen && !!pollingCode && !isSuccess && !errorMessage,
    refetchInterval: client.pollingInterval,
    retry: false,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (qrElement) {
      qrInstanceRef.current.append(qrElement);
    }
  }, [qrElement]);

  // Handle poll responses
  useEffect(() => {
    if (!pollData) return;

    (async () => {
      if (pollData.status === 'authorized' && pollData.authorization_code) {
        try {
          await exchangeToken(pollData.authorization_code);
          setIsSuccess(true);
        } catch (error) {
          setErrorMessage('Failed to login');
          setErrorDescription('Login could not be completed');
        }
      } else if (pollData.status === 'rejected') {
        setErrorMessage('Access rejected');
        setErrorDescription('You did not allow access to sign in');
      } else if (pollData.status === 'expired') {
        setErrorMessage('Link expired');
        setErrorDescription('Login could not be completed');
      }
    })();
  }, [pollData, exchangeToken]);

  const resetState = () => {
    setIsSuccess(false);
    setErrorMessage('');
    setErrorDescription('');
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
        <div className={styles.title}>Sign in with Alien App</div>

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
