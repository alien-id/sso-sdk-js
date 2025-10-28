import React, { useEffect, useMemo } from 'react';
import { AlienSolanaSsoProvider, useSolanaAuth } from '@alien_org/solana-sso-sdk-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider, useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import './App.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import { SolanaSignInButton } from "@alien_org/solana-sso-sdk-react";

const ssoConfig = {
  ssoBaseUrl: import.meta.env.VITE_ALIEN_SSO_BASE_URL,
  providerAddress: import.meta.env.VITE_ALIEN_PROVIDER_ADDRESS,
};

function AppContent() {
  const { publicKey } = useWallet();
  const { auth, verifyAttestation, logout } = useSolanaAuth();

  useEffect(() => {
    if (!publicKey) return;

    verifyAttestation(publicKey.toBase58()).catch(console.error);
  }, [publicKey]);

  if (publicKey && auth.sessionAddress) {
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
                You're authenticated with Alien on Solana
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
                <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '20px' }}>Authentication Info</h3>
                <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
                  <p style={{ margin: '8px 0', wordBreak: 'break-all' }}>
                    <strong style={{ opacity: 0.8 }}>Session Address:</strong><br/>
                    <code style={{
                      background: 'rgba(0,0,0,0.2)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px'
                    }}>
                      {auth.sessionAddress}
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
                      {publicKey.toBase58()}
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
            Sign In with Alien on Solana blockchain
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

            {publicKey && !auth.sessionAddress && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                justifyContent: 'start',
                alignItems: 'center',
                width: '100%'
              }}>
                <SolanaSignInButton />
                or short variant:
                <div>
                  <SolanaSignInButton variant="short" />
                </div>
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
              : 'Sign in with Alien to link your wallet'}
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
