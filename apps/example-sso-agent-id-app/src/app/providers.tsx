'use client';

import {
  AlienSsoProvider,
  type AlienSsoProviderConfig,
} from '@alien-id/sso-react';

const config: AlienSsoProviderConfig = {
  ssoBaseUrl: process.env.NEXT_PUBLIC_ALIEN_SSO_BASE_URL!,
  providerAddress: process.env.NEXT_PUBLIC_ALIEN_PROVIDER_ADDRESS!,
  agentId: {
    enabled: true,
    skillUrl: '/AGENT-SKILL.md',
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return <AlienSsoProvider config={config}>{children}</AlienSsoProvider>;
}
