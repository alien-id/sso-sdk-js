# @alien-id/sso-solana-react

React hooks and components for [Alien SSO](https://alien.org) Solana authentication. Built on top of [@alien-id/sso-solana](https://www.npmjs.com/package/@alien-id/sso-solana) with Solana wallet adapter integration.

## ⚠️ Alpha Version Notice

**This is an early alpha version.** The SDK is under active development and may contain bugs or undergo breaking changes. Use with caution in production environments.

## Installation

```bash
npm install @alien-id/sso-solana-react @solana/web3.js @solana/wallet-adapter-react
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
- **[Demo App](https://dev.alien.org/docs/solana-sso-demo-app)** - Example Solana React application

### Core SDK

For vanilla JavaScript/TypeScript usage or custom implementations, see [@alien-id/sso-solana](https://www.npmjs.com/package/@alien-id/sso-solana).

## Authentication Flow

The SDK handles the complete Solana authentication flow automatically:

1. User **connects wallet** via Solana wallet adapter
2. User clicks **Sign In** button
3. Modal opens with **QR code** and deep link
4. User scans QR or opens deep link in **Alien App**
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
import '@alien-id/sso-solana-react/dist/style.css'; // Optional: Import default styles

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
  SolanaLinkResponse,
  SolanaPollResponse
} from '@alien-id/sso-solana';
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
- [GitHub Repository](https://github.com/alien-id/sso-sdk-js)
- [NPM Package](https://www.npmjs.com/package/@alien-id/sso-solana-react)
- [Core SDK](https://www.npmjs.com/package/@alien-id/sso-solana)
