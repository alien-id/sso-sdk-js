# @alien_org/solana-sso-sdk-core

Solana-specific authentication client for [Alien SSO](https://alien.org) with on-chain attestation support. Enables blockchain-native authentication with session verification on Solana.

## Installation

```bash
npm install @alien_org/solana-sso-sdk-core @solana/web3.js
```

## Features

- ✅ **On-chain attestations** - Verifiable sessions on Solana blockchain
- ✅ **PDA derivation utilities** - All necessary account derivations
- ✅ **Transaction building** - Ready-to-sign attestation transactions
- ✅ **TypeScript-first** with full type safety
- ✅ **Runtime validation** via Zod schemas
- ✅ **Multi-program support** - Credential Signer, Session Registry, SAS

## Documentation

📚 **Full documentation at [dev.alien.org/docs](https://dev.alien.org/docs)**

- **[Solana Integration Guide](https://dev.alien.org/docs/solana-sso-guide/core-integration)** - Complete integration walkthrough
- **[API Reference](https://dev.alien.org/docs/solana-sso-api-reference/api-reference-core)** - Detailed API documentation
- **[What is Alien Session?](https://dev.alien.org/docs/what-is-alien-session)** - Session architecture explained
- **[Demo dApp](https://dev.alien.org/docs/solana-sso-demo-dapp)** - Example Solana application

### React Integration

For React applications with Solana wallet adapters, check out [@alien_org/solana-sso-sdk-react](https://www.npmjs.com/package/@alien_org/solana-sso-sdk-react):

```bash
npm install @alien_org/solana-sso-sdk-react
```

## Authentication Flow

1. **User connects** Solana wallet
2. **Generate deeplink** with wallet address → Display QR code
3. **User authenticates** in Alien mobile app
4. **Poll for completion** → Get oracle signature and session data
5. **Build transaction** → Create on-chain attestation
6. **Sign and send** → User signs with wallet, transaction confirms
7. **Verify attestation** → Check on-chain session validity

## On-Chain Programs

The SDK integrates with three Solana programs:

- **Credential Signer** (`9cstDz8WWRAFaq1vVpTjfHz6tjgh6SJaqYFeZWi1pFHG`) - Manages credentials
- **Session Registry** (`DeHa6pyZ2CFSbQQiNMm7FgoCXqmkX6tXG77C4Qycpta6`) - Stores sessions
- **SAS** (`22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`) - Solana Attestation Service

All program IDs are configurable via constructor options.

## Getting a Provider Address

Register your application at the [Developer Portal](https://dev.alien.org/dashboard) to get your provider credentials.

## TypeScript Support

Includes full TypeScript declarations with Zod runtime validation:

```typescript
import type {
  AlienSolanaSsoClientConfig,
  SolanaLinkResponse,
  SolanaPollResponse,
  SolanaAttestationResponse
} from '@alien_org/solana-sso-sdk-core';
```

## Peer Dependencies

- `@solana/web3.js` - Solana blockchain interaction

## License

MIT

## Links

- [Documentation](https://dev.alien.org/docs)
- [GitHub Repository](https://github.com/alien-org/sso-sdk-js)
- [NPM Package](https://www.npmjs.com/package/@alien_org/solana-sso-sdk-core)
- [React Integration](https://www.npmjs.com/package/@alien_org/solana-sso-sdk-react)
