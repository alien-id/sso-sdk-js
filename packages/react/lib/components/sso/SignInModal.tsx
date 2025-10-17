import { useEffect, useRef, useState } from 'react';
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

export const SignInModal = () => {
  const { isModalOpen: isOpen, closeModal: onClose, getAuthDeeplink, startPollingLoop, exchangeToken } = useAuth();
  const isMobile = useIsMobile();

  const [flowState, setFlowState] = useState<FlowState>('ready');
  const [deeplink, setDeeplink] = useState<string>('');

  const qrInstanceRef = useRef<QRCodeStyling>(new QRCodeStyling(qrOptions));
  const qrElementRef = useRef<HTMLDivElement>(null);
  const stopPollingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (qrElementRef.current) {
      qrInstanceRef.current.append(qrElementRef.current);
    }
  }, [qrElementRef.current]);

  useEffect(() => {
    if (isOpen && !deeplink) {
      initAuth();
    }

    return () => {
      stopPollingRef.current?.();
    };
  }, [isOpen]);

  useEffect(() => {
    qrInstanceRef.current.update({
      data: deeplink,
    });
  }, [deeplink]);

  const initAuth = async () => {
    try {
      setFlowState('loading');
      const response = await getAuthDeeplink();
      setDeeplink(response.deep_link);
      qrInstanceRef.current.update({ data: response.deep_link });
      setFlowState('ready');

      stopPollingRef.current = await startPollingLoop(response.polling_code, {
        onAuthorized: async (authCode) => {
          await exchangeToken(authCode);
          setFlowState('success');
        },
        onRejected: () => {
          setFlowState('error');
        },
        onError: (error) => {
          console.error('Poll failed:', error);
          setFlowState('error');
        },
      });
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      setFlowState('error');
    }
  };

  const resetState = () => {
    stopPollingRef.current?.();
    stopPollingRef.current = null;
    setFlowState('ready');
    setDeeplink('');
  };

  const handleRetry = () => {
    resetState();
    initAuth();
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
