import { useEffect, useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

import { AlienSSOClient } from '@alien/sso-sdk-js'

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const authFlow = async () => {
      const client = new AlienSSOClient({
        providerAddress: 'your-provider-address',
        providerPrivateKey: 'your-private-key',
        baseUrl: 'https://sso.alien.com',
      });

      // 1. Start authorization
      const authResponse = await client.authorize();

      // 2. Poll for user authorization
      const authorizationCode = await client.pollForAuthorization(authResponse.polling_code);

      // 3. Exchange code for access token
      const accessToken = await client.exchangeCode(authorizationCode!);
      console.log('accessToken', accessToken);

      // 4. Verify token
      const isValid = await client.verifyToken();
      console.log('isValid', isValid);

      // 5. Get access token directly
      const token = client.getAccessToken();
      console.log('token', token);

      // 6. Logout
      client.logout();
    }

    authFlow();
  }, [])

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
