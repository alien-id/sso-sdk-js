import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { getLogoUri } from "../consts/logoUri";
import { PublicKey } from '@solana/web3.js';
import { SolanaIcon } from "../assets/SolanaIcon.tsx";
import { SolanaColorIcon } from "../assets/SolanaColorIcon.tsx";
import { Buffer } from 'buffer';

// Create QR code instance with blob URL for CSP compatibility
const qrCode = new QRCodeStyling({
  ...qrOptions,
  image: getLogoUri(),
})

const shortenAddress = (address: string, startChars = 11, endChars = 4): string => {
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const SolanaSignInModal = () => {
  const {
    isModalOpen: isOpen,
    closeModal: onClose,
    generateDeeplink,
    pollAuth,
    client,
    wallet: { publicKey, signTransaction },
    connectionAdapter: { connection },
    queryClient,
  } = useSolanaAuth();
  const isMobile = useIsMobile();

  const [isSuccess, setIsSuccess] = useState(false);
  const [alreadyLinked, setAlreadyLinked] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [errorDescription, setErrorDescription] = useState<string>('');
  const [pollingCode, setPollingCode] = useState<string>('');
  const [deeplink, setDeeplink] = useState<string>('');
  const [isSigningTransaction, setIsSigningTransaction] = useState(false);
  const [pendingTransactionData, setPendingTransactionData] = useState<any>(null);
  const [isTransactionExpired, setIsTransactionExpired] = useState(false);

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

        const sessionAddress = await client.getAttestation(solanaAddress);
        if (sessionAddress) {
          // The wallet is already bound (L1 lookup). The binding is permanent
          // and the on-chain `init` is non-idempotent, so there is nothing left
          // to enroll — running the QR/oracle ceremony again would revert. Just
          // report the existing binding.
          //
          // This is NOT a sign-in: a binding proves a historical link, never
          // current possession of the wallet (F-06). This modal does enrollment
          // and lookup only; it establishes no session. To authenticate a
          // returning wallet, verify a fresh proof-of-possession in your backend
          // (see docs/solana-integration.md). We therefore do not need
          // `signMessage` here at all.
          setAlreadyLinked(true);
          setIsSuccess(true);
          setIsLoadingQr(false);
          return sessionAddress;
        }
        // No attestation exists: run the full QR/oracle bind ceremony. The
        // create-attestation transaction the user signs is itself a fresh proof
        // of possession, so no separate signed nonce is needed.

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
      setIsTransactionExpired(false);

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
      const rawTransaction = signedTransaction.serialize();

      // Retry loop with blockhash expiration tracking
      let currentBlockHeight = await connection.getBlockHeight();
      let transactionSent = false;

      while (currentBlockHeight < lastValidBlockHeight) {
        try {
          const signature = await connection.sendRawTransaction(rawTransaction, {
            skipPreflight: true,
            maxRetries: 0,
          });

          // Try to confirm transaction
          const confirmation = await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight,
          }, 'confirmed');

          if (confirmation.value.err) {
            // Transaction failed, continue retry loop
            await sleep(500);
            currentBlockHeight = await connection.getBlockHeight();
            continue;
          }

          // Transaction confirmed successfully: the wallet ↔ Alien ID binding
          // now exists on-chain. This is enrollment, NOT sign-in — the modal
          // establishes no session and sets no auth state. Authentication is the
          // integrator's, performed in their backend (see ADR-0002).
          transactionSent = true;

          setIsSuccess(true);
          return;
        } catch (error: any) {
          // If error is not related to confirmation timeout, continue retry
          console.log('Retry attempt failed, continuing...', error.message);
          await sleep(500);
          currentBlockHeight = await connection.getBlockHeight();
        }
      }

      // Blockhash expired without successful confirmation
      if (!transactionSent) {
        setIsTransactionExpired(true);
        setErrorMessage('Transaction expired');
        setErrorDescription('The transaction blockhash has expired. Please try sending the transaction again.');
      }
    } catch (error: any) {
      console.error('Transaction error:', error);

      // Check if error is related to blockhash expiration
      if (error?.message?.includes('blockhash') || error?.message?.includes('expired')) {
        setIsTransactionExpired(true);
        setErrorMessage('Transaction expired');
        setErrorDescription('The transaction blockhash has expired. Please try sending the transaction again.');
      } else {
        setErrorMessage('Failed to sign transaction');
        setErrorDescription(error?.message || 'Could not complete transaction');
      }
    } finally {
      setIsSigningTransaction(false);
    }
  };

  const resetState = () => {
    setIsSuccess(false);
    setAlreadyLinked(false);
    setErrorMessage('');
    setErrorDescription('');
    setDeeplink('');
    setPollingCode('');
    setIsSigningTransaction(false);
    setPendingTransactionData(null);
    setIsTransactionExpired(false);
    queryClient.removeQueries({ queryKey: ['auth-deeplink'] });
    queryClient.removeQueries({ queryKey: ['auth-poll'] });
  };

  const handleRetry = () => {
    resetState();
  };

  const handleSendTransactionAgain = () => {
    setErrorMessage('');
    setErrorDescription('');
    setIsTransactionExpired(false);
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
          <div className={styles.successfulTitle}>
            {alreadyLinked ? 'Wallet already linked' : 'Wallet linked!'}
          </div>
          <div className={styles.successfulSubtitle}>
            {alreadyLinked
              ? <>This Solana address is already linked <br /> to your Alien ID</>
              : <>Your Solana address is now linked <br /> to your Alien ID</>}
          </div>
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
          {isTransactionExpired ? (
            <div className={styles.errorButton} onClick={handleSendTransactionAgain}><RetryIcon />Send transaction again</div>
          ) : (
            <div className={styles.errorButton} onClick={handleRetry}><RetryIcon />Try again</div>
          )}
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
                <div className={styles.footerTitle}>Don't have an Alien App yet?</div>
                <div className={styles.footerSubtitle}>Available on iOS and Android.</div>
              </div>

              <a href="https://alien.org" target="_blank" className={styles.footerButton}>Download</a>
            </div>
          </>
        ) : (
          <>
            {deeplink && <a href={deeplink} target="_blank" className={styles.mobileOpenButton}><span>Open in Alien App</span> <RightIcon /></a>}
            <div className={styles.mobileFooter}>
              <div className={styles.mobileFooterTitle}>Don't have an Alien App yet?</div>
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
