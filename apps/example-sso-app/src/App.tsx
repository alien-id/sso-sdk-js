import React from 'react';
import { AlienSsoProvider } from '@alien_org/sso-sdk-react';
import { SignInButton } from '@alien_org/sso-sdk-react';
import './App.css';

const ssoConfig = {
  ssoBaseUrl: import.meta.env.VITE_ALIEN_SSO_BASE_URL,
  providerAddress: import.meta.env.VITE_ALIEN_PROVIDER_ADDRESS,
};

function App() {
  return (
    <AlienSsoProvider config={ssoConfig}>
      <div className="App">
        <header className="App-header">
          <h1>Alien SSO Example</h1>
          <p>Click the button below to authenticate with Alien SSO</p>
          <SignInButton />
          <div style={{ marginTop: '10px' }}>
            <SignInButton variant="short" />
          </div>
        </header>
      </div>
    </AlienSsoProvider>
  );
}

export default App;
