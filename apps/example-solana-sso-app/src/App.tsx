import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlienSolanaSsoProvider, useSolanaAuth } from '@alien-id/sso-solana-react';
import { buildPopMessage } from '@alien-id/sso-solana';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import './App.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import { SolanaSignInButton } from "@alien-id/sso-solana-react";

const ssoConfig = {
  ssoBaseUrl: import.meta.env.VITE_ALIEN_SSO_BASE_URL,
  providerAddress: import.meta.env.VITE_ALIEN_PROVIDER_ADDRESS,
};

type Session = { sessionAddress: string; wallet: string };

function AppContent() {
  const { publicKey, signMessage } = useWallet();
  const { verifyAttestation } = useSolanaAuth();

  const [session, setSession] = useState<Session | null>(null);
  const [isLinked, setIsLinked] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string>('');

  const walletAddress = useMemo(() => publicKey?.toBase58(), [publicKey]);

  // Restore an existing backend session on load. This is the ONLY source of
  // "signed in" truth — it lives in an httpOnly cookie the frontend can't forge.
  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setSession)
      .catch(() => setSession(null));
  }, []);

  // L1 lookup — a UI hint only. It reports whether the wallet is bound to an
  // Alien ID; it never signs anyone in (F-06). Authentication happens in the
  // backend, below.
  useEffect(() => {
    if (!walletAddress) {
      setIsLinked(false);
      return;
    }
    verifyAttestation(walletAddress)
      .then((sessionAddress) => setIsLinked(!!sessionAddress))
      .catch(console.error);
  }, [walletAddress, verifyAttestation]);

  // The real authentication flow: prove possession to OUR backend, which
  // verifies the Ed25519 signature, looks up the binding (L1), and mints its
  // own httpOnly session.
  const signIn = useCallback(async () => {
    if (!walletAddress || !signMessage) {
      setError('Connect a wallet that supports message signing.');
      return;
    }
    setError('');
    setIsSigningIn(true);
    try {
      const { nonce } = await fetch('/api/nonce', { method: 'POST' }).then((r) => r.json());
      const signature = await signMessage(
        new TextEncoder().encode(buildPopMessage(walletAddress, nonce)),
      );
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: walletAddress,
          nonce,
          signature: Buffer.from(signature).toString('base64'),
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'sign-in failed' }));
        throw new Error(error || 'sign-in failed');
      }
      setSession(await res.json());
    } catch (e: any) {
      setError(e?.message || 'Sign-in failed');
    } finally {
      setIsSigningIn(false);
    }
  }, [walletAddress, signMessage]);

  const logout = useCallback(async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    setSession(null);
  }, []);

  if (publicKey && session) {
    return (
      <div className="App">
        <header className="App-header">
          <div style={{
            background: 'linear-gradient(135deg, #14F195 0%, #9945FF 100%)',
            padding: '40px',
            borderRadius: '20px',
            maxWidth: '600px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            position: 'relative'
          }}>
            <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 10, display: 'flex', gap: '12px' }}>
              <button
                onClick={logout}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                  transition: 'all 0.2s',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.3)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
                }}
              >
                Logout
              </button>
              <WalletMultiButton />
            </div>

            <div style={{ paddingTop: '40px' }}>
              <h1 style={{ marginBottom: '10px', fontSize: '36px' }}>🎉 Welcome!</h1>
              <p style={{ fontSize: '16px', opacity: 0.9, marginBottom: '30px' }}>
                Authenticated by this app's backend (httpOnly session)
              </p>
            </div>

              <div style={{
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '12px',
                padding: '24px',
                textAlign: 'left',
                backdropFilter: 'blur(10px)',
                marginBottom: '24px'
              }}>
                <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '20px' }}>Session Info</h3>
                <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
                  <p style={{ margin: '8px 0', wordBreak: 'break-all' }}>
                    <strong style={{ opacity: 0.8 }}>Session Address (sub):</strong><br/>
                    <code style={{
                      background: 'rgba(0,0,0,0.2)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px'
                    }}>
                      {session.sessionAddress}
                    </code>
                  </p>
                  <p style={{ margin: '8px 0', wordBreak: 'break-all' }}>
                    <strong style={{ opacity: 0.8 }}>Solana Wallet:</strong><br/>
                    <code style={{
                      background: 'rgba(0,0,0,0.2)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px'
                    }}>
                      {session.wallet}
                    </code>
                  </p>
                </div>
              </div>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="App-header">
        <div style={{
          background: 'rgba(255,255,255,0.1)',
          backdropFilter: 'blur(20px)',
          padding: '50px 40px',
          borderRadius: '24px',
          maxWidth: '500px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.2)',
          position: 'relative',
          zIndex: 1
        }}>
          <h1 style={{
            fontSize: '36px',
            marginBottom: '16px',
            background: 'linear-gradient(135deg, #14F195 0%, #9945FF 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontWeight: '700'
          }}>
            Solana Demo
          </h1>
          <h1 style={{
            fontSize: '42px',
            marginBottom: '16px',
            background: 'linear-gradient(135deg, #fff 0%, #e0e7ff 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontWeight: '700'
          }}>
            Alien SSO
          </h1>
          <p style={{
            fontSize: '16px',
            opacity: 0.9,
            marginBottom: '40px',
            lineHeight: '1.6'
          }}>
            Link your wallet to an Alien ID (enrollment), then sign in through
            this app's backend (proof-of-possession + your own session).
          </p>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            alignItems: 'center'
          }}>
            <WalletMultiButton style={{
              background: publicKey ? 'rgba(20,241,149,0.2)' : 'linear-gradient(135deg, #14F195 0%, #9945FF 100%)',
            }} />

            {publicKey && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                justifyContent: 'start',
                alignItems: 'center',
                width: '100%'
              }}>
                {isLinked ? (
                  <>
                    <div style={{ fontSize: '13px', opacity: 0.85, textAlign: 'center' }}>
                      This wallet is linked to an Alien ID. Sign in to prove you
                      control it.
                    </div>
                    <button
                      onClick={signIn}
                      disabled={isSigningIn}
                      style={{
                        background: 'linear-gradient(135deg, #14F195 0%, #9945FF 100%)',
                        border: 'none',
                        borderRadius: '10px',
                        padding: '12px 24px',
                        color: 'white',
                        cursor: isSigningIn ? 'default' : 'pointer',
                        fontSize: '15px',
                        fontWeight: 700,
                        opacity: isSigningIn ? 0.7 : 1,
                      }}
                    >
                      {isSigningIn ? 'Signing in…' : 'Sign in (prove ownership)'}
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '13px', opacity: 0.85, textAlign: 'center' }}>
                      This wallet isn't linked yet. Enroll it with the Alien App
                      first.
                    </div>
                    <SolanaSignInButton />
                  </>
                )}
                {error && (
                  <div style={{ fontSize: '13px', color: '#ffb4b4', textAlign: 'center' }}>
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{
            marginTop: '32px',
            paddingTop: '24px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            fontSize: '14px',
            opacity: 0.7
          }}>
            {!publicKey
              ? 'Connect your Solana wallet to continue'
              : isLinked
                ? 'Sign in to create a backend session'
                : 'Enroll your wallet to link it to your Alien ID'}
          </div>
        </div>
      </header>
    </div>
  );
}

function App() {
  const endpoint = useMemo(() => clusterApiUrl(WalletAdapterNetwork.Devnet), []);
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AlienSolanaSsoProvider
            config={ssoConfig}
          >
            <AppContent />
          </AlienSolanaSsoProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default App;
