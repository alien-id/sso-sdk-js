# @alien_org/solana-sso-sdk-react

React hooks and components for [Alien SSO](https://alien.org) Solana authentication. Built on top of [@alien_org/solana-sso-sdk-core](https://www.npmjs.com/package/@alien_org/solana-sso-sdk-core) with Solana wallet adapter integration.

## Installation

```bash
npm install @alien_org/solana-sso-sdk-react @solana/web3.js @solana/wallet-adapter-react
```

## Features

- ✅ **Solana wallet integration** - Works with any Solana wallet adapter
- ✅ **On-chain attestation** - Automatic transaction building and signing
- ✅ **Grace period handling** - Manages RPC indexing delays
- ✅ **Pre-built components** - Sign-in button and modal
- ✅ **React 19 support** with modern hooks
- ✅ **TypeScript-first** with full type safety
- ✅ **Persistent sessions** - localStorage-backed authentication state

## Documentation

📚 **Full documentation at [dev.alien.org/docs](https://dev.alien.org/docs)**

- **[Solana React Integration Guide](https://dev.alien.org/docs/solana-sso-guide/react-integration)** - Complete integration walkthrough
- **[API Reference](https://dev.alien.org/docs/solana-sso-api-reference/api-reference-react)** - Detailed API documentation
- **[Demo dApp](https://dev.alien.org/docs/solana-sso-demo-dapp)** - Example Solana React application

### Core SDK

For vanilla JavaScript/TypeScript usage or custom implementations, see [@alien_org/solana-sso-sdk-core](https://www.npmjs.com/package/@alien_org/solana-sso-sdk-core).

## Authentication Flow

The SDK handles the complete Solana authentication flow automatically:

1. User **connects wallet** via Solana wallet adapter
2. User clicks **Sign In** button
3. Modal opens with **QR code** and deep link
4. User scans QR or opens deep link in **Alien app**
5. SDK **polls** for authentication completion
6. On success, builds **attestation transaction**
7. User **signs transaction** via wallet
8. Transaction **sent and confirmed** on Solana
9. **Grace period** handles RPC indexing delay
10. Auth state updates with **session address**

## Grace Period Mechanism

The SDK implements a 60-second grace period after attestation creation to handle RPC indexing delays:

- After successful attestation, session address is cached for 60 seconds
- During grace period, `verifyAttestation()` returns cached value immediately
- Background verification runs after grace period expires
- Automatic retry on verification failures

## Storage Keys

- `alien-sso_solana_authed_address` - Authenticated Solana wallet address
- `alien-sso_session_address` - Session address
- `alien-sso_attestation_created_at` - Timestamp of attestation creation

## Custom Styling

The SDK includes default styles, but you can customize them:

```tsx
import '@alien_org/solana-sso-sdk-react/dist/style.css'; // Optional: Import default styles

// Override with your own CSS
.alien-solana-sso-button {
  background: your-color;
  /* ... */
}
```

## TypeScript Support

Includes full TypeScript declarations:

```typescript
import type {
  AlienSolanaSsoClientConfig,
  SolanaAuthState,
  SolanaLinkResponse,
  SolanaPollResponse
} from '@alien_org/solana-sso-sdk-react';
```

## Peer Dependencies

- `react` ^19.1.1
- `react-dom` ^19.1.1
- `@solana/web3.js` - Solana blockchain interaction
- `@solana/wallet-adapter-react` - Solana wallet adapter

## Getting a Provider Address

Register your application at the [Developer Portal](https://dev.alien.org/dashboard) to get your provider credentials.

## Browser Support

- Modern browsers with ES2020+ support
- Chrome, Firefox, Safari, Edge (latest versions)

## License

MIT

## Links

- [Documentation](https://dev.alien.org/docs)
- [GitHub Repository](https://github.com/alien-org/sso-sdk-js)
- [NPM Package](https://www.npmjs.com/package/@alien_org/solana-sso-sdk-react)
- [Core SDK](https://www.npmjs.com/package/@alien_org/solana-sso-sdk-core)
