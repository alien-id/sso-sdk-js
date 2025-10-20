import React, { useEffect } from 'react';
import { AlienSsoProvider, useAuth } from '@alien_org/sso-sdk-react';
import { SignInButton } from '@alien_org/sso-sdk-react';
import './App.css';

const ssoConfig = {
  ssoBaseUrl: import.meta.env.VITE_ALIEN_SSO_BASE_URL,
  providerAddress: import.meta.env.VITE_ALIEN_PROVIDER_ADDRESS,
};

function AuthVerifier() {
  const { verifyAuth, logout, auth } = useAuth();

  useEffect(() => {
    if (!auth.token) {
      return;
    }

    (async () => {
      try {
        const isValid = await verifyAuth();
        if (!isValid) {
          logout();
        }
      } catch (error) {
        logout();
      }
    })();
  }, [verifyAuth, logout, auth.token]);

  return null;
}

function AppContent() {
  const { auth, logout } = useAuth();

  if (auth.isAuthenticated && auth.tokenInfo) {
    return (
      <div className="App">
        <header className="App-header">
          <div style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            padding: '40px',
            borderRadius: '20px',
            maxWidth: '600px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
          }}>
            <h1 style={{ marginBottom: '10px', fontSize: '36px' }}>🎉 Welcome!</h1>
            <p style={{ fontSize: '16px', opacity: 0.9, marginBottom: '30px' }}>
              You're successfully authenticated with Alien SSO
            </p>

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
                  <strong style={{ opacity: 0.8 }}>Session:</strong><br/>
                  <code style={{
                    background: 'rgba(0,0,0,0.2)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}>
                    {auth.tokenInfo.app_callback_session_address}
                  </code>
                </p>
                <p style={{ margin: '8px 0' }}>
                  <strong style={{ opacity: 0.8 }}>Issued:</strong> {new Date(auth.tokenInfo.issued_at * 1000).toLocaleString()}
                </p>
                <p style={{ margin: '8px 0' }}>
                  <strong style={{ opacity: 0.8 }}>Expires:</strong> {new Date(auth.tokenInfo.expired_at * 1000).toLocaleString()}
                </p>
              </div>
            </div>

            <button
              onClick={logout}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: '2px solid rgba(255,255,255,0.3)',
                color: 'white',
                padding: '12px 32px',
                fontSize: '16px',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: '600',
                transition: 'all 0.3s ease',
                backdropFilter: 'blur(10px)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.3)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              Logout
            </button>
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
            background: 'linear-gradient(135deg, #fff 0%, #e0e7ff 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontWeight: '700'
          }}>
            Demo app
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
            Secure authentication powered by blockchain and TEE technology
          </p>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            justifyContent: 'start',
            alignItems: 'center'
          }}>
            <SignInButton />
            or short variant:
            <div>
               <SignInButton variant="short" />
            </div>
          </div>

          <div style={{
            marginTop: '32px',
            paddingTop: '24px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            fontSize: '14px',
            opacity: 0.7
          }}>
            Click any button to sign in with your Alien identity
          </div>
        </div>
      </header>
    </div>
  );
}

function App() {
  return (
    <AlienSsoProvider config={ssoConfig}>
      <AuthVerifier />
      <AppContent />
    </AlienSsoProvider>
  );
}

export default App;
