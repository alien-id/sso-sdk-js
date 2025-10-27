import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import styles from './SolanaSignInModal.module.css';
import { AUTHED_ADDRESS_KEY, useSolanaAuth } from "../../providers";
import { useSolanaAuthInternal } from "../../providers";
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
import { PublicKey } from '@solana/web3.js';
import { SolanaIcon } from "../assets/SolanaIcon.tsx";
import { SolanaColorIcon } from "../assets/SolanaColorIcon.tsx";

const qrCode = new QRCodeStyling(qrOptions)

const shortenAddress = (address: string, startChars = 11, endChars = 4): string => {
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
};

export const SolanaSignInModal = () => {
  const {
    isModalOpen: isOpen,
    closeModal: onClose,
    generateDeeplink,
    getAttestation,
    pollAuth,
    client,
    wallet: { publicKey, signTransaction },
    connectionAdapter: { connection },
    queryClient,
  } = useSolanaAuth();
  const { setSessionAddress } = useSolanaAuthInternal()
  const isMobile = useIsMobile();

  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [errorDescription, setErrorDescription] = useState<string>('');
  const [pollingCode, setPollingCode] = useState<string>('');
  const [deeplink, setDeeplink] = useState<string>('');
  const [isSigningTransaction, setIsSigningTransaction] = useState(false);
  const [pendingTransactionData, setPendingTransactionData] = useState<any>(null);

  const qrInstanceRef = useRef<QRCodeStyling>(qrCode);
  const [qrElement, setQrElement] = useState<HTMLDivElement | null>(null);

  const [isLoadingQr, setIsLoadingQr] = useState(false);

  const solanaAddress = useMemo(() => publicKey?.toBase58(), [publicKey])

  // Initialize auth and get deeplink
  useQuery({
    queryKey: ['auth-deeplink', solanaAddress],
    queryFn: async () => {
      if (!solanaAddress) {
        setErrorMessage('Failed to login');
        setErrorDescription('Login could not be completed');
        return;
      }
      try {
        setIsLoadingQr(true);

        const sessionAddress = await getAttestation(solanaAddress);
        if (sessionAddress) {
          setIsLoadingQr(false);
          setIsSuccess(true);
          return sessionAddress;
        }

        const response = await generateDeeplink(solanaAddress);
        setDeeplink(response.deep_link);
        setPollingCode(response.polling_code);

        qrInstanceRef.current.update({
          data: response.deep_link,
        });
        return response;
      } catch (e) {
        setErrorMessage('Failed to login');
        setErrorDescription('Login could not be completed');
        throw e;
      } finally {
        setIsLoadingQr(false);
      }
    },
    enabled: isOpen && !deeplink && !!solanaAddress,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Polling query
  const { data: pollData } = useQuery({
    queryKey: ['auth-poll', pollingCode],
    queryFn: async () => {
      try {
        return await pollAuth(pollingCode);
      } catch (e) {
        setErrorMessage('Failed to login');
        setErrorDescription('Login could not be completed');
        throw e;
      }
    },
    enabled: isOpen && !!pollingCode && !isSuccess && !errorMessage && !isSigningTransaction && !pendingTransactionData,
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

    if (pollData.status === 'authorized') {
      setPendingTransactionData({
        oracleSignature: pollData.oracle_signature,
        oraclePublicKey: pollData.oracle_public_key,
        sessionAddress: pollData.session_address,
        timestamp: pollData.timestamp,
        solanaAddress: pollData.solana_address,
      });
    } else if (pollData.status === 'rejected') {
      setErrorMessage('Access rejected');
      setErrorDescription('You did not allow access to sign in');
    } else if (pollData.status === 'expired') {
      setErrorMessage('Link expired');
      setErrorDescription('Login could not be completed');
    }
  }, [pollData]);

  const handleConfirmTransaction = async () => {
    if (isSigningTransaction) {
      return
    }

    if (!pendingTransactionData || !solanaAddress || !signTransaction) {
      setErrorMessage('Wallet not connected');
      setErrorDescription('Please connect your Solana wallet first');
      return;
    }

    try {
      setIsSigningTransaction(true);

      // Build transaction
      const oracleSignature = Uint8Array.from(Buffer.from(pendingTransactionData.oracleSignature, 'hex'));
      const oraclePublicKey = new PublicKey(Buffer.from(pendingTransactionData.oraclePublicKey, 'hex'));
      const payerPublicKey = new PublicKey(pendingTransactionData.solanaAddress);

      const transaction = await client.buildCreateAttestationTransaction({
        connection,
        payerPublicKey,
        sessionAddress: pendingTransactionData.sessionAddress,
        oracleSignature,
        oraclePublicKey,
        timestamp: pendingTransactionData.timestamp,
        expiry: 0,
      });

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = payerPublicKey;

      const signedTransaction = await signTransaction(transaction);

      const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
        skipPreflight: true,
      });

      // Wait for confirmation
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');

      // Save to cache immediately after successful transaction
      localStorage.setItem(AUTHED_ADDRESS_KEY, pendingTransactionData.solanaAddress);
      setSessionAddress(pendingTransactionData.sessionAddress);

      setIsSuccess(true);
    } catch (error: any) {
      console.error('Transaction error:', error);
      setErrorMessage('Failed to sign transaction');
      setErrorDescription(error?.message || 'Could not complete transaction');
    } finally {
      setIsSigningTransaction(false);
    }
  };

  const resetState = () => {
    setIsSuccess(false);
    setErrorMessage('');
    setErrorDescription('');
    setDeeplink('');
    setPollingCode('');
    setIsSigningTransaction(false);
    setPendingTransactionData(null);
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
          <div className={styles.successfulSubtitle}>You have successfully signed in <br /> and your Solana address is now linked</div>
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

  if (pendingTransactionData) {
    return (
      <ModalBase onClose={handleClose} isOpen={isOpen}>
        <div className={styles.pendingContainer}>
          <SolanaIcon />
          <div className={styles.pendingTitle}>Link Your Solana Address</div>
          <div className={styles.pendingSubtitle}>
            Finish signing and link your Solana <br /> address to your Alien ID.{' '}
            <span className={styles.pendingWarning}>It cannot be changed</span>
          </div>
          <div className={styles.pendingWalletContainer}>
            <SolanaColorIcon />
            <div>
              <div className={styles.pendingWalletAddress}>{shortenAddress(pendingTransactionData.solanaAddress)}</div>
              <div className={styles.pendingWalletSubtitle}>
                Connected Solana address
              </div>
            </div>
          </div>
          <div className={styles.pendingButton} onClick={handleConfirmTransaction}>
            <div className={styles.pendingButtonContainer}>
              {isSigningTransaction ? (
                <div className={styles.qrCodeSpin}><SpinIcon /></div>
              ) :
                'Send transaction'
              }
            </div>
          </div>
        </div>
      </ModalBase>
    )
  }

  return (
    <ModalBase onClose={handleClose} isOpen={isOpen}>
      <div className={styles.container}>
        <div className={styles.title}>Sign in with Alien App</div>

        <div className={styles.subtitle}>Scan this QR code with Alien App<br />and link your Solana address to your Alien ID</div>
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
            {deeplink && <a href={deeplink} target="_blank" className={styles.mobileOpenButton}><span>Open in Alien App</span> <RightIcon /></a>}
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
