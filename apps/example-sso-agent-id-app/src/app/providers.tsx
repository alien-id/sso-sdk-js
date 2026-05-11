'use client';

import {
  AlienSsoProvider,
  type AlienSsoProviderConfig,
} from '@alien-id/sso-react';

// Build-time fallbacks: Next.js static prerender invokes the Zod-validated
// AlienSsoProvider config before Vercel's env vars are available. The
// canonical issuer is safe to default; provider address falls back to the
// zero address (overridden at runtime by the real value).
const config: AlienSsoProviderConfig = {
  ssoBaseUrl:
    process.env.NEXT_PUBLIC_ALIEN_SSO_BASE_URL ?? 'https://sso.alien-api.com',
  providerAddress:
    process.env.NEXT_PUBLIC_ALIEN_PROVIDER_ADDRESS ??
    '00000000000000000000000000000000',
  agentId: {
    enabled: true,
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return <AlienSsoProvider config={config}>{children}</AlienSsoProvider>;
}
