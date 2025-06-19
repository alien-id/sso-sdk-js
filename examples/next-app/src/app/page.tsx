'use client';
import { AlienSsoSdkClient } from '@alien/sso-sdk-client-js'

import './page.css';

const alienSsoSdkClient = new AlienSsoSdkClient({
  providerAddress: 'your-provider-address',
  providerPrivateKey: 'your-private-key',
  ssoBaseUrl: 'http://localhost:3005',
  serverSdkBaseUrl: 'http://localhost:3000'
});

export default function Home() {
  const handleLogin = async () => {
    try {
      const result = await alienSsoSdkClient.authorize();

      console.log(result);
    } catch (error) {
      console.log('handleLogin', error);
    }
  }

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
        <button
          className="button"
          onClick={handleLogin}
        >
          <div className="button-content-wrapper">

            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 42 42"
              fill="none"
              className='button-icon'
            >
              <path fillRule="evenodd" clipRule="evenodd" d="M21 1.75C12.3015 1.75 5.25 8.86965 5.25 17.6522C5.25 22.6624 5.69145 25.9924 6.07067 27.9287C6.3465 29.337 7.2096 30.5142 8.34433 31.3793L15.098 36.5283C16.7762 37.8077 18.8218 38.5 20.9246 38.5C23.0286 38.5 25.0764 37.8145 26.7637 36.5454L32.765 32.0315C34.4415 30.7705 35.5239 28.8629 35.7533 26.7649L36.75 17.6522C36.75 8.86965 29.6985 1.75 21 1.75ZM17.6635 20.5496C20.0443 24.7132 20.093 29.1851 17.7723 30.5379C15.4516 31.8907 11.6403 29.6121 9.25943 25.4486C6.87861 21.285 6.82987 16.8131 9.15058 15.4603C11.4713 14.1075 15.2826 16.3861 17.6635 20.5496ZM24.3731 30.5379C22.0524 29.1851 22.1011 24.7132 24.482 20.5496C26.8628 16.3861 30.6741 14.1075 32.9949 15.4603C35.3156 16.8131 35.2668 21.285 32.886 25.4486C30.5052 29.6121 26.6938 31.8907 24.3731 30.5379Z" fill="white" />
            </svg>

            <span className="button-contents">Sign in with Alien</span>
            <span style={{ display: 'none' }}>Sign in with Alien</span>
          </div>
        </button>
      </main>
    </div>
  );
}
