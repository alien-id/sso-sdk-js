import React, {useEffect, useRef} from 'react';
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

export const SignInModal: React.FC = () => {
  const { isModalOpen: isOpen, closeModal: onClose } = useAuth();
  const isMobile = useIsMobile();

  const qrInstanceRef = useRef<QRCodeStyling>(new QRCodeStyling(qrOptions));
  const qrElementRef = useRef<HTMLDivElement>(null);
  const isAppendedRef = useRef(false);

  useEffect(() => {
    if (qrElementRef.current && !isAppendedRef.current) {
      qrInstanceRef.current.append(qrElementRef.current);
      isAppendedRef.current = true;
    }
  }, [isOpen]);

  const isLoading = false;
  const isSuccess = false;
  const isError = false;

  if (isSuccess) {
    return (
      <ModalBase onClose={onClose} isOpen={isOpen}>
        <div className={styles.successfulContainer}>
          <SuccessIcon />
          <div className={styles.successfulTitle}>Sign in successful!</div>
          <div className={styles.successfulSubtitle}>You have signed in successfully.</div>
          <div className={styles.successfulButton} onClick={onClose}>Done</div>
        </div>
      </ModalBase>
    )
  }

  if (isError) {
    return (
      <ModalBase onClose={onClose} isOpen={isOpen}>
        <div className={styles.errorContainer}>
          <ErrorIcon />
          <div className={styles.errorTitle}>Access rejected</div>
          <div className={styles.errorSubtitle}>
            You did not allow access to sign in.<br />
            Please try again if you want to proceed.
          </div>
          <div className={styles.errorButton} onClick={onClose}><RetryIcon />Try again</div>
        </div>
      </ModalBase>
    )
  }

  return (
    <ModalBase onClose={onClose} isOpen={isOpen}>
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
                <div className={styles.footerTitle}>Don’t have an Alien app yet?</div>
                <div className={styles.footerSubtitle}>Available on iOS and Android.</div>
              </div>

              <a href="https://alien.org" target="_blank" className={styles.footerButton}>Download</a>
            </div>
          </>
        ) : (
          <>
            <a href="https://alien.org" target="_blank" className={styles.mobileOpenButton}><span>Open in Alien App</span> <RightIcon /></a>
            <div className={styles.mobileFooter}>
              <div className={styles.mobileFooterTitle}>Don’t have an Alien app yet?</div>
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
