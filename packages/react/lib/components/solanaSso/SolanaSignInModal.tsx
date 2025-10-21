import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import styles from './SolanaSignInModal.module.css';
import { useSolanaAuth } from "../../providers";
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
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

const qrCode = new QRCodeStyling(qrOptions)

export const SolanaSignInModal = () => {
  const { isModalOpen: isOpen, closeModal: onClose, generateDeeplink, pollAuth, client, auth } = useSolanaAuth();
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();

  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [errorDescription, setErrorDescription] = useState<string>('');
  const [pollingCode, setPollingCode] = useState<string>('');
  const [deeplink, setDeeplink] = useState<string>('');
  const [isSigningTransaction, setIsSigningTransaction] = useState(false);
  const [pendingTransactionData, setPendingTransactionData] = useState<any>(null);

  const qrInstanceRef = useRef<QRCodeStyling>(qrCode);
  const [qrElement, setQrElement] = useState<HTMLDivElement | null>(null);

  // Initialize auth and get deeplink
  const { isLoading: isLoadingDeeplink } = useQuery({
    queryKey: ['auth-deeplink', auth.solanaAddress],
    queryFn: async () => {
      if (!auth.solanaAddress) {
        throw new Error('Solana address is required');
      }
      try {
        const response = await generateDeeplink(auth.solanaAddress);
        setDeeplink(response.deep_link);
        setPollingCode(response.polling_code);
        return response;
      } catch (e) {
        setErrorMessage('Failed to login');
        setErrorDescription('Login could not be completed');
        throw e;
      }
    },
    enabled: isOpen && !deeplink && !!auth.solanaAddress,
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
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (qrElement) {
      qrInstanceRef.current.append(qrElement);
    }
  }, [qrElement]);

  useEffect(() => {
    if (deeplink) {
      qrInstanceRef.current.update({
        data: deeplink,
      });
    }
  }, [deeplink]);

  // Handle poll responses
  useEffect(() => {
    if (!pollData) return;

    if (pollData.status === 'authorized') {
      if (!pollData.oracle_signature || !pollData.oracle_public_key || !pollData.session_address || !pollData.timestamp || !auth.solanaAddress) {
        setErrorMessage('Failed to login');
        setErrorDescription('Missing required data from authorization');
        return;
      }

      // Store transaction data, show confirm UI
      setPendingTransactionData({
        oracleSignature: pollData.oracle_signature,
        oraclePublicKey: pollData.oracle_public_key,
        sessionAddress: pollData.session_address,
        timestamp: pollData.timestamp,
        solanaAddress: auth.solanaAddress,
      });
    } else if (pollData.status === 'rejected') {
      setErrorMessage('Access rejected');
      setErrorDescription('You did not allow access to sign in');
    } else if (pollData.status === 'expired') {
      setErrorMessage('Link expired');
      setErrorDescription('Login could not be completed');
    }
  }, [pollData, auth.solanaAddress]);

  const handleConfirmTransaction = async () => {
    if (!pendingTransactionData || !publicKey || !signTransaction) {
      setErrorMessage('Wallet not connected');
      setErrorDescription('Please connect your Solana wallet first');
      return;
    }

    try {
      setIsSigningTransaction(true);

      // Build transaction
      const oracleSignature = Uint8Array.from(Buffer.from(pendingTransactionData.oracleSignature, 'base64'));
      const oraclePublicKey = new PublicKey(pendingTransactionData.oraclePublicKey);
      const payerPublicKey = publicKey;

      const transaction = client.buildCreateAttestationTransaction({
        payerPublicKey,
        sessionAddress: pendingTransactionData.sessionAddress,
        oracleSignature,
        oraclePublicKey,
        timestamp: pendingTransactionData.timestamp,
        expiry: pendingTransactionData.timestamp + 86400, // 24 hours expiry
      });

      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = payerPublicKey;

      // Sign transaction with wallet-adapter
      const signedTransaction = await signTransaction(transaction);

      // Send transaction
      const signature = await connection.sendRawTransaction(signedTransaction.serialize());

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

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
          <div className={styles.successfulSubtitle}>You have signed in successfully.</div>
          <div className={styles.successfulButton} onClick={handleClose}>Done</div>
        </div>
      </ModalBase>
    )
  }

  if (pendingTransactionData && !isSigningTransaction) {
    return (
      <ModalBase onClose={handleClose} isOpen={isOpen}>
        <div className={styles.successfulContainer}>
          <SuccessIcon />
          <div className={styles.successfulTitle}>Authorization Complete</div>
          <div className={styles.successfulSubtitle}>Click confirm to create your attestation on Solana</div>
          <div className={styles.successfulButton} onClick={handleConfirmTransaction}>Confirm</div>
        </div>
      </ModalBase>
    )
  }

  if (isSigningTransaction) {
    return (
      <ModalBase onClose={handleClose} isOpen={isOpen} showClose={false}>
        <div className={styles.successfulContainer}>
          <div className={styles.qrCodeSpin}><SpinIcon /></div>
          <div className={styles.successfulTitle}>Sign Transaction</div>
          <div className={styles.successfulSubtitle}>Please approve the transaction in your wallet</div>
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
          {isLoadingDeeplink ? (
            <div className={styles.qrCodeSpinContainer}>
              <div className={styles.qrCodeSpin}><SpinIcon /></div>
            </div>
          ) : null}
          <div className={clsx(styles.qrCode, isLoadingDeeplink && styles.qrCodeLoading)} ref={setQrElement} />
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
