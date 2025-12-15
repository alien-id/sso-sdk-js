## ⚠️ Alpha Version Notice

**This is an early alpha version of the Alien SSO SDK.** The SDK is under active development and may contain bugs or undergo breaking changes. Use with caution in production environments.

## Overview

This monorepo provides two authentication approaches:

- **Standard SSO**: Web2-style OIDC authentication with TEE and blockchain backing
- **Solana SSO**: Blockchain-native authentication with on-chain attestations on Solana

## Packages

### Standard SSO

- **[@alien_org/sso-sdk-core](./packages/core)** - Core TypeScript client for OIDC-style authentication
- **[@alien_org/sso-sdk-react](./packages/react)** - React hooks and components for Standard SSO

### Solana SSO

- **[@alien_org/solana-sso-sdk-core](./packages/solanaCore)** - Solana-specific authentication client with on-chain attestation support
- **[@alien_org/solana-sso-sdk-react](./packages/solanaReact)** - React hooks and components for Solana SSO

## Documentation

📚 **Full documentation available at [dev.alien.org/docs](https://dev.alien.org/docs)**

### Guides

- [Standard SSO Integration Guide](https://dev.alien.org/docs/sso-guide/introduction)
  - [Core Integration](https://dev.alien.org/docs/sso-guide/core-integration) - Vanilla JS/TS
  - [React Integration](https://dev.alien.org/docs/sso-guide/react-integration) - React hooks and components

- [Solana SSO Integration Guide](https://dev.alien.org/docs/solana-sso-guide/introduction)
  - [Core Integration](https://dev.alien.org/docs/solana-sso-guide/core-integration) - Vanilla JS/TS with Solana
  - [React Integration](https://dev.alien.org/docs/solana-sso-guide/react-integration) - React with wallet adapters

### API Reference

- [Standard SSO Core API](https://dev.alien.org/docs/sso-api-reference/api-reference-core) - `@alien_org/sso-sdk-core`
- [Standard SSO React API](https://dev.alien.org/docs/sso-api-reference/api-reference-react) - `@alien_org/sso-sdk-react`
- [Solana SSO Core API](https://dev.alien.org/docs/solana-sso-api-reference/api-reference-core) - `@alien_org/solana-sso-sdk-core`
- [Solana SSO React API](https://dev.alien.org/docs/solana-sso-api-reference/api-reference-react) - `@alien_org/solana-sso-sdk-react`

### Core Concepts

- [What is Alien Session?](https://dev.alien.org/docs/what-is-alien-session) - Session architecture and lifecycle
- [What is Alien Provider?](https://dev.alien.org/docs/what-is-alien-provider) - Provider registration and management

### Demo Applications

- [Standard SSO Demo App](https://dev.alien.org/docs/sso-demo-app) - Example React application
- [Solana SSO Demo dApp](https://dev.alien.org/docs/solana-sso-demo-dapp) - Example Solana dApp

## Development

This is a Turborepo monorepo. To work with the SDK locally:

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run in development mode (watch mode)
npm run dev

# Run tests
npm test

# Run demo apps
npm --filter example-sso-app run dev
npm --filter example-solana-sso-app run dev
```

## Getting a Provider Address

To use the SDK, you need a provider address. Register your application at the [Developer Portal](https://dev.alien.org/dashboard) to get your provider credentials.

## Features

- ✅ **TypeScript-first** with full type safety
- ✅ **Runtime validation** via Zod schemas
- ✅ **React hooks** and pre-built components
- ✅ **OIDC-compatible** standard authentication flow
- ✅ **Solana integration** with on-chain attestations
- ✅ **PKCE support** for secure authorization
- ✅ **Dual export formats**: ESM and CJS
- ✅ **Mobile-friendly** with QR code and deep link support

## Browser Support

- Modern browsers with ES2020+ support
- Chrome, Firefox, Safari, Edge (latest versions)

## Support

- 📖 [Documentation](https://dev.alien.org/docs)
- 🐛 [Report Issues](https://github.com/alien-org/sso-sdk-js/issues)
- 💬 [Discord Community](https://discord.gg/alien)
