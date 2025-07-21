'use client';

import { AlienSsoSdkClient } from '@alien/sso-sdk-client-js'

import './page.css';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import QRCode from "react-qr-code";
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

const alienSsoSdkClient = new AlienSsoSdkClient({
  providerAddress: '00000001000000000000001400000000',
  providerPrivateKey: 'f65a779912afa285668ac6ad553f354db7cdb781364dd04238c70b8583f090303fa6921c3d79e40833d372f5ffcfceaf29844930da55b8d5b00ea1428ce0d268',
  // ssoBaseUrl: 'http://localhost:3000/api/mock',
  ssoBaseUrl: 'https://sso.alien-api.com', // https://sso.alien-api.com
  serverSdkBaseUrl: 'http://localhost:3001/api',
});

export default function Home() {
  const router = useRouter();

  const [deepLink, setDeepLink] = useState<string>('');
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);

  useEffect(() => {
    const accessToken = alienSsoSdkClient.getAccessToken();

    setIsAuthorized(!!accessToken);
  }, [router]);

  const handleLogin = async () => {
    try {
      const { deep_link, polling_code } = await alienSsoSdkClient.authorize();
      console.log({ deep_link, polling_code });

      setDeepLink(deep_link);

      const autorizationCode = await alienSsoSdkClient.pollForAuthorization(polling_code);

      console.log({ autorizationCode });

      if (!autorizationCode) return;

      const accessToken = await alienSsoSdkClient.exchangeCode(autorizationCode);
      console.log({ accessToken });

      if (!accessToken) return;

      const isValid = await alienSsoSdkClient.verifyToken('');
      console.log({ isValid });

      setIsAuthorized(isValid);
    } catch (error) {
      console.log('handleLogin', error);
    }
  }

  const handleSignOut = () => {
    alienSsoSdkClient.logout();
    setIsAuthorized(false);
    setDeepLink('');
    router.refresh();
  }

  if (isAuthorized) return (
    <div className='flex flex-col items-center gap-4'>
      You're authorized!

      <button
        className="button"
        onClick={handleSignOut}
      >
        <div className="button-content-wrapper">
          <span className="button-contents">Sign Out</span>
          <span style={{ display: 'none' }}>Sign Out</span>
        </div>
      </button>
    </div>
  )

  if (deepLink) return (
    <>
      <div style={{ height: "auto", background: "white", padding: "1rem", margin: "0 auto", maxWidth: 256, width: "100%" }}>
        <QRCode
          size={256}
          style={{ height: "auto", maxWidth: "100%", width: "100%" }}
          value={deepLink}
          viewBox={`0 0 256 256`}
        />
      </div>

      <Link target='_blank' href={deepLink} style={{ wordBreak: 'break-all' }}>
        {deepLink}
      </Link>
    </>
  )

  return (
    <Button
      className=""
      size='lg'
      onClick={handleLogin}
    >
      Sign in with Alien ID
    </Button>
  );
}
